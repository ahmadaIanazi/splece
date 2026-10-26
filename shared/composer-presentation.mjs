import { compatibleVideoModels, fitVideoSettings } from "./video-selection.mjs";
export function modelTitle(model) {
  const name = model?.name || model?.id || "Choose model";
  return (
    name
      .split(" · ")
      .filter(
        (part) =>
          part !== model?.id && part !== model?.provider && part !== "Test",
      )
      .join(" · ") || name
  );
}
export function modelFit(model, compiled, settings) {
  const compatible = compatibleVideoModels([model], compiled).length > 0;
  const images = (compiled?.references || []).reduce(
    (n, r) => n + (r.selectedMediaList?.length || (r.selectedMedia ? 1 : 0)),
    0,
  );
  let reason = "";
  if (!compatible) {
    if (model.supported === false)
      reason = model.unavailableReason || "Unavailable in this workflow";
    else if (model.referenceMode === "none" && images)
      reason = "Text only · remove image references";
    else if (images > (model.maxReferences ?? 8))
      reason = `Up to ${model.maxReferences ?? 8} reference images`;
    else if (model.referenceMode === "flat" && !images)
      reason = "Attach at least one reference image";
    else if (model.requiresEnd) reason = "Requires start and end frames";
    else if (model.referenceMode === "single")
      reason = "Needs one image or a start frame, without extra references";
    else reason = "Current frames or references are not supported";
  }
  const fitted = fitVideoSettings(settings, model);
  const adjustments = ["duration", "resolution", "aspect", "audio"]
    .filter((k) => settings[k] !== fitted[k])
    .map(
      (k) =>
        `${k === "duration" ? "Length" : k}: ${fitted[k] ?? "default"}${k === "duration" ? "s" : ""}`,
    );
  return { compatible, reason, adjustments };
}
export const referenceRoleLabels = {
  identity: "Identity & face",
  location: "Environment",
  style: "Visual style",
  palette: "Color palette",
  lighting: "Lighting",
  pose: "Pose & position",
  clothing: "Clothing",
};
export function assetRole(asset, draft) {
  return (
    draft.referenceOptions?.[asset.id]?.role ||
    (asset.kind === "character"
      ? "identity"
      : asset.kind === "location"
        ? "location"
        : "style")
  );
}
// Release-to-confirm: reaching the threshold alone never submits. A hold is
// cancelled by leaving the control, losing focus, or changing the request.
export const GENERATION_HOLD_MS = 950;
export function completedHold(start, now, cancelled = false) {
  return (
    !cancelled && Number.isFinite(start) && now - start >= GENERATION_HOLD_MS
  );
}
