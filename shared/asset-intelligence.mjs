import { normalizeCharacterProfile, lookDetails } from "./character-looks.mjs";
import { normalizeVisualBrief } from "./asset-brief.mjs";
import { cleanLibraryTags } from "./library-organization.mjs";
const sets = {
  image: [
    [
      "warm",
      "Warm light",
      "Preserve the subject and composition with warmer light.",
      ["warm"],
    ],
    [
      "cool",
      "Cool light",
      "Preserve the subject and composition with cooler light.",
      ["cool"],
    ],
    ["detail", "Detail", "A closer view of the same subject.", ["detail"]],
    ["wide", "Wide", "A wider view retaining the same subject.", ["wide"]],
  ],
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
    setting: str(value.setting, 1000),
    lookName: str(value.lookName, 80),
    contextSuggestions: normalizeAssetSuggestions(value.contextSuggestions),
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
  if (!Number.isInteger(count) || count < 1 || count > 4)
    throw Error("Choose one to four images.");
  if (value.candidates === true)
    return Array.from({ length: count }, (_, i) => ({
      ...value,
      variationName: count > 1 ? `Option ${i + 1}` : "",
      variationPrompt: "",
      variationKeywords: [],
    }));
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
    Object.assign(next, details, {
      lookKeywords: safe.keywords,
      variant: "",
      lookTags: {
        ...next.lookTags,
        ...(safe.setting ? { setting: safe.setting } : {}),
      },
    });
    if (
      safe.lookName &&
      (!next.mainLookName || next.mainLookName === "Main look")
    )
      next.mainLookName = safe.lookName;
    // A generated look can also be the main reference. Keep both in agreement.
    next.variants = (next.variants || []).map((v) =>
      v.media?.id === mediaId
        ? {
            ...v,
            ...details,
            keywords: safe.keywords,
            tags: {
              ...v.tags,
              ...(safe.setting ? { setting: safe.setting } : {}),
            },
          }
        : v,
    );
  } else {
    next.variants ||= [];
    const index = next.variants.findIndex((v) => v.media?.id === mediaId);
    if (index >= 0)
      next.variants[index] = {
        ...next.variants[index],
        ...details,
        keywords: safe.keywords,
        tags: {
          ...next.variants[index].tags,
          ...(safe.setting ? { setting: safe.setting } : {}),
        },
      };
    else
      next.variants.push({
        id: `look:${mediaId}`,
        name: safe.lookName || media.name || `Look ${next.variants.length + 1}`,
        media,
        tags: safe.setting ? { setting: safe.setting } : {},
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

// Creative suggestions are based on the written story, not inferred from appearance.
export function normalizeAssetSuggestions(value = {}) {
  const result = { characterProfile: {}, voice: {} };
  for (const [group, fields] of Object.entries({
    characterProfile: ["role", "personality"],
    voice: [
      "tone",
      "timbre",
      "pitch",
      "pace",
      "accent",
      "language",
      "description",
    ],
  })) {
    for (const key of fields) {
      const text = value?.[group]?.[key];
      if (typeof text === "string" && text.trim())
        result[group][key] = text
          .trim()
          .slice(0, key === "description" ? 1000 : key === "role" ? 200 : 400);
    }
  }
  return result;
}
export function assetCreativeContext(asset = {}) {
  return {
    characterProfile: normalizeCharacterProfile(asset.characterProfile || {}),
    voice: normalizeAssetSuggestions({ voice: asset.voice }).voice,
    looks: [
      asset.media,
      ...(asset.mediaList || []),
      ...(asset.variants || []).map((v) => v.media),
    ]
      .filter(
        (m, i, all) => m?.id && all.findIndex((x) => x?.id === m.id) === i,
      )
      .slice(0, 12)
      .map((media) => {
        const look = lookDetails(asset, media.id);
        return {
          mediaId: media.id,
          name: String(look.name || "").slice(0, 80),
          description: String(look.description || "").slice(0, 1500),
          setting: String(look.tags?.setting || "").slice(0, 600),
        };
      }),
  };
}
export function fillAssetDetails(asset, result, mediaId) {
  const next = replaceAssetDescription(asset, result, mediaId);
  const safe = validateAssetUnderstanding(result);
  if (!next.name?.trim()) next.name = safe.name;
  if (next.kind !== "character") return next;
  for (const group of ["characterProfile", "voice"]) {
    next[group] = { ...next[group] };
    // A chosen voice preset expresses intent even when individual fields are empty.
    if (group === "voice" && (next.voice.preset || next.voice.id)) continue;
    for (const [key, value] of Object.entries(safe.contextSuggestions[group]))
      if (!next[group][key]?.trim()) next[group][key] = value;
  }
  if (!next.characterProfile.age && result.visualBrief?.age)
    next.characterProfile.age = normalizeVisualBrief(
      result.visualBrief,
      "character",
    ).age;
  if (!next.characterProfile.identity && result.visualBrief?.features)
    next.characterProfile.identity = normalizeVisualBrief(
      result.visualBrief,
      "character",
    ).features;
  return next;
}
export function validateLookSuggestion(value) {
  if (
    !value ||
    typeof value.prompt !== "string" ||
    !value.prompt.trim() ||
    value.prompt.length > 2000
  )
    throw Error(
      "The assistant returned no usable variation. Your writing is unchanged.",
    );
  return {
    name:
      typeof value.name === "string"
        ? value.name.trim().slice(0, 80)
        : "New look",
    prompt: value.prompt.trim(),
  };
}
