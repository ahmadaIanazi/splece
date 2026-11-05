// Each reference owns its description. Promoting/removing a main look must not
// silently carry the previous image's wardrobe or pose into the next one.
export function characterLooks(asset) {
  return [
    asset.media,
    ...(asset.mediaList || []),
    ...(asset.variants || []).map((v) => v.media),
  ]
    .filter(Boolean)
    .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i);
}
export function lookDetails(asset, mediaId) {
  const variant = asset.variants?.find((v) => v.media?.id === mediaId);
  if (asset.media?.id === mediaId)
    return {
      ...variant,
      name: variant?.name || asset.mainLookName || "Main look",
      description: asset.variant || asset.description || "",
      visualBrief: asset.visualBrief || {},
      tags: asset.lookTags || {},
      keywords: asset.lookKeywords || variant?.keywords || [],
      descriptionMediaId: asset.descriptionMediaId,
    };
  return variant || { name: "New look", description: "", tags: {} };
}
export function editCharacterLook(asset, mediaId, patch) {
  const media = characterLooks(asset).find((m) => m.id === mediaId);
  if (!media) return asset;
  const details = { ...lookDetails(asset, mediaId), ...patch };
  const variants = (asset.variants || []).filter(
    (v) => v.media?.id !== mediaId,
  );
  variants.push({ ...details, id: details.id || `look:${mediaId}`, media });
  return {
    ...asset,
    characterProfile: {
      ...(asset.visualBrief?.age ? { age: asset.visualBrief.age } : {}),
      ...asset.characterProfile,
    },
    variants,
    ...(asset.media?.id === mediaId
      ? {
          mainLookName: details.name,
          description: details.description,
          variant: "",
          visualBrief: details.visualBrief || {},
          lookTags: details.tags || {},
          lookKeywords: details.keywords || [],
          descriptionMediaId: details.descriptionMediaId,
        }
      : {}),
  };
}
export function promoteCharacterLook(asset, mediaId) {
  if (asset.media?.id === mediaId) return asset;
  const gallery = characterLooks(asset),
    media = gallery.find((m) => m.id === mediaId);
  if (!media) return asset;
  const saved = asset.media
    ? editCharacterLook(asset, asset.media.id, {})
    : asset;
  const look = lookDetails(saved, mediaId);
  return {
    ...saved,
    media,
    mediaList: gallery,
    mainLookName: look.name,
    description: look.description || "",
    variant: "",
    visualBrief: look.visualBrief || {},
    lookTags: look.tags || {},
    lookKeywords: look.keywords || [],
    descriptionMediaId: look.descriptionMediaId,
  };
}
export function removeCharacterLook(asset, mediaId) {
  const remaining = characterLooks(asset).filter((m) => m.id !== mediaId);
  let next =
    asset.media?.id === mediaId && remaining.length
      ? promoteCharacterLook(asset, remaining[0].id)
      : { ...asset };
  if (!remaining.length)
    next = {
      ...next,
      media: null,
      description: "",
      variant: "",
      visualBrief: {},
      lookTags: {},
      lookKeywords: [],
      mainLookName: "",
      descriptionMediaId: undefined,
    };
  return {
    ...next,
    mediaList: remaining,
    variants: (next.variants || []).filter((v) => v.media?.id !== mediaId),
    contactSheets: (next.contactSheets || []).filter((id) => id !== mediaId),
  };
}
export function characterIdentityText(asset) {
  const profile = asset?.characterProfile || {};
  return [
    ["Age", profile.age],
    ["Role", profile.role],
    ["Personality", profile.personality],
    ["Identity", profile.identity],
  ]
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

export function normalizeCharacterProfile(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Check character identity.");
  const result = {};
  for (const [key, limit] of Object.entries({
    age: 100,
    role: 200,
    personality: 400,
    identity: 2000,
  })) {
    const text = value[key] ?? "";
    if (typeof text !== "string" || text.length > limit)
      throw Error(`Keep character ${key} under ${limit} characters.`);
    if (text.trim()) result[key] = text.trim();
  }
  return result;
}
