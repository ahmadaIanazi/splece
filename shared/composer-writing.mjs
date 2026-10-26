// Canvas operations retain the existing scenes/dialogue/reference contract.
// No separate HTML document or lossy conversion is persisted.
export function insertComposerReference(draft, sceneId, asset, range) {
  const scene = draft.scenes.find((s) => s.id === sceneId);
  if (!scene || !asset || ["footage", "audio"].includes(asset.kind))
    return false;
  draft.referenceIds ??= [];
  if (!draft.referenceIds.includes(asset.id)) draft.referenceIds.push(asset.id);
  const text = scene.text || "";
  const start = Math.max(0, Math.min(text.length, range?.start ?? text.length));
  const end = Math.max(start, Math.min(text.length, range?.end ?? start));
  const mention = `@[${asset.name}]`;
  scene.text =
    text.slice(0, start) +
    (start && !/\s$/.test(text.slice(0, start)) ? " " : "") +
    mention +
    (end < text.length && /^\s/.test(text.slice(end)) ? "" : " ") +
    text.slice(end);
  // An explicit cast must include a character the writer just placed here.
  if (
    asset.kind === "character" &&
    scene.characterIds?.length &&
    !scene.characterIds.includes(asset.id)
  )
    scene.characterIds.push(asset.id);
  if (asset.kind === "location") scene.locationId = asset.id;
  return true;
}

export function supportedComposerDuration(value, durations = []) {
  const values = durations
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!values.length || !Number.isFinite(Number(value))) return null;
  return values.reduce((best, n) =>
    Math.abs(n - value) < Math.abs(best - value) ? n : best,
  );
}
