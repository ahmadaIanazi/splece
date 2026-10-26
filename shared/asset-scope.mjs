// Draft references belong to their project until an image is explicitly approved.
export const isProjectOnly = (asset) =>
  asset?.scope === "project" || asset?.referenceStatus === "draft";
export const hasReferenceImage = (asset) =>
  !!(asset?.media?.kind === "image" && asset.media.url);
export const needsReferenceApproval = (asset) =>
  asset?.referenceStatus === "draft";
export function projectReferenceDraft(asset) {
  return { ...asset, scope: "project", referenceStatus: "draft" };
}
export function setAssetProjectOnly(asset, projectOnly) {
  if (
    !projectOnly &&
    needsReferenceApproval(asset) &&
    !hasReferenceImage(asset)
  )
    throw Error(
      "Add an image reference before approving this asset for the shared library.",
    );
  asset.scope = projectOnly ? "project" : "shared";
  if (!projectOnly && needsReferenceApproval(asset))
    asset.referenceStatus = "approved";
  return asset;
}
