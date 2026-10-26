import { structurePath, isStructureClip } from "./structure.mjs";
import { stitchTimeline } from "./generation-slots.mjs";
import { syncPlannedTimings } from "./planned-timeline.mjs";

export function selectTimelineClips(
  clips,
  current,
  targets,
  { toggle = false, range = false, anchor = null } = {},
) {
  const ordered = [...clips].sort((a, b) => a.start - b.start).map((c) => c.id);
  const wanted = targets.filter((id) => ordered.includes(id));
  if (!wanted.length) return [];
  if (range && ordered.includes(anchor)) {
    const indices = [
      ordered.indexOf(anchor),
      ...wanted.map((id) => ordered.indexOf(id)),
    ];
    const span = ordered.slice(Math.min(...indices), Math.max(...indices) + 1);
    return toggle
      ? ordered.filter((id) => current.includes(id) || span.includes(id))
      : span;
  }
  if (toggle) {
    const remove = wanted.every((id) => current.includes(id));
    return ordered.filter((id) =>
      remove
        ? current.includes(id) && !wanted.includes(id)
        : current.includes(id) || wanted.includes(id),
    );
  }
  return ordered.filter((id) => wanted.includes(id));
}
export function moveTimelineSelection(project, ids, at) {
  if (!Number.isFinite(at)) return false;
  const set = new Set(ids),
    ordered = [...project.clips].sort((a, b) => a.start - b.start);
  const moving = ordered.filter((c) => set.has(c.id)),
    remaining = ordered.filter((c) => !set.has(c.id));
  if (!moving.length) return false;
  const index = remaining.findIndex((c) => at < c.start + c.duration / 2);
  remaining.splice(index < 0 ? remaining.length : index, 0, ...moving);
  if (remaining.every((c, i) => c.id === ordered[i].id)) return false;
  stitchTimeline(project, remaining);
  syncPlannedTimings(project);
  return true;
}
// Folding changes presentation only: real time, media, jobs and clip IDs stay intact.
// If unrelated clips interleave a group, show separate runs rather than hiding them.
export function foldedTimeline(project, collapsed = []) {
  const nodes = project.storyPlans?.[project.episodeId]?.beats || [];
  const folded = new Set(collapsed),
    items = [];
  for (const clip of [...project.clips].sort((a, b) => a.start - b.start)) {
    const owner = structurePath(
      nodes,
      clip.storyBeatId || clip.structureNodeId,
    ).find((n) => !isStructureClip(n) && folded.has(n.id));
    if (!owner) {
      items.push({
        type: "clip",
        id: clip.id,
        start: clip.start,
        duration: clip.duration,
        clip,
      });
      continue;
    }
    const previous = items.at(-1);
    if (
      previous?.node?.id === owner.id &&
      Math.abs(previous.start + previous.duration - clip.start) < 0.001
    ) {
      previous.members.push(clip);
      previous.duration += clip.duration;
    } else
      items.push({
        type: "group",
        id: `fold:${owner.id}:${clip.id}`,
        node: owner,
        start: clip.start,
        duration: clip.duration,
        members: [clip],
      });
  }
  return items;
}
