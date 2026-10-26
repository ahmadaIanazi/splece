import {
  isStructureClip,
  createStructureNode,
  structurePath,
} from "./structure.mjs";
import { storyTree, descendants } from "./story-tree.mjs";
import {
  stitchTimeline,
  resizeSlot,
  reorderStorySlot,
  generationTarget,
} from "./generation-slots.mjs";
import { editedStoryTiming } from "./timeline-navigation.mjs";

export const editablePlannedSlot = (slot) =>
  !!slot?.plannedReservation && !slot.activeTake && !slot.generationRequested;

// A deliberate planning edit updates the outline as well as its reservations.
// Media trims still keep their authored plan; job snapshots are never rewritten.
export function editPlannedSlot(project, slotId, change, models = []) {
  const slot = project.clips.find((c) => c.id === slotId);
  if (!editablePlannedSlot(slot)) return false;
  if (change.duration !== undefined) {
    if (!Number.isFinite(change.duration) || change.duration < 0.1)
      return false;
    resizeSlot(project, slot, Math.round(change.duration * 1000) / 1000);
  }
  if (Number.isFinite(change.dropTime))
    reorderStorySlot(project, slot.id, Math.max(0, change.dropTime));
  syncPlannedTimings(project);
  for (const draft of project.drafts) {
    if (draft.episodeId && draft.episodeId !== project.episodeId) continue;
    const target = generationTarget(project, draft);
    if (!editablePlannedSlot(target)) continue;
    // Follow the requested length when the model can supply it exactly. Otherwise
    // retain the valid provider setting and show both lengths in the composer.
    const model = models.find((m) => m.id === draft.settings?.model);
    if (
      change.duration !== undefined &&
      target.id === slot.id &&
      model?.durations?.includes(target.duration)
    )
      draft.settings.duration = target.duration;
  }
  return true;
}

// Shared by deliberate planning edits; fixed-time notes/audio and receipts stay intact.
export function syncPlannedTimings(project) {
  const timings = editedStoryTiming(project);
  for (const node of project.storyPlans?.[project.episodeId]?.beats || []) {
    const range = timings.get(node.id);
    if (!range?.placed) continue;
    node.start = range.start;
    node.duration = range.end - range.start;
    node.end = range.end;
  }
  for (const draft of project.drafts) {
    if (draft.episodeId && draft.episodeId !== project.episodeId) continue;
    const target = generationTarget(project, draft);
    if (!target) continue;
    draft.start = target.start;
    if (editablePlannedSlot(target)) draft.plannedDuration = target.duration;
  }
}

export function groupSlots(project, nodeId) {
  const nodes = project.storyPlans?.[project.episodeId]?.beats || [];
  const ids = descendants(nodes, nodeId);
  return project.clips
    .filter((c) => ids.has(c.structureNodeId) || ids.has(c.storyBeatId))
    .sort((a, b) => a.start - b.start);
}

export function moveTimelineGroup(project, nodeId, dropTime) {
  if (!Number.isFinite(dropTime)) return false;
  const nodes = project.storyPlans?.[project.episodeId]?.beats || [];
  const node = nodes.find((n) => n.id === nodeId);
  if (!node || isStructureClip(node)) return false;
  const moving = groupSlots(project, nodeId);
  if (!moving.length) return false;
  const ids = new Set(moving.map((c) => c.id));
  const ordered = [...project.clips].sort((a, b) => a.start - b.start);
  const others = ordered.filter((c) => !ids.has(c.id));
  const index = others.findIndex((c) => dropTime < c.start + c.duration / 2);
  others.splice(index < 0 ? others.length : index, 0, ...moving);
  if (others.every((c, i) => c.id === ordered[i].id)) return false;
  stitchTimeline(project, others);
  syncPlannedTimings(project);
  return true;
}

// Insert at an actual cut. Inside one group, inherit that group; across groups,
// use their common ancestor. An empty group stays a sibling, not an implicit parent.
export function insertPlannedNode(project, type, at) {
  if (!["clip", "group"].includes(type) || !Number.isFinite(at)) return null;
  project.storyPlans ??= {};
  const plan = (project.storyPlans[project.episodeId] ??= {
    title: project.name || "Structure",
    brief: "",
    synopsis: "",
    beats: [],
    structureVersion: 1,
  });
  const ordered = [...project.clips].sort((a, b) => a.start - b.start);
  let index = ordered.findIndex((c) => at < c.start + c.duration / 2);
  if (index < 0) index = ordered.length;
  const parentPath = (c) =>
    c
      ? structurePath(plan.beats, c.storyBeatId || c.structureNodeId).slice(
          0,
          -1,
        )
      : [];
  const left = parentPath(ordered[index - 1]),
    right = parentPath(ordered[index]);
  const parent = !ordered[index - 1]
    ? right.at(-1)
    : !ordered[index]
      ? left.at(-1)
      : left.filter((n) => right.some((r) => r.id === n.id)).at(-1);
  const node = createStructureNode(plan, type, parent?.id || "");
  node.start =
    ordered[index]?.start ??
    (ordered.length ? ordered.at(-1).start + ordered.at(-1).duration : 0);
  node.end = node.start + node.duration;
  plan.beats.push(node);
  reconcilePlannedTimeline(project);
  const slot = project.clips.find((c) => c.structureNodeId === node.id);
  ordered.splice(index, 0, slot);
  stitchTimeline(project, ordered);
  syncPlannedTimings(project);
  return node;
}

// Planned slots are real editorial reservations, not generated media. The slot
// identity survives filling, trimming and regeneration; a job still owns its take.
export function reconcilePlannedTimeline(
  project,
  makeId = () => crypto.randomUUID(),
) {
  const nodes = project.storyPlans?.[project.episodeId]?.beats || [];
  const parents = new Set(nodes.map((n) => n.parentId).filter(Boolean));
  const leaves = storyTree(nodes).filter((n) => !parents.has(n.id) && (isStructureClip(n) || n.duration !== 0));
  const wanted = new Set(leaves.map((n) => n.id));
  let changed = false;
  project.clips = project.clips.filter((c) => {
    if (
      c.plannedReservation &&
      !c.takes.length &&
      !c.generationRequested &&
      !wanted.has(c.structureNodeId || c.storyBeatId)
    ) {
      changed = true;
      return false;
    }
    return true;
  });
  const ordered = [...project.clips].sort((a, b) => a.start - b.start);
  for (let i = 0; i < leaves.length; i++) {
    const node = leaves[i];
    let slot = ordered.find(
      (c) => c.storyBeatId === node.id || c.structureNodeId === node.id,
    );
    if (slot) {
      if (
        slot.plannedReservation &&
        !slot.takes.length &&
        !slot.generationRequested &&
        slot.duration !== node.duration
      ) {
        slot.duration = node.duration;
        changed = true;
      }
      continue;
    }
    slot = {
      id: makeId(),
      structureNodeId: node.id,
      ...(isStructureClip(node) ? { storyBeatId: node.id } : {}),
      plannedReservation: true,
      start: node.start || 0,
      duration: node.duration || 5,
      in: 0,
      takes: [],
      activeTake: null,
      volume: 1,
      mute: false,
    };
    // Anchor missing items to surviving neighbors, preserving manual edits/order.
    const following = new Set(leaves.slice(i + 1).map((n) => n.id));
    let at = ordered.findIndex((c) =>
      following.has(c.storyBeatId || c.structureNodeId),
    );
    if (at < 0) {
      const preceding = new Set(leaves.slice(0, i).map((n) => n.id));
      const previous = ordered.findLastIndex((c) =>
        preceding.has(c.storyBeatId || c.structureNodeId),
      );
      at = previous < 0 ? ordered.length : previous + 1;
    }
    ordered.splice(at, 0, slot);
    project.clips.push(slot);
    changed = true;
  }
  if (changed) stitchTimeline(project, ordered);
  return changed;
}

export function plannedNode(project, slot) {
  return project.storyPlans?.[project.episodeId]?.beats.find(
    (n) => n.id === (slot?.storyBeatId || slot?.structureNodeId),
  );
}

// Explicitly filling a reservation preserves the planned node/slot identity.
export function fillPlannedSlot(project, incoming, at, matchStory = true) {
  const available = project.clips.filter(
    (c) =>
      c.plannedReservation &&
      c.storyBeatId &&
      !c.activeTake &&
      !c.generationRequested,
  );
  const slot =
    (matchStory &&
      incoming.storyBeatId &&
      available.find((c) => c.storyBeatId === incoming.storyBeatId)) ||
    available.find(
      (c) => Number.isFinite(at) && at >= c.start && at < c.start + c.duration,
    );
  if (!slot) return null;
  const preserved = {
    id: slot.id,
    start: slot.start,
    storyBeatId: slot.storyBeatId,
    structureNodeId: slot.structureNodeId,
  };
  const duration = matchStory
    ? incoming.duration
    : Math.min(slot.duration, incoming.duration);
  resizeSlot(project, slot, duration);
  Object.assign(slot, structuredClone(incoming), preserved, {
    duration,
    plannedReservation: true,
  });
  slot.generationTargets = [
    ...new Set(
      [...(slot.generationTargets || []), incoming.id].filter(
        (id) => id && id !== slot.id,
      ),
    ),
  ];
  return slot;
}

// Deleting an unfilled plan removes its source node too, so reconciliation cannot
// silently recreate it. The caller's ordinary project Undo retains the whole edit.
export function removePlannedClip(project, slotId) {
  const slot = project.clips.find(c => c.id === slotId);
  if (!slot || slot.activeTake || !slot.plannedReservation) return false;
  const plan = project.storyPlans?.[project.episodeId];
  const nodeId = slot.storyBeatId || slot.structureNodeId;
  const ids = plan && nodeId ? descendants(plan.beats, nodeId) : new Set();
  if (project.clips.some(c => c.id !== slotId && (ids.has(c.storyBeatId) || ids.has(c.structureNodeId)))) return false;
  if (plan) plan.beats = plan.beats.filter(b => !ids.has(b.id));
  const removed = new Set(project.drafts.filter(d => d.episodeId === project.episodeId && (ids.has(d.storyBeatId) || d.targetId === slotId || d.generationSlotId === slotId)).map(d=>d.id));
  project.drafts = project.drafts.filter(d => !removed.has(d.id));
  if (removed.has(project.activeDraftId)) project.activeDraftId = project.drafts.find(d=>d.episodeId===project.episodeId)?.id || null;
  project.clips = project.clips.filter(c=>c.id!==slotId);
  stitchTimeline(project);
  syncPlannedTimings(project);
  return true;
}
