// A bounded scene description, never executable model output. Rendering remains
// local; the Decisions service only chooses these inexpensive visual variables.
export const scenePalettes = {
  pastel: ["#bab9e1", "#eab8c7", "#d6e4c4"],
  earth: ["#6c8774", "#b9a788", "#e2d2b7"],
  citrus: ["#dbdf77", "#f0a05b", "#537b78"],
  dusk: ["#555378", "#b8767d", "#f1b687"],
  mono: ["#51575c", "#aeb4b9", "#e6e6e3"],
};
export const subjects = [
  "abstract",
  "person",
  "group",
  "zombie",
  "robot",
  "bottle",
  "shoe",
  "car",
  "food",
  "plant",
  "animal",
  "object",
];
export const settings = [
  "studio",
  "city",
  "forest",
  "room",
  "classroom",
  "desert",
  "space",
  "coast",
  "mountains",
  "abstract",
];
export const media = [
  "flat",
  "ink",
  "chalk",
  "paint",
  "clay",
  "cinema",
  "collage",
];
export const atmospheres = ["clear", "mist", "rain", "stars", "glitter"];
export const directedControls = [
  "look",
  "realism",
  "energy",
  "light",
  "sun",
  "softness",
  "palette",
  "saturation",
  "lens",
  "angle",
  "movement",
  "orbit",
  "dialogue",
  "tempo",
  "pacing",
  "customColors",
];
const bounded = (n, fallback = 50) =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
const string = (v, limit = 300) =>
  typeof v === "string" ? v.slice(0, limit).trim() : "";
const option = (v, values, fallback) => (values.includes(v) ? v : fallback);
export const safeColors = (v) =>
  Array.isArray(v)
    ? v
        .filter((c) => typeof c === "string" && /^#[a-f\d]{6}$/i.test(c))
        .slice(0, 4)
    : [];
export function sceneKey(context) {
  const source = JSON.stringify([
    context.text || "",
    context.format || "movie",
    context.lookText || "",
  ]);
  let hash = 2166136261;
  for (const c of source) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
export function normalizeScene(raw = {}) {
  return {
    subject: option(raw?.subject, subjects, "abstract"),
    setting: option(raw?.setting, settings, "abstract"),
    medium: option(raw?.medium, media, "flat"),
    atmosphere: option(raw?.atmosphere, atmospheres, "clear"),
    label: string(raw?.label, 100),
    colors: safeColors(raw?.colors),
    count: Math.max(1, Math.min(5, Math.round(Number(raw?.count) || 1))),
    night: raw?.night === true,
    covered: raw?.covered === true,
    accent: string(raw?.accent, 100),
    // Keep free style language, while all geometry remains owned by the renderer.
    style: string(raw?.style, 600),
  };
}
const has = (s, pattern) => pattern.test(s);
export function inferScene(text = "", format = "movie", lookText = "") {
  const t = text.toLowerCase(),
    style = `${text} ${lookText}`.toLowerCase();
  const horror = has(t, /horror|zombi|undead|haunt|رعب|زومبي/);
  let subject = "abstract",
    label = "Your scene";
  const candidates = [
    ["zombie", /zombi|undead|زومبي/, "Zombies"],
    ["bottle", /perfume|bottle|serum|soda|beverage|عطر|زجاجة/, "Product study"],
    ["shoe", /sneaker|shoe|footwear|حذاء/, "Footwear study"],
    ["car", /\bcar\b|vehicle|automotive|سيارة/, "On the road"],
    ["robot", /robot|android|روبوت/, "A mechanical world"],
    ["food", /coffee|food|burger|cake|pizza|قهوة|طعام/, "A taste of the idea"],
    [
      "animal",
      /\bdog\b|\bcat\b|\bbird\b|animal|قط[ة]?|كلب|طائر/,
      "A living world",
    ],
    ["plant", /flower|plant|botanical|زهور|نبات/, "Growing things"],
    [
      "person",
      /teacher|woman|man\b|person|character|girl|boy|singer|dancer|معلم|امرأة|رجل|شخص|طفل/,
      "Character study",
    ],
    [
      "object",
      /product|object|sculpture|jewel|watch|منتج|مجسم/,
      "Object study",
    ],
  ];
  // A protagonist explicitly named before incidental objects takes priority,
  // except for ads where a product is generally the focal point.
  if (format !== "ad" && /teacher|singer|dancer|معلم/.test(t) && !horror) {
    subject = "person";
    label = "Character study";
  } else
    for (const [kind, pattern, title] of candidates)
      if (has(t, pattern)) {
        subject = kind;
        label = title;
        break;
      }
  let setting = format === "ad" ? "studio" : "abstract";
  for (const [value, pattern] of [
    ["forest", /forest|woods|jungle|غابة/],
    ["city", /city|street|urban|مدينة|شارع/],
    ["classroom", /classroom|kindergarten|school|فصل|مدرسة|روضة/],
    ["room", /room|house|home|interior|غرفة|منزل/],
    ["desert", /desert|dune|صحراء/],
    ["space", /space|planet|galaxy|فضاء/],
    ["coast", /beach|ocean|sea\b|coast|بحر|شاطئ/],
    ["mountains", /mountain|جبل/],
    ["studio", /studio|ستوديو/],
  ])
    if (has(t, pattern)) {
      setting = value;
      break;
    }
  const night = horror || /night|midnight|ليل/.test(t);
  const medium = /whiteboard|chalk|blackboard|سبورة/.test(style)
    ? "chalk"
    : /sketch|ink|pencil|رسم|قلم/.test(style)
      ? "ink"
      : /gogh|paint|watercolou?r|oil painting|لوحة|مائي/.test(style)
        ? "paint"
        : /clay|3d|plasticine|طين/.test(style)
          ? "clay"
          : /collage|paper|ورق/.test(style)
            ? "collage"
            : /realistic|cinema|film|واقعي|سينما/.test(style) ||
                horror ||
                format === "ad"
              ? "cinema"
              : "flat";
  let colors = horror
    ? ["#121c24", "#405451", "#9db49c", "#da7054"]
    : format === "ad"
      ? ["#19222c", "#527d8c", "#ead8bc", "#e0a662"]
      : format === "kids"
        ? ["#c8dce7", "#9cafd5", "#f5cd91", "#e99483"]
        : ["#233e53", "#698a97", "#d6d7c4", "#e7a969"];
  if (/pastel|باستيل/.test(style))
    colors = ["#c3bbdd", "#a8d7ce", "#efc5c9", "#f5dfac"];
  if (/neon|نيون/.test(style))
    colors = ["#181532", "#755fca", "#6fe7cc", "#ef84bd"];
  if (medium === "chalk") colors = ["#f1efe7", "#b4bdc4", "#303e4e", "#e4ae56"];
  return normalizeScene({
    subject,
    setting,
    medium,
    label,
    colors,
    night,
    covered: subject === "person" && /hijab|حجاب/.test(t),
    count: subject === "zombie" || /crowd|group|مجموعة/.test(t) ? 3 : 1,
    atmosphere: /glitter|sparkle|بريق/.test(style)
      ? "glitter"
      : /rain|مطر/.test(t)
        ? "rain"
        : horror
          ? "mist"
          : setting === "space"
            ? "stars"
            : "clear",
    style: lookText,
  });
}
export function inferDirection(context) {
  const scene = inferScene(context.text, context.format, context.lookText);
  const horror = /horror|zombi|haunt|رعب|زومبي/i.test(context.text);
  const direction = {
    customColors: scene.colors,
    light: scene.night
      ? "rim"
      : context.format === "ad"
        ? "studio"
        : "daylight",
    softness: horror ? 25 : 75,
    energy: horror ? 65 : context.format === "kids" ? 55 : 40,
    realism: scene.medium === "cinema" ? 85 : scene.medium === "clay" ? 55 : 25,
    look: scene.medium === "cinema" ? "cinematic" : "graphic",
    sun: scene.night ? 85 : 40,
    lens: context.format === "ad" ? 65 : 35,
    saturation: /neon|vivid/i.test(context.lookText) ? 90 : 60,
  };
  return { scene, direction, looks: suggestLooks(context) };
}
export function normalizeDirection(raw = {}) {
  const out = {};
  for (const key of directedControls) {
    if (key === "customColors") {
      if (safeColors(raw[key]).length >= 3) out[key] = safeColors(raw[key]);
    } else if (["look", "light", "palette"].includes(key)) {
      const values =
        key === "look"
          ? ["cinematic", "clean", "analog", "graphic"]
          : key === "light"
            ? ["daylight", "golden", "studio", "silhouette", "rim", "neon"]
            : ["pastel", "earth", "citrus", "dusk", "mono"];
      if (values.includes(raw[key])) out[key] = raw[key];
    } else if (typeof raw[key] === "number" && Number.isFinite(raw[key]))
      out[key] =
        key === "tempo"
          ? Math.max(40, Math.min(200, raw[key]))
          : bounded(raw[key]);
  }
  return out;
}
export function normalizeLooks(value) {
  return (Array.isArray(value) ? value : [])
    .filter(
      (v) => typeof v?.label === "string" && typeof v?.description === "string",
    )
    .slice(0, 6)
    .map((v) => ({
      label: string(v.label, 50),
      description: string(v.description, 600),
    }))
    .filter((v) => v.label && v.description);
}
export function suggestLooks(context = {}, seed = 0) {
  const materials = [
    "Hand-drawn ink",
    "Soft clay",
    "Oil painting",
    "Cut paper",
    "Whiteboard",
    "Watercolor",
    "Film grain",
    "Polished glass",
    "Chrome",
    "Charcoal",
    "Van Gogh brushwork",
    "Stop-motion felt",
  ];
  const accents = [
    "neon",
    "pastel",
    "glitter",
    "sculpted forms",
    "warm shadows",
    "raw pencil",
    "iridescence",
    "chalk lines",
    "real textures",
    "tiny lights",
    "bold geometry",
    "dreamy bloom",
    "monochrome",
  ];
  const finishes = [
    "expressive, imperfect edges",
    "quiet negative space",
    "luminous accents",
    "dramatic light",
    "tactile surfaces and tiny details",
    "bold, graphic shadows",
    "layered depth and soft reflections",
  ];
  let state = (Math.abs(Math.trunc(seed)) + 1) * 7919;
  const pick = (array) => {
    state = Math.imul(state ^ (state >>> 13), 1597334677) >>> 0;
    return array[state % array.length];
  };
  const note =
    context.format === "ad"
      ? "Keep the product the focal point."
      : /horror|zombi|رعب|زومبي/i.test(context.text || "")
        ? "Keep the atmosphere uneasy without losing the subject in shadow."
        : "Keep the scene readable and the subject recognizable.";
  return Array.from({ length: 3 }, () => {
    const material = pick(materials),
      accent = pick(accents);
    return {
      label: `${material} + ${accent}`,
      description: `${material} mixed with ${accent}, ${pick(finishes)}. ${note}`,
    };
  });
}
export function validateSceneDecision(raw, context) {
  const fallback = inferDirection(context);
  if (!raw?.scene || typeof raw.scene !== "object") return fallback;
  const scene = normalizeScene({ ...fallback.scene, ...raw.scene });
  // Never invent religious clothing from a place/language alone.
  scene.covered =
    scene.subject === "person" && /hijab|حجاب/i.test(context.text);
  return {
    scene,
    direction: normalizeDirection(raw.direction),
    looks: normalizeLooks(raw.looks).length
      ? normalizeLooks(raw.looks)
      : fallback.looks,
  };
}
export function sceneForDesk(desk, concept = "") {
  const context = {
    text: concept,
    format: desk.format,
    lookText: desk.lookText,
  };
  const scene =
    desk.scene &&
    (desk.autoDirection === false || desk.sceneGraph?.nodes?.length || desk.sceneSource === sceneKey(context))
      ? normalizeScene(desk.scene)
      : inferScene(concept, desk.format, desk.lookText);
  return {
    ...scene,
    colors:
      desk.customColors?.length >= 3
        ? desk.customColors
        : desk.manualControls?.includes("palette")
          ? scenePalettes[desk.palette] || scene.colors
          : scene.colors,
  };
}
