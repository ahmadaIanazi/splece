import { selectedLook, lookMedia, isManualLook } from "./look-selection.mjs";
import { effectiveVideoSound, videoSoundAvailability } from "./video-sound.mjs";
import { syncAssistantInheritance } from "./composer-assistant.mjs";
import { projectVisualReferences } from "./creative-presets.mjs";
import { projectReferenceDraft } from "./asset-scope.mjs";
import { upgradeStructure } from "./structure.mjs";
import { referenceErrors } from "./references.mjs";
import { smartSignature } from "./smart.mjs";
export const uid = () => crypto.randomUUID();
export const automationDefaults = {
  specs: true,
  characters: true,
  background: true,
  remarks: true,
  frames: true,
  startFrame: true,
  endFrame: true,
  camera: true,
  dialogue: true,
  enhance: false,
};
export const exportDefaults = { aspect: "16:9", resolution: "720p", fps: 24 };
export function upgradeProject(p) {
  p.schemaVersion = 2;
  p.directionRanges ??= [];
  upgradeStructure(p);
  p.audioClips ??= [];
  p.audioLanes ??= 1;
  p.episodeId ??= uid();
  p.elements ??= [];
  p.episodes ??= [];
  p.settings ??= {};
  p.settings.automation = { ...automationDefaults, ...p.settings.automation };
  p.settings.export = { ...exportDefaults, ...p.settings.export };
  p.settings.concurrency ??= 3;
  p.settings.deliveryPresets ??= [
    "Softly",
    "Whispering",
    "Calmly",
    "Angrily",
    "Shouting",
    "Laughing",
    "Crying",
  ];
  p.settings.templateVersions ??= [];
  p.settings.templates ??= {
    characters: "Preserve each character’s identity and selected appearance.",
    background: "Use authored continuity facts; do not invent observed events.",
    dialogue: "Preserve the exact words and speaker attribution.",
  };
  for (const d of p.drafts) {
    d.frameOverrides ??= {};
    d.referenceOptions ??= {};
    d.sectionOverrides ??= {};
    d.contextNotes ??= "";
    d.preparations ??= [];
    d.automation ??= {};
    d.quantity ??= 1;
    d.episodeId ??= p.episodeId;
    for (const s of d.scenes) {
      s.characterIds ??= [];
      s.locationId ??= "";
      s.duration ??= null;
      s.transition ??= "Auto";
      for (const line of s.dialogue) line.direction ??= "";
    }
  }
  for (const a of p.assets) {
    a.version ??= 1;
    a.variants ??= [];
    a.history ??= [];
    a.delivery ??= "Softly";
  }
  return syncAssistantInheritance(p);
}
export function effectiveAutomation(p, d) {
  return Object.fromEntries(
    Object.entries({ ...automationDefaults, ...p.settings.automation }).map(
      ([key, v]) => [
        key,
        typeof d.automation?.[key] === "boolean" ? d.automation[key] : v,
      ],
    ),
  );
}
export function resolveReferences(p, d, { projectVisuals = true } = {}) {
  const defaults = projectVisuals ? projectVisualReferences(p,d) : [];
  return p.assets
    .filter((a) => d.referenceIds.includes(a.id) || defaults.some(r=>r.assetId===a.id))
    .map((a) => {
      const visual = !d.referenceIds.includes(a.id) && defaults.find(r=>r.assetId===a.id);
      const option = d.referenceOptions?.[a.id] || (visual ? {role:visual.role,variantId:"none"} : {});
      const variant = selectedLook(a, { ...d, referenceOptions: { ...d.referenceOptions, [a.id]: option } }, p.assets);
      const media = lookMedia(a, variant);
      return {
        ...structuredClone(a),
        ...(a.kind === "character" && variant ? {
          description: variant.description || "",
          variant: "",
          visualBrief: variant.visualBrief || {},
          lookTags: variant.tags || {},
        } : {}),
        ...(visual ? { projectVisualRole: visual.role, kind: "style" } : {}),
        selectedVariant: variant ? structuredClone(variant) : null,
        role:
          option.role ||
          (a.kind === "character"
            ? "identity"
            : a.kind === "location"
              ? "location"
              : a.kind === "prop" ? "prop" : "style"),
        targetName: p.assets.find(x => x.id === option.targetAssetId)?.name || "",
        targetAssetId: option.targetAssetId || null,
        required: !!option.required,
        selectionOrigin: isManualLook(d, a.id) ? "manual" : d.assistant?.appearances?.[a.id] === "following" ? "Composer Assistant" : "analyzed look match",
        selectedMedia: media[0] || null,
        selectedMediaList: media,

      };
    });
}
export function resolveBoundary(d, key, automatic) {
  const o = d.frameOverrides?.[key];
  if (o?.mode === "none") return null;
  if (["manual", "pinned"].includes(o?.mode))
    return { ...o.frame, mode: o.mode };
  return automatic ? { ...automatic, mode: "auto" } : null;
}
export function validatePreparation(p, d, compiled, model) {
  const errors = [],
    warnings = [];
  const soundAvailability = videoSoundAvailability(model, d.settings);
  if (effectiveVideoSound(p,d).enabled && !soundAvailability.ready) warnings.push({code:"native-sound", message:soundAvailability.reason});
  for (const key of ["start","end"]) {
    const waiting = d.frameOverrides?.[key];
    if (waiting?.mode === "waiting" && !p.clips.some(c=>c.id === waiting.clipId && c.takes?.some(t=>t.id===c.activeTake))) errors.push({code:"frame-pending",message:`Waiting for the ${key} frame’s source footage. Generate that clip first, or remove this frame dependency.`});
  }
  for (const reference of compiled.references) {
    if (reference.selectedVariant?.unavailable) errors.push({ code: "look-unavailable", message: `${reference.name}’s selected look is no longer available. Choose another look before generating.` });
  }
  const attached = new Set(compiled.references.map(r=>r.id));
  const writing = (d.scenes || []).map(s=>s.text || "").join(" ").toLowerCase();
  for (const asset of p.assets.filter(a=>a.kind === "character" && a.name?.length > 2 && !attached.has(a.id))) {
    if (writing.includes(asset.name.toLowerCase())) warnings.push({code:"unresolved-cast",message:`${asset.name} is named in the action but has no attached character reference. Attach the identity or remove the mention before generating.`});
  }
  if (!model)
    errors.push({
      code: "model-unavailable",
      message:
        "This saved model is unavailable. Choose a supported model; the original settings and prompt remain in the generation history.",
    });
  if (model?.supported === false)
    errors.push({ code: "model-workflow", message: model.unavailableReason });
  if (model)
    for (const [key, choices] of Object.entries({
      duration: model.durations,
      resolution: model.resolutions,
      aspect: model.aspects,
    })) {
      if (choices?.length && !choices.includes(d.settings[key]))
        errors.push({
          code: "settings-changed",
          message: `Saved ${key} is no longer supported. Choose a supported value before generating; your saved inputs remain intact.`,
        });
    }
  if (d.repair && Math.abs(d.settings.duration - d.repair.duration) > 0.02)
    errors.push({
      code: "repair-duration",
      message: `The selected repair is ${d.repair.duration.toFixed(2)}s. Choose a model with that duration, or select a new range; the timeline is not stretched.`,
    });
  if (d.repair) {
    const target = p.clips.find((c) => c.id === d.targetId);
    if (
      !target ||
      Math.abs(target.duration - d.repair.duration) > 0.02 ||
      Math.abs(target.start - d.start) > 0.02
    )
      errors.push({
        code: "repair-target",
        message:
          "The repair target moved or was trimmed. Select the desired range again before generating.",
      });
  }
  if (
    d.repair &&
    (model?.provider === "Venice" || model?.providerId === "fal") &&
    ((compiled.boundaries.start && !model.frames) ||
      (compiled.boundaries.end && !model.endFrame))
  )
    errors.push({
      code: "repair-frames",
      message:
        "This model cannot accept the pinned repair frames. Choose a model with start/end support; Kling O3 reference-to-video also accepts character references.",
    });
  if (compiled.smartStale)
    errors.push({
      code: "smart-stale",
      message:
        "The source or context changed after smart preparation. Prepare again or return to the original compiled prompt.",
    });
  const limit = model?.promptLimit || 10000;
  if (compiled.text.length > limit)
    errors.push({
      code: "prompt-limit",
      message: `Prepared prompt is ${compiled.text.length} characters; this model allows ${limit}. Review a shorter prepared version. Your writing is preserved.`,
    });
  const timed = d.scenes.reduce((n, s) => n + (Number(s.duration) || 0), 0);
  if (timed > d.settings.duration + 0.01)
    errors.push({
      code: "scene-timing",
      message: `Scene timings total ${timed}s, but the model duration is ${d.settings.duration}s. Adjust timings or model duration.`,
    });
  for (const message of referenceErrors(compiled, model))
    errors.push({ code: "reference-mapping", message });
  const maxRefs = model?.maxReferences ?? 8;
  const refs = compiled.references.filter((a) => a.selectedMedia);
  const imageCount = refs.reduce(
    (n, ref) => n + (ref.selectedMediaList?.length || 1),
    0,
  );
  if (imageCount > maxRefs)
    errors.push({
      code: "references",
      message: `${imageCount} image references are attached; ${maxRefs} supported.`,
    });
  for (const ref of refs)
    if (model?.referenceRoles && !model.referenceRoles.includes(ref.role)) {
      (ref.required ? errors : warnings).push({
        code: "unsupported-reference",
        message: `${ref.name}: ${ref.role} reference is not supported and will not be sent.`,
      });
    }
  if (d.scenes.some((s) => s.dialogue.length) && model?.audio === false)
    warnings.push({
      code: "audio",
      message:
        "This model does not generate audio. Dialogue remains in your draft and prompt; no spoken audio is promised.",
    });
  else if (d.scenes.some((s) => s.dialogue.length) && model?.audioConfigurable && !d.settings.audio)
    warnings.push({code: "audio-off", message: "This clip has dialogue, but generated audio is off. Turn audio on in generation settings to request spoken dialogue."});
  for (const key of ["start", "end"])
    if (
      compiled.boundaries[key] &&
      (!model?.frames || (key === "end" && model.endFrame === false))
    )
      errors.push({
        code: "frame",
        message: `This model cannot accept the ${key} frame. Remove that frame or choose a model with frame support. Your image is kept.`,
      });
  for (const s of d.scenes)
    for (const line of s.dialogue)
      if (!line.speaker && line.text)
        errors.push({
          code: "speaker",
          message: "Choose a character for each spoken line.",
        });
  return { errors, warnings, characters: compiled.text.length, limit, timed };
}
export function switchEpisode(p, id, name) {
  p.episodes ??= [];
  const current = {
    id: p.episodeId,
    name: p.episode,
    clips: p.clips,
    remarks: p.remarks,
    remarkLanes: p.remarkLanes,
    audioClips: p.audioClips,
    audioLanes: p.audioLanes,
    activeDraftId: p.activeDraftId,
  };
  const i = p.episodes.findIndex((e) => e.id === current.id);
  if (i < 0) p.episodes.push(structuredClone(current));
  else p.episodes[i] = structuredClone(current);
  let target = p.episodes.find((e) => e.id === id);
  if (!target) {
    target = {
      id: id || uid(),
      name: name || `Episode ${String(p.episodes.length + 1).padStart(2, "0")}`,
      clips: [],
      remarks: [],
      remarkLanes: 1,
      audioClips: [],
      audioLanes: 1,
    };
    p.episodes.push(target);
  }
  Object.assign(p, {
    episodeId: target.id,
    episode: target.name,
    clips: structuredClone(target.clips),
    remarks: structuredClone(target.remarks),
    remarkLanes: target.remarkLanes,
    audioClips: structuredClone(target.audioClips || []),
    audioLanes: target.audioLanes || 1,
  });
  const draft = p.drafts.find((d) => d.episodeId === target.id && !d.closed);
  if (draft) p.activeDraftId = draft.id;
  else p.activeDraftId = null;
}
export function timelineIssues(clips) {
  const issues = [];
  const ordered = [...clips].sort((a, b) => a.start - b.start);
  let end = 0;
  for (const c of ordered) {
    const take = c.takes.find((t) => t.id === c.activeTake);
    if (c.start < end - 0.02)
      issues.push({
        clipId: c.id,
        code: "overlap",
        message: `Overlap at ${c.start.toFixed(2)}s`,
      });
    if (!take)
      issues.push({
        clipId: c.id,
        code: "pending",
        message: `Clip at ${c.start.toFixed(2)}s has no ready take`,
      });
    else if (c.in + c.duration > take.duration + 0.04)
      issues.push({
        clipId: c.id,
        code: "short",
        message: `Take at ${c.start.toFixed(2)}s is shorter than its trim`,
      });
    end = Math.max(end, c.start + c.duration);
  }
  return issues;
}
export function audioGain(c, episodeTime) {
  if (c.mute) return 0;
  const t = episodeTime - c.start;
  if (t < 0 || t >= c.duration) return 0;
  const envelope = c.envelope || {
    in: c.in,
    duration: c.duration,
    fadeIn: c.fadeIn,
    fadeOut: c.fadeOut,
  };
  const position = t + (c.in || 0) - (envelope.in || 0);
  return (
    (c.volume ?? 1) *
    Math.min(
      1,
      envelope.fadeIn ? Math.max(0, position / envelope.fadeIn) : 1,
      envelope.fadeOut
        ? Math.max(0, (envelope.duration - position) / envelope.fadeOut)
        : 1,
    )
  );
}
export function exportSize(settings) {
  const short = parseInt(settings.resolution || "720"),
    long = Math.round((short * 16) / 9 / 2) * 2;
  return settings.aspect === "4:5" ? [short, Math.round(short*5/4/2)*2] : settings.aspect === "9:16"
    ? [short, long]
    : settings.aspect === "1:1"
      ? [short, short]
      : [long, short];
}
export function visibleClips(clips, scrollLeft, width, zoom, overscan = 250) {
  return clips.filter(
    (c) =>
      (c.start + c.duration) * zoom >= scrollLeft - overscan &&
      c.start * zoom <= scrollLeft + width + overscan,
  );
}
export function editAsset(project, next) {
  const index = project.assets.findIndex((a) => a.id === next.id);
  if (index < 0) {
    project.assets.push({
      ...(next.kind === "character" && next.referenceStatus !== "approved"
        ? projectReferenceDraft(next)
        : next),
      version: 1,
      history: [],
    });
    return;
  }
  const old = project.assets[index],
    history = [
      ...(old.history || []),
      {
        ...structuredClone(old),
        history: undefined,
        at: new Date().toISOString(),
      },
    ];
  project.assets[index] = { ...next, version: (old.version || 1) + 1, history };
}
export function restoreDraftsWithoutOverwrite(current, recovered) {
  const result = structuredClone(current);
  for (const draft of recovered.drafts) {
    const old = result.drafts.find((d) => d.id === draft.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(draft)) {
      result.drafts.push({
        ...structuredClone(draft),
        id: uid(),
        name: draft.name + " · recovered",
        closed: false,
      });
    }
  }
  for (const asset of recovered.assets)
    if (!result.assets.some((a) => a.id === asset.id))
      result.assets.push(structuredClone(asset));
  return result;
}

// A reused take begins with its frozen inputs, even if defaults/assets changed later.
export function reuseGeneration(project, snapshot) {
  const d = structuredClone(snapshot.draft);
  delete d.assistant;
  for (const scene of d.scenes || []) { delete scene.assistant; delete scene.assistantVersion; }
  const mapping = {};
  for (const ref of snapshot.compiled.references) {
    const copy = structuredClone(ref);
    copy.id = uid();
    mapping[ref.id] = copy.id;
    project.assets.push(copy);
  }
  if (snapshot.compiled.soundReference) d.videoSound = effectiveVideoSound({settings:snapshot.template}, snapshot.draft);
  d.soundContinuity = snapshot.compiled.soundReference ? {enabled:true,source:structuredClone(snapshot.compiled.soundReference)} : {enabled:false};
  d.id = uid();
  d.episodeId = project.episodeId;
  d.closed = false;
  d.name += " · copy";
  d.targetId = null;
  d.generationSlotId =
    snapshot.targetId || snapshot.draft.generationSlotId || null;
  d.referenceIds = [...new Set([...d.referenceIds.map((id) => mapping[id] || id), ...snapshot.compiled.references.filter(r=>r.projectVisualRole).map(r=>mapping[r.id])])];
  d.useProjectVisuals = false;
  d.referenceOptions = Object.fromEntries(
    Object.entries(d.referenceOptions || {}).map(([id, option]) => [
      mapping[id] || id,
      option,
    ]),
  );
  for (const ref of snapshot.compiled.references.filter(r => r.projectVisualRole))
    d.referenceOptions[mapping[ref.id]] = { role: ref.projectVisualRole, variantId: "none" };
  for (const scene of d.scenes) {
    scene.characterIds = (scene.characterIds || []).map(
      (id) => mapping[id] || id,
    );
    scene.locationId = mapping[scene.locationId] || scene.locationId;
    for (const event of scene.sequence || []) {
      if (event.speaker) event.speaker = mapping[event.speaker] || event.speaker;
    }
    scene.dialogue.forEach((line) => {
      line.speaker = mapping[line.speaker] || line.speaker;
    });
  }
  d.systemTemplate = d.systemTemplate ?? snapshot.template.systemPrompt;
  d.templateOverrides = structuredClone(
    d.templateOverrides ?? snapshot.template.templates ?? {},
  );
  d.automation = effectiveAutomation({ settings: snapshot.template }, d);
  d.sectionOverrides = Object.fromEntries(
    snapshot.compiled.sections.map((s) => [s.label, s.text]),
  );
  if (!Object.hasOwn(d.sectionOverrides, "Sound direction")) d.sectionOverrides["Sound direction"] = "";
  // Reuse freezes the absence of creative choices too, including future timeline defaults.
  if (!Object.hasOwn(d.sectionOverrides, "Creative direction")) d.sectionOverrides["Creative direction"] = "";
  // Reuse freezes the absence of creative choices too, even in a styled project.
  if ((project.settings.creativeDirection || project.storyPlans?.[project.episodeId]?.creativeDirection) &&
      !Object.hasOwn(d.sectionOverrides, "Creative direction"))
    d.sectionOverrides["Creative direction"] = "";
  d.preparations = structuredClone(snapshot.draft.preparations || []);
  for (const key of ["start", "end"]) {
    const frame = snapshot.compiled.boundaries[key];
    d.frameOverrides ??= {};
    d.frameOverrides[key] = frame
      ? { mode: "pinned", frame: structuredClone(frame) }
      : { mode: "none" };
  }
  if (d.smartAccepted) {
    d.smartAccepted.decisions = d.smartAccepted.decisions.map((c) => ({
      ...c,
      assetId: mapping[c.assetId] || c.assetId,
    }));
    d.smartAccepted.sourceSignature = smartSignature(project, d);
  }
  project.drafts.push(d);
  project.activeDraftId = d.id;
  return d;
}
