import {characterIdentityText, normalizeCharacterProfile} from "./character-looks.mjs";
import { normalizeVisualBrief, visualBriefText } from "./asset-brief.mjs";
import {
  effectiveCreativeDirection,
  creativeDirectionText,
} from "./creative-presets.mjs";
import { renderPromptPreset } from "./prompt-library.mjs";
import { workflowText } from "./workflows.mjs";
export const imageModels = [

  {id:"venice-grok-quality", provider:"venice", model:"grok-imagine-image-quality", name:"Grok Imagine Quality", mode:"create", price:0.06, promptLimit:7500},
  {
    id: "venice-grok",
    promptLimit: 7500,
    provider: "venice",
    model: "grok-imagine-image",
    name: "Grok Imagine",
    mode: "create",
    price: 0.03,
  },
  {
    id: "venice-firered",
    promptLimit: 1500,
    provider: "venice",
    model: "firered-image-edit",
    name: "FireRed",
    mode: "vary",
    price: 0.04,
  },
  {
    id: "fal-schnell",
    provider: "fal",
    model: "fal-ai/flux/schnell",
    name: "FLUX Schnell",
    mode: "create",
  },
  {
    id: "fal-flux-edit",
    provider: "fal",
    model: "fal-ai/flux-2/edit",
    name: "FLUX.2 Edit",
    mode: "vary",
  },
  {id:'xai-imagine-create',provider:'xai',model:'grok-imagine-image-2.0',name:'Grok Imagine 2 · xAI',mode:'create',price:.04,inputPrice:.01,promptLimit:32000},
  {id:'xai-imagine-edit',provider:'xai',model:'grok-imagine-image-2.0',name:'Grok Imagine 2 Edit · xAI',mode:'vary',price:.06,inputPrice:.01,maxReferences:5,promptLimit:32000},
];
// Venice adapters currently expose fixed/native output; do not invent low-cost sizes.
for (const model of imageModels) model.resolutions = model.provider === 'fal' ? ['480p','720p','1080p'] : ['1K'];
export function imageDimensions(input) {
  const original = imageRatios[input.ratio];
  if (!input.resolution || input.resolution === '1K') return original;
  const side = parseInt(input.resolution,10);
  const scale = side / Math.min(...original);
  return original.map(n=>Math.round(n*scale));
}
export const assetLooks = [
  { id: "auto", name: "Auto", text: "" },
  {
    id: "cinematic",
    name: "Cinematic",
    text: "Photorealistic cinematic reference, believable materials and natural light.",
  },
  {
    id: "illustrated",
    name: "Illustrated",
    text: "Expressive hand-painted illustration, coherent shapes and a restrained palette.",
  },
  {
    id: "3d",
    name: "3D",
    text: "Stylized three-dimensional render with tactile materials and soft studio light.",
  },
];
export const assetFramings = {
  character: [
    ["portrait", "Portrait"],
    ["sheet", "Character sheet"],
    ["full", "Full body"],
  ],
  location: [
    ["wide", "Establishing"],
    ["detail", "Detail"],
  ],
  prop: [
    ["product", "Object study"],
    ["detail", "Detail"],
  ],
  style: [["mood", "Mood study"]],
  frame: [["scene", "Scene frame"]],
  image: [["image", "Single image"]],
};
export const imageRatios = {
  "1:1": [1024, 1024],
  "16:9": [1280, 720],
  "9:16": [720, 1280],
};
export function normalizeImageInput(value) {
  if (!value || typeof value !== "object")
    throw Error("Describe an asset first.");
  const text = (key, max, required = false) => {
    const v = value[key] ?? "";
    if (typeof v !== "string" || v.length > max || (required && !v.trim()))
      throw Error(`Check ${key}.`);
    return v.trim();
  };
  const kind = text("kind", 20, true),
    mode = text("mode", 10, true),
    model = imageModels.find((m) => m.id === value.modelId && m.mode === mode);
  if (!assetFramings[kind] || !model)
    throw Error("Choose a compatible image model and asset type.");
  const framing = value.framing || assetFramings[kind][0][0],
    look = value.look || "auto",
    ratio = value.ratio || "1:1";
  if (
    (framing !== "auto" && !assetFramings[kind].some(([id]) => id === framing)) ||
    !assetLooks.some((l) => l.id === look) ||
    !imageRatios[ratio]
  )
    throw Error("Choose a supported look, framing and shape.");
  if (value.resolution !== undefined && !model.resolutions.includes(value.resolution)) throw Error('Choose a supported image resolution.');
  if (kind === 'frame' && !['start','end'].includes(value.boundary)) throw Error('Choose start or end frame.');
  const input = {
    assetId: text("assetId", 100, true),
    variationName: text("variationName",80),
    variationPrompt: text("variationPrompt",600),
    variationKeywords: Array.isArray(value.variationKeywords) ? value.variationKeywords.filter(v=>typeof v === "string").slice(0,6).map(v=>v.slice(0,64)) : [],
    name: text("name", 100),
    description: text("description", 4000, true),
    visualBrief: normalizeVisualBrief(value.visualBrief, kind),
    kind,
    ...(kind === "character" ? {characterProfile: normalizeCharacterProfile(value.characterProfile)} : {}),
    mode,
    modelId: model.id,
    ...(value.resolution ? {resolution:value.resolution} : {}),
    framing,
    look,
    ratio,
    sourceMediaId: text("sourceMediaId", 100),
    ...(kind === "frame" ? {draftId:text("draftId",100,true), boundary: value.boundary === "start" ? "start" : "end"} : {}),
  };
  if (mode === "vary" && !input.sourceMediaId && kind !== "frame")
    throw Error("Choose an image to vary.");
  if (mode === "create") input.sourceMediaId = "";
  return input;
}
export function imageAssetPrompt(input, project) {
  const subject = [input.name, input.description, characterIdentityText(input)].filter(Boolean).join(": ");
  const identity = visualBriefText(input.visualBrief, input.kind);
  let recipe = null,
    text;
  if (input.framing === "auto") {
    text = `Create the described image. Follow the written composition, pose, setting and rendering style; if unspecified, follow the reference. Do not impose a portrait, studio backdrop or contact sheet.\n${subject}`;
  } else if (input.kind === "character") {
    recipe = renderPromptPreset(
      input.framing === "sheet" ? "character-views" : "identity-portrait",
      input.framing === "sheet"
        ? {
            Subject: subject,
            Wardrobe:
              "Follow the supplied description; otherwise use simple neutral clothing.",
          }
        : {
            Subject: subject,
            "Framing and light":
              input.framing === "full"
                ? "Single full-body reference, clear silhouette, neutral background."
                : "Single close-up portrait, readable facial features, neutral background.",
          },
    );
    text = recipe.text;
  } else if (input.kind === "location") {
    recipe = renderPromptPreset("location-study", {
      Location: subject,
      "Light and atmosphere":
        input.framing === "detail"
          ? "An architectural or environmental detail with spatial context."
          : "A clear establishing view with readable layout and depth.",
    });
    text = recipe.text;
  } else
    text = `${input.kind === "prop" ? "Reusable object reference: consistent proportions and materials, simple neutral background." : input.kind === "image" ? "Create the described image. Follow the requested subjects, composition and visual style." : "Visual mood reference: coherent palette, materials and lighting."}\n${subject}\n${input.framing === "detail" ? "Close detail showing surface and construction." : ""}`;
  const role =
    input.mode === "vary"
      ? input.kind === "character"
        ? "The attached image controls facial identity, body proportions and defining features. Keep the same person or creature, age and species. Only change clothing, pose, expression or setting when explicitly requested."
        : input.kind === "location"
          ? "The attached image controls the location’s spatial layout and architecture. Keep the same place; only change the requested details."
          : "The attached image controls the object or visual design. Preserve its identity and change only the requested details."
      : "Generate from the description; no image reference is attached.";
  const plan = project.storyPlans?.[project.episodeId];
  const direction = typeof plan?.setup?.directionBrief === "string" ? plan.setup.directionBrief.slice(0, 1600) : "";
  const creative = effectiveCreativeDirection(project);
  if (input.look !== "auto") delete creative.look;
  if (input.mode === "vary") {
    const asset = project.assets?.find(a=>a.id===input.assetId);
    const existing = ((!asset?.media?.id || input.sourceMediaId === asset?.media?.id) ? asset?.visualBrief : asset?.variants?.find(v=>v.media?.id===input.sourceMediaId)?.visualBrief) || {};
    const changed = Object.fromEntries(Object.entries(input.visualBrief || {}).filter(([key,value])=>value !== existing[key]));
    const editPrompt = [
      input.description,
      characterIdentityText(input),
      input.variationPrompt,
      role,
      input.framing === "sheet" ? "Character sheet: front, rear and face close-up of the same subject, not three people." : input.framing === "full" ? "Full-body view, head to feet." : "",
      visualBriefText(changed,input.kind),
      assetLooks.find(l=>l.id===input.look)?.text,
      input.look === "auto" ? direction : "",
      creativeDirectionText(creative,{camera:false}),
      workflowText(project.settings,"image"),
      "Keep all unrequested details unchanged. No added text or watermark.",
    ].filter(Boolean).join("\n\n");
    const limit=imageModels.find(m=>m.id===input.modelId)?.promptLimit || 8000;
    if(editPrompt.length>limit) throw Error(`This model allows ${limit.toLocaleString()} prompt characters; this edit has ${editPrompt.length.toLocaleString()}. Shorten the change or visual details, or choose another model. Your writing is kept.`);
    return {prompt:editPrompt,recipeId:recipe?.id || input.kind+"-study",sourceIds:recipe?.sourceIds || []};
  }
  const prompt = [
    role,
    input.mode === "vary" ? "Source identity context (not a request to recreate its outfit or background):\n" + subject : text,
    input.mode === "vary" ? (input.framing === "sheet" ? "Character reference sheet: front view, rear view and face close-up of the same subject, not three people." : input.framing === "full" ? "Show the complete subject, head to feet." : "Keep the requested composition readable; the requested variation may change the background.") : "",
    identity ? "Visual identity details (explicit refinements to the description):\n" + identity : "",
    input.variationPrompt ? "Requested variation (keep the source identity): " + input.variationPrompt : "",
    input.framing === "auto" ? "Preserve the described subject identity and anatomy. Explicit written direction takes priority over project defaults." : input.kind === "location"
      ? "Environment-only asset: do not render people mentioned in story context. Show the place itself, without characters."
      : input.kind === "character"
        ? "Exactly one character identity; multiple sheet panels are views of that same individual. Preserve the specified age, species, anatomy, defining features and cultural clothing. For animals or creatures use their described anatomy and surface, not human skin or human proportions. Show readable eyes and recognizable features; soft even light, restrained contrast. Ignore dialogue, occupation, biography and story action as things to depict; this is a reusable identity reference."
        : "",
    assetLooks.find((l) => l.id === input.look)?.text,
    creativeDirectionText(creative, { camera: false }),
    direction ? "Project art direction: " + direction + (input.look === "auto" ? "\nInherit its rendering style, palette and lighting only; ignore story action and camera movement." : "\nUse its palette and lighting only. The explicitly selected image style takes priority over its rendering medium.") : "",
    workflowText(project.settings, "image"),
    input.kind === "character" && input.framing !== "auto" ? "Age fidelity is essential even in stylized 3D: an adult must read unmistakably as an adult, with mature facial structure and adult head-to-body proportions, not a child, toddler, baby-faced doll or chibi. A child or animal must retain its explicitly described age and species. Do not infantilize adults because the story is for children. For text-to-image identity creation use a plain warm-grey studio backdrop and soft even lighting; for reference editing follow the requested setting." : "",
    "Output one clean image, without captions, labels or watermarks. Do not add unrelated characters or story action.",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (prompt.length > (imageModels.find(m=>m.id===input.modelId)?.promptLimit || 8000))
    throw Error(
      "Image direction is too long. Shorten the description or image workflow layers.",
    );
  return {
    prompt,
    recipeId: recipe?.id || input.kind + "-study",
    sourceIds: recipe?.sourceIds || [],
  };
}
export function applyGeneratedImage(asset, job, { variant = false } = {}) {
  if (job.state !== "ready" || !job.media || job.input.assetId !== asset.id)
    throw Error("Choose a completed image for this asset.");
  const next = structuredClone(asset),
    media = job.media;
  next.name ||= job.input.name || job.input.description.slice(0, 48);
  next.description ||= job.input.description;
  if (!variant && Object.keys(job.input.visualBrief || {}).length) next.visualBrief = job.input.visualBrief;
  if (variant) {
    next.variants ||= [];
    if (!next.variants.some((v) => v.media?.id === media.id))
      next.variants.push({
        id: job.id,
        name: job.input.variationName || `Look ${next.variants.length + 1}`,
        description: [...new Set([job.input.description, job.input.variationPrompt].filter(Boolean))].join("\n"),
        keywords: job.input.variationKeywords || [],
        visualBrief: job.input.visualBrief || {},
        media,
        tags: {},
      });
  } else {
    next.mediaList = [next.media, ...(next.mediaList || []), media]
      .filter(Boolean)
      .filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i);
    next.media = media;
    if (job.input.framing === "sheet")
      next.contactSheets = [
        ...new Set([...(next.contactSheets || []), media.id]),
      ];
  }
  return next;
}
export function imageCostRecord(job) {
  const test = job.executionMode !== "live";
  return {
    key: "image:" + job.id,
    id: job.id,
    kind: "image",
    provider: job.provider,
    test,
    state: job.state,
    title: job.input.name || "Asset image",
    model: job.model,
    createdAt: job.createdAt,
    amount: test
      ? 0
      : job.acceptedAt
        ? job.price.amount
        : job.state === "submission_uncertain"
          ? null
          : 0,
    status: test
      ? "test"
      : job.acceptedAt
        ? "estimated"
        : job.state === "submission_uncertain"
          ? "unknown"
          : "not-submitted",
    charges: [],
  };
}
