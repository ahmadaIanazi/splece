import {
  readCamera,
  writeCamera,
  framings,
  elevations,
  viewpoints,
} from "./camera-direction.mjs";
import {
  clipContinuityContext,
  priorClipContinuitySource,
} from "./clip-continuity.mjs";
import { effectiveCreativeDirection } from "./creative-presets.mjs";
import { timelineDirectionSignature } from "./timeline-direction.mjs";
export const assistantFields = {
  framing: framings,
  elevation: [null, ...elevations],
  viewpoint: [null, ...viewpoints],
  movement: [
    "Auto",
    "No movement",
    "Slow push in",
    "Pull back",
    "Tracking",
    "Pan left",
    "Pan right",
    "Handheld",
  ],
};
export const cameraValues = (s) => ({
  ...readCamera(s.camera),
  movement: s.movement || "Auto",
});
export function fieldOwner(scene, field) {
  const explicit = scene.assistant?.owners?.[field];
  if (["manual", "following", "inherited"].includes(explicit)) return explicit;
  const value = cameraValues(scene)[field];
  // Existing non-default values have unknown provenance. Never appropriate them.
  return scene.assistantVersion === 1 || value == null || value === "Auto"
    ? "inherited"
    : "manual";
}
export function claimCamera(scene, fields, owner = "manual") {
  scene.assistant ??= {};
  scene.assistant.owners ??= {};
  for (const field of fields) scene.assistant.owners[field] = owner;
}
export function setCameraField(scene, field, value) {
  if (field === "movement") scene.movement = value;
  else scene.camera = writeCamera(scene.camera, { [field]: value });
}
export function appearanceOwner(draft, id) {
  return (
    draft.assistant?.appearances?.[id] ||
    (draft.referenceOptions?.[id]?.variantId &&
    draft.referenceOptions[id].variantId !== "auto"
      ? "manual"
      : "inherited")
  );
}
export function markAssistantManualEdits(before, after) {
  for (const draft of after.drafts || []) {
    const prev = before.drafts?.find((d) => d.id === draft.id);
    if (!prev) continue;
    for (const scene of draft.scenes || []) {
      const old = prev.scenes?.find((s) => s.id === scene.id);
      if (!old) continue;
      const a = cameraValues(old),
        b = cameraValues(scene);
      for (const field of Object.keys(assistantFields))
        if (
          a[field] !== b[field] &&
          scene.assistant?.owners?.[field] === old.assistant?.owners?.[field]
        )
          claimCamera(scene, [field]);
      if (scene.cameraDirection !== old.cameraDirection) {
        claimCamera(scene, Object.keys(assistantFields));
        scene.assistant.customOwner = "manual";
      }
    }
    for (const id of draft.referenceIds || [])
      if (
        draft.referenceOptions?.[id]?.variantId !==
        prev.referenceOptions?.[id]?.variantId
      ) {
        draft.assistant ??= {};
        draft.assistant.appearances ??= {};
        draft.assistant.appearances[id] = "manual";
      }
  }
}
export function syncAssistantInheritance(project) {
  for (const draft of project.drafts || [])
    for (const scene of draft.scenes || []) {
      if (!scene.assistant?.sourceStoryId) continue;
      const node = project.storyPlans?.[
        draft.episodeId || project.episodeId
      ]?.beats?.find((n) => n.id === scene.assistant.sourceStoryId);
      if (!node) continue;
      const inherited = cameraValues(node);
      if (scene.assistant.customOwner !== "manual")
        scene.cameraDirection = node.cameraDirection || "";
      for (const field of Object.keys(assistantFields))
        if (fieldOwner(scene, field) === "inherited")
          setCameraField(scene, field, inherited[field]);
    }
  return project;
}
const limit = (value, n = 1200) => String(value || "").slice(0, n);
const mediaKey = (m) =>
  m
    ? {
        id: m.id,
        url: m.url,
        path: m.path,
        thumbnail: m.thumbnail,
        kind: m.kind,
        mime: m.mime,
      }
    : null;
export function assistantContext(
  project,
  draft,
  sceneId,
  model = {},
  policy = {},
) {
  if (!project || !draft) return null;
  const scene =
    draft.scenes?.find((s) => s.id === sceneId) || draft.scenes?.[0];
  if (!scene) return null;
  // Skip rather than truncate authored text: a dropped negation is consequential.
  if ((scene.text || "").length > 6000) return null;
  const index = draft.scenes.indexOf(scene),
    values = cameraValues(scene);
  const plan = project.storyPlans?.[draft.episodeId || project.episodeId];
  const nodes = [];
  let node = plan?.beats?.find((n) => n.id === draft.storyBeatId);
  const seen = new Set();
  while (node && !seen.has(node.id) && nodes.length < 32) {
    seen.add(node.id);
    nodes.unshift({
      id: node.id,
      title: limit(node.title),
      description: limit(node.description || node.summary || node.prompt),
      dialogue: node.dialogue,
      camera: node.camera,
      movement: node.movement,
      cameraDirection: node.cameraDirection,
      creativeDirection: node.creativeDirection,
    });
    node = plan.beats.find((n) => n.id === node.parentId);
  }
  const prior = priorClipContinuitySource(project, draft);
  const candidates = (project.assets || [])
    .filter((a) => a.kind === "character" && draft.referenceIds?.includes(a.id))
    .slice(0, 12)
    .map((a) => ({
      id: a.id,
      name: limit(a.name, 100),
      description: limit(a.description),
      owner: appearanceOwner(draft, a.id),
      selected: draft.referenceOptions?.[a.id]?.variantId || "auto",
      options: draft.referenceOptions?.[a.id] || {},
      media: mediaKey(a.media),
      variants: (a.variants || []).slice(0, 12).map((v) => ({
        id: v.id,
        name: limit(v.name, 100),
        description: limit(v.description),
        tags: v.tags,
        media: mediaKey(v.media),
      })),
    }));
  const neighbors = (project.drafts || [])
    .filter(
      (d) =>
        d.id !== draft.id &&
        (d.episodeId || project.episodeId) ===
          (draft.episodeId || project.episodeId) &&
        (!draft.promptGroupId || d.promptGroupId !== draft.promptGroupId),
    )
    .sort((a, b) => a.start - b.start);
  const summarize = (d) =>
    d
      ? {
          title: limit(d.name, 120),
          start: d.start,
          scenes: (d.scenes || [])
            .slice(0, 4)
            .map((s) => ({ text: limit(s.text, 600), dialogue: s.dialogue })),
          plannedEnd: d.continuity?.plannedEnd,
        }
      : null;
  return {
    version: 2,
    workflows: project.settings?.workflows,
    policy: {
      creativeDecisions: policy.creativeDecisions !== false,
      writingSuggestions: policy.writingSuggestions !== false,
    },
    story: {
      title: limit(plan?.title, 120),
      synopsis: limit(plan?.synopsis, 2000),
      brief: limit(
        typeof plan?.brief === "string"
          ? plan.brief
          : JSON.stringify(plan?.brief || {}),
        2000,
      ),
      outline: (plan?.beats || [])
        .slice(0, 80)
        .map((b) => ({
          id: b.id,
          parentId: b.parentId,
          title: limit(b.title, 100),
          description: limit(b.description || b.summary || b.prompt, 180),
          start: b.start,
        })),
    },
    neighbors: {
      before: summarize(neighbors.filter((d) => d.start <= draft.start).at(-1)),
      after: summarize(neighbors.find((d) => d.start > draft.start)),
    },
    attached: (project.assets || [])
      .filter((a) => draft.referenceIds?.includes(a.id))
      .map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    projectId: project.id,
    draftId: draft.id,
    sceneId: scene.id,
    index,
    text: scene.text || "",
    dialogue: scene.dialogue || [],
    general: limit(draft.general),
    notes: limit(draft.notes),
    controls: Object.fromEntries(
      Object.keys(assistantFields).map((field) => [
        field,
        { value: values[field], owner: fieldOwner(scene, field) },
      ]),
    ),
    writtenCamera: scene.cameraDirection || "",
    cameraEnabled:
      (draft.automation?.camera ?? project.settings?.automation?.camera) !==
      false,
    sceneOverride: draft.sectionOverrides?.Scenes,
    start: draft.start,
    duration: draft.settings?.duration,
    episodeId: draft.episodeId || project.episodeId,
    structure: nodes,
    creative: effectiveCreativeDirection(project, draft),
    timedDirection: timelineDirectionSignature(project, draft),
    continuity: clipContinuityContext(project, draft),
    prior: prior
      ? {
          origin: prior.origin,
          clipId: prior.clip?.id,
          takeId: prior.take?.id,
          plannedEnd: prior.draft?.continuity?.plannedEnd || null,
        }
      : null,
    adjacent: draft.scenes
      .slice(Math.max(0, index - 1), index + 2)
      .filter((s) => s.id !== scene.id)
      .map((s) => ({ id: s.id, relation: draft.scenes.indexOf(s) < index ? "before" : "after", text: limit(s.text), dialogue: s.dialogue })),
    frames: draft.frameOverrides || {},
    referenceIds: draft.referenceIds || [],
    candidates,
    // All transport-relevant inputs invalidate decisions, even if not sent to the LLM.
    referenceState: (project.assets || [])
      .filter((a) => draft.referenceIds?.includes(a.id))
      .map((a) => ({
        id: a.id,
        version: a.version,
        media: mediaKey(a.media),
        mediaList: a.mediaList?.map(mediaKey),
      })),
    settings: draft.settings,
    model: {
      id: model.id,
      catalogVersion: model.catalogVersion,
      capabilities: model.capabilities,
      referenceMode: model.referenceMode,
      maxReferences: model.maxReferences,
      frames: model.frames,
      endFrame: model.endFrame,
      supported: model.supported,
      durations: model.durations,
      resolutions: model.resolutions,
      aspects: model.aspects,
      promptLimit: model.promptLimit,
      audio: model.audio,
      audioConfigurable: model.audioConfigurable,
    },
    suppress: draft.assistant?.suppressed || [],
  };
}
export function assistantFingerprint(context) {
  if (!context) return "";
  if (["structure", "setup", "scene-asset"].includes(context.workspace)) return JSON.stringify(context);
  const value = structuredClone(context);
  for (const control of Object.values(value.controls))
    if (control.owner !== "manual") {
      control.value = null;
      control.owner = "eligible";
    }
  for (const a of value.candidates)
    if (a.owner !== "manual") {
      a.selected = null;
      a.owner = "eligible";
      delete a.options.variantId;
    }
  delete value.suppress;
  return JSON.stringify(value);
}
function exactKeys(object, keys) {
  return (
    object &&
    typeof object === "object" &&
    !Array.isArray(object) &&
    Object.keys(object).every((k) => keys.includes(k))
  );
}
export function validateAssistantDecision(raw, context) {
  if (
    !exactKeys(raw, ["camera", "appearances", "issues", "completion"]) ||
    !Array.isArray(raw.camera) ||
    !Array.isArray(raw.appearances) ||
    !Array.isArray(raw.issues) ||
    raw.camera.length > 4 ||
    raw.appearances.length > 12 ||
    raw.issues.length > 6
  )
    throw Error("Assistant response did not match the decision contract.");
  const seen = new Set(),
    camera = [],
    appearances = [],
    issues = [];
  const evidence = (v) =>
    typeof v === "string" &&
    v.trim().length >= 3 &&
    context.text.includes(v) &&
    v.length <= 1000;
  for (const c of raw.camera) {
    if (
      !exactKeys(c, ["field", "value", "evidence"]) ||
      !assistantFields[c.field]?.includes(c.value) ||
      seen.has(c.field) ||
      !evidence(c.evidence)
    )
      throw Error("Invalid camera decision.");
    seen.add(c.field);
    const position = context.text.indexOf(c.evidence),
      prefix = context.text.slice(Math.max(0, position - 30), position);
    const negated =
      /(?:not|avoid|without|no longer|never)\s+(?:a |the |any )?$/i.test(
        prefix,
      ) || /\b(?:not|avoid|without|no longer|never)\b/i.test(c.evidence);
    const speech = (context.dialogue || []).some((line) =>
      line.text?.includes(c.evidence),
    );
    if (negated || speech) {
      issues.push({
        kind: "camera",
        message:
          "Camera wording is negated or part of dialogue; existing settings kept.",
        evidence: c.evidence,
      });
      continue;
    }
    const explicit = /camera|shot|close[- ]up|wide|angle|pan |push in|pull back|tracking|handheld|locked|static|profile|overhead|الكاميرا|لقطة|زاوية/i.test(c.evidence);
    let timed = []; try { timed = JSON.parse(context.timedDirection || '[]'); } catch {}
    const settings = [context.creative || {}, ...timed.map(s => s.settings || {})];
    const directed = (context.structure || []).some(n => {
      const value = cameraValues(n)[c.field]; return value != null && value !== 'Auto';
    }) || settings.some(s => c.field === 'framing' ? s.lens || s.movement : c.field === 'movement' ? s.movement : false);
    if (!explicit && (context.policy?.creativeDecisions === false || directed)) continue;
    if (context.writtenCamera || context.controls[c.field].owner === "manual") {
      if (context.controls[c.field]?.value !== c.value)
        issues.push({
          kind: "camera",
          message: `Writing suggests ${c.value || "Auto"}; your manual ${c.field} is kept.`,
          evidence: c.evidence,
        });
    } else if (context.cameraEnabled && context.sceneOverride === undefined)
      camera.push(c);
  }
  for (const a of raw.appearances) {
    const candidate = context.candidates.find((c) => c.id === a.assetId);
    if (
      !exactKeys(a, ["assetId", "variantId", "evidence"]) ||
      !candidate ||
      seen.has(a.assetId) ||
      !evidence(a.evidence) ||
      !(a.variantId === "none"
        ? candidate.media
        : candidate.variants.find((v) => v.id === a.variantId)?.media)
    )
      throw Error("Unknown or unavailable appearance.");
    seen.add(a.assetId);
    if (candidate.owner === "manual")
      issues.push({
        kind: "appearance",
        message: `${candidate.name}: your pinned appearance is kept.`,
        evidence: a.evidence,
      });
    else if (
      /\b(?:not|without|no longer|removes?|takes? off)\b/i.test(a.evidence) ||
      context.prior?.takeId ||
      context.index !== 0 ||
      Object.values(context.frames).some((f) => f?.mode && f.mode !== "none") ||
      context.continuity?.opening?.text
    )
      issues.push({
        kind: "appearance",
        message: `${candidate.name}: check this appearance against the opening state. No reference changed.`,
        evidence: a.evidence,
      });
    else appearances.push(a);
  }
  for (const issue of raw.issues) {
    if (
      !exactKeys(issue, ["kind", "message", "evidence"]) ||
      !["continuity", "appearance", "camera", "technical"].includes(issue.kind) ||
      typeof issue.message !== "string" ||
      issue.message.length > 300 ||
      !evidence(issue.evidence)
    )
      throw Error("Invalid continuity notice.");
    // Notices are explicitly textual checks, never visual observations.
    issues.push({ ...issue, message: issue.message.trim() });
  }
  let completion = null;
  if (raw.completion != null && context.policy?.writingSuggestions !== false) {
    const v = raw.completion;
    if (
      !exactKeys(v, ["text", "reason"]) ||
      typeof v.text !== "string" ||
      !v.text.trim() ||
      v.text.length > 320 ||
      /[\r\n]/.test(v.text) ||
      typeof v.reason !== "string" ||
      v.reason.length > 180
    )
      throw Error("Invalid writing suggestion.");
    const names = new Set((context.attached || []).map((a) => a.name));
    if (
      [...v.text.matchAll(/@\[([^\]]+)\]/g)].some((m) => !names.has(m[1])) ||
      /@(?:Image|Element)\d+|https?:|<[^>]+>/i.test(v.text) || v.text.replace(/@\[[^\]]+\]/g, "").includes("@")
    )
      throw Error("A writing suggestion referred to an unavailable asset.");
    const nextActions = [
      ...(context.neighbors?.after?.scenes || []),
      ...(context.adjacent || []),
    ]
      .map((s) => s.text?.trim())
      .filter(Boolean);
    if (
      !context.text.includes(v.text.trim()) &&
      !nextActions.some((text) => text === v.text.trim())
    )
      completion = { text: v.text.trim(), reason: v.reason.trim() };
  }
  return { camera, appearances, issues: issues.slice(0, 6), completion };
}
export function applyAssistantDecision(
  project,
  draftId,
  context,
  decision,
  receiptId,
) {
  const draft = project.drafts.find((d) => d.id === draftId),
    scene = draft?.scenes.find((s) => s.id === context.sceneId);
  if (!scene) return false;
  const fresh = assistantContext(
      project,
      draft,
      scene.id,
      context.model,
      context.policy,
    ),
    fingerprint = assistantFingerprint(context);
  if (
    assistantFingerprint(fresh) !== fingerprint ||
    draft.assistant?.suppressed?.includes(fingerprint)
  )
    return false;
  let changed = false;
  for (const c of decision.camera)
    if (
      fieldOwner(scene, c.field) !== "manual" &&
      !scene.cameraDirection &&
      cameraValues(scene)[c.field] !== c.value
    ) {
      setCameraField(scene, c.field, c.value);
      claimCamera(scene, [c.field], "following");
      scene.assistant.changed = {
        ...scene.assistant.changed,
        [c.field]: { at: Date.now(), value: c.value, evidence: c.evidence },
      };
      changed = true;
    }
  for (const a of decision.appearances)
    if (
      appearanceOwner(draft, a.assetId) !== "manual" &&
      draft.referenceOptions?.[a.assetId]?.variantId !== a.variantId
    ) {
      draft.referenceOptions ??= {};
      draft.referenceOptions[a.assetId] = {
        ...draft.referenceOptions[a.assetId],
        variantId: a.variantId,
      };
      draft.assistant ??= {};
      draft.assistant.appearances ??= {};
      draft.assistant.appearances[a.assetId] = "following";
      changed = true;
    }
  draft.assistant ??= {};
  draft.assistant.last = {
    receiptId,
    fingerprint,
    sceneId: scene.id,
    at: Date.now(),
    issues: decision.issues,
    completion: decision.completion || null,
    changes: [
      ...decision.camera.map((c) => `${c.field}: ${c.value || "Auto"}`),
      ...decision.appearances.map((a) => `Appearance: ${a.assetId}`),
    ],
  };
  return changed;
}
export function suppressUndoneAssistance(before, after) {
  for (const old of before.drafts || []) {
    const d = after.drafts?.find((d) => d.id === old.id),
      last = old.assistant?.last;
    if (d && last && d.assistant?.last?.receiptId !== last.receiptId) {
      d.assistant ??= {};
      d.assistant.suppressed = [
        ...new Set([...(d.assistant.suppressed || []), last.fingerprint]),
      ].slice(-8);
    }
  }
}
// Predictable local simulation; deliberately narrow. It never contacts a provider.
export function simulateAssistant(context) {
  const camera = [];
  const phrases = [
    ["framing", "Close-up", /close[- ]up/i],
    ["framing", "Wide shot", /wide shot/i],
    ["framing", "Medium shot", /medium shot/i],
    ["elevation", "Low angle", /low angle/i],
    ["elevation", "High angle", /high angle/i],
    [
      "movement",
      "No movement",
      /(?:camera stays still|no camera movement|locked camera)/i,
    ],
    ["movement", "Slow push in", /slow push in/i],
  ];
  for (const [field, value, pattern] of phrases) {
    const match = context.text.match(pattern);
    if (
      match &&
      !camera.some((c) => c.field === field) &&
      !/(?:no |not |avoid )$/i.test(
        context.text.slice(Math.max(0, match.index - 10), match.index),
      )
    )
      camera.push({ field, value, evidence: match[0] });
  }
  if (
    !camera.some((c) => c.field === "framing") &&
    context.policy?.creativeDecisions !== false
  ) {
    const detail = context.text.match(
      /(?:examines?|holds?|picks up) [^.!?]{3,60}/i,
    );
    if (detail)
      camera.push({ field: "framing", value: "Close-up", evidence: detail[0] });
  }
  return {
    camera,
    appearances: [],
    issues: [],
    completion:
      context.policy?.writingSuggestions === false
        ? null
        : {
            text: "A brief pause holds the moment before the next action.",
            reason: "Offline sample suggestion; Online uses the surrounding story.",
          },
  };
}

// Suggestions remain outside authored prose until the user explicitly accepts one.
export function acceptAssistantCompletion(
  project,
  draftId,
  context,
  receiptId,
) {
  const d = project.drafts.find((d) => d.id === draftId),
    last = d?.assistant?.last;
  if (
    !last?.completion ||
    last.receiptId !== receiptId ||
    last.dismissed ||
    last.fingerprint !==
      assistantFingerprint(
        assistantContext(
          project,
          d,
          context.sceneId,
          context.model,
          context.policy,
        ),
      )
  )
    return false;
  const scene = d.scenes.find((s) => s.id === context.sceneId);
  if (!scene) return false;
  scene.text =
    (scene.text || "") +
    (scene.text?.trim() ? "\n" : "") +
    last.completion.text;
  last.dismissed = true;
  last.acceptedAt = Date.now();
  return true;
}
