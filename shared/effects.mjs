import { takeSourceIn } from "./repair.mjs";
import {
  morphDefinition,
  prepareMorphIntent,
  insertMorphClip,
  fillMorphClip,
} from "./morph-effects.mjs";

// Public intent contract: UI and assistants prepare the same validated request.
// No executor, credentials, or pipeline implementation is imported here.
export const effectDefinitions = Object.freeze([
  Object.freeze({
    id: "ai-upscale",
    version: 1,
    name: "AI upscale",
    category: "Enhance",
    description:
      "Recover detail and enlarge images or selected footage with RealESRGAN.",
    inputs: ["image", "video"],
    output: "same-kind",
    referenceRoles: [],
    limits: {
      maxDuration: 30,
      maxInputEdge: 2048,
      maxOutputEdge: 4096,
      maxUploadBytes: 24 * 1024 ** 2,
    },
    settings: { scale: { type: "number", enum: [2, 4], default: 2 } },
    models: { image: "fal-ai/esrgan", video: "fal-ai/video-upscaler" },
    stages: [
      {
        id: "prepare",
        dependsOn: [],
        output: "source-snapshot",
        billable: false,
      },
      {
        id: "transform",
        dependsOn: ["prepare"],
        output: "transformed-media",
        billable: true,
      },
      {
        id: "save",
        dependsOn: ["transform"],
        output: "derived-media",
        billable: false,
      },
    ],
  }),
  morphDefinition,
]);
export const effectActive = (j) => ["queued", "processing"].includes(j.state);
export const effectSignature = (input) => JSON.stringify(input);
export function prepareEffectIntent(project, intent) {
  const definition = effectDefinitions.find((d) => d.id === intent?.effectId);
  if (!definition) throw Error("Choose an implemented effect.");
  if (intent.version != null && intent.version !== definition.version)
    throw Error("This effect definition changed. Prepare it again.");
  if (definition.id === "ai-morph") return prepareMorphIntent(project, intent);
  const scale = intent.settings?.scale ?? 2;
  if (
    !definition.settings.scale.enum.includes(scale) ||
    Object.keys(intent.settings || {}).some((k) => k !== "scale")
  )
    throw Error("Choose 2× or 4× enlargement.");
  if (intent.references?.length)
    throw Error("This effect does not accept references.");
  const target = intent.target;
  let media, clip, asset;
  if (target?.kind === "clip") {
    clip = project.clips.find((c) => c.id === target.id);
    media = clip?.takes?.find((t) => t.id === clip.activeTake);
    if (clip && ((clip.speed ?? 1) !== 1 || clip.reverse || clip.repair))
      throw Error(
        "Use a regular-speed clip without a repair range for this effect.",
      );
  } else if (target?.kind === "asset") {
    asset = project.assets.find((a) => a.id === target.id);
    media = asset?.media;
  }
  if (!media?.id || !media.url)
    throw Error("Select one completed clip or an image / footage asset.");
  const kind = media.kind || "video";
  if (!definition.inputs.includes(kind))
    throw Error("AI upscale accepts images and video.");
  const duration = clip?.duration ?? media.duration ?? 5;
  if (
    !(duration > 0) ||
    (kind === "video" && duration > definition.limits.maxDuration)
  )
    throw Error("Choose footage up to 30 seconds.");
  return {
    effectId: definition.id,
    version: definition.version,
    settings: { scale },
    references: [],
    target: { kind: target.kind, id: target.id },
    episodeId: project.episodeId,
    source: {
      mediaId: media.id,
      kind,
      in:
        kind === "image"
          ? 0
          : Math.max(0, clip ? takeSourceIn(clip, media) || 0 : 0),
      duration,
      ...(clip
        ? { start: clip.start, clipIn: clip.in, visual: clip.visual || null }
        : {}),
      ...(media.lipSync ? { lipSync: structuredClone(media.lipSync) } : {}),
    },
  };
}
export function saveEffectAsset(project, job) {
  if (
    job.projectId !== project.id ||
    !job.media ||
    project.assets.some((a) => a.id === job.media.id)
  )
    return;
  project.assets.push({
    id: job.media.id,
    kind: "footage",
    name: job.media.name,
    media: job.media,
    description:
      job.executionMode === "test"
        ? "Offline workflow check · no AI generation"
        : `${effectDefinitions.find((d) => d.id === job.input.effectId)?.name || "AI effect"} · original preserved`,
    scope: "project",
    tags: ["effect", job.executionMode === "test" ? "test" : "ai"],
    version: 1,
  });
}
export function applyEffect(project, job) {
  if (
    job.projectId !== project.id ||
    job.input.episodeId !== project.episodeId ||
    job.state !== "ready" ||
    !job.media
  )
    throw Error("This result is unavailable in the active edit.");
  if (
    job.input.effectId === "ai-morph" &&
    job.input.placement === "insert" &&
    project.clips.some((c) => c.effectJobId === job.id)
  )
    return;
  if (
    job.input.target.kind === "clip" &&
    project.clips.find((c) => c.id === job.input.target.id)?.activeTake ===
      job.media.id
  )
    return;
  const current = prepareEffectIntent(project, job.input);
  if (effectSignature(current) !== job.signature)
    throw Error(
      "The source changed. You can still save this result to Assets for review.",
    );
  saveEffectAsset(project, job);
  if (job.input.effectId === "ai-morph" && job.input.placement === "insert") {
    insertMorphClip(project, job);
    return;
  }
  if (job.input.placement === "fill") {
    fillMorphClip(project, job);
    return;
  }
  const media = {
    ...job.media,
    ...(job.input.source.lipSync ? { lipSync: job.input.source.lipSync } : {}),
    effect: {
      jobId: job.id,
      originalId: current.source.mediaId,
      originalIn: current.source.clipIn ?? current.source.in,
      duration: current.source.duration,
    },
    sourceIn: 0,
  };
  if (current.target.kind === "clip") {
    const clip = project.clips.find((c) => c.id === current.target.id);
    clip.takeEdits ??= {};
    clip.takeEdits[clip.activeTake] = { in: clip.in, duration: clip.duration };
    if (!clip.takes.some((t) => t.id === media.id)) clip.takes.push(media);
    clip.activeTake = media.id;
    clip.in = 0;
    // Picture-only replacement: keep linked dialogue, faders, timing and sound tracks untouched.
  } else {
    const asset = project.assets.find((a) => a.id === current.target.id);
    asset.effectHistory ??= [];
    asset.effectHistory.push({
      jobId: job.id,
      media: structuredClone(asset.media),
    });
    asset.media = media;
  }
}
export function revertEffect(project, target) {
  if (target.kind === "clip") {
    const clip = project.clips.find((c) => c.id === target.id),
      take = clip?.takes.find((t) => t.id === clip.activeTake);
    if (!take?.effect) throw Error("No applied effect on this clip.");
    clip.takeEdits ??= {};
    clip.takeEdits[take.id] = { in: clip.in, duration: clip.duration };
    clip.activeTake = take.effect.originalId;
    clip.in = clip.takeEdits[clip.activeTake]?.in ?? take.effect.originalIn;
    clip.duration =
      clip.takeEdits[clip.activeTake]?.duration ?? take.effect.duration;
  } else {
    const asset = project.assets.find((a) => a.id === target.id),
      previous = asset?.effectHistory?.pop();
    if (!previous) throw Error("No applied effect on this asset.");
    asset.media = previous.media;
  }
}
export function effectCostRecord(job) {
  const stage = job.stages.find((s) => s.id === "transform");
  return {
    key: "effect:" + job.id,
    id: job.id,
    kind: "effect",
    provider: job.executionMode === "test" ? "local-test" : "fal",
    model: job.model,
    test: job.executionMode === "test",
    state: job.state,
    title:
      effectDefinitions.find((d) => d.id === job.input.effectId)?.name ||
      "AI effect",
    episodeId: job.input.episodeId,
    targetId: job.input.target.id,
    createdAt: job.createdAt,
    amount:
      job.executionMode === "test"
        ? 0
        : stage.state === "submission_uncertain"
          ? null
          : stage.providerJobId
            ? job.estimate.amount
            : 0,
    status:
      job.executionMode === "test"
        ? "test"
        : stage.state === "submission_uncertain"
          ? "unknown"
          : stage.providerJobId
            ? "estimated"
            : "pending",
    charges: [],
  };
}
