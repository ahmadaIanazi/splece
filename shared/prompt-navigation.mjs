import { storyPlan } from "./authoring.mjs";

export function promptGroupKey(draft) {
  return draft.storyBeatId
    ? "story:" + draft.storyBeatId
    : draft.promptGroupId ||
        "draft:" + (draft.generationSlotId || draft.targetId || draft.id);
}
export function promptGroups(project) {
  const groups = new Map();
  for (const d of project.drafts.filter(
    (d) => d.episodeId === project.episodeId,
  )) {
    const key = promptGroupKey(d);
    if (!groups.has(key))
      groups.set(key, { key, storyBeatId: d.storyBeatId, drafts: [] });
    groups.get(key).drafts.push(d);
  }
  return [...groups.values()];
}
export function promptPath(project, draft) {
  const plan = storyPlan(project),
    path = [],
    seen = new Set();
  let node = plan.beats.find((b) => b.id === draft?.storyBeatId);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    path.unshift(node);
    node = plan.beats.find((b) => b.id === node.parentId);
  }
  return path;
}
export function chooseGroupDraft(group, activeId) {
  return (
    group?.drafts.find((d) => d.id === activeId) ||
    group?.drafts.find((d) => !d.closed) ||
    group?.drafts[0]
  );
}
