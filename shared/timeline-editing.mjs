import {
  resizeSlot,
  stitchTimeline,
  markIndependentSegment,
} from "./generation-slots.mjs";
import {
  editPlannedSlot,
  editablePlannedSlot,
  insertPlannedNode,
  syncPlannedTimings,
} from "./planned-timeline.mjs";
import { takeSourceIn } from "./repair.mjs";

// Both pointer previews and commits use the same bounds and ripple calculation.
export function trimTimelineClip(
  project,
  id,
  edge,
  delta,
  fps = 24,
  models = [],
) {
  const c = project.clips.find((c) => c.id === id);
  if (!c || !Number.isFinite(delta)) return;
  delta = Math.round(delta * fps) / fps;
  const minimum = 1 / fps;
  if (editablePlannedSlot(c)) {
    editPlannedSlot(
      project,
      id,
      {
        duration: Math.max(
          0.1,
          c.duration + (edge === "left" ? -delta : delta),
        ),
      },
      models,
    );
    return;
  }
  const take = c.takes.find((t) => t.id === c.activeTake);
  if (!take) return;
  const sourceIn = takeSourceIn(c, take) || 0;
  if (edge === "left") {
    const shift = Math.max(-sourceIn, Math.min(c.duration - minimum, delta));
    c.in = (c.in || 0) + shift;
    if (c.repair)
      c.takes = c.takes.map((t) => ({
        ...t,
        sourceIn: (t.sourceIn || 0) + shift,
      }));
    resizeSlot(project, c, c.duration - shift);
  } else {
    resizeSlot(
      project,
      c,
      Math.max(minimum, Math.min(take.duration - sourceIn, c.duration + delta)),
    );
  }
}

function segment(c, from, to, id) {
  const next = structuredClone(c),
    offset = from - c.start;
  Object.assign(next, {
    id,
    start: from,
    in: (c.in || 0) + offset,
    duration: to - from,
  });
  if (next.repair)
    next.takes = next.takes.map((t) => ({
      ...t,
      sourceIn: (t.sourceIn || 0) + offset,
    }));
  markIndependentSegment(next);
  return next;
}
export function copyTimelineRange(project, range) {
  if (
    !range ||
    !Number.isFinite(range.from) ||
    !Number.isFinite(range.to) ||
    range.to <= range.from
  )
    return null;
  const clips = project.clips
    .filter((c) => c.start < range.to && c.start + c.duration > range.from)
    .sort((a, b) => a.start - b.start);
  if (!clips.length) throw Error("Select a range containing footage.");
  if (clips.some((c) => !c.activeTake))
    throw Error(
      "Generate or import footage into planned slots before copying or removing this range.",
    );
  const parts = clips.map((c) =>
    segment(
      c,
      Math.max(range.from, c.start),
      Math.min(range.to, c.start + c.duration),
      c.id,
    ),
  );
  return {
    type: "video-range",
    projectId: project.id,
    clips: parts,
    duration: parts.reduce((n, c) => n + c.duration, 0),
  };
}
export function removeTimelineRange(
  project,
  range,
  makeId = () => crypto.randomUUID(),
) {
  const copied = copyTimelineRange(project, range);
  if (!copied) return;
  const next = [];
  project.removedClips ??= [];
  for (const c of [...project.clips].sort((a, b) => a.start - b.start)) {
    const from = Math.max(range.from, c.start),
      to = Math.min(range.to, c.start + c.duration);
    if (to <= from) {
      next.push(c);
      continue;
    }
    const removed = segment(c, from, to, makeId());
    project.removedClips.push({
      episodeId: project.episodeId,
      removedAt: Date.now(),
      clip: removed,
    });
    if (from > c.start + 1e-6) next.push(segment(c, c.start, from, c.id));
    if (to < c.start + c.duration - 1e-6)
      next.push(
        segment(
          c,
          to,
          c.start + c.duration,
          from > c.start + 1e-6 ? makeId() : c.id,
        ),
      );
  }
  project.clips = next;
  stitchTimeline(project);
  return copied;
}
export function pasteTimelineRange(
  project,
  copied,
  at,
  makeId = () => crypto.randomUUID(),
) {
  if (copied.projectId !== project.id)
    throw Error("Paste footage within its original project.");
  const ordered = [...project.clips].sort((a, b) => a.start - b.start),
    next = [];
  let inserted = false;
  const additions = copied.clips.map((c) => {
    const part = segment(c, c.start, c.start + c.duration, makeId());
    part.generationTargets = [];
    delete part.storyBeatId;
    delete part.structureNodeId;
    delete part.sourceDraftId;
    return part;
  });
  const insert = () => {
    next.push(...additions);
    inserted = true;
  };
  for (const c of ordered) {
    if (!inserted && at <= c.start) insert();
    if (!inserted && at > c.start && at < c.start + c.duration) {
      next.push(segment(c, c.start, at, c.id));
      insert();
      next.push(segment(c, at, c.start + c.duration, makeId()));
    } else next.push(c);
  }
  if (!inserted) insert();
  project.clips = next;
  stitchTimeline(project);
  return additions;
}

// Insert at the precise playhead, preserving both surrounding source segments.
export function insertPromptAtFrame(
  project,
  clipId,
  at,
  duration,
  makeId = () => crypto.randomUUID(),
) {
  const c = project.clips.find((c) => c.id === clipId);
  if (!c?.activeTake) throw Error("Select a frame inside a completed clip.");
  const fps = project.settings?.export?.fps || 24;
  const time = Math.max(
    c.start,
    Math.min(c.start + c.duration, Math.round(at * fps) / fps),
  );
  const media = c.takes.find((t) => t.id === c.activeTake),
    sourceIn = takeSourceIn(c, media) || 0;
  const frame = (offset) => ({
    clipId: c.id,
    takeId: media.id,
    time: Math.max(
      sourceIn,
      Math.min(sourceIn + c.duration - 1 / fps, sourceIn + offset),
    ),
    timelineCapture: true,
  });
  const frames = {
    start: frame(time - c.start - 1 / fps),
    end: frame(time - c.start),
  };
  if (time > c.start + 1e-6 && time < c.start + c.duration - 1e-6) {
    const left = segment(c, c.start, time, c.id),
      right = segment(c, time, c.start + c.duration, makeId());
    project.clips = project.clips.flatMap((x) =>
      x.id === c.id ? [left, right] : [x],
    );
  }
  const node = insertPlannedNode(project, "clip", time);
  const slot = project.clips.find((c) => c.structureNodeId === node.id);
  editPlannedSlot(project, slot.id, { duration });
  syncPlannedTimings(project);
  return { node, slot, frames };
}
