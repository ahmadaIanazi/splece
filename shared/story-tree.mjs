import { isStructureClip, validateStructureNodes } from "./structure.mjs";
export function storyTree(beats, parentId = "") {
  const children = new Map();
  for (const node of beats) {
    const parent = node.parentId || "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node);
  }
  for (const list of children.values())
    list.sort((a, b) =>
      Number.isFinite(a.order) || Number.isFinite(b.order)
        ? (a.order ?? Number.MAX_SAFE_INTEGER) -
            (b.order ?? Number.MAX_SAFE_INTEGER) || a.start - b.start
        : a.start - b.start,
    );
  const result = [],
    seen = new Set(),
    stack = [...(children.get(parentId) || [])].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    result.push(node);
    stack.push(...[...(children.get(node.id) || [])].reverse());
  }
  return result;
}
export function descendants(beats, id) {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of beats)
      if (ids.has(b.parentId) && !ids.has(b.id)) {
        ids.add(b.id);
        changed = true;
      }
  }
  return ids;
}
export function storyDepth(beats, beat) {
  let depth = 0,
    parent = beat.parentId;
  const seen = new Set([beat.id]);
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    depth++;
    parent = beats.find((b) => b.id === parent)?.parentId;
  }
  return depth;
}
export const validateHierarchy = validateStructureNodes;

// Editorial allocation changes the plan, never generated media or fixed remarks.
export function retimeSection(beats, id, start, duration) {
  const b = beats.find((b) => b.id === id);
  if (
    !b ||
    !Number.isFinite(start) ||
    !Number.isFinite(duration) ||
    start < 0 ||
    duration < 0.01
  )
    throw Error("Enter a valid time budget.");
  const oldStart = b.start,
    scale = duration / b.duration,
    scope = descendants(beats, id);
  for (const node of beats.filter((n) => scope.has(n.id))) {
    node.start = start + (node.start - oldStart) * scale;
    node.duration *= scale;
    node.end = node.start + node.duration;
  }
}
export function allocateStoryTime(plan, parentId = "", equal = false) {
  const parent = plan.beats.find((b) => b.id === parentId);
  const duration = parent?.duration || plan.setup?.targetDuration || 60;
  if (!duration) throw Error("Set the overall target duration first.");
  const children = plan.beats
    .filter((b) => (b.parentId || "") === parentId)
    .sort((a, b) => a.start - b.start);
  const total = children.reduce((n, b) => n + b.duration, 0);
  let start = parent?.start || 0;
  for (const b of children) {
    const length = equal
      ? duration / children.length
      : (duration * b.duration) / total;
    retimeSection(plan.beats, b.id, start, length);
    start += length;
  }
}
export function resizeStorySection(plan, id, duration) {
  const b = plan.beats.find((b) => b.id === id),
    parent = plan.beats.find((n) => n.id === b.parentId);
  const siblings = plan.beats
    .filter((n) => (n.parentId || "") === (b.parentId || ""))
    .sort((a, b) => a.start - b.start);
  let start = parent?.start || 0;
  for (const n of siblings) {
    const length = n.id === id ? duration : n.duration;
    retimeSection(plan.beats, n.id, start, length);
    start += length;
  }
}
export function formatStoryTime(seconds) {
  const n = Math.round(seconds * 10) / 10;
  return `${Math.floor(n / 60)}:${(n % 60).toFixed(n % 1 ? 1 : 0).padStart(n % 1 ? 4 : 2, "0")}`;
}
export function childKind(kind) {
  return kind === "act"
    ? "chapter"
    : kind === "chapter"
      ? "scene"
      : "generation";
}

export function storyReadiness(project, beat, jobs = []) {
  const readyJob = jobs.some(
    (j) =>
      j.state === "ready" &&
      j.snapshot?.draft?.storyBeatId === beat.id &&
      j.snapshot?.draft?.episodeId === project.episodeId,
  );
  if (readyJob) return "generated";
  const descriptive = !!beat.description?.trim();
  const lines = beat.dialogue || [];
  const validDialogue = lines.every(
    (l) =>
      l.text?.trim() &&
      project.assets.some((a) => a.id === l.speaker && a.kind === "character"),
  );
  const missingCast = (beat.characterIds || []).some(
    (id) => !project.assets.some((a) => a.id === id),
  );
  return descriptive && validDialogue && !missingCast ? "ready" : "draft";
}
