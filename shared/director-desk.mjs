import {
  normalizeGraph,
  validateEntities,
  reconcileGraph,
  sceneArrangement,
} from "./scene-graph.mjs";
import {
  normalizeScene,
  normalizeLooks,
  normalizeDirection,
  safeColors,
  directedControls,
  inferDirection,
  validateSceneDecision,
  sceneKey,
  scenePalettes,
} from "./scene-sketch.mjs";
// The desk describes creative intent. It never changes authored text or promises
// that an editorial shot length is supported by a particular video provider.
export const deskFormats = [
  {
    id: "movie",
    label: "Movie",
    hint: "A little world",
    duration: 60,
    energy: 40,
    realism: 85,
  },
  {
    id: "explainer",
    label: "Explainer",
    hint: "Make it click",
    duration: 30,
    energy: 35,
    realism: 65,
  },
  {
    id: "music",
    label: "Music video",
    hint: "Move with the beat",
    duration: 60,
    energy: 80,
    realism: 55,
  },
  {
    id: "kids",
    label: "Kids story",
    hint: "Spark their curiosity",
    duration: 30,
    energy: 55,
    realism: 30,
  },
  {
    id: "ad",
    label: "Ad",
    hint: "One memorable idea",
    duration: 15,
    energy: 65,
    realism: 85,
  },
  {
    id: "social",
    label: "Social short",
    hint: "Stop the scroll",
    duration: 15,
    energy: 75,
    realism: 75,
  },
];
export const durationStops = [5, 15, 30, 60, 180, 600];
export const factFields = {
  character: "Character",
  wardrobe: "Look",
  audience: "Audience",
  region: "Place",
  language: "Language",
  accent: "Dialect",
};
export const looks = [
  { id: "cinematic", label: "Cinema", hint: "Rich light. A film-like feel." },
  { id: "clean", label: "Clear & bright", hint: "Natural, fresh and direct." },
  { id: "analog", label: "Home movie", hint: "Warm, grainy and personal." },
  { id: "graphic", label: "Illustrated", hint: "Playful shapes and color." },
];
export const palettes = [
  {
    id: "pastel",
    label: "Soft pastel",
    colors: scenePalettes.pastel,
  },
  { id: "earth", label: "Earth", colors: scenePalettes.earth },
  { id: "citrus", label: "Citrus", colors: scenePalettes.citrus },
  {
    id: "dusk",
    label: "After hours",
    colors: scenePalettes.dusk,
  },
  {
    id: "mono",
    label: "Monochrome",
    colors: scenePalettes.mono,
  },
];
const clamp = (n, a = 0, b = 100) =>
  Math.max(a, Math.min(b, Number.isFinite(Number(n)) ? Number(n) : a));
const text = (v, limit = 200) =>
  typeof v === "string" ? v.slice(0, limit) : "";
const choice = (v, list, fallback) => (list.includes(v) ? v : fallback);
export function normalizeFormatIdeas(raw) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : [])
    .slice(0, 8)
    .filter(
      (f) =>
        f &&
        text(f.label, 80).trim() &&
        !seen.has(f.label) &&
        seen.add(f.label),
    )
    .map((f) => ({
      label: text(f.label, 80),
      aspect: choice(f.aspect, ["16:9", "9:16", "1:1"], "16:9"),
      duration: clamp(f.duration || 30, 1, 7200),
    }));
}
export function normalizeDesk(value = {}, setup = {}, assetIds) {
  const v = value || {};
  const f =
    deskFormats.find((f) => f.id === v.format) ||
    deskFormats.find((f) => f.label === setup.format) ||
    deskFormats[0];
  const facts = Object.fromEntries(
    Object.keys(factFields).map((k) => [k, text(v.facts?.[k] ?? setup[k])]),
  );
  return {
    version: 4,
    sceneEstablished: !!v.sceneEstablished,
    sceneText: text(v.sceneText, 10000),
    formatLabel: text(
      v.formatLabel ||
        (v.format && !deskFormats.some((f) => f.id === v.format)
          ? v.format
          : "") ||
        f.label,
      80,
    ),
    formatIdeas: normalizeFormatIdeas(v.formatIdeas),
    formatManual: !!v.formatManual,
    aspect: choice(v.aspect, ["16:9", "9:16", "1:1"], "16:9"),
    aspectManual: !!v.aspectManual,
    suggestedDuration: clamp(
      v.suggestedDuration ?? setup.targetDuration ?? 30,
      1,
      7200,
    ),
    durationManual: !!v.durationManual,
    referenceBindings: Object.fromEntries(
      Object.entries(v.referenceBindings || {})
        .filter(
          ([k, id]) =>
            /^[$a-zA-Z0-9_-]{1,64}$/.test(k) &&
            typeof id === "string" &&
            id.length < 100,
        )
        .slice(0, 12),
    ),
    referenceMediaIds: Object.fromEntries(
      Object.entries(v.referenceMediaIds || {})
        .filter(
          ([k, id]) =>
            /^[$a-zA-Z0-9_-]{1,64}$/.test(k) &&
            typeof id === "string" &&
            /^[a-zA-Z0-9_-]{1,100}$/.test(id),
        )
        .slice(0, 12),
    ),
    referenceDesigns: Object.fromEntries(
      Object.entries(v.referenceDesigns || {})
        .filter(
          ([k, id]) =>
            /^[$a-zA-Z0-9_-]{1,64}$/.test(k) && /^g-[a-z0-9]+$/.test(id),
        )
        .slice(0, 12),
    ),
    showSceneImage: v.showSceneImage !== false,
    sceneGraph: normalizeGraph(v.sceneGraph),
    autoDirection: v.autoDirection !== false,
    lookText: text(v.lookText, 1200),
    customColors: safeColors(v.customColors),
    scene:
      v.scene && typeof v.scene === "object" ? normalizeScene(v.scene) : null,
    sceneSource: text(v.sceneSource, 40),
    manualScene: [
      "subject",
      "setting",
      "medium",
      "atmosphere",
      "night",
      "count",
      "label",
      "covered",
    ].filter((k) => v.manualScene?.includes(k)),
    lookIdeas: normalizeLooks(v.lookIdeas),
    manualControls: directedControls.filter((k) =>
      v.manualControls?.includes(k),
    ),
    mode: choice(v.mode, ["quick", "director"], "quick"),
    format: f.id,
    look: choice(
      v.look,
      looks.map((x) => x.id),
      choice(
        setup.creativeMix?.look?.[0],
        looks.map((l) => l.id),
        "cinematic",
      ),
    ),
    realism: clamp(v.realism ?? f.realism),
    energy: clamp(v.energy ?? f.energy),
    light: choice(
      v.light,
      ["daylight", "golden", "studio", "silhouette", "rim", "neon"],
      "daylight",
    ),
    sun: clamp(v.sun ?? 40),
    softness: clamp(v.softness ?? 75),
    palette: choice(
      v.palette,
      palettes.map((p) => p.id),
      choice(
        setup.creativeMix?.palette?.[0],
        palettes.map((p) => p.id),
        "pastel",
      ),
    ),
    saturation: clamp(v.saturation ?? 55),
    lens: clamp(v.lens ?? 35),
    angle: clamp(v.angle ?? 50),
    movement: clamp(v.movement ?? 0),
    orbit: clamp(v.orbit ?? 50),
    path: Array.isArray(v.path)
      ? v.path
          .filter((p) => p && typeof p === "object")
          .slice(0, 40)
          .map((p) => ({ x: clamp(p.x), y: clamp(p.y) }))
      : [],
    dialogue: clamp(
      v.dialogue ??
        (setup.dialogueStyle === "silent"
          ? 0
          : setup.dialogueStyle === "balanced"
            ? 50
            : 70),
    ),
    tempo: clamp(v.tempo ?? 100, 40, 200),
    pacing: clamp(v.pacing ?? 45),
    facts,
    manualFacts: Object.keys(factFields).filter(
      (k) => v.manualFacts?.includes(k) || (!value?.version && setup[k]),
    ),
    pins: (Array.isArray(v.pins) ? v.pins : [])
      .filter(
        (p) =>
          p &&
          typeof p.id === "string" &&
          (!assetIds || assetIds.includes(p.id)),
      )
      .slice(0, 30)
      .map((p) => ({ id: p.id, x: clamp(p.x, 5, 95), y: clamp(p.y, 10, 90) })),
    turn: clamp(v.turn ?? 0, 0, 360),
    garment: choice(
      v.garment,
      ["everyday", "abaya", "dress", "jacket"],
      "everyday",
    ),
    garmentColor: choice(
      v.garmentColor,
      ["sage", "blue", "rose", "sand"],
      "sage",
    ),
    identityLocked: !!v.identityLocked,
    modelId: text(v.modelId),
  };
}
export function durationText(n) {
  return n < 60 ? `${n}s` : `${Number((n / 60).toFixed(1))}m`;
}
export function shotPlan(seconds = 60, model) {
  const duration = clamp(seconds, 1, 86400);
  const supported = (model?.durations || model?.constraints?.durations || [])
    .map(Number)
    .filter((n) => n > 0);
  // Ten seconds is an editorial planning estimate, not a provider guarantee.
  const perShot = supported.length
    ? Math.max(...supported.filter((n) => n <= 10), Math.min(...supported))
    : 10;
  const count = Math.ceil(duration / perShot);
  return {
    duration,
    perShot,
    count,
    multiple: count > 1,
    estimated: !supported.length,
  };
}
export function pinWeight(pin) {
  return Math.round(
    100 - clamp((Math.hypot(pin.x - 50, pin.y - 50) / 45) * 80, 0, 80),
  );
}
export function deskNudges(d) {
  const result = [];
  if (
    d.light === "silhouette" &&
    (d.format === "kids" || /child|kid|طفل|أطفال/i.test(d.facts.audience))
  )
    result.push({
      id: "face",
      text: "Silhouette hides their face. Children connect with faces.",
      action: "Try rim light",
      patch: { light: "rim", softness: 80 },
    });
  if (d.lens > 85 && ["explainer", "kids"].includes(d.format))
    result.push({
      id: "close",
      text: "This close, small details fill the picture. Pull back to see the person.",
      action: "Show their face",
      patch: { lens: 55 },
    });
  if (d.movement > 75 && d.energy < 30)
    result.push({
      id: "pace",
      text: "A fast-moving camera may compete with this calm mood.",
      action: "Slow it down",
      patch: { movement: 20 },
    });
  return result;
}
export function cameraIntent(d) {
  const framing =
    d.lens < 25
      ? "Wide view of the setting"
      : d.lens < 55
        ? "Natural medium framing"
        : d.lens < 85
          ? "Close portrait framing"
          : "Extreme close-up of a detail";
  const angle =
    d.angle < 30 ? "from above" : d.angle > 70 ? "from below" : "at eye level";
  const move =
    d.path.length > 1
      ? "Follow the authored camera path: " +
        d.path
          .map((p) => `(${Math.round(p.x)},${Math.round(p.y)})`)
          .join(" → ") +
        " on a top-down set (0–100; center is the subject, top is behind them). Translate into a smooth camera move, not scene cuts."
      : d.movement < 5
        ? "Camera stays still, no new angles"
        : d.movement < 55
          ? "Slow, gentle push toward the subject"
          : "Steady forward push toward the subject";
  return `${framing}, ${angle}. Camera position ${Math.round((d.orbit - 50) * 3.6)}° around the subject. ${move}.`;
}
export function deskPrompt(setup = {}, assets = [], options = {}) {
  if (!setup.directorDesk) return "";
  const d = normalizeDesk(setup.directorDesk, setup);
  const f = { label: d.formatLabel },
    p = palettes.find((p) => p.id === d.palette),
    shots = shotPlan(setup.targetDuration, options.model);
  return [
    options.scope === "clip"
      ? `${f.label} project. Apply this direction only to the current clip.`
      : `${f.label}. Plan about ${setup.targetDuration || 60} seconds as approximately ${shots.count} short shot${shots.count === 1 ? "" : "s"}; check each generation against its selected model’s duration limits.`,
    ...Object.entries(d.facts)
      .filter(([, v]) => v)
      .map(([k, v]) => `${factFields[k]}: ${v}.`),
    `Look: ${d.lookText || d.scene?.style || looks.find((l) => l.id === d.look)?.label}. ${d.realism > 65 ? "Believable real-world motion and physics" : d.realism < 35 ? "Illustrated, stylized rendering" : "A balance of natural detail and stylization"}. ${d.energy < 35 ? "Calm" : d.energy > 65 ? "Energetic" : "Balanced"} energy.`,
    `Light: ${d.light}; ${d.scene?.night ? "night" : d.sun < 25 ? "early morning" : d.sun > 75 ? "late afternoon" : "daytime"}, softness ${d.softness}%. Palette: ${d.customColors.length ? "Custom" : p.label} (${(d.customColors.length ? d.customColors : p.colors).join(", ")}), vividness ${d.saturation}%.`,
    cameraIntent(d),
    ...(sceneArrangement(d.sceneGraph)
      ? [
          `User scene arrangement: ${sceneArrangement(d.sceneGraph)}. Coordinates are a composition guide; positive x is stage right, positive depth is towards the front camera. Respect the authored story.`,
        ]
      : []),
    `Dialogue: ${d.dialogue === 0 ? "silent, no invented speech" : d.dialogue < 35 ? "sparse" : d.dialogue > 65 ? "talkative" : "balanced"}. Preserve any authored dialogue exactly.`,
    ...(d.format === "music"
      ? [
          `Beat guide: ${d.tempo} BPM, visual accents on beats; this is a planning guide, not audio analysis.`,
        ]
      : []),
    ...(d.format === "explainer"
      ? [
          `Explanation pace: ${d.pacing < 35 ? "patient, one idea at a time" : d.pacing > 65 ? "brisk" : "easy to follow"}.`,
        ]
      : []),
    ...(d.identityLocked
      ? [
          `Character sheet intent: ${d.garmentColor} ${d.garment}, keep the same identity across shots. Honor story-driven wardrobe changes and start-frame continuity.`,
        ]
      : []),
    ...d.pins
      .map((pin) => {
        const a = assets.find((a) => a.id === pin.id);
        return a
          ? `Reference ${a.name} (${a.kind}): relative creative influence ${pinWeight(pin)}%. These are planning priorities, not provider image weights.`
          : "";
      })
      .filter(Boolean),
    "Use these as project defaults. Explicit clip writing, dialogue, local direction and continuity frames take precedence. Never force a cut inside a continuous shot.",
  ].join("\n");
}
export function deskSetupPatch(d, setup = {}) {
  const n = normalizeDesk(d, setup);
  return {
    directorDesk: n,
    format: n.formatLabel,
    ...(!n.durationManual ? { targetDuration: n.suggestedDuration } : {}),
    language: n.facts.language,
    region: n.facts.region,
    accent: n.facts.accent,
    dialogueStyle:
      n.dialogue === 0
        ? "silent"
        : n.dialogue > 65
          ? "dialogue-led"
          : "balanced",
    creativeMix: { ...setup.creativeMix, look: [n.look], palette: [n.palette] },
  };
}
// The request excludes extracted values so applying the answer cannot trigger
// another paid request. Manual choices always win over a late response.
export function setupAssistantContext(project) {
  const s = project.storyPlans?.[project.episodeId]?.setup || {};
  return {
    workspace: "setup",
    schema: 4,
    lookText: text(s.directorDesk?.lookText, 1200),
    episodeId: project.episodeId,
    text: text(s.concept, 10000),
    format: s.directorDesk?.formatManual ? s.directorDesk.formatLabel : "auto",
  };
}
export function extractExplicitFacts(idea = "") {
  const rules = {
    language: [/Arabic|العربية|عربي[ة]?/i, /English|الإنجليزية/i],
    region: [
      /Saudi(?: Arabia)?|السعودية/i,
      /Japan|اليابان/i,
      /New York|Paris|London|Tokyo|Dubai|Riyadh|Jeddah|جدة|الرياض|دبي/i,
    ],
    audience: [/Arabic kids|children|kids|أطفال|الأطفال/i],
    character: [
      /kindergarten teacher|kids[’']? teacher|teacher|معلمة|معلم/i,
      /zombies?|robots?|singer|dancer|astronaut|زومبي|روبوت|رائد فضاء/i,
    ],
    wardrobe: [
      /hijab\s*(?:\+|and)?\s*(?:Saudi\s*)?abaya|hijab|abaya|حجاب|عباءة/i,
    ],
  };
  return {
    facts: Object.entries(rules).flatMap(([field, patterns]) => {
      const value = patterns.map((p) => idea.match(p)?.[0]).find(Boolean);
      return value ? [{ field, value, evidence: value }] : [];
    }),
  };
}
export function validateSetupFacts(raw, context) {
  if (!Array.isArray(raw?.facts))
    throw Error(
      "The Assistant could not read the idea. Your writing is saved.",
    );
  const seen = new Set();
  return {
    ...validateSceneDecision(raw, context),
    formatIdeas: normalizeFormatIdeas(raw.formatIdeas),
    entities: validateEntities(
      raw.entities,
      validateSceneDecision(raw, context).scene,
    ),
    entitiesProvided:
      raw.entitiesProvided ??
      (Array.isArray(raw.entities) && raw.entities.length > 0),
    geometryChanges: (Array.isArray(raw.geometryChanges)
      ? raw.geometryChanges
      : []
    )
      .slice(0, 8)
      .filter(
        (c) =>
          typeof c?.id === "string" &&
          typeof c.evidence === "string" &&
          c.evidence.trim().length >= 4 &&
          context.text?.includes(c.evidence),
      )
      .map((c) => ({ id: c.id, evidence: c.evidence.slice(0, 600) })),
    facts: raw.facts
      .slice(0, 12)
      .filter(
        (f) =>
          Object.hasOwn(factFields, f?.field) &&
          !(
            f.field === "language" &&
            /^(Saudi(?: Arabian?| Arabia)?|American|British|Bali)$/i.test(
              f.value?.trim() || "",
            )
          ) &&
          !(
            f.field === "audience" &&
            !/audience|viewers|aimed at|for (?:the |an? )?(?:kids|children|teens|adults|families|Saudi|Arabic)|جمهور|للأطفال/i.test(
              context.text || "",
            )
          ) &&
          !seen.has(f.field) &&
          text(f.value).trim() &&
          typeof f.evidence === "string" &&
          f.evidence.trim() &&
          context.text
            .toLocaleLowerCase()
            .includes(f.evidence.toLocaleLowerCase()) &&
          seen.add(f.field),
      )
      .map((f) => ({
        field: f.field,
        value: text(f.value),
        evidence: text(f.evidence, 500),
      })),
  };
}
export function mergeSetupFacts(d, result) {
  const next = normalizeDesk(d);
  for (const key of Object.keys(factFields))
    if (!next.manualFacts.includes(key)) next.facts[key] = "";
  for (const { field, value } of result.facts || [])
    if (Object.hasOwn(factFields, field) && !next.manualFacts.includes(field))
      next.facts[field] = value;
  return next;
}
export function mergeSetupDecision(d, result, context) {
  const current = normalizeDesk(d);
  if (!current.autoDirection) return current;
  const next = mergeSetupFacts(current, result);
  const direction = normalizeDirection(result.direction);
  const ideas = normalizeFormatIdeas(result.formatIdeas);
  if (ideas.length) {
    next.formatIdeas = ideas;
    if (!next.formatManual) next.formatLabel = ideas[0].label;
    if (!next.aspectManual) next.aspect = ideas[0].aspect;
    if (!next.durationManual) next.suggestedDuration = ideas[0].duration;
  }
  for (const [key, value] of Object.entries(direction))
    if (!next.manualControls.includes(key)) next[key] = value;
  if (result.scene) {
    next.scene = normalizeScene({
      ...result.scene,
      ...Object.fromEntries(
        current.manualScene.map((k) => [k, current.scene?.[k]]),
      ),
    });
    next.sceneSource = sceneKey(context);
  }
  let entities = validateEntities(result.entities, next.scene);
  const manualRoles = new Set();
  if (
    current.manualScene.some((k) => ["subject", "count", "covered"].includes(k))
  )
    manualRoles.add("subject");
  if (current.manualScene.includes("setting")) manualRoles.add("environment");
  if (manualRoles.size)
    entities = [
      ...entities.filter((n) => !manualRoles.has(n.role)),
      ...validateEntities(null, next.scene).filter((n) =>
        manualRoles.has(n.role),
      ),
    ];
  if (current.sceneEstablished && result.entitiesProvided) {
    const oldWords = new Set(
      current.sceneText.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [],
    );
    const newWords = new Set(
      (context.text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [],
    );
    const overlap =
      [...newWords].filter((w) => oldWords.has(w)).length /
      Math.max(1, Math.min(oldWords.size, newWords.size));
    // New concepts can replace the stage. Edits to the same concept cannot silently redraw it.
    if (overlap > 0.45)
      entities = entities.map((n) => {
        const old = current.sceneGraph.nodes.find((o) => o.id === n.id);
        const evidence = result.geometryChanges?.find(
          (c) => c.id === n.id,
        )?.evidence;
        if (
          !old ||
          (evidence &&
            context.text?.includes(evidence) &&
            !current.sceneText.includes(evidence))
        )
          return n;
        return {
          ...n,
          role: old.role,
          kind: old.kind,
          design: old.design,
          x: old.x,
          y: old.y,
          z: old.z,
          scale: old.scale,
          turn: old.turn,
        };
      });
  }
  next.sceneGraph = reconcileGraph(current.sceneGraph, entities);
  if (result.entitiesProvided) {
    next.sceneEstablished = true;
    next.sceneText = context.text || "";
  }
  next.lookIdeas = normalizeLooks(result.looks);
  return normalizeDesk(next);
}
export function simulateSetupDecision(context) {
  const ad = /ad\b|hostel|product|real estate/i.test(context.text),
    horror = /zombi|horror/i.test(context.text);
  return {
    ...extractExplicitFacts(context.text),
    ...inferDirection(context),
    formatIdeas: [
      {
        label: ad
          ? "Lifestyle property ad"
          : horror
            ? "Surreal horror short"
            : "Visual story",
        aspect: ad ? "9:16" : "16:9",
        duration: ad ? 20 : 30,
      },
      { label: "Atmospheric film", aspect: "16:9", duration: 60 },
      { label: "Looping vignette", aspect: "1:1", duration: 10 },
    ],
  };
}
export function deskRecipe(setup) {
  const d = normalizeDesk(setup.directorDesk, setup);
  // A recipe shares creative settings, not project asset IDs or private writing.
  return {
    type: "splece-director-recipe",
    version: 1,
    targetDuration: setup.targetDuration || 60,
    directorDesk: {
      ...d,
      facts: {},
      manualFacts: [],
      pins: [],
      modelId: "",
      scene: null,
      sceneSource: "",
      sceneText: "",
      sceneEstablished: false,
      sceneGraph: normalizeGraph(),
      referenceBindings: {},
      referenceMediaIds: {},
      referenceDesigns: {},
      lookIdeas: [],
      autoDirection: false,
    },
  };
}

export function deskRecipeCard(setup) {
  const recipe = deskRecipe(setup),
    d = normalizeDesk(recipe.directorDesk),
    p = palettes.find((p) => p.id === d.palette);
  const escape = (v) =>
    String(v)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const rows = [
    d.formatLabel,
    `${durationText(recipe.targetDuration)} · approximately ${shotPlan(recipe.targetDuration).count} shots`,
    `${d.lookText || looks.find((l) => l.id === d.look).label} · ${d.customColors.length ? "Custom palette" : p.label}`,
    `${d.light} light · ${d.softness}% softness`,
    `${d.realism}% realism · ${d.energy}% energy`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="620" viewBox="0 0 1000 620"><metadata id="splece-recipe">${escape(JSON.stringify(recipe))}</metadata><rect width="1000" height="620" rx="36" fill="#090a0d"/><rect x="32" y="32" width="936" height="556" rx="26" fill="#14161c"/><text x="70" y="100" fill="#a9aebb" font-family="system-ui,sans-serif" font-size="19" letter-spacing="3">SPLECE · DIRECTOR RECIPE</text><text x="70" y="176" fill="#f5f4fa" font-family="system-ui,sans-serif" font-size="48" font-weight="600">Make it your own.</text>${rows.map((r, i) => `<text x="70" y="${244 + i * 48}" fill="${i === 0 ? "#f5f4fa" : "#a9aebb"}" font-family="system-ui,sans-serif" font-size="23">${escape(r)}</text>`).join("")}${(d.customColors.length ? d.customColors : p.colors).map((c, i) => `<rect x="${670 + i * 76}" y="212" width="64" height="230" rx="24" fill="${c}"/>`).join("")}<text x="70" y="548" fill="#a9aebb" font-family="system-ui,sans-serif" font-size="17">Load this card in Splece to remix its settings. No private media included.</text></svg>`;
}

export function restoreDeskSetup(current, previous) {
  return {
    ...current,
    ...deskSetupPatch(normalizeDesk(previous.directorDesk, previous), current),
    targetDuration: previous.targetDuration || 60,
  };
}

export function deskCreativeDefaults(setup) {
  if (!setup?.directorDesk) return {};
  const d = normalizeDesk(setup.directorDesk, setup);
  return {
    look: d.look,
    ...(sceneArrangement(d.sceneGraph)
      ? { spatialIntent: sceneArrangement(d.sceneGraph) }
      : {}),
    ...(d.lookText || d.scene?.style
      ? { styleIntent: d.lookText || d.scene.style }
      : {}),
    ...(d.customColors.length
      ? { customPalette: d.customColors }
      : { palette: d.palette }),
    realism: d.realism > 65 ? "physical" : "stylized",
    lighting: d.light === "daylight" ? "window" : d.light,
    lens:
      d.lens < 25
        ? "wide"
        : d.lens < 55
          ? "natural"
          : d.lens < 85
            ? "portrait"
            : "macro",
    movement: d.movement < 5 ? "static" : "push",
    lightSoftness: d.softness,
    timeOfDay: d.sun,
    ...(d.scene?.night ? { timePeriod: "night" } : {}),
    colorVividness: d.saturation,
    cameraAngle: d.angle < 30 ? "above" : d.angle > 70 ? "below" : "eye",
    cameraPosition: Math.round((d.orbit - 50) * 3.6),
    ...(d.path.length > 1 ? { cameraPath: d.path } : {}),
    pacing: d.energy < 35 ? "calm" : d.energy > 65 ? "energetic" : "balanced",
  };
}
