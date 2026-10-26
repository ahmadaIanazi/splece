import { moveStructureItem } from "./structure-document.mjs";
import { descendants } from "./story-tree.mjs";
import { stitchTimeline } from "./generation-slots.mjs";
import { editedStoryTiming } from "./timeline-navigation.mjs";
import {
  reconcilePlannedTimeline,
  editablePlannedSlot,
  editPlannedSlot,
  syncPlannedTimings,
} from "./planned-timeline.mjs";
import { isStructureClip } from "./structure.mjs";

export function plannedStructureSlot(project, nodeId) {
  return project.clips.find(
    (c) => c.storyBeatId === nodeId || c.structureNodeId === nodeId,
  );
}
export function resizeStructureClip(project, nodeId, duration, models = []) {
  const node = project.storyPlans?.[project.episodeId]?.beats.find(
    (n) => n.id === nodeId,
  );
  if (
    !node ||
    !isStructureClip(node) ||
    !Number.isFinite(duration) ||
    duration < 1 ||
    duration > 3600
  )
    return false;
  // Do not alter a generated/pending take or its source media to satisfy a planning gesture.
  const existing = plannedStructureSlot(project, nodeId);
  if (existing && !editablePlannedSlot(existing)) return false;
  reconcilePlannedTimeline(project);
  return editPlannedSlot(
    project,
    plannedStructureSlot(project, nodeId)?.id,
    { duration },
    models,
  );
}
// Cards have equal width: time is mapped locally within each card, not globally.
export function structureDurationTicks(duration, width) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const majorStep = 5 * Math.max(1, Math.ceil(duration / 300));
  const step = width / duration >= 7 ? 1 : majorStep;
  const ticks = [];
  for (let time = step; time < duration; time += step) {
    ticks.push({
      time,
      fraction: time / duration,
      major: time % majorStep === 0,
    });
  }
  return ticks;
}
// A parent can span several separated runs after editorial reordering. Avoid
// enclosing unrelated clips; render a continuation of the same parent instead.
export function structureGroupRuns(plan, cells, groups) {
  const byId = new Map(plan.beats.map((n) => [n.id, n]));
  const paths = cells.map((n) => {
    const ids = new Set([n.id]);
    while (n?.parentId && !ids.has(n.parentId)) {
      ids.add(n.parentId);
      n = byId.get(n.parentId);
    }
    return ids;
  });
  return groups.flatMap(({ node }) => {
    const runs = [];
    paths.forEach((path, i) => {
      if (!path.has(node.id)) return;
      const last = runs.at(-1);
      if (last && last.last === i - 1) last.last = i;
      else runs.push({ node, first: i, last: i });
    });
    return runs;
  });
}

// One transaction owns hierarchy, placement and editable prompt timing.
export function moveStructureTimelineItem(
  project,
  id,
  targetId,
  position = "inside",
) {
  const plan = project.storyPlans?.[project.episodeId];
  const next = structuredClone(plan);
  moveStructureItem(next, id, targetId, position); // validates before any mutation
  const before = new Set(plan.beats.map((n) => n.parentId).filter(Boolean));
  const target = plan.beats.find((n) => n.id === targetId);
  const branch = descendants(plan.beats, id);
  reconcilePlannedTimeline(project);
  const ordered = [...project.clips].sort((a, b) => a.start - b.start);
  const moving = ordered.filter((c) =>
    branch.has(c.storyBeatId || c.structureNodeId),
  );
  const targetIds = descendants(plan.beats, targetId);
  const targetSlots = ordered.filter(
    (c) =>
      targetIds.has(c.storyBeatId || c.structureNodeId) && !moving.includes(c),
  );
  const boundary =
    position === "before" || (position === "inside" && !before.has(targetId))
      ? (targetSlots[0]?.start ?? target.start)
      : targetSlots.at(-1)
        ? targetSlots.at(-1).start + targetSlots.at(-1).duration
        : target.start;
  const parents = new Set(next.beats.map((n) => n.parentId).filter(Boolean));
  let rest = ordered.filter(
    (c) =>
      !moving.includes(c) &&
      !(parents.has(c.structureNodeId) && editablePlannedSlot(c)),
  );
  const at = rest.findIndex((c) => c.start >= boundary - 0.001);
  rest.splice(at < 0 ? rest.length : at, 0, ...moving);
  plan.beats = next.beats;
  for (const n of plan.beats)
    if (!isStructureClip(n) && before.has(n.id) && !parents.has(n.id)) {
      n.duration = 0;
      n.end = n.start;
    }
  project.clips = rest;
  stitchTimeline(project, rest);
  syncPlannedTimings(project);
  const timing = editedStoryTiming(project);
  for (const n of plan.beats)
    if (!isStructureClip(n)) {
      const range = timing.get(n.id);
      if (range) {
        n.start = range.start;
        n.duration = range.end - range.start;
        n.end = range.end;
      }
    }
  return true;
}
