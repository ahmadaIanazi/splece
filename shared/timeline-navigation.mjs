import { isStructureClip, structurePath } from "./structure.mjs";
import { storyTree } from "./story-tree.mjs";
import { generationTarget } from "./generation-slots.mjs";

const endOf = (c) => c.start + c.duration;
export const pictureEnd = (p) => Math.max(0, ...(p.clips || []).map(endOf));

// Story timing is a plan. The edit is the source of truth for navigation.
// Keep both: changing an edit must never rewrite the authored plan or a job receipt.
export function editedStoryTiming(p, jobs = []) {
  const beats = p.storyPlans?.[p.episodeId]?.beats || [];
  const result = new Map();
  const leaves = beats
    .filter(isStructureClip)
    .sort((a, b) => a.start - b.start);
  for (const b of leaves) {
    const primary = generationTarget(p, { storyBeatId: b.id }, jobs);
    const clips = (p.clips || []).filter(
      (c) => c.storyBeatId === b.id || c === primary,
    );
    if (clips.length)
      result.set(b.id, {
        start: Math.min(...clips.map((c) => c.start)),
        end: Math.max(...clips.map(endOf)),
        placed: true,
        clipId: primary?.id || clips[0].id,
      });
  }
  for (const c of p.clips || []) {
    if (c.structureNodeId && !result.has(c.structureNodeId))
      result.set(c.structureNodeId, {
        start: c.start,
        end: c.start + c.duration,
        placed: true,
        clipId: c.id,
      });
  }
  // An unmade or removed generation has an insertion point next to its surviving
  // story neighbor, not an obsolete timestamp in empty timeline space.
  for (let i = 0; i < leaves.length; i++) {
    const b = leaves[i];
    if (result.has(b.id)) continue;
    const next = leaves
      .slice(i + 1)
      .map((v) => result.get(v.id))
      .find((v) => v?.placed);
    const prev = leaves
      .slice(0, i)
      .reverse()
      .map((v) => result.get(v.id))
      .find((v) => v?.placed);
    const start = next?.start ?? prev?.end ?? pictureEnd(p);
    result.set(b.id, { start, end: start + b.duration, placed: false });
  }
  const childMap = new Map();
  for (const beat of beats) {
    const list = childMap.get(beat.parentId) || [];
    list.push(beat);
    childMap.set(beat.parentId, list);
  }
  // Bottom-up aggregation avoids a call-stack limit for deeply nested groups.
  for (const b of storyTree(beats).reverse()) {
    if (result.has(b.id)) continue;
    const children = (childMap.get(b.id) || [])
      .map((v) => result.get(v.id))
      .filter(Boolean);
    const placed = children.filter((v) => v.placed);
    const range = placed.length ? placed : children;
    result.set(
      b.id,
      range.length
        ? {
            start: Math.min(...range.map((v) => v.start)),
            end: Math.max(...range.map((v) => v.end)),
            placed: !!placed.length,
          }
        : {
            start: Math.min(b.start || 0, pictureEnd(p)),
            end: Math.min(b.start || 0, pictureEnd(p)),
            placed: false,
          },
    );
  }
  return result;
}

export function draftTimelinePosition(
  p,
  draft,
  jobs = [],
  timings = editedStoryTiming(p, jobs),
) {
  const story = timings.get(draft.storyBeatId);
  const clip =
    generationTarget(p, draft, jobs) ||
    (!draft.repair && story?.placed
      ? p.clips.find((c) => c.id === story.clipId)
      : null);
  let start = clip?.start ?? story?.start ?? draft.start ?? 0;
  const end = pictureEnd(p);
  start = Math.max(0, Math.min(start, end));
  // At an insertion point at the end, preview the last visible frame.
  const seek = clip
    ? clip.start
    : Math.min(start, Math.max(0, end - 1 / (p.settings?.export?.fps || 24)));
  return {
    clip,
    start,
    seek,
    duration: clip?.duration ?? draft.settings?.duration,
  };
}

export function syncEditedDraftTimes(p) {
  const timings = editedStoryTiming(p);
  for (const d of p.drafts || []) {
    if (d.episodeId && d.episodeId !== p.episodeId) continue;
    const position = draftTimelinePosition(p, d, [], timings);
    if (!position.clip && !d.storyBeatId && !d.targetId && !d.generationSlotId)
      continue;
    d.start = position.start;
    if (d.repair && position.clip) {
      d.repair.from = position.start;
      d.repair.to = position.start + d.repair.duration;
    }
  }
}

// Reveal deeper levels as the timeline zooms in, with screen-space collision checks. Manual remarks
// have their own lanes and remain fixed to their explicitly authored times.
export function storyTimelineLabels(
  p,
  zoom,
  timings = editedStoryTiming(p),
  viewportLeft = 0,
) {
  const beats = p.storyPlans?.[p.episodeId]?.beats || [];
  const existing = new Set(beats.map((b) => b.kind));
  const overview =
    zoom < 25 && existing.has("act")
      ? "act"
      : existing.has("chapter")
        ? "chapter"
        : "act";
  const detail = zoom >= 100 ? "generation" : zoom >= 45 ? "scene" : null;
  const kinds = [
    ...new Set([overview, detail].filter((kind) => existing.has(kind))),
  ];
  const canonical = p.storyPlans?.[p.episodeId]?.structureVersion === 1;
  const depth = (b) => structurePath(beats, b.id).length - 1;
  const maxDepth = Math.max(
    0,
    ...beats.filter((b) => !isStructureClip(b)).map(depth),
  );
  const level = 0;
  const selectors = canonical
    ? [
        (b) => !isStructureClip(b) && depth(b) === level,
        ...(zoom >= 100
          ? [isStructureClip]
          : zoom >= 45 && maxDepth > level
            ? [
                (b) => !isStructureClip(b) && depth(b) === level + 1,
                ...(maxDepth > 1 && zoom >= 55
                  ? [(b) => !isStructureClip(b) && depth(b) === 2]
                  : []),
              ]
            : []),
      ]
    : kinds.map((kind) => (b) => b.kind === kind);
  const labels = [];
  selectors.forEach((matches, lane) => {
    let edge = -Infinity;
    for (const b of beats
      .filter(matches)
      .sort(
        (a, b) =>
          (timings.get(a.id)?.start || 0) - (timings.get(b.id)?.start || 0),
      )) {
      const t = timings.get(b.id);
      if (!t?.placed) continue;
      const left = Math.max(t.start * zoom, viewportLeft);
      const width = Math.min(
        t.end * zoom - left - 12,
        Math.max(86, b.title.length * 6.2 + 30),
      );
      if (width < 52 || left < edge) continue;
      labels.push({ ...b, ...t, lane, width, left });
      edge = left + width + 12;
    }
  });
  return { labels, lanes: selectors.length };
}
