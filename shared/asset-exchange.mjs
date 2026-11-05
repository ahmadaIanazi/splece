import { workflowText } from "./workflows.mjs";
import { storyPlan } from "./authoring.mjs";
const fields = ["name", "description", "variant", "delivery"];
const voiceFields = [
  "tone",
  "timbre",
  "pitch",
  "pace",
  "accent",
  "language",
  "description",
];
const tags = [
  "setting",
  "clothing",
  "pose",
  "angle",
  "expression",
  "condition",
  "lighting",
  "timeOfDay",
];
export const assetTagFields = (kind) =>
  kind === "character" ? tags : ["angle", "condition", "lighting", "timeOfDay"];
export function assetContext(asset, project) {
  const plan = storyPlan(project);
  const character = asset.kind === "character";
  return {
    story: { title: plan.title, brief: plan.brief },
    ...(character
      ? {
          speechDefaults: {
            language: plan.setup?.language || "",
            accent: plan.setup?.accent || "",
          },
        }
      : {}),
    asset: {
      kind: asset.kind,
      name: asset.name,
      description: asset.description || "",
      variant: asset.variant || "",
      ...(character
        ? {
            gender: asset.gender || "",
            characterProfile: asset.characterProfile || {},
            delivery: asset.delivery || "",
            voice: asset.voice || {},
          }
        : {}),
      variants: (asset.variants || []).map((v) => ({
        name: v.name,
        description: v.description,
        tags: Object.fromEntries(
          Object.entries(v.tags || {}).filter(
            ([k, v]) => assetTagFields(asset.kind).includes(k) && v,
          ),
        ),
      })),
    },
  };
}
export function assetImagePrompt(asset, project) {
  const guidance = workflowText(project.settings, "image");
  return `${guidance ? guidance + "\n" : ""}Create a reusable ${asset.kind} visual reference for this film. Follow the supplied creative details and context; do not add unrelated story action. ${asset.kind === "character" ? "Create a coherent character sheet of ONE person: front, side, back, and a close-up portrait. Keep the same face, proportions, clothing and visual style across views. Use a simple neutral background with no text or watermark." : asset.kind === "location" ? "Show the environment clearly, with recognizable layout, architecture, materials and lighting. Keep foreground people out unless specified. Produce one clean establishing reference without text or watermark." : asset.kind === "prop" ? "Show the same object clearly with consistent proportions and materials, on a simple background. No labels or watermark." : "Produce a visual reference expressing the specified palette, lighting, materials and aesthetic. No labels or watermark."}\nIf an image is attached, use it as the existing visual reference. If none is attached, work from the description.\n\nCONTEXT\n${JSON.stringify(assetContext(asset, project), null, 2)}`;
}
export function assetMetadataPrompt(asset, project) {
  const character = asset.kind === "character";
  const template = {
    schemaVersion: 1,
    kind: asset.kind,
    name: asset.name || "",
    description: "",
    variant: "",
    ...(character
      ? {
          gender: asset.gender || "",
          delivery: "",
          voice: Object.fromEntries(voiceFields.map((k) => [k, ""])),
        }
      : {}),
    variants: [],
  };
  return `Create a concise ${asset.kind} profile from the supplied facts and reference image, if available. Return ONLY valid JSON matching the template.
Rules:
- Preserve known facts. Do not invent unseen details or import unrelated plot, people or future events.
- Unknown, irrelevant or not applicable text MUST be ""; unused lists MUST be []. Never write "N/A", "not applicable", explanations, or filler.
- Description: 40–80 words maximum, only identity-defining visual details. Do not repeat it in other fields.
- Variant: a short distinguishing phrase, or "". Do not create a redundant "Default look" variant. Use variants: [] unless distinct looks are supplied or requested.
- Optional variant item: {"name":"", "description":"", "tags":{}}. Description: at most 30 words, differences only. Allowed tag keys: ${assetTagFields(asset.kind).join(", ")}. Each tag: 1–8 words or ""; omit unused tag keys.
${character ? '- Keep supplied gender (male/female/other); if unspecified, use "". Voice is proposed creative direction, not inferred from appearance. Voice fields and delivery: 1–6 words each; voice.description: at most 20 words. Keep known language/accent; leave unsupported details empty.' : "- No gender, voice, delivery, clothing, pose or facial-expression fields for this asset type. Describe the asset itself, not how future characters use it."}
- No extra keys, IDs, URLs, camera instructions unless supplied, or markdown. Keep schemaVersion and kind unchanged.

SOURCE
${JSON.stringify(assetContext(asset, project), null, 2)}

JSON TEMPLATE
${JSON.stringify(template, null, 2)}`;
}
export function assetProfileWarnings(patch, kind) {
  const warnings = [];
  const words = (value) =>
    typeof value === "string"
      ? value.trim().split(/\s+/).filter(Boolean).length
      : 0;
  if (words(patch.description) > 80)
    warnings.push(
      "Description is longer than 80 words. Consider asking the AI for a shorter version.",
    );
  for (const v of patch.variants || []) {
    if (words(v.description) > 30)
      warnings.push(
        `Variant “${v.name}” repeats too much detail; aim for 30 words or fewer.`,
      );
    for (const [k, value] of Object.entries(v.tags || {})) {
      if (value && !assetTagFields(kind).includes(k))
        warnings.push(
          `“${k}” is not applicable to ${kind}; use an empty value.`,
        );
      else if (words(value) > 8)
        warnings.push(`“${k}” should be a short tag, not a paragraph.`);
    }
  }
  return [...new Set(warnings)];
}
export function parseAssetMetadata(text, asset) {
  const value = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  );
  const object = (v, allowed, label) => {
    if (!v || typeof v !== "object" || Array.isArray(v))
      throw Error(`${label} must be an object.`);
    for (const k of Object.keys(v))
      if (!allowed.includes(k)) throw Error(`Unknown ${label} field: ${k}`);
  };
  const string = (v, label) => {
    if (typeof v !== "string" || v.length > 20000)
      throw Error(`${label} must be text under 20,000 characters.`);
    return v;
  };
  object(
    value,
    ["schemaVersion", "kind", ...fields, "gender", "voice", "variants"],
    "asset",
  );
  if (value.schemaVersion !== 1 || value.kind !== asset.kind)
    throw Error("Schema version or asset type does not match this asset.");
  const patch = {};
  for (const k of fields) if (k in value) patch[k] = string(value[k], k);
  if ("gender" in value) {
    if (
      asset.kind !== "character" ||
      !["", "male", "female", "other"].includes(value.gender)
    )
      throw Error(
        "Gender must be male, female, other or empty, for a character.",
      );
    patch.gender = value.gender;
  }
  if ("voice" in value) {
    if (asset.kind !== "character")
      throw Error("Voice belongs to characters only.");
    object(value.voice, voiceFields, "voice");
    patch.voice = { ...asset.voice, preset: "" };
    for (const [k, v] of Object.entries(value.voice))
      patch.voice[k] = string(v, `voice.${k}`);
  }
  if ("variants" in value) {
    if (!Array.isArray(value.variants) || value.variants.length > 30)
      throw Error("Use up to 30 variants.");
    const names = new Set();
    patch.variants = value.variants.map((v) => {
      object(v, ["name", "description", "tags"], "variant");
      const name = string(v.name, "variant name").trim();
      if (!name || names.has(name.toLowerCase()))
        throw Error("Variant names must be nonempty and unique.");
      names.add(name.toLowerCase());
      const result = {
        name,
        description: string(v.description, "variant description"),
        tags: {},
      };
      if (v.tags) {
        object(v.tags, tags, "tags");
        for (const [k, t] of Object.entries(v.tags))
          result.tags[k] = string(t, k);
      }
      return result;
    });
  }
  return patch;
}
export function applyAssetMetadata(asset, patch, makeId) {
  const next = { ...asset, ...patch };
  if (patch.variants) {
    // Merge by name: keep existing reference attachments and unmentioned variants.
    next.variants = [...(asset.variants || [])];
    for (const v of patch.variants) {
      const index = next.variants.findIndex(
        (old) => old.name.toLowerCase() === v.name.toLowerCase(),
      );
      if (index < 0) next.variants.push({ ...v, id: makeId(), media: null });
      else
        next.variants[index] = {
          ...next.variants[index],
          ...v,
          tags: { ...next.variants[index].tags, ...v.tags },
        };
    }
  }
  return next;
}
