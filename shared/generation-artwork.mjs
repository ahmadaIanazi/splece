// Use the submitted snapshot, never the user's subsequently edited composition.
export function generationArtwork(job) {
  const compiled = job?.snapshot?.compiled;
  if (!compiled) return [];
  const images = [];
  const add = (src, label) => {
    if (
      typeof src !== "string" ||
      !/^(\/api\/media\/|https?:\/\/|data:image\/)/i.test(src)
    )
      return;
    if (!images.some((image) => image.src === src)) images.push({ src, label });
  };
  const frame = (value, label) => {
    if (!value) return;
    const id = value.mediaId || value.takeId;
    if (!id) return;
    add(
      value.mediaId || value.kind === "image"
        ? `/api/media/${encodeURIComponent(id)}/original`
        : `/api/media/${encodeURIComponent(id)}/frame?time=${Math.max(0, Number(value.time) || 0)}`,
      label,
    );
  };
  frame(
    compiled.continuityReference || compiled.boundaries?.start,
    "Start frame",
  );
  frame(
    compiled.continuityEndReference || compiled.boundaries?.end,
    "End frame",
  );
  for (const asset of compiled.references || []) {
    if (["audio", "footage"].includes(asset.kind)) continue;
    const media =
      asset.selectedMedia || asset.selectedVariant?.media || asset.media;
    add(
      media?.thumbnail ||
        (media?.id
          ? `/api/media/${encodeURIComponent(media.id)}/original`
          : null),
      asset.name || "Reference",
    );
  }
  return images.slice(0, 5);
}
