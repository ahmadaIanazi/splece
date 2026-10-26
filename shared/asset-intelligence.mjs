import { normalizeVisualBrief } from "./asset-brief.mjs";
import { cleanLibraryTags } from "./library-organization.mjs";
const sets = {
  character: [
    [
      "casual",
      "Casual",
      "Relaxed everyday clothing, natural pose.",
      ["casual", "everyday"],
    ],
    [
      "work",
      "At work",
      "Practical work clothing, composed expression.",
      ["work"],
    ],
    [
      "evening",
      "Evening",
      "Elegant evening clothing, understated styling.",
      ["evening"],
    ],
    [
      "outdoors",
      "Outdoors",
      "Weather-appropriate outdoor clothing, relaxed stance.",
      ["outdoors"],
    ],
    [
      "hospital",
      "Hospital",
      "Grey hoodie, hair tied back if long, visitor badge, tired expression.",
      ["hospital", "visitor"],
    ],
    [
      "wedding",
      "Wedding",
      "Formal wedding-guest clothing, polished styling.",
      ["wedding"],
    ],
  ],
  location: [
    [
      "night",
      "Night",
      "The same location at night, believable practical lighting.",
      ["night"],
    ],
    [
      "midday",
      "Midday",
      "The same location in clear midday light.",
      ["midday"],
    ],
    [
      "reverse",
      "Reverse view",
      "View the same location from the opposite side; preserve architecture and layout.",
      ["reverse view"],
    ],
    [
      "overhead",
      "Overhead",
      "Elevated overhead view showing the same location and spatial layout.",
      ["overhead"],
    ],
  ],
  prop: [
    ["front", "Front", "Straight-on front view of the same object.", ["front"]],
    [
      "back",
      "Back",
      "Rear view of the same object, consistent construction.",
      ["back"],
    ],
    ["side", "Side", "Left-side profile of the same object.", ["side"]],
    ["top", "Top", "Direct overhead view of the same object.", ["top"]],
    ["right", "Right", "Right-side profile of the same object.", ["right"]],
  ],
  style: [
    [
      "warm",
      "Warm",
      "Warm palette and soft light, preserving the visual identity.",
      ["warm"],
    ],
    [
      "cool",
      "Cool",
      "Cool palette and soft light, preserving the visual identity.",
      ["cool"],
    ],
    ["soft", "Soft", "Diffuse light and gentle contrast.", ["soft"]],
    [
      "contrast",
      "Contrast",
      "Directional light and stronger contrast.",
      ["contrast"],
    ],
  ],
};
export function variationPresets(kind) {
  return (sets[kind] || []).map(([id, name, prompt, keywords]) => ({
    id,
    name,
    prompt,
    keywords: [...keywords],
  }));
}
export function validateAssetUnderstanding(value) {
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  if (!value || typeof value !== "object" || !str(value.description, 4000))
    throw Error("The assistant returned no usable description.");
  return {
    name: str(value.name, 100),
    description: str(value.description, 4000),
    keywords: cleanLibraryTags(value.keywords || []).slice(0, 12),
    variations: (Array.isArray(value.variations) ? value.variations : [])
      .slice(0, 4)
      .map((v) => ({
        name: str(v?.name, 80),
        prompt: str(v?.prompt, 600),
        keywords: cleanLibraryTags(v?.keywords || []).slice(0, 6),
      }))
      .filter((v) => v.name && v.prompt),
  };
}
export function applyAssetUnderstanding(asset, result) {
  const safe = validateAssetUnderstanding(result),
    next = structuredClone(asset);
  if (!next.name?.trim()) next.name = safe.name;
  if (!next.description?.trim()) next.description = safe.description;
  next.libraryTags = cleanLibraryTags(
    [...(next.libraryTags || []), ...safe.keywords]
      .filter(
        (v, i, a) =>
          a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i,
      )
      .slice(0, 30),
  );
  return next;
}
export function imageBatchInputs(value) {
  const count = value.count ?? 1;
  if (![1, 4].includes(count)) throw Error("Choose one or four variations.");
  const presets = variationPresets(value.kind),
    ids = value.presetIds ?? [];
  if (
    !Array.isArray(ids) ||
    ids.length > count ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !presets.some((p) => p.id === id))
  )
    throw Error("Choose supported variation presets.");
  if (count === 4 && !presets.length)
    throw Error(
      "Four variations are available for characters, locations, props and styles.",
    );
  const chosen = ids.map((id) => presets.find((p) => p.id === id));
  if (count === 4)
    chosen.push(
      ...presets.filter((p) => !ids.includes(p.id)).slice(0, 4 - chosen.length),
    );
  return Array.from({ length: count }, (_, i) => {
    const p = chosen[i];
    return {
      ...value,
      variationName: p?.name || (count > 1 ? `Take ${i + 1}` : ""),
      variationPrompt: p?.prompt || "",
      variationKeywords: p?.keywords || [],
    };
  });
}

// The image is authoritative only after an explicit Update description action.
// Alternative looks stay scoped to their image; voice and story metadata survive.
export function replaceAssetDescription(asset, result, mediaId) {
  const safe = validateAssetUnderstanding(result),
    next = structuredClone(asset);
  const media = [
    next.media,
    ...(next.mediaList || []),
    ...(next.variants || []).map((v) => v.media),
  ].find((m) => m?.id === mediaId);
  if (!media)
    throw Error("This image is no longer attached. Choose a reference again.");
  const visualBrief = normalizeVisualBrief(
    result.visualBrief || {},
    asset.kind,
  );
  const details = {
    description: safe.description,
    visualBrief,
    descriptionMediaId: mediaId,
  };
  if (next.media?.id === mediaId) {
    Object.assign(next, details, { variant: "", lookTags: {} });
    // A generated look can also be the main reference. Keep both in agreement.
    next.variants = (next.variants || []).map((v) =>
      v.media?.id === mediaId ? { ...v, ...details, tags: {} } : v,
    );
  } else {
    next.variants ||= [];
    const index = next.variants.findIndex((v) => v.media?.id === mediaId);
    if (index >= 0)
      next.variants[index] = { ...next.variants[index], ...details, tags: {} };
    else
      next.variants.push({
        id: `look:${mediaId}`,
        name: media.name || `Look ${next.variants.length + 1}`,
        media,
        tags: {},
        keywords: safe.keywords,
        ...details,
      });
  }
  next.libraryTags = cleanLibraryTags(
    [...(next.libraryTags || []), ...safe.keywords]
      .filter(
        (v, i, a) =>
          a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i,
      )
      .slice(0, 30),
  );
  return next;
}
