import {validateMediaVisual} from "../shared/media-animation.mjs";
import {validateElements} from "../shared/elements.mjs";
import { visualBriefText } from "../shared/asset-brief.mjs";
import { composerSequenceText, composerSequenceControl } from "../shared/composer-sequence.mjs";
import { workflowGuidance, validateWorkflowSettings } from "../shared/workflows.mjs";
import { syncAssistantInheritance } from "../shared/composer-assistant.mjs";
import { timelineCreativeSection, timelineDirectionContext } from "../shared/timeline-direction.mjs";
import { referenceRoles } from "../shared/reference-roles.mjs";
import { continuitySection } from "../shared/clip-continuity.mjs";
import {timelineFrameSources, captureTimelineFrame} from "../shared/timeline-frames.mjs";
import { projectCreativeSection, CREATIVE_INJECTION_VERSION } from "../shared/creative-presets.mjs";
import {
  shotDefaults,
  cameraDirection,
  lockedCamera,
  shotActionControl,
} from "../shared/shot-direction.mjs";
import {
  sceneControls,
  hasAuthoredSpeech,
  notesForSubmission,
} from "../shared/scene-controls.mjs";
import { storyPromptContext } from "../shared/authoring.mjs";
import { orderProtectedPrompt } from "../shared/prompt-protection.mjs";
import { bindReferencePrompt } from "../shared/references.mjs";
import { smartSignature } from "../shared/smart.mjs";
import {
  effectiveAutomation,
  resolveReferences,
  resolveBoundary,
  upgradeProject,
} from "../shared/studio.mjs";
export const id = () => crypto.randomUUID();
export const models = [
  {
    id: "demo-cinema",
    name: "Cinema",
    provider: "Local simulator",
    durations: [5, 10],
    resolutions: ["480p", "720p"],
    aspects: ["16:9", "9:16", "1:1"],
    frames: true,
    price: 0,
    promptLimit: 10000,
    maxReferences: 8,
    audio: false,
    referenceRoles: ["identity", "location", "style", "pose", "clothing"],
    catalogVersion: "demo-v2",
  },
  {
    id: "demo-motion",
    name: "Motion",
    provider: "Local simulator",
    durations: [4, 8],
    resolutions: ["720p", "1080p"],
    aspects: ["16:9", "9:16"],
    frames: false,
    price: 0,
    promptLimit: 4000,
    maxReferences: 2,
    audio: false,
    referenceRoles: ["identity", "style"],
    catalogVersion: "demo-v2",
  },
];
export function normalizeSettings(settings, modelId) {
  const model = models.find((m) => m.id === modelId);
  if (!model) throw new Error("Unknown model. Online providers are not enabled.");
  const next = { model: model.id };
  const changes = [];
  for (const [field, values] of Object.entries({
    duration: model.durations,
    resolution: model.resolutions,
    aspect: model.aspects,
  })) {
    next[field] = values.includes(settings[field])
      ? settings[field]
      : values[0];
    if (next[field] !== settings[field])
      changes.push(`${field}: ${settings[field]} → ${next[field]}`);
  }
  return { settings: next, changes };
}
export const defaultAutomation = {
  specs: true,
  characters: true,
  background: true,
  remarks: true,
  frames: true,
  camera: true,
  dialogue: true,
};
export function newDraft(name = "Untitled scene", start = 0) {
  return {
    id: id(),
    name,
    start,
    targetId: null,
    settings: {
      model: "demo-cinema",
      duration: 5,
      resolution: "480p",
      aspect: "16:9",
    },
    general: "",
    notes: "",
    referenceIds: [],
    automation: {},
    scenes: [
      {
        id: id(),
        text: "",
        ...shotDefaults,
        dialogue: [],
      },
    ],
    closed: false,
  };
}
export function newProject(name) {
  const draft = newDraft("Clip #1");
  return {
    id: id(),
    name,
    episode: "Episode 01",
    drafts: [draft],
    activeDraftId: draft.id,
    clips: [],
    assets: [],
    remarks: [],
    remarkLanes: 1,
    settings: {
      systemPrompt:
        "Maintain visual identity and spatial continuity. Follow the director’s scene descriptions and dialogue precisely.",
      automation: { ...defaultAutomation },
    },
    createdAt: new Date().toISOString(),
  };
}
export function compilePrompt(project, draft, model) {
  if (draft.scenes?.some(scene => scene.assistant?.sourceStoryId))
    draft = syncAssistantInheritance({ ...project, drafts: [structuredClone(draft)] }).drafts[0];
  const sections = [];
  const a = effectiveAutomation(project, draft);
  if (a.specs)
    sections.push({
      label: "General specifications",
      source: "Project template + model settings",
      text: [
        draft.systemTemplate ?? project.settings.systemPrompt,
        `${draft.settings.aspect}; ${draft.settings.resolution}; ${draft.settings.duration} seconds.`,
        draft.general,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  else if (draft.general)
    sections.push({
      label: "General specifications",
      source: "Your writing",
      text: draft.general,
    });
  const creative = timelineCreativeSection(project, draft, a, model) || projectCreativeSection(project, draft, a, model);
  if (creative) sections.push(creative);
  sections.push(...workflowGuidance(project.settings, "video", "camera").map(s => ({...s,label:"Workflow · " + s.label})));
  const assets = resolveReferences(project, draft);
  if (a.characters && assets.length)
    sections.push({
      label: "Characters & references",
      source: "Selected library assets",
      text: [
        (draft.templateOverrides ?? project.settings.templates)?.characters ||
          "",
        assets
          .map(
            (x) =>
              `${x.name} (${x.kind}${x.kind === "character" && x.gender ? ", " + x.gender : ""}, version ${x.version || 1}): ${x.description}${visualBriefText({...x.visualBrief,...x.selectedVariant?.visualBrief}, x.kind) ? "\nApproved visual details (refine the base description): " + visualBriefText({...x.visualBrief,...x.selectedVariant?.visualBrief}, x.kind) : ""}${x.variant ? "\nAppearance / outfit / pose: " + x.variant : ""}${
                x.selectedVariant
                  ? "\nSelected variant: " +
                    x.selectedVariant.name +
                    ". " +
                    x.selectedVariant.description +
                    ". " +
                    Object.entries(x.selectedVariant.tags || {})
                      .map(([k, v]) => k + ": " + v)
                      .join("; ")
                  : ""
              }`,
          )
          .join("\n"),
      ]
        .filter(Boolean)
        .join("\n"),
    });
  const roleLines = assets.filter(x => draft.referenceOptions?.[x.id]?.role).map(x => {
    const role = referenceRoles.find(r => r.id === x.role);
    return role ? `${x.name}: ${role.label}${x.targetName ? " for " + x.targetName : ""}. ${role.instruction}` : "";
  }).filter(Boolean);
  if (roleLines.length) sections.push({ label: "Reference roles", source: "Explicit clip-local reference choices", text: roleLines.join("\n") });
  sections.push(...workflowGuidance(project.settings, "video", "references").map(s => ({...s,label:"Workflow · " + s.label})));
  const before = project.clips
    .filter(
      (c) =>
        c.id !== draft.targetId && c.start + c.duration <= draft.start + 0.01,
    )
    .sort((a, b) => b.start - a.start)[0];
  const after = project.clips
    .filter(
      (c) =>
        c.start >= draft.start + draft.settings.duration - 0.01 &&
        c.id !== draft.targetId,
    )
    .sort((a, b) => a.start - b.start)[0];
  // Broad story context is retained for text planning, not visual casting instructions.
  const planningContext = {
    episode: project.storyPlans?.[project.episodeId]
      ? storyPromptContext(project, draft)
      : "",
    before: before?.intent || "",
    after: after?.intent || "",
    notes: draft.contextNotes || "",
    backgroundTemplate:
      (draft.templateOverrides ?? project.settings.templates)?.background || "",
  };
  if (a.remarks) {
    const remarks = project.remarks.filter(
      (r) =>
        r.start < draft.start + draft.settings.duration && r.end > draft.start,
    );
    if (remarks.length)
      sections.push({
        label: "Editorial intent",
        source: "Fixed-time remarks; not spoken or on-screen text",
        text: remarks.map((r) => r.text).join("\n"),
      });
  }
  if (a.dialogue && model?.audio !== false && draft.settings.audio !== false) {
    const speakers = new Set(
      draft.scenes.flatMap((s) =>
        s.dialogue.filter((l) => l.text).map((l) => l.speaker),
      ),
    );
    const voices = assets
      .filter((x) => x.kind === "character" && x.voice && speakers.has(x.id))
      .map((x) => {
        const description = Object.entries(x.voice)
          .filter(
            ([k, v]) => k !== "preset" && typeof v === "string" && v.trim(),
          )
          .map(([k, v]) => `${k}: ${v}`)
          .join("; ");
        return description
          ? `${x.name} — voice identity: ${description}. Keep this voice identity consistent for this character. Apply nonverbal or singing delivery only to the requested performance.`
          : "";
      })
      .filter(Boolean);
    if (voices.length)
      sections.push({
        label: "Character voices",
        source: "Saved speaker voice profiles",
        text: voices.join("\n"),
      });
  }
  sections.push({
    label: "Scenes",
    source: "Your scene cards and dialogue",
    text: [
      a.dialogue && draft.scenes.some((s) => s.dialogue.some((d) => d.text))
        ? (draft.templateOverrides ?? project.settings.templates)?.dialogue
        : "",
      draft.scenes
        .map(
          (s, i) =>
            `${i + 1}. ${s.duration ? "[" + s.duration + "s] " : ""}${s.text}${s.locationId ? "\nLocation: " + (assets.find((a) => a.id === s.locationId)?.name || "unspecified") : ""}${s.characterIds?.length ? "\nCharacters: " + s.characterIds.map((id) => assets.find((a) => a.id === id)?.name || id).join(", ") : ""}${s.transition && s.transition !== "Auto" ? "\nTransition: " + s.transition : ""}${a.camera && cameraDirection(s) ? "\nCamera: " + cameraDirection(s) + "." : ""}${s.sequence?.length ? "\n" + composerSequenceText(s, assets, a.dialogue) : a.dialogue ? s.dialogue.map((d) => `\n${assets.find((x) => x.id === d.speaker)?.name || "Unassigned speaker"} ${[d.delivery !== "Auto" ? d.delivery : "", d.direction].filter(Boolean).length ? "(" + [d.delivery !== "Auto" ? d.delivery : "", d.direction].filter(Boolean).join("; ") + ")" : ""}: “${d.text}”`).join("") : ""}`,
        )
        .join("\n\n"),
    ]
      .filter(Boolean)
      .join("\n"),
  });
  const continuity = continuitySection(project, draft);
  if (continuity) sections.push(continuity);
  sections.push(...workflowGuidance(project.settings, "video", "continuity").map(s => ({...s,label:"Workflow · " + s.label})));
  if (draft.repairInstructions)
    sections.push({
      label: "Repair direction",
      source: "Your selected range",
      text: draft.repairInstructions,
    });
  const submittedNotes = notesForSubmission(
    draft.notes,
    hasAuthoredSpeech(draft, a),
  );
  if (submittedNotes)
    sections.push({
      label: "General notes",
      source: "Your writing",
      text: submittedNotes,
    });
  const boundaries = {
    start: before
      ? {
          clipId: before.id,
          takeId: before.activeTake,
          time: before.in + before.duration - 1 / 24,
        }
      : null,
    end: after
      ? { clipId: after.id, takeId: after.activeTake, time: after.in }
      : null,
  };
  if (a.enhance && draft.preparations?.length) {
    const enhancement = draft.preparations.at(-1);
    sections.push({
      label: "Reviewed preparation",
      source: enhancement.source || "Local scripted preparation",
      text: enhancement.text,
    });
  }
  sections.push(...workflowGuidance(project.settings, "video", "assemble").map(s => ({...s, label: "Workflow · " + s.label})));
  for (const section of sections) {
    if (draft.sectionOverrides?.[section.label] !== undefined) {
      section.generatedText = section.text;
      section.text = draft.sectionOverrides[section.label];
      section.source = "Manual prepared override · preserved until rebuilt";
    }
  }
  for (const section of sections) {
    for (const asset of project.assets)
      section.text = section.text
        .split("@[" + asset.name + "]")
        .join(asset.name);
  }
  const resolveFrame = key => {
    const override = draft.frameOverrides?.[key];
    if (override?.mode !== "waiting") return resolveBoundary(draft,key,boundaries[key]);
    const source = timelineFrameSources(project).find(s => s.clip.id === override.clipId);
    return source ? {...captureTimelineFrame(source,key === "start" ? source.max : source.min), mode:"manual"} : null;
  };
  const directionContext = timelineDirectionContext(project, draft);
  const result = {
    injectionVersion: CREATIVE_INJECTION_VERSION,
    ...(directionContext ? {directionContext} : {}),
    planningContext,
    sections,
    text: sections.map((s) => `[${s.label}]\n${s.text}`).join("\n\n"),
    references: structuredClone(assets),
    boundaries: {
      start:
        a.frames && a.startFrame !== false
          ? resolveFrame("start")
          : null,
      end:
        a.frames && a.endFrame !== false
          ? resolveFrame("end")
          : null,
    },
    before,
    after,
  };
  // An automatic continuity suggestion must not change the chosen video workflow.
  // Explicit frames stay visible so validation can explain incompatible inputs.
  result.omittedAutomaticFrames = [];
  if (model)
    for (const key of ["start", "end"]) {
      if (
        (result.boundaries[key]?.mode === "auto" ||
          (result.boundaries[key]?.timelineCapture &&
            (model.continuityAsReference ||
              /^wan-3-0-.*reference-to-video$/.test(model.id)))) &&
        (!model.frames || (key === "end" && model.endFrame === false))
      ) {
        if (
          (key === "start" || result.boundaries[key]?.timelineCapture) &&
          (model.continuityAsReference ||
            /^wan-3-0-.*reference-to-video$/.test(model.id)) &&
          (result.boundaries[key]?.timelineCapture ||
            before?.takes?.some((t) => t.id === result.boundaries[key].takeId))
        ) {
          result[
            key === "start" ? "continuityReference" : "continuityEndReference"
          ] = { ...result.boundaries[key] };
        } else result.omittedAutomaticFrames.push(key);
        result.boundaries[key] = null;
      }
    }
  if (draft.smartAccepted) {
    result.smartStale =
      draft.smartAccepted.sourceSignature !== smartSignature(project, draft);
    if (!result.smartStale) {
      result.text = draft.smartAccepted.prompt;
      result.sections = [
        {
          label: "Smart prompt",
          text: result.text,
          source: "Reviewed smart proposal · original writing preserved",
        },
      ];
      result.references = draft.smartAccepted.decisions
        .map((choice) => {
          const asset = project.assets.find((a) => a.id === choice.assetId);
          if (!asset) return null;
          return resolveReferences(project, {
            ...draft,
            referenceIds: [asset.id],
            referenceOptions: {
              ...draft.referenceOptions,
              [asset.id]: {
                ...draft.referenceOptions?.[asset.id],
                variantId: choice.variantId || "none",
              },
            },
          }, { projectVisuals: false })[0];
        })
        .filter(Boolean);
      for (const visual of assets.filter(x=>x.projectVisualRole)) if (!result.references.some(x=>x.id===visual.id)) result.references.push(visual);
    }
  }
  for (const key of ["start", "end"]) {
    const frame =
      result[
        key === "start" ? "continuityReference" : "continuityEndReference"
      ];
    if (!frame) continue;
    const media = {
      id: `continuity-${key}-${frame.takeId}-${frame.time}`,
      kind: "image",
      frameSource: frame,
      thumbnail: `/api/media/${frame.takeId}/frame?time=${frame.time}`,
    };
    const placeFirst =
      key === "start" &&
      (!draft.smartAccepted ||
        result.smartStale ||
        draft.smartAccepted.referenceOrder);
    result.references[placeFirst ? "unshift" : "push"]({
      id: media.id,
      name:
        key === "end"
          ? "Closing continuity frame"
          : frame.timelineCapture
            ? "Opening continuity frame"
            : "Previous clip · last frame",
      boundaryKey: key,
      kind: "continuity",
      role: "location",
      selectedMedia: media,
      selectedMediaList: [media],
    });
  }
  if (draft.smartAccepted?.referenceOrder && !result.smartStale) {
    const order = draft.smartAccepted.referenceOrder;
    result.references.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
  }
  const controls = sceneControls(draft, assets, a);
  if (result.boundaries.start || result.continuityReference) controls.push("Opening-state continuity: The supplied opening frame is authoritative for the current clothing, removed garments, carried objects and visible condition. Character reference sheets establish identity, not a wardrobe reset. Keep a removed coat or other removed clothing off; do not restore reference outfits or reset props mid-shot. Change clothing or object state only through an explicitly authored visible action. Maintain this state throughout the shot and into its ending.");
  if (a.camera)
    draft.scenes.forEach((s, i) => {
      if (s.cameraDirection?.trim())
        controls.push(
          `Scene ${i + 1} camera control: ${s.cameraDirection.trim().replace(/\s*\n\s*/g, " ")}`,
        );
      else if (lockedCamera(s))
        controls.push(
          draft.nativeMultiShot
            ? `Scene ${i + 1} camera control: Still camera; same framing/angle, no cuts.`
            : `Scene ${i + 1} camera control: Locked camera. Keep one continuous shot with the same framing and angle. No pan, tilt, zoom, tracking, camera shake, cuts or new angles. Only subjects move as explicitly described.`,
        );
    });
  controls.push(
    ...draft.scenes
      .map((s, i) => composerSequenceControl(s, i, assets, a.dialogue) || shotActionControl(s, i, draft.nativeMultiShot))
      .filter(Boolean),
  );
  result.sceneControls = controls;
  result.sections.push({
    label: "Scene controls",
    source: "Scene cast and authored dialogue",
    text: controls.join("\n"),
  });
  if (!controls.every((line) => result.text.split("\n").includes(line))) {
    result.text = result.text
      .split("\n")
      .filter(
        (line) =>
          !/^Scene \d+ (cast|speech|camera|action) control:/.test(line) &&
          line !== "[Scene controls]",
      )
      .join("\n");
    result.text += "\n\n[Scene controls]\n" + controls.join("\n");
  }
  const bound = bindReferencePrompt(result, model);
  bound.text = orderProtectedPrompt(bound.text, draft);
  return bound;
}
export function splitClip(clips, clipId, time) {
  const c = clips.find((c) => c.id === clipId);
  if (!c || time <= c.start + 0.04 || time >= c.start + c.duration - 0.04)
    return clips;
  const delta = time - c.start;
  return clips.flatMap((x) =>
    x.id !== clipId
      ? [x]
      : [
          { ...x, duration: delta },
          {
            ...structuredClone(x),
            id: id(),
            start: time,
            in: x.in + delta,
            duration: x.duration - delta,
          },
        ],
  );
}
export function validateProject(p) {
  validateElements(p?.elements);
  for(const c of p?.clips || []) if(c.visual) validateMediaVisual(c.visual);
  if (
    !p ||
    typeof p.name !== "string" ||
    !Array.isArray(p.drafts) ||
    !Array.isArray(p.clips) ||
    !Array.isArray(p.assets) ||
    !Array.isArray(p.remarks)
  )
    throw new Error("Invalid project");
  if (p.settings?.workflows !== undefined) validateWorkflowSettings(p.settings.workflows);
  for (const c of p.clips)
    if (
      !Number.isFinite(c.start) ||
      c.start < 0 ||
      !Number.isFinite(c.duration) ||
      c.duration <= 0 ||
      !Number.isFinite(c.in) ||
      c.in < 0
    )
      throw new Error("Invalid clip timing");
  for (const r of p.remarks)
    if (
      !Number.isFinite(r.start) ||
      r.start < 0 ||
      !Number.isFinite(r.end) ||
      r.end <= r.start
    )
      throw new Error("Invalid remark range");
  for (const d of p.drafts)
    if (!Number.isFinite(d.start) || d.start < 0)
      throw new Error("Invalid draft destination");
  return p;
}
