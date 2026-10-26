import { editAsset } from "./studio.mjs";

// Apply only this editor's changed fields, so polling cannot overwrite new media
// or another completed generation. Revision history comes from the live record.
export function saveAssetEdit(project, before, after) {
  if (!after?.id) return false;
  const current = project.assets.find((a) => a.id === after.id);
  if (!current) {
    if (!after.name?.trim() && !after.media && !after.description?.trim())
      return false;
    editAsset(project, {
      ...after,
      name: after.name?.trim() || `New ${after.kind}`,
    });
    return true;
  }
  const next = { ...current };
  let changed = false;
  for (const key of new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after),
  ])) {
    if (["id", "version", "history"].includes(key)) continue;
    if (JSON.stringify(before?.[key]) === JSON.stringify(after[key])) continue;
    if (JSON.stringify(current[key]) === JSON.stringify(after[key])) continue;
    if (after[key] === undefined) delete next[key];
    else next[key] = structuredClone(after[key]);
    changed = true;
  }
  if (changed) editAsset(project, next);
  return changed;
}

export function assetImageDraftSignature(asset) {
  return JSON.stringify([
    asset.description || "",
    asset.variant || "",
    asset.visualBrief || {},
    asset.media?.id || "",
    asset.variants || [],
  ]);
}
