// Executable, source-backed prompt guidance. These rules never grant API capabilities.
export const promptingRevision = "2026-10-23.1";
const source = (title, url) => ({ title, url });
const venice = source(
  "Venice prompting fundamentals",
  "https://learn.venice.ai/video/guides/prompting",
);
const runway4 = source(
  "Runway Gen-4 video guide",
  "https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide",
);
const runway45 = source(
  "Runway image-to-video guide",
  "https://help.runwayml.com/hc/en-us/articles/48324313115155-Image-to-Video-Prompting-Guide",
);
const profiles = [
  {
    id: "wan",
    name: "Wan",
    match:
      /^(?:fal:alibaba\/wan-3\.0\/(?:text|image|reference)-to-video|wan-(?:3-0(?:-prime)?(?:-pro)?|2-7(?:-enhanced)?|2-2-enhanced|2\.6(?:-flash)?|2\.5-preview)-(?:text|image|reference)-to-video)$/,
    order: ["Subject", "Setting", "Action", "Camera", "Visual treatment"],
    rules: [
      "Use concrete subjects, spatial relationships and observable motion, followed by supplied aesthetic details. For image animation emphasize how the action develops from the opening state; do not redescribe or contradict the supplied image unnecessarily. For reference mode retain each supplied image role separately.",
    ],
    sources: [
      source(
        "Alibaba video prompt guide",
        "https://help.aliyun.com/en/model-studio/text-to-video-prompt",
      ),
      source("Wan 3.0 native sound and reference prompting", "https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-prompt-guide"),
    ],
  },
  {
    id: "seedance",
    name: "Seedance",
    match:
      /^seedance-(?:1-5-pro|2-0(?:-fast|-mini)?|2-5(?:-us)?)-(?:text|image|reference)-to-video-(?:basic|private)$/,
    order: ["Subject", "Action", "Camera", "Style", "Constraints"],
    rules: [
      "Build clear subject/action prose with the existing camera and visual intent. Reference tags are bindings, not decorative text. Never turn a single authored action line into several shots.",
    ],
    sources: [
      source(
        "Venice Seedance workflow",
        "https://learn.venice.ai/guides/generating-video-with-seedance-2-0-on-venice",
      ),
    ],
    scope:
      "Provider workflow guidance; exact capabilities remain catalog-specific.",
  },
  {
    id: "kling",
    name: "Kling",
    match:
      /^kling-(?:o3-(?:pro|standard|4k)|v3-(?:pro|standard|4k|turbo-pro)|2\.6-pro|2\.5-turbo-pro)-(?:text|image|reference)-to-video$/,
    order: ["Camera", "Subject", "Action", "Environment", "Physical detail"],
    rules: [
      "Describe staging, camera and physical action clearly. When the selected adapter supplies elements, preserve character/prop element identities separately from scene images and native boundary frames. Use no invented element tags.",
    ],
    sources: [
      venice,
      source(
        "Venice Kling O3 references",
        "https://learn.venice.ai/guides/how-to-create-consistent-characters-with-kling-o3-reference",
      ),
    ],
    scope:
      "Shared cinematography guidance; element semantics only for the explicit O3 R2V mappings.",
  },
  {
    id: "runway45",
    name: "Runway Gen-4.5",
    match: /^runway-gen4-5(?:-text)?$/,
    order: ["Action", "Environment motion", "Camera", "Timing"],
    rules: [
      "Use direct visual language. In image-to-video focus on subject/environment motion, camera, direction, speed and temporal progression; the image supplies composition and appearance. For text-to-video establish the subject and setting as well. Avoid adding negative phrasing; authored protected negatives remain verbatim. Keep prose economical for this model limit.",
    ],
    sources: [
      runway45,
      source(
        "Runway text-to-video guide",
        "https://help.runwayml.com/hc/en-us/articles/42460036199443-Text-to-Video-Prompting-Guide",
      ),
    ],
  },
  {
    id: "runway4",
    name: "Runway Gen-4 Turbo",
    match: /^runway-gen4-turbo$/,
    order: ["Subject motion", "Camera", "Scene motion"],
    rules: [
      "Use a simple, direct motion description grounded in the first image. Prefer positive visual statements, such as a still camera, for newly written prose. Preserve existing negative blocks and camera controls exactly even where the guide discourages negative phrasing.",
    ],
    sources: [runway4],
  },
  {
    id: "veo31",
    name: "Veo 3.1",
    match: /^veo3\.1-(?:fast|full)-(?:text|image)-to-video$/,
    order: ["Subject", "Action", "Setting", "Camera", "Audio"],
    rules: [
      "Describe the visible subject/action, context and cinematography concretely. Keep existing speech and sound distinct from visible action; never invent dialogue. Native audio and boundary support follow the selected Venice capability record, not the direct Google API.",
    ],
    sources: [
      source("Google Veo guide", "https://ai.google.dev/gemini-api/docs/veo"),
    ],
  },
  {
    id: "ltx",
    name: "LTX",
    match:
      /^ltx-(?:2-v2-3-(?:fast|full)|2-5-(?:fast|pro))-(?:text|image)-to-video$/,
    order: ["Shot", "Setting", "Action", "Character detail", "Camera", "Audio"],
    rules: [
      "Write connected visual prose using active verbs and a coherent beginning-to-end action. Use only supplied character, light, texture and sound detail; express supplied emotions through existing observable behavior. Separate shots only where the writer already authored them.",
    ],
    sources: [
      source(
        "LTX prompting guide",
        "https://docs.ltx.io/open-source-model/usage-guides/prompting-guide",
      ),
    ],
  },
  {
    id: "minimax-h3",
    name: "MiniMax H3",
    match: /^minimax-h3(?:-max(?:-turbo)?|-enhanced)?-(?:text|image)-to-video$/,
    order: ["Opening state", "Action onset", "Development", "Result", "Sound"],
    rules: [
      "Use a coherent visible timeline; for first-frame animation develop action continuously from its supplied anchors. The native H3 guide separates audiovisual description, soundscape and music. This editor rewrites shot prose only: do not insert native Picture/Shot tokens, top-level fields or image-alignment instructions, since the Venice mapping has not verified that dialect. Preserve exact speech in its separate locked fields.",
    ],
    sources: [
      source(
        "MiniMax H3 base prompt guide",
        "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md",
      ),
    ],
    scope:
      "Semantic guidance only; native H3 prompt serialization is not enabled by the Venice adapter.",
  },
  {
    id: "grok",
    name: "Grok Imagine",
    match:
      /^grok-imagine(?:-1-5(?:-lite)?)?-(?:text|image|reference)-to-video(?:-private)?$/,
    order: ["Subject", "Action", "Camera", "Setting"],
    rules: [
      "Use an explicit description of the action and camera. Image-to-video is a progression from the provided image. Direct xAI reference/video-edit APIs do not enable those fields in the selected Venice adapter.",
    ],
    sources: [
      source(
        "xAI video generation",
        "https://docs.x.ai/developers/model-capabilities/video/generation",
      ),
      venice,
    ],
    scope:
      "API/workflow guidance; no proprietary prompting dialect is asserted.",
  },
];
export const modelPromptProfiles = profiles.map(({ match, ...p }) => ({
  ...p,
  version: promptingRevision,
  verifiedOn: "2026-10-23",
}));
export function resolvePromptProfile(model = {}) {
  const found = profiles.find((p) => p.match.test(model.id || ""));
  const mode = ["flat", "elements"].includes(model.referenceMode)
    ? "references"
    : model.type === "image-to-video" ||
        model.operation === "image-to-video" ||
        model.referenceMode === "single"
      ? "image"
      : "text";
  const { match, ...profile } = found || {
    id: "workflow",
    name: "Video workflow",
    order: ["Subject", "Action", "Setting", "Camera"],
    rules: [
      "Use natural, concrete descriptions of the supplied subject, action, setting and explicit camera. No model-specific syntax or capabilities have been verified for this exact ID.",
    ],
    sources: [venice],
    scope:
      "Conservative workflow guidance; model-specific style is unverified.",
  };
  return {
    ...profile,
    version: promptingRevision,
    verifiedOn: "2026-10-23",
    modelId: model.id || "",
    mode,
    stages:
      mode === "image"
        ? ["Action", "Frame continuity", "Camera", "Model format"]
        : mode === "references"
          ? ["Action", "Reference roles", "Camera", "Model format"]
          : ["Action", "Setting", "Camera", "Model format"],
  };
}
export function optimizerInstructions(profile, model = {}, settings = {}) {
  return [
    `Target: ${model.id || profile.modelId}. Profile: ${profile.id}@${profile.version}. Workflow: ${profile.mode}.`,
    `Preferred descriptive emphasis: ${profile.order.join(" → ")}. This is an emphasis guide within each authored action line, never permission to reorder actions or shots.`,
    ...profile.rules,
    profile.mode === "image"
      ? "Only describe progression from supplied frame context. You have textual context, not visual observation; never claim to have inspected pixels."
      : profile.mode === "references"
        ? "Keep authored @[asset name] mentions verbatim. Numbered model reference bindings are assembled separately and remain locked; do not add or replace them in shot prose."
        : "Establish only the supplied subject and environment. Do not refer to missing images or invent reference attachments.",
    model.audio === false || settings.audio === false
      ? "This request has no native generated audio. Leave locked dialogue unchanged; do not promise speech, lip sync or add sound instructions."
      : "Preserve supplied audio intent and exact speech; no invented sound, voice identity or lip-sync guarantee.",
    `Final assembled video prompt limit: ${model.promptLimit || 10000} characters, including locked injections. If protected material cannot fit, report the conflict; never remove it.`,
    "Rewrite only existing shot prose. All camera settings, transitions, duration, references, dialogue, negatives, creative choices and technical injections are locked. Do not repeat their instructions in prose. Never add unsupported parameters, cuts, characters, style details or facts. Preserve source language.",
  ].join("\n");
}
