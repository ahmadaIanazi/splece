import { isStructureClip, validateStructureNodes } from "./structure.mjs";
import { storyTree, descendants, retimeSection } from "./story-tree.mjs";

// Document order is independent of advisory timing and placed video clips.
export function moveStructureItem(plan, id, targetId, position = "before") {
  const node = plan.beats.find((b) => b.id === id);
  const target = plan.beats.find((b) => b.id === targetId);
  if (!node || (targetId && !target))
    throw Error("This section is no longer available.");
  if (!["before", "after", "inside"].includes(position))
    throw Error("Unknown move position.");
  const branch = descendants(plan.beats, id);
  if (target && branch.has(target.id))
    throw Error("A group cannot be moved into itself or its contents.");
  if (position === "inside" && target && isStructureClip(target))
    throw Error("Choose a group to nest this section.");
  const parentId = !target
    ? ""
    : position === "inside"
      ? target.id
      : target.parentId || "";
  const ordered = storyTree(plan.beats);
  const siblings = ordered.filter(
    (b) => b.id !== id && (b.parentId || "") === parentId,
  );
  let index =
    target && position !== "inside"
      ? siblings.findIndex((b) => b.id === targetId)
      : siblings.length;
  if (position === "after") index++;
  const next = plan.beats.map((b) => ({ ...b }));
  const byId = new Map(next.map((b) => [b.id, b]));
  const moved = byId.get(id);
  moved.parentId = parentId;
  siblings.splice(index, 0, moved);
  // Give every sibling set a stable order, including legacy nodes without one.
  ordered.forEach((b, i) => {
    byId.get(b.id).order = i;
  });
  siblings.forEach((b, i) => {
    byId.get(b.id).order = i;
  });
  validateStructureNodes(next);
  plan.beats = next;
}

export function attachStructureReference(node, asset) {
  if (!node || !asset) return;
  const field = asset.kind === "character" ? "characterIds" : "assetIds";
  node[field] = [...new Set([...(node[field] || []), asset.id])];
  if (asset.kind === "location") node.locationId = asset.id;
}

export function structureReferences(node, assets) {
  const ids = new Set([
    ...(node.characterIds || []),
    ...(node.assetIds || []),
    node.locationId,
  ]);
  return assets.filter((a) => ids.has(a.id));
}

// Keep gaps and nested proportions while extending the outline, without touching media.
export function adjustStructureTiming(plan, id, patch) {
  const node = plan.beats.find((b) => b.id === id);
  if (!node) throw Error("This section is no longer available.");
  const duration = patch.duration ?? node.duration;
  const start = patch.start ?? node.start;
  if (
    !Number.isFinite(duration) ||
    duration < 1 ||
    !Number.isFinite(start) ||
    start < 0
  )
    throw Error("Choose a positive duration and a start at or after zero.");
  const oldEnd = node.start + node.duration;
  const delta = duration - node.duration;
  const later =
    patch.duration === undefined
      ? []
      : plan.beats.filter(
          (b) =>
            b.id !== id &&
            (b.parentId || "") === (node.parentId || "") &&
            b.start >= oldEnd,
        );
  retimeSection(plan.beats, id, start, duration);
  for (const sibling of later)
    retimeSection(
      plan.beats,
      sibling.id,
      Math.max(0, sibling.start + delta),
      sibling.duration,
    );
}
