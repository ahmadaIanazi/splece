import { characterLooks, lookDetails } from "./character-looks.mjs";
import { composerEvents } from "./composer-sequence.mjs";

// A gallery image is a separate look, even before it has been analyzed.
export function selectableLooks(asset) {
  if (asset.kind !== "character") return asset.variants || [];
  return characterLooks(asset).map((media) => {
    const details = lookDetails(asset, media.id);
    return {
      ...details,
      id:
        media.id === asset.media?.id
          ? "none"
          : details.id || `look:${media.id}`,
      media,
    };
  });
}
export function isManualLook(draft, id) {
  const option = draft.referenceOptions?.[id];
  return (
    option?.lookLocked === true ||
    draft.assistant?.appearances?.[id] === "manual" ||
    (!!option?.variantId &&
      option.variantId !== "auto" &&
      draft.assistant?.appearances?.[id] !== "following")
  );
}
export function chooseLook(draft, id, variantId) {
  draft.referenceIds ??= [];
  if (!draft.referenceIds.includes(id)) draft.referenceIds.push(id);
  draft.referenceOptions ??= {};
  draft.referenceOptions[id] = {
    ...draft.referenceOptions[id],
    variantId,
    lookLocked: variantId !== "auto",
  };
  draft.assistant ??= {};
  draft.assistant.appearances ??= {};
  draft.assistant.appearances[id] =
    variantId === "auto" ? "inherited" : "manual";
  // An accepted review may contain prose for the previous wardrobe.
  delete draft.smartAccepted;
}
export function lookMedia(asset, look) {
  // The character gallery contains alternate outfits, not extra identity views.
  // Only explicitly grouped images belonging to the selected look may accompany it.
  const media = look?.media || (look ? null : asset.media);
  const extras = look
    ? look.mediaList || []
    : asset.kind === "character"
      ? []
      : asset.mediaList || [];
  const otherLooks = new Set(
    asset.kind === "character"
      ? characterLooks(asset)
          .filter((m) => m.id !== media?.id)
          .map((m) => m.id)
      : [],
  );
  return [media, ...extras]
    .filter((m) => m && !otherLooks.has(m.id))
    .filter(
      (m, i, all) =>
        all.findIndex((x) => (x.id || x.url) === (m.id || m.url)) === i,
    );
}
export function normalizeLookText(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}
// Fast offline cross-language vocabulary. Open-ended semantic interpretation is
// handled by the Composer Assistant using the same analyzed look metadata.
const concepts = [
  "hospital clinic medical مستشفى مستشفي مستوصف عياده طبي طبيه",
  "classroom kindergarten school teaching مدرسه فصل روضه تدريس صف",
  "wedding bridal bride زفاف عرس عروس",
  "home house منزل بيت منزلي",
  "work office business عمل مكتب",
  "beach seaside شاطئ بحر",
  "winter cold snowy شتاء شتوي برد ثلج",
  "summer summerwear صيف صيفي",
  "sleep pajamas pyjamas بيجامه نوم",
  "sport sports gym رياضه رياضي نادي",
  "formal elegant رسمي رسميه انيق انيقه",
  "casual everyday يومي يوميه كاجوال",
  "coat jacket معطف جاكيت ستره",
  "dress gown فستان",
  "abaya abayas عباءه عبايه",
  "hijab headscarf حجاب",
  "hoodie هودي",
  "uniform زي",
  "red احمر حمراء",
  "blue ازرق زرقاء",
  "green اخضر خضراء",
  "black اسود سوداء",
  "white ابيض بيضاء",
  "pink وردي ورديه",
  "yellow اصفر صفراء",
  "purple violet بنفسجي بنفسجيه",
  "mauve موف بنفسجي",
  "grey gray رمادي رماديه",
  "brown بني بنيه",
  "gold golden ذهبي ذهبيه",
  "happy cheerful سعيد سعيده مرح مرحه",
  "worried anxious قلق قلقه",
  "sad حزين حزينه",
  "tired متعب متعبه",
];
const aliases = new Map();
for (const group of concepts) {
  const tokens = group.split(" "),
    canonical = tokens[0];
  for (const token of tokens)
    if (!aliases.has(token)) aliases.set(token, canonical);
}
const ignored = new Set(
  "a an the in on at of to with and or is are she he her his wears wearing look character image photo reference this that same for as from it ال في من على الي مع و او هو هي هذا هذه صوره شخصيه ترتدي يرتدي".split(
    " ",
  ),
);
const negators = new Set([
  "not",
  "no",
  "without",
  "avoid",
  "never",
  "لا",
  "ليس",
  "ليست",
  "بدون",
  "غير",
]);
function token(raw) {
  let word = raw;
  if (/^[\u0621-\u064a]+$/.test(word)) {
    if (word.startsWith("وال")) word = word.slice(1);
    if (word.startsWith("بال")) word = word.slice(1);
    if (word.startsWith("ال")) word = word.slice(2);
  }
  return aliases.get(word) || word;
}
function terms(text, negation = false) {
  const positive = new Set(),
    negative = new Set();
  let remaining = 0;
  for (const raw of normalizeLookText(text).match(
    /[\p{L}\p{N}]+|[.,;!؟،؛\n]/gu,
  ) || []) {
    if (
      /^[.,;!؟،؛\n]$/.test(raw) ||
      ["but", "instead", "لكن", "بل"].includes(raw)
    ) {
      remaining = 0;
      continue;
    }
    if (negation && negators.has(raw)) {
      remaining = 4;
      continue;
    }
    if (ignored.has(raw)) continue;
    (remaining > 0 ? negative : positive).add(token(raw));
    if (remaining) remaining--;
  }
  return { positive, negative };
}
function metadata(look) {
  return [
    look.name,
    look.description,
    look.keywords,
    look.tags,
    look.visualBrief,
  ];
}
function flatten(value) {
  if (Array.isArray(value)) return value.map(flatten).join(" ");
  if (value && typeof value === "object")
    return Object.values(value).map(flatten).join(" ");
  return typeof value === "string" ? value : "";
}
export function matchLook(asset, draft, allAssets = []) {
  const looks = selectableLooks(asset).filter((v) => v.media);
  const scene = draft.scenes?.[0];
  const actions = scene
    ? composerEvents(scene)
        .filter(
          (e) => e.kind !== "speak" && (!e.speaker || e.speaker === asset.id),
        )
        .slice(0, 1)
        .map((e) => e.text)
    : [];
  const text = [draft.general, draft.notes, scene?.text, ...actions]
    .filter(Boolean)
    .join("\n");
  // Exclude clauses explicitly attributed to other characters.
  const relevant = text.split(/\b(?:then|later)\b|ثم|لاحقا/iu)[0];
  const contextText = (relevant || "")
    .split(/\b(?:and|but)\b|[.!?\n،؛;]/iu)
    .filter(
      (clause) =>
        !allAssets.some(
          (a) =>
            a.id !== asset.id &&
            a.kind === "character" &&
            a.name &&
            normalizeLookText(clause).includes(normalizeLookText(a.name)),
        ) || normalizeLookText(clause).includes(normalizeLookText(asset.name)),
    )
    .join("\n");
  const context = terms(contextText, true);
  const sets = looks.map((v) => terms(flatten(metadata(v))).positive);
  const ranked = looks
    .map((look, i) => {
      let score = 0;
      for (const word of sets[i]) {
        const frequency = sets.filter((set) => set.has(word)).length;
        if (frequency === looks.length && looks.length > 1) continue;
        const weight = 1 / frequency;
        if (context.negative.has(word)) score -= 4 * weight;
        else if (context.positive.has(word)) score += weight;
      }
      return { look, score };
    })
    .sort((a, b) => b.score - a.score);
  if (
    !ranked[0] ||
    ranked[0].score <= 0 ||
    ranked[0].score === ranked[1]?.score
  )
    return null;
  return ranked[0].look.id === "none" ? null : ranked[0].look;
}
export function selectedLook(asset, draft, allAssets = []) {
  const id = draft.referenceOptions?.[asset.id]?.variantId;
  if (id === "none") return null;
  if (id && id !== "auto")
    return (
      selectableLooks(asset).find((v) => v.id === id) ||
      asset.variants?.find((v) => v.id === id) || {
        id,
        name: "Unavailable look",
        unavailable: true,
      }
    );
  return matchLook(asset, draft, allAssets);
}
