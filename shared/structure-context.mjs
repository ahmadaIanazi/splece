import {
  reconcilePlannedTimeline,
  moveTimelineGroup,
  syncPlannedTimings,
} from "./planned-timeline.mjs";
import { reorderStorySlot } from "./generation-slots.mjs";
import { editedStoryTiming } from "./timeline-navigation.mjs";
import { storyPlan } from "./authoring.mjs";
import { isStructureClip } from "./structure.mjs";
import { projectReferenceDraft } from "./asset-scope.mjs";
const prose = (d) =>
  (d?.scenes || []).map((s) => ({
    text: s.text || "",
    camera: s.camera,
    movement: s.movement,
    dialogue: s.dialogue || [],
    characterIds: s.characterIds || [],
    locationId: s.locationId,
  }));
export function editorPlanningContext(p, jobs = []) {
  const drafts = (p.drafts || []).filter(
    (d) => !d.episodeId || d.episodeId === p.episodeId,
  );
  const clips = (p.clips || [])
    .map((c) => {
      const take = c.takes?.find((t) => t.id === c.activeTake);
      const generated = jobs.find(
        (j) => j.id === take?.jobId && j.projectId === p.id,
      )?.snapshot?.draft;
      const draft =
        drafts.find((d) => d.id === c.sourceDraftId) ||
        drafts.find((d) => d.targetId === c.id) ||
        drafts.find((d) => d.storyBeatId && d.storyBeatId === c.storyBeatId);
      return {
        id: c.id,
        storyBeatId:
          c.storyBeatId || c.structureNodeId || draft?.storyBeatId || null,
        title: c.name || draft?.name || "",
        start: c.start,
        duration: c.duration,
        sourceIn: c.sourceIn ?? c.in ?? 0,
        speed: c.speed || 1,
        reverse: !!c.reverse,
        activeTake: c.activeTake,
        generated: !!take?.jobId,
        submittedWriting: prose(generated),
        submittedDirection: generated
          ? {
              general: generated.general,
              notes: generated.notes,
              contextNotes: generated.contextNotes,
            }
          : null,
        direction: draft
          ? {
              general: draft.general,
              notes: draft.notes,
              contextNotes: draft.contextNotes,
            }
          : null,
        referenceIds: draft?.referenceIds || [],
        writing: prose(draft),
      };
    })
    .sort((a, b) => a.start - b.start);
  return {
    source:
      "Current saved Editor state; text is authored intent, not visual analysis.",
    clips,
    drafts: drafts.map((d) => ({
      id: d.id,
      storyBeatId: d.storyBeatId || null,
      name: d.name,
      start: d.start,
      duration: d.plannedDuration || d.settings?.duration,
      referenceIds: d.referenceIds || [],
      writing: prose(d),
      general: d.general,
      notes: d.notes,
      contextNotes: d.contextNotes,
    })),
  };
}
export const editorPlanningSignature = (p) =>
  JSON.stringify(editorPlanningContext(p));
export function structureTiming(p) {
  const plan = storyPlan(p),
    edited = editedStoryTiming(p),
    ranges = new Map();
  for (const n of plan.beats) {
    const live = edited.get(n.id);
    ranges.set(
      n.id,
      live?.placed
        ? live
        : { start: n.start, end: n.start + n.duration, placed: false },
    );
  }
  return ranges;
}
export function structureAssistantContext(p, nodeId = null) {
  if (!p) return null;
  const plan = storyPlan(p),
    node = plan.beats.find((n) => n.id === nodeId),
    timing = structureTiming(p),
    ordered = plan.beats
      .filter(isStructureClip)
      .sort((a, b) => timing.get(a.id).start - timing.get(b.id).start),
    at = ordered.findIndex((n) => n.id === nodeId);
  return {
    workspace: "structure",
    workflows: p.settings?.workflows,
    projectId: p.id,
    episodeId: p.episodeId,
    nodeId: node?.id || null,
    text: node?.description || plan.setup?.concept || plan.brief || "",
    title: node?.title || plan.title,
    story: {
      brief: plan.brief,
      synopsis: plan.synopsis,
      setup: plan.setup,
      connectionNotes: plan.connectionNotes || [],
      outline: plan.beats.map((n) => ({
        id: n.id,
        parentId: n.parentId,
        title: n.title,
        description: n.description,
        characterIds: n.characterIds,
        locationId: n.locationId,
        dialogue: n.dialogue,
        start: n.start,
        duration: n.duration,
      })),
    },
    before: at > 0 ? ordered[at - 1] : null,
    after: at >= 0 ? ordered[at + 1] || null : null,
    references: p.assets
      .filter((a) =>
        ["character", "location", "prop", "style"].includes(a.kind),
      )
      .map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        description: a.description,
      })),
    editor: editorPlanningContext(p),
  };
}
export function validateStructureSuggestions(raw, context) {
  if (!Array.isArray(raw?.suggestions) || raw.suggestions.length > 4)
    throw Error(
      "Assistant suggestions were not readable. Your writing is unchanged.",
    );
  const seen = new Set();
  return {
    suggestions: raw.suggestions.map((s, i) => {
      if (
        !["character", "location", "prop", "connection"].includes(s.kind) ||
        typeof s.message !== "string" ||
        !s.message.trim() ||
        s.message.length > 500
      )
        throw Error("Invalid Structure suggestion.");
      const asset = s.assetId
        ? context.references.find(
            (a) => a.id === s.assetId && a.kind === s.kind,
          )
        : null;
      if (s.assetId && !asset)
        throw Error("Assistant suggested an unknown reference.");
      if (
        s.kind !== "connection" &&
        !asset &&
        (typeof s.name !== "string" || !s.name.trim() || s.name.length > 80)
      )
        throw Error("Missing reference name.");
      const key = s.assetId || `${s.kind}:${s.name || s.message}`;
      if (seen.has(key)) throw Error("Duplicate assistant suggestion.");
      seen.add(key);
      return {
        id: String(i),
        kind: s.kind,
        message: s.message,
        assetId: asset?.id || null,
        name: asset?.name || s.name || "",
        description:
          typeof s.description === "string"
            ? s.description.slice(0, 1000)
            : s.message,
      };
    }),
  };
}
export function simulateStructureSuggestions(context) {
  const suggestions = [];
  for (const kind of ["character", "location"])
    if (!context.references.some((a) => a.kind === kind))
      suggestions.push({
        kind,
        name: kind === "character" ? "Main character" : "Story setting",
        message:
          kind === "character"
            ? "Give the main character a reusable identity for continuity."
            : "Define a reusable setting to connect the clips.",
        description: context.text.slice(0, 500),
      });
  if (!suggestions.length)
    suggestions.push({
      kind: "connection",
      message: context.after
        ? `Connect this moment to “${context.after.title}” without revealing its action early.`
        : "Keep a recurring visual detail across the opening and closing moments.",
    });
  return {
    suggestions: suggestions.filter(
      (s) => !context.story.connectionNotes.includes(s.message),
    ),
  };
}
export function acceptStructureSuggestion(p, context, suggestion) {
  if (
    JSON.stringify(structureAssistantContext(p, context.nodeId)) !==
    JSON.stringify(context)
  )
    throw Error("The story changed. Wait for fresh suggestions.");
  const plan = storyPlan(p),
    node = plan.beats.find((n) => n.id === context.nodeId);
  if (suggestion.kind === "connection") {
    plan.connectionNotes = [
      ...new Set([...(plan.connectionNotes || []), suggestion.message]),
    ];
    return { kind: "connection" };
  }
  let asset = p.assets.find((a) => a.id === suggestion.assetId);
  if (!asset) {
    asset = projectReferenceDraft({
      id: crypto.randomUUID(),
      kind: suggestion.kind,
      name: suggestion.name,
      description: suggestion.description,
    });
    p.assets.push(asset);
  }
  if (node) {
    const key = asset.kind === "character" ? "characterIds" : "assetIds";
    node[key] = [...new Set([...(node[key] || []), asset.id])];
    if (asset.kind === "location") node.locationId = asset.id;
  } else {
    plan.setup ??= {};
    const key = asset.kind === "character" ? "castIds" : "assetIds";
    plan.setup[key] = [...new Set([...(plan.setup[key] || []), asset.id])];
  }
  return { kind: asset.kind, assetId: asset.id };
}

export function moveStructureTime(p, id, at) {
  reconcilePlannedTimeline(p);
  const node = storyPlan(p).beats.find((n) => n.id === id);
  if (!node) return;
  if (isStructureClip(node)) {
    const slot = p.clips.find(
      (c) => c.storyBeatId === id || c.structureNodeId === id,
    );
    if (slot) reorderStorySlot(p, slot.id, at);
    syncPlannedTimings(p);
  } else moveTimelineGroup(p, id, at);
}

// Equal-sized storyboard cells keep every clip legible. Exact edited time lives
// on the ruler; group spans are derived from their descendant cells.
export function structureStoryboard(p, folded = {}) {
  const plan = storyPlan(p),
    ranges = structureTiming(p),
    byId = new Map(plan.beats.map((n) => [n.id, n]));
  const hidden = (n) => {
    let parent = n.parentId;
    const seen = new Set();
    while (parent && !seen.has(parent)) {
      if (folded[parent]) return true;
      seen.add(parent);
      parent = byId.get(parent)?.parentId;
    }
    return false;
  };
  const visible = plan.beats.filter((n) => !hidden(n));
  const cells = visible
    .filter(
      (n) =>
        isStructureClip(n) ||
        folded[n.id] ||
        !plan.beats.some((b) => b.parentId === n.id),
    )
    .sort(
      (a, b) =>
        ranges.get(a.id).start - ranges.get(b.id).start ||
        (a.order ?? plan.beats.indexOf(a)) - (b.order ?? plan.beats.indexOf(b)),
    );
  const ancestors = (id) => {
    const result = new Set([id]);
    let n = byId.get(id);
    while (n?.parentId && !result.has(n.parentId)) {
      result.add(n.parentId);
      n = byId.get(n.parentId);
    }
    return result;
  };
  const paths = cells.map((n) => ancestors(n.id));
  const groups = visible
    .filter((n) => !isStructureClip(n))
    .map((n) => {
      const indices = paths.flatMap((path, i) => (path.has(n.id) ? [i] : []));
      return {
        node: n,
        first: Math.min(...indices),
        last: Math.max(...indices),
      };
    })
    .filter((g) => Number.isFinite(g.first));
  return { cells, groups, ranges };
}

export const structureReviewKey = (project, nodeId) => `${project.episodeId}:${nodeId || "story"}`;
export function saveStructureReview(project, context, answer) {
  if (JSON.stringify(structureAssistantContext(project, context.nodeId)) !== JSON.stringify(context)) return false;
  project.structureAssistantReviews ??= {};
  const key = structureReviewKey(project, context.nodeId);
  project.structureAssistantReviews[key] = {
    receiptId: answer.id,
    fingerprint: JSON.stringify(context),
    mode: answer.executionMode,
    items: answer.decision.suggestions.map(item => ({ ...item, status: "pending" })),
  };
  const keys = Object.keys(project.structureAssistantReviews);
  for (const old of keys.slice(0, Math.max(0, keys.length - 80))) if (old !== key) delete project.structureAssistantReviews[old];
  return true;
}
// Applying one choice rebases this batch, preserving its siblings without another AI call.
export function resolveStructureSuggestion(project, nodeId, itemId, dismiss = false) {
  const context = structureAssistantContext(project, nodeId);
  const review = project.structureAssistantReviews?.[structureReviewKey(project, nodeId)];
  if (!review || review.fingerprint !== JSON.stringify(context)) throw Error("Your story changed. Check it again for fresh suggestions.");
  const item = review.items.find(item => item.id === itemId);
  if (!item || item.status !== "pending") return;
  const result = dismiss ? null : acceptStructureSuggestion(project, context, item);
  Object.assign(item, result, { status: dismiss ? "dismissed" : "accepted" });
  review.fingerprint = JSON.stringify(structureAssistantContext(project, nodeId));
  return result;
}
