import { selectableLooks } from "./look-selection.mjs";
import { validSoundSource } from "./video-sound-continuity.mjs";
import { normalizeVideoSound } from "./video-sound.mjs";
import { composerEvents, saveComposerEvents, eventKinds, eventRelations } from "./composer-sequence.mjs";
import { normalizeDesk, deskPrompt } from "./director-desk.mjs";
import { validateContinuity } from "./clip-continuity.mjs";
import { normalizeCreativeDirection, creativePlanningContext, effectiveCreativeDirection } from "./creative-presets.mjs";
import { projectReferenceDraft } from "./asset-scope.mjs";
import { shotDefaults } from "./shot-direction.mjs";
import {
  normalizeStructureNode,
  isStructureClip,
  structurePath,
} from "./structure.mjs";
import { draftTimelinePosition } from "./timeline-navigation.mjs";
import { generationTarget } from "./generation-slots.mjs";
import { validateHierarchy, storyTree } from "./story-tree.mjs";
// Versioned, provider-neutral authoring contract. Imports only accept known local IDs.
const clone = (v) => structuredClone(v);
const text = (v, label, max = 50000) => {
  if (typeof v !== "string" || v.length > max)
    throw Error(`${label} must be text (up to ${max} characters).`);
  return v;
};
const num = (v, label, min = 0) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > 86400)
    throw Error(`${label} must be a number between ${min} and 86400.`);
  return v;
};
const list = (v, label, max = 200) => {
  if (!Array.isArray(v) || v.length > max)
    throw Error(`${label} must be an array (up to ${max} items).`);
  return v;
};
export const promptContract = {
  schemaVersion: 1,
  kind: "frame.prompt",
  instructions:
    "Edit composer only. Keep local asset/variant/media IDs from library. Output this JSON object. Injections and context are read-only snapshots, recomputed on import. Imports create a new draft and never generate video. Camera defaults to No movement. Explicit Auto leaves that field unspecified. cameraDirection overrides camera/movement presets. Same-line actions are concurrent; a new action line means then. Dialogue speaker is a character asset ID. Never invent media URLs or IDs.",
  composer: {
    name: "Scene title",
    start: 0,
    settings: {
      model: "model ID",
      duration: 5,
      resolution: "480p",
      aspect: "16:9",
    },
    general: "",
    notes: "",
    contextNotes: "",
    referenceIds: [],
    referenceOptions: {},
    automation: {},
    sectionOverrides: {},
    frameOverrides: {},
    scenes: [
      {
        text: "Scene action",
        ...shotDefaults,
        cameraDirection: "",
        duration: null,
        characterIds: [],
        locationId: "",
        dialogue: [
          {
            speaker: "character ID",
            text: "Exact dialogue",
            delivery: "Softly",
            direction: "",
          },
        ],
      },
    ],
  },
};
export function storyPlan(p) {
  return (
    p.storyPlans?.[p.episodeId] || {
      title: p.episode || "Episode",
      brief: "",
      synopsis: "",
      beats: [],
    }
  );
}
export function storySignature(p) {
  const { history, ...plan } = storyPlan(p);
  return JSON.stringify({
    episodeId: p.episodeId,
    plan,
    creativeDirection: effectiveCreativeDirection(p),
    workflows: p.settings.workflows,
    assets: p.assets.map(({ favorite, ...asset }) => asset),
  });
}
export function storyContext(p, d) {
  const plan = storyPlan(p),
    end = d.start + d.settings.duration;
  return {
    episodeId: p.episodeId,
    title: plan.title,
    synopsis: plan.synopsis,
    directorIntent: deskPrompt(plan.setup, p.assets, {scope: "clip"}),
    ...(creativePlanningContext(effectiveCreativeDirection(p, d))
      ? { creativeContext: creativePlanningContext(effectiveCreativeDirection(p, d)) }
      : {}),
    ancestors: structurePath(plan.beats, d.storyBeatId).slice(0, -1),
    brief: plan.brief,
    current: plan.beats.filter(
      (b) => b.start < end && b.start + b.duration > d.start,
    ),
    before: plan.beats.filter((b) => b.start + b.duration <= d.start),
    after: plan.beats.filter((b) => b.start >= end),
    timeline: p.clips.map((c) => ({
      id: c.id,
      start: c.start,
      duration: c.duration,
      intent: c.intent || "",
      takeId: c.activeTake,
    })),
    remarks: p.remarks,
    evidence:
      "Story plans and clip intents are authored context, not observed visual facts.",
  };
}
export function storyPromptContext(p, d) {
  const context = storyContext(p, d);
  const describe = (b) =>
    `${b.act} / ${b.title} (${b.start}–${b.start + b.duration}s): ${b.description}`;
  return [
    `Episode: ${context.title}. ${context.synopsis || context.brief}`,
    ...(context.directorIntent ? [context.directorIntent] : []),
    ...context.current.map((b) => "Current planned scene: " + describe(b)),
    ...context.before
      .slice()
      .sort((a, b) => b.start - a.start)
      .slice(0, 1)
      .map((b) => "Prior story intent (continuity only): " + describe(b)),
    ...context.after
      .slice()
      .sort((a, b) => a.start - b.start)
      .slice(0, 1)
      .map(
        (b) =>
          "Following story intent (continuity only; do not perform it in this clip): " +
          describe(b),
      ),
  ].join("\n");
}
export function exportPrompt(p, d, compiled, models = []) {
  const keys = [
    "name",
    "storyBeatId",
    "plannedDuration",
    "repairInstructions",
    "start",
    "settings",
    "general",
    "notes",
    "contextNotes",
    "referenceIds",
    "referenceOptions",
    "continuity",
    "creativeDirection",
    "videoSound",
    "soundContinuity",
    "automation",
    "sectionOverrides",
    "frameOverrides",
    "scenes",
    "systemTemplate",
    "templateOverrides",
  ];
  return {
    ...clone(promptContract),
    composer: { ...Object.fromEntries(
      keys.filter((k) => d[k] !== undefined).map((k) => [k, clone(d[k])]),
    ), ...(compiled.soundReference ? {soundContinuity:{enabled:true,source:clone(compiled.soundReference)}} : {}) },
    injections: {
      text: compiled.text,
      sections: compiled.sections,
      references: compiled.references,
      frames: compiled.boundaries,
      ...(compiled.directionContext ? { directionContext: clone(compiled.directionContext) } : {}),
    },
    context: storyContext(p, d),
    library: p.assets
      .filter((a) => a.kind !== "footage")
      .map(({ history, ...a }) => clone(a)),
    projectDefaults: clone(p.settings),
    supportedModels: models.map((m) => ({
      id: m.id,
      durations: m.durations,
      resolutions: m.resolutions,
      aspects: m.aspects,
      audioConfigurable: !!m.audioConfigurable,
      referenceMode: m.referenceMode,
      maxReferences: m.maxReferences,
      promptLimit: m.promptLimit,
      frames: m.frames,
      endFrame: m.endFrame,
    })),
  };
}
function ids(values, assets, label, kind) {
  return list(values, label).map((id) => {
    if (
      typeof id !== "string" ||
      !assets.some((a) => a.id === id && (!kind || a.kind === kind))
    )
      throw Error(
        `${label}: unknown ${kind || "asset"} ID ${id}. Use a library ID.`,
      );
    return id;
  });
}
function scene(value, assets) {
  if (!value || typeof value !== "object")
    throw Error("Each scene must be an object.");
  const result = {
    id: crypto.randomUUID(),
    text: text(value.text, "Scene text"),
    ...(value.creativeDirection ? {creativeDirection: normalizeCreativeDirection(value.creativeDirection)} : {}),
    camera: text(value.camera ?? "Auto", "Camera", 200),
    movement: text(value.movement ?? shotDefaults.movement, "Movement", 200),
    cameraDirection: text(
      value.cameraDirection ?? "",
      "Custom camera direction",
      2000,
    ),
    transition: text(
      value.transition ?? shotDefaults.transition,
      "Transition",
      200,
    ),
    duration:
      value.duration == null
        ? null
        : num(value.duration, "Scene duration", 0.01),
    characterIds: ids(
      value.characterIds || [],
      assets,
      "Scene characters",
      "character",
    ),
    locationId: value.locationId
      ? ids([value.locationId], assets, "Location", "location")[0]
      : "",
    dialogue: list(value.dialogue || [], "Dialogue").map((l) => ({
      ...(l.id
        ? {id: text(l.id, "Dialogue ID", 200)}
        : value.sequence !== undefined ? {id: crypto.randomUUID()} : {}),
      speaker: ids([l.speaker], assets, "Speaker", "character")[0],
      text: text(l.text, "Dialogue"),
      delivery: text(l.delivery || "Auto", "Delivery", 200),
      direction: text(l.direction || "", "Direction"),
    })),
  };
  const dialogueIds = result.dialogue.map(line => line.id).filter(Boolean);
  if (new Set(dialogueIds).size !== dialogueIds.length) throw Error("Dialogue IDs must be unique.");
  if (value.sequence !== undefined) {
    const seen = new Set();
    result.sequence = list(value.sequence, "Event sequence").map(event => {
      if (!event || !eventKinds.includes(event.kind) || !eventRelations.includes(event.relation || "next")) throw Error("Invalid event type or timing relationship.");
      const id = text(event.id, "Event ID", 200);
      if (!id || seen.has(id)) throw Error("Event IDs must be unique.");
      seen.add(id);
      const pause = num(event.pause ?? 1, "Event pause", 0.1);
      if (pause > 30) throw Error("Event pauses must be at most 30 seconds.");
      const base = { id, kind: event.kind, relation: event.relation || "next", pause };
      if (event.kind === "speak") {
        if (!result.dialogue.some(line => line.id === id)) throw Error("Spoken event must refer to an existing dialogue line.");
        return base;
      }
      return { ...base, text: text(event.text, "Event text"), speaker: event.speaker ? ids([event.speaker], assets, "Event character", "character")[0] : "", direction: text(event.direction || "", "Event direction") };
    });
    saveComposerEvents(result, composerEvents(result));
  }
  return result;
}
export function importPrompt(value, p, models) {
  if (value?.schemaVersion !== 1 || value.kind !== "frame.prompt")
    throw Error(
      "Expected frame.prompt JSON with schemaVersion 1. Copy the example contract first.",
    );
  const c = value.composer;
  if (!c || typeof c !== "object") throw Error("Missing composer object.");
  const model = models.find((m) => m.id === c.settings?.model);
  if (!model || model.supported === false)
    throw Error(
      "Choose an available video model ID from the current composer.",
    );
  const settings = {};
  for (const [key, options] of Object.entries({
    duration: model.durations,
    resolution: model.resolutions,
    aspect: model.aspects,
  })) {
    if (!options?.includes(c.settings[key]) && options?.length)
      throw Error(
        `Unsupported ${key}: ${c.settings[key]}. Supported: ${options.join(", ")}.`,
      );
    settings[key] = c.settings[key];
  }
  num(settings.duration, "Generation duration", 0.01);
  settings.model = model.id;
  if (c.settings.audio !== undefined) {
    if (typeof c.settings.audio !== "boolean")
      throw Error("Audio must be a boolean.");
    if (c.settings.audio && !model.audioConfigurable && !model.audio)
      throw Error("This model does not support requested audio.");
    settings.audio = c.settings.audio;
  }

  const referenceIds = ids(c.referenceIds || [], p.assets, "References");
  const referenceOptions = {};
  for (const [id, option] of Object.entries(c.referenceOptions || {})) {
    if (!referenceIds.includes(id))
      throw Error("Reference options must belong to selected references.");
    const a = p.assets.find((a) => a.id === id),
      v = option.variantId;
    if (
      v &&
      !["auto", "none"].includes(v) &&
      !selectableLooks(a).some((x) => x.id === v) && !a.variants?.some((x) => x.id === v)
    )
      throw Error(`Unknown appearance variant for ${a.name}.`);
    if (option.targetAssetId && !p.assets.some(x => x.id === option.targetAssetId)) throw Error("Unknown reference target.");
    referenceOptions[id] = {
      variantId: v || "auto",
      ...(option.lookLocked !== undefined ? { lookLocked: !!option.lookLocked } : {}),
      role: text(option.role || "", "Reference role", 500),
      ...(option.targetAssetId ? { targetAssetId: option.targetAssetId } : {}),
      required: !!option.required,
    };
  }
  const scenes = list(c.scenes, "Scenes").map((s) => scene(s, p.assets));
  if (!scenes.length) throw Error("At least one scene is required.");
  for (const s of scenes)
    for (const id of [
      ...s.characterIds,
      s.locationId,
      ...s.dialogue.map((l) => l.speaker),
      ...(s.sequence || []).map(event => event.speaker),
    ].filter(Boolean))
      if (!referenceIds.includes(id)) referenceIds.push(id);
  const automation = {};
  for (const [k, v] of Object.entries(c.automation || {})) {
    if (
      ![
        "specs",
        "characters",
        "background",
        "remarks",
        "frames",
        "startFrame",
        "endFrame",
        "camera",
        "dialogue",
        "enhance",
      ].includes(k) ||
      typeof v !== "boolean"
    )
      throw Error("Automation must contain known boolean toggles.");
    automation[k] = v;
  }
  const sectionOverrides = {};
  for (const [k, v] of Object.entries(c.sectionOverrides || {})) {
    if (["__proto__", "constructor", "prototype"].includes(k))
      throw Error("Invalid section name.");
    sectionOverrides[k] = text(v, "Section injection");
  }
  // Manual frame objects must already exist locally; never trust an imported URL.
  const frameOverrides = {};
  const knownFrames = p.drafts.flatMap((d) =>
    Object.values(d.frameOverrides || {})
      .map((o) => o.frame)
      .filter(Boolean),
  );
  for (const [k, v] of Object.entries(c.frameOverrides || {})) {
    if (
      !["start", "end"].includes(k) ||
      !["auto", "none", "manual", "pinned"].includes(v.mode)
    )
      throw Error("Invalid frame override.");
    if (["auto", "none"].includes(v.mode)) frameOverrides[k] = { mode: v.mode };
    else {
      const frame = knownFrames.find(
        (f) => JSON.stringify(f) === JSON.stringify(v.frame),
      );
      if (!frame)
        throw Error(
          "Unknown frame. Select local start/end frames in the composer first.",
        );
      frameOverrides[k] = { mode: v.mode, frame: clone(frame) };
    }
  }
  let soundContinuity;
  if (c.soundContinuity) {
    soundContinuity = {enabled:c.soundContinuity.enabled === true};
    const source=c.soundContinuity.source;
    if (source) {
      if (!validSoundSource(source) || !p.clips.some(clip => clip.id === source.clipId && clip.takes?.some(take => take.id === source.takeId && take.jobId)))
        throw Error("The saved sound source is not available in this project. Choose a local previous clip first.");
      soundContinuity.source={clipId:source.clipId,takeId:source.takeId,start:source.start,duration:source.duration};
    }
  }
  const result = {
    id: crypto.randomUUID(),
    episodeId: p.episodeId,
    closed: false,
    targetId: null,
    name: text(c.name || "Imported scene", "Draft name", 300),
    start: num(c.start, "Start"),
    settings,
    general: text(c.general || "", "General"),
    notes: text(c.notes || "", "Notes"),
    contextNotes: text(c.contextNotes || "", "Context"),
    referenceIds,
    referenceOptions,
    ...(soundContinuity ? {soundContinuity} : {}),
    ...(c.videoSound ? {videoSound: normalizeVideoSound(c.videoSound)} : {}),
    ...(c.creativeDirection ? {creativeDirection: normalizeCreativeDirection(c.creativeDirection)} : {}),
    ...(c.continuity ? { continuity: validateContinuity(c.continuity, p) } : {}),
    scenes,
    automation,
    sectionOverrides,
    frameOverrides,
  };
  if (c.storyBeatId) {
    if (!storyPlan(p).beats.some((b) => b.id === c.storyBeatId))
      throw Error("Unknown story scene ID.");
    result.storyBeatId = c.storyBeatId;
  }
  if (c.plannedDuration !== undefined)
    result.plannedDuration = num(c.plannedDuration, "Planned duration", 0.01);
  if (c.repairInstructions !== undefined)
    result.repairInstructions = text(
      c.repairInstructions,
      "Repair instructions",
    );
  if (c.systemTemplate !== undefined)
    result.systemTemplate = text(c.systemTemplate, "System template");
  if (c.templateOverrides !== undefined) {
    result.templateOverrides = {};
    for (const k of ["characters", "background", "dialogue"])
      if (c.templateOverrides[k] !== undefined)
        result.templateOverrides[k] = text(c.templateOverrides[k], "Template");
  }
  return result;
}
export function validateStory(value, p) {
  if (!value || typeof value !== "object")
    throw Error("Expected a story plan object.");
  const characters = list(value.characters || [], "Characters", 100).map(
    (a) => ({
      id: text(a.id, "Character ID", 200),
      kind: "character",
      gender: ["male", "female", "other"].includes(a.gender) ? a.gender : "",
      name: text(a.name, "Character name", 300),
      description: text(a.description, "Character description"),
      voice: Object.fromEntries(
        [
          "tone",
          "timbre",
          "pitch",
          "pace",
          "accent",
          "language",
          "description",
          "preset",
        ]
          .filter((k) => a.voice?.[k])
          .map((k) => [k, text(a.voice[k], "Voice " + k, 2000)]),
      ),
      variants: [],
      history: [],
      version: 1,
    }),
  );
  const seen = new Set(p.assets.map((a) => a.id));
  for (const a of characters) {
    if (!a.id || seen.has(a.id))
      throw Error(
        "New character IDs must be unique and must not replace library assets.",
      );
    seen.add(a.id);
  }
  const suggestedAssets = list(value.assets || [], "Story assets", 100).map(
    (a) => {
      if (!["location", "prop", "style"].includes(a.kind))
        throw Error("Story asset kind must be location, prop or style.");
      const id = text(a.id, "Asset ID", 200);
      if (!id || seen.has(id)) throw Error("New asset IDs must be unique.");
      seen.add(id);
      return {
        id,
        kind: a.kind,
        name: text(a.name, "Asset name", 300),
        description: text(a.description, "Asset description"),
        variants: [],
        history: [],
        version: 1,
      };
    },
  );
  const assets = [...p.assets, ...characters, ...suggestedAssets],
    beatIds = new Set();
  const beats = list(value.beats, "Structure items", 10000).map((b) => {
    const id = text(b.id, "Beat ID", 200);
    if (!id || beatIds.has(id)) throw Error("Story beat IDs must be unique.");
    beatIds.add(id);
    const s = scene({ ...b, text: b.description }, assets);
    const duration = b.duration ?? b.end - b.start;
    if (b.end != null && Math.abs(b.end - b.start - duration) > 0.001)
      throw Error("Section end must equal start + duration.");
    return {
      id,
      ...(Number.isFinite(b.order) ? { order: b.order } : {}),
      ...normalizeStructureNode({
        kind: text(b.kind || "scene", "Section kind", 20),
        ...(b.nodeType ? { nodeType: b.nodeType } : {}),
        ...(b.legacyLabel
          ? { legacyLabel: text(b.legacyLabel, "Legacy label", 100) }
          : {}),
      }),
      label: text(b.label || "", "Group label", 100),
      parentId: text(b.parentId || "", "Parent ID", 200),
      act: text(b.act || "Act 1", "Act", 300),
      title: text(b.title, "Beat title", 300),
      start: num(b.start, "Beat start"),
      duration: num(duration, "Beat duration", isStructureClip(b) ? 0.01 : 0),
      end: num(b.start + duration, "Section end"),
      description: s.text,
      childNodeType:
        b.childNodeType === "group"
          ? "group"
          : b.childNodeType === "clip"
            ? "clip"
            : undefined,
      generationMode: b.generationMode === "compact" ? "compact" : "multiple",
      generationDuration: [5, 10, 15, 20, 25, 30].includes(b.generationDuration)
        ? b.generationDuration
        : 10,
      assetIds: ids(b.assetIds || [], assets, "Story references"),
      characterIds: s.characterIds,
      locationId: s.locationId,
      cameraDirection: s.cameraDirection,
      camera: s.camera,
      movement: s.movement,
      transition: s.transition,
      dialogue: s.dialogue,
    };
  });
  return {
    // Project choices/provenance are controlled by setup, not story model output.
    ...(storyPlan(p).creativeDirection !== undefined
      ? { creativeDirection: normalizeCreativeDirection(storyPlan(p).creativeDirection) }
      : {}),
    ...(storyPlan(p).starterTemplate !== undefined
      ? { starterTemplate: clone(storyPlan(p).starterTemplate) }
      : {}),
    namingTemplate: value.namingTemplate || storyPlan(p).namingTemplate,
    structureVersion: 1,
    groupLabels: value.groupLabels
      ? list(value.groupLabels, "Group labels", 100).map((v) =>
          text(v, "Group label", 100),
        )
      : storyPlan(p).groupLabels,
    title: text(value.title, "Story title", 300),
    brief: text(value.brief || storyPlan(p).brief || "", "Brief"),
    synopsis: text(value.synopsis || "", "Synopsis"),
    setup: validateStorySetup(value.setup || storyPlan(p).setup || {}, assets),
    beats: storyTree(validateHierarchy(beats)),
    characters,
    assets: suggestedAssets,
  };
}
export function applyStory(p, proposal, signature) {
  if (signature !== storySignature(p))
    throw Error(
      "Story or assets changed. Prepare a fresh proposal before applying.",
    );
  const value = validateStory(proposal, p),
    old = clone(storyPlan(p));
  p.assets.push(
    ...value.characters.map(projectReferenceDraft),
    ...value.assets.map(projectReferenceDraft),
  );
  delete value.assets;
  delete value.characters;
  p.storyPlans ??= {};
  p.storyPlans[p.episodeId] = {
    ...value,
    history: [
      ...(old.history || []),
      { ...old, history: undefined, at: Date.now() },
    ].slice(-30),
  };
}
export function addStoryRemarks(p, beatIds) {
  const chosen = storyPlan(p).beats.filter((b) => beatIds.includes(b.id));
  for (const b of chosen) {
    const marker = {
      id: crypto.randomUUID(),
      lane: 0,
      start: b.start,
      end: b.start + b.duration,
      text: `${b.act} · ${b.title}`,
      storyBeatId: b.id,
    };
    const old = p.remarks.find((r) => r.storyBeatId === b.id);
    if (old)
      Object.assign(old, {
        start: marker.start,
        end: marker.end,
        text: marker.text,
      });
    else p.remarks.push(marker);
  }
}
export function beatDraft(p, beat, base) {
  if (!isStructureClip(beat))
    throw Error(
      "Create a generation inside this scene before opening the video composer.",
    );
  const d = clone(base);
  d.id = crypto.randomUUID();
  d.episodeId = p.episodeId;
  d.name = beat.title;
  d.start = beat.start;
  d.storyBeatId = beat.id;
  d.plannedDuration = beat.duration;
  d.settings.duration = beat.duration;
  d.targetId = null;
  d.generationSlotId = null;
  const existingSlot = generationTarget(p, d);
  d.targetId = existingSlot?.id || null;
  d.generationSlotId = existingSlot?.id || null;
  if (existingSlot || storyPlan(p).beats.some((b) => b.id === beat.id))
    d.start = draftTimelinePosition(p, d).start;
  delete d.sourceGenerationId;
  d.closed = false;
  d.general = "";
  const language = storyPlan(p).setup || {};
  d.notes = [
    ["Spoken language", language.language],
    ["Region", language.region],
    ["Default accent", language.accent],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(". ");
  d.contextNotes = storyPlan(p).synopsis;
  d.referenceOptions = {};
  d.frameOverrides = {};
  d.sectionOverrides = {};
  d.referenceIds = [
    ...new Set(
      [
        ...beat.characterIds,
        ...(beat.assetIds || []),
        beat.locationId,
        ...beat.dialogue.map((l) => l.speaker),
      ].filter(Boolean),
    ),
  ];
  d.scenes = [
    {
      id: crypto.randomUUID(),
      text: beat.description,
      assistantVersion: 1,
      assistant: { sourceStoryId: beat.id },
      cameraDirection: beat.cameraDirection || "",
      camera: beat.camera || "Auto",
      movement: beat.movement || shotDefaults.movement,
      transition: beat.transition || shotDefaults.transition,
      duration: null,
      characterIds: beat.characterIds,
      locationId: beat.locationId,
      dialogue: clone(beat.dialogue),
    },
  ];
  for (const k of [
    "smartAccepted",
    "smartReviews",
    "smartHistory",
    "repair",
    "repairInstructions",
    "preparedOverride",
    "preparations",
  ])
    delete d[k];
  return d;
}

export function validateStorySetup(value, assets) {
  const castIds = list(value.castIds || [], "Cast IDs", 100).map((id) =>
    text(id, "Cast ID", 200),
  );
  const heroIds = list(value.heroIds || [], "Hero IDs", 100).map((id) =>
    text(id, "Hero ID", 200),
  );
  if (
    castIds.some(
      (id) => !assets.some((a) => a.id === id && a.kind === "character"),
    ) ||
    heroIds.some((id) => !castIds.includes(id))
  )
    throw Error(
      "Choose cast and heroes from character IDs in this plan or library.",
    );
  return {
    ...(value.planningVersion === 2 ? {planningVersion:2} : {}),
    language: text(value.language || "", "Dialogue language", 200),
    region: text(value.region || "", "Dialogue region", 200),
    accent: text(value.accent || "", "Dialogue accent", 200),
    dialogueStyle: ["balanced", "dialogue-led", "silent"].includes(
      value.dialogueStyle,
    )
      ? value.dialogueStyle
      : "dialogue-led",
    format: text(value.format || "Short film", "Format", 100),
    targetDuration: num(value.targetDuration ?? 60, "Target duration", 1),
    durationSkipped: !!value.durationSkipped,
    step: Math.min(4, Math.floor(num(value.step ?? 0, "Setup step"))),
    directionBrief: text(value.directionBrief || "", "Creative direction"),
    ...(value.directorDesk ? { directorDesk: normalizeDesk(value.directorDesk, value, assets.map(a => a.id)) } : {}),
    creativeMix: Object.fromEntries(["look", "palette", "lighting", "lens", "movement", "cameraAngles"].map(k => [k,
      list(value.creativeMix?.[k] || [], k, 20).map(v => text(v, k, 200)).filter(v => k !== "cameraAngles" || ["eye-level", "low-angle", "high-angle", "overhead", "dutch-angle"].includes(v))])),
    assetIds: list(value.assetIds || [], "Setup references", 100).filter(id => assets.some(a => a.id === id)),
    referenceIds: list(value.referenceIds || [], "Setup references", 100).filter(id => assets.some(a => a.id === id)),
    castCount: num(value.castCount ?? 1, "Cast count", 0),
    castIds,
    heroIds,
    concept: text(value.concept || "", "Concept"),
    personalityBrief: text(value.personalityBrief || "", "Personality brief"),
    minorCharacters: text(
      value.minorCharacters || "",
      "Minor character descriptions",
    ),
    grouping: value.grouping === "act" ? "act" : "chapter",
    complete: !!value.complete,
  };
}

// A fresh project has no saved story plan yet. Cast setup must work before outlining.
export function attachProjectReference(project, asset) {
  project.storyPlans ??= {};
  project.storyPlans[project.episodeId] ??= structuredClone(storyPlan(project));
  const plan = project.storyPlans[project.episodeId];
  plan.setup ??= {};
  if (!project.assets.some(a=>a.id===asset.id)) project.assets.push(asset);
  const key=asset.kind === "character" ? "castIds" : "assetIds";
  plan.setup[key]=[...new Set([...(plan.setup[key] || []),asset.id])];
  if(key === "castIds") plan.setup.castCount=Math.max(plan.setup.castCount || 1,plan.setup.castIds.length);
  return plan;
}
