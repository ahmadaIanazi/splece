export const assetTypes = [
  {
    id: "character",
    name: "Character",
    hint: "Identity, appearance & voice",
    description: "Describe identity, appearance and personality…",
  },
  {
    id: "location",
    name: "Location",
    hint: "Places & environments",
    description: "Describe the layout, architecture, atmosphere and lighting…",
  },
  {
    id: "prop",
    name: "Prop",
    hint: "Objects & important details",
    description:
      "Describe the object, materials, scale and distinctive details…",
  },
  {
    id: "style",
    name: "Style",
    hint: "Visual moods & references",
    description: "Describe the palette, lighting, texture and visual mood…",
  },
  {
    id: "footage",
    name: "Footage",
    hint: "Import video clips",
    description: "What happens in this footage? Add useful search notes…",
  },
  {
    id: "audio",
    name: "Audio",
    hint: "Music, voices & sound effects",
    description: "Describe the sound, mood, instruments or intended use…",
  },
];
export function libraryAssetKey(projectId, asset) {
  return (
    asset.libraryId ||
    `${projectId}:${asset.job ? "generation-" + asset.job.id : asset.id}`
  );
}
export function libraryItemKey(projectId, item) {
  return (
    item.entry?.id ||
    (item.asset
      ? libraryAssetKey(projectId, item.asset)
      : `${projectId}:${item.job ? "generation-" + item.job.id : "media-" + item.media.id}`)
  );
}
export function cleanLibraryTags(value) {
  if (!Array.isArray(value)) throw Error("Tags must be a list.");
  if (value.length > 30) throw Error("Use up to 30 tags per asset.");
  const seen = new Set();
  return value
    .map((t) => {
      if (typeof t !== "string" || t.trim().length > 64)
        throw Error("Each tag must be text up to 64 characters.");
      return t.trim();
    })
    .filter(
      (t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()),
    );
}
export function folderPath(folders, id) {
  const parts = [],
    seen = new Set();
  let folder = folders.find((f) => f.id === id);
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id);
    parts.unshift(folder.name);
    folder = folders.find((f) => f.id === folder.parentId);
  }
  return parts.join(" / ");
}
export function folderContains(folders, parent, id) {
  const seen = new Set();
  while (id && !seen.has(id)) {
    if (id === parent) return true;
    seen.add(id);
    id = folders.find((f) => f.id === id)?.parentId;
  }
  return false;
}
export function assetOrganization(metadata, key, asset) {
  return {
    folderId: null,
    tags: asset?.libraryTags || [],
    favorite: !!asset?.favorite,
    ...metadata[key],
  };
}
export function matchesLibraryItem(
  item,
  organization,
  {
    query = "",
    folder = "all",
    tags = [],
    favorites = false,
    kind = "all",
    unused = false,
  },
  folders,
) {
  if (favorites && !organization.favorite) return false;
  if (unused && item.onTimeline) return false;
  if (kind !== "all" && item.kind !== kind) return false;
  if (folder === "unfiled" && organization.folderId) return false;
  if (
    !["all", "unfiled"].includes(folder) &&
    !folderContains(folders, folder, organization.folderId)
  )
    return false;
  if (
    tags.some(
      (t) =>
        !organization.tags.some((v) => v.toLowerCase() === t.toLowerCase()),
    )
  )
    return false;
  const searchable = [
    item.name,
    item.asset?.description,
    item.entry?.originName,
    folderPath(folders, organization.folderId),
    ...organization.tags,
  ]
    .join(" ")
    .toLowerCase();
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((word) => searchable.includes(word));
}
