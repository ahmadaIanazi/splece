import { resizeSlot } from "./generation-slots.mjs";
import { takeSourceIn } from "./repair.mjs";
import {
  insertPlannedNode,
  editPlannedSlot,
  syncPlannedTimings,
} from "./planned-timeline.mjs";

// Local effect assets: the curve drives the preview and its text drives the prompt.
// These are creative instructions, not extra image references or model controls.
export const morphPresets = Object.freeze([
  {
    id: "smooth",
    name: "Smooth morph",
    description: "Shapes flow into the next scene.",
    path: "M8 44 C30 44 30 12 56 12 S82 44 104 16",
    prompt:
      "Use a single coherent material transformation between matching background shapes. Keep people, faces, hands, clothing and important objects anatomically stable. When subjects differ, reveal the next subject behind a flowing foreground occlusion instead of melting one face into another.",
  },
  {
    id: "push",
    name: "Push through",
    description: "Travel forward into a new world.",
    path: "M8 44 Q72 44 104 8",
    prompt:
      "Move the camera steadily forward through the dominant opening or visual feature of the first scene, revealing the last scene through that motion. Build depth and parallax. Avoid melting faces or objects.",
  },
  {
    id: "whip",
    name: "Whip pan",
    description: "A fast sweep, then a clean landing.",
    path: "M8 44 L34 44 C50 44 54 8 74 8 L104 8",
    prompt:
      "Whip the camera horizontally to the right. Use directional motion blur through the middle to bridge the two environments, then decelerate into the exact composition of the last frame. Preserve object shapes outside the blurred passage.",
  },
  {
    id: "orbit",
    name: "Orbit reveal",
    description: "Circle the subject to reveal the scene.",
    path: "M24 40 C-4 0 110 0 88 40 C70 60 42 44 56 24",
    prompt:
      "Make one smooth clockwise camera arc around the main foreground subject. Let foreground occlusion reveal the last scene. Keep spatial depth and coherent parallax rather than deforming the subject.",
  },
  {
    id: "light",
    name: "Light sweep",
    description: "Light carries one scene into another.",
    path: "M8 44 L40 44 L56 6 L72 44 L104 44",
    prompt:
      "Carry a soft luminous sweep across the scene. Transition the environment behind the moving light and let it recede to reveal the last frame. Preserve recognizable subjects and avoid an abrupt hard cut.",
  },
]);
export const morphVibes = Object.freeze([
  {
    id: "natural",
    name: "Match frames",
    prompt:
      "Interpolate the source lighting and color naturally; add no new color treatment.",
  },
  {
    id: "warm",
    name: "Warm cinematic",
    color: "#dba675",
    prompt:
      "Use restrained warm amber light through the middle, returning to the final frame’s original colors.",
  },
  {
    id: "cool",
    name: "Cool dream",
    color: "#829bd9",
    prompt:
      "Use soft cool blue atmosphere through the middle, returning to the final frame’s original colors.",
  },
  {
    id: "bold",
    name: "Electric",
    color: "#c189e2",
    prompt:
      "Use energetic violet and cyan light accents through the middle without obscuring the subjects; restore the final frame’s original colors.",
  },
]);
export const morphDefinition = Object.freeze({
  id: "ai-morph",
  version: 1,
  name: "AI morph / transition",
  category: "Transition",
  description: "Connect two frames with a transformation or camera movement.",
  inputs: ["image", "video"],
  output: "video",
  referenceRoles: ["start", "end"],
  limits: {
    maxDuration: 30,
    maxInputEdge: 16384,
    maxOutputEdge: 1920,
    maxUploadBytes: 20 * 1024 ** 2,
  },
  settings: {
    duration: {
      type: "number",
      enum: Array.from({ length: 29 }, (_, i) => i + 2),
      default: 2,
    },
    preset: {
      type: "string",
      enum: morphPresets.map((p) => p.id),
      default: "smooth",
    },
    vibe: {
      type: "string",
      enum: morphVibes.map((p) => p.id),
      default: "natural",
    },
    resolution: {
      type: "string",
      enum: ["480p", "720p", "1080p"],
      default: "480p",
    },
    aspect: {
      type: "string",
      enum: ["16:9", "9:16", "1:1", "4:3", "3:4"],
      default: "16:9",
    },
  },
  models: {
    image: "alibaba/wan-3.0/image-to-video",
    video: "alibaba/wan-3.0/image-to-video",
  },
  stages: [
    {
      id: "prepare",
      dependsOn: [],
      output: "frame-snapshots",
      billable: false,
    },
    {
      id: "transform",
      dependsOn: ["prepare"],
      output: "transition-video",
      billable: true,
    },
    {
      id: "save",
      dependsOn: ["transform"],
      output: "derived-media",
      billable: false,
    },
  ],
});
function resolveSource(project, target) {
  const clip =
    target?.kind === "clip" && project.clips.find((c) => c.id === target.id);
  const media = clip
    ? clip.takes.find((t) => t.id === clip.activeTake)
    : target?.kind === "asset" &&
      project.assets.find((a) => a.id === target.id)?.media;
  if (
    !media?.id ||
    !media.url ||
    !["image", "video"].includes(media.kind || "video")
  )
    throw Error("Choose an available image or completed clip for each frame.");
  if (clip && ((clip.speed ?? 1) !== 1 || clip.reverse || clip.repair))
    throw Error(
      "Use regular-speed clips without a repair range for frame inputs.",
    );
  const kind = media.kind || "video",
    duration = clip?.duration ?? media.duration ?? 5;
  if (!Number.isFinite(duration) || duration <= 0)
    throw Error("Frame source has no usable duration.");
  return {
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
  };
}
export function morphPrompt(settings) {
  return [
    `Create one continuous ${settings.duration}-second transition. Begin with the supplied first frame and finish on the supplied last frame, matching their framing, subjects and composition.`,
    morphPresets.find((p) => p.id === settings.preset).prompt,
    "Use the first 15 percent to establish the starting composition, the middle 70 percent for one motivated transition, and the final 15 percent to settle into the exact ending composition. Maintain a consistent camera direction and believable depth. Preserve facial identity, anatomy, silhouettes and subject count within each endpoint scene. No double exposure, ghost faces, rubbery limbs, random zoom, invented text, borders or additional cuts.",
    morphVibes.find((v) => v.id === settings.vibe).prompt,
    settings.guidance
      ? `Additional creative direction: ${settings.guidance}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
export function prepareMorphIntent(project, intent) {
  const supplied = intent.settings || {},
    settings = {};
  if (
    Object.keys(supplied).some(
      (k) => !morphDefinition.settings[k] && k !== "guidance",
    )
  )
    throw Error("Unknown transition setting.");
  for (const [key, spec] of Object.entries(morphDefinition.settings)) {
    settings[key] = supplied[key] ?? spec.default;
    if (!spec.enum.includes(settings[key]))
      throw Error(`Choose a supported transition ${key}.`);
  }
  if (supplied.guidance != null && typeof supplied.guidance !== "string")
    throw Error("Guidance must be text.");
  settings.guidance = (supplied.guidance || "").trim();
  if (settings.guidance.length > 1000)
    throw Error("Keep optional guidance under 1,000 characters.");
  const placement = intent.placement || "insert";
  if (!["insert", "replace", "fill"].includes(placement))
    throw Error("Choose new clip or replace clip.");
  const target = intent.target;
  if (
    !target ||
    !["clip", "asset"].includes(target.kind) ||
    (placement === "replace" && target.kind !== "clip")
  )
    throw Error(
      "Select a timeline clip to replace, or a frame source for a new clip.",
    );
  const targetClip =
    target.kind === "clip" && project.clips.find((c) => c.id === target.id);
  if (
    placement === "fill" &&
    (!targetClip || targetClip.activeTake || targetClip.generationRequested)
  )
    throw Error("Choose an empty clip without an active generation.");
  const source = resolveSource(
    project,
    placement === "fill"
      ? intent.references?.find((r) => r.role === "start")?.target
      : target,
  );
  const insertion = intent.insertion;
  if (insertion) {
    if (!Number.isFinite(insertion.at) || insertion.at < 0)
      throw Error("Choose a valid insertion point.");
    const ordered = [...project.clips].sort((a, b) => a.start - b.start);
    const before = ordered
      .filter((c) => c.start + c.duration <= insertion.at + 1e-5)
      .at(-1);
    const after = ordered.find((c) => c.start >= insertion.at - 1e-5);
    if (
      ordered.some(
        (c) =>
          c.start < insertion.at - 1e-5 &&
          c.start + c.duration > insertion.at + 1e-5,
      ) ||
      (before?.id || null) !== (insertion.previousClipId || null) ||
      (after?.id || null) !== (insertion.nextClipId || null)
    )
      throw Error(
        "The insertion point changed. Choose Effect at the cut again.",
      );
  }
  let range;
  if (intent.range) {
    const { from, to } = intent.range;
    if (
      placement !== "replace" ||
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from < source.start - 1e-5 ||
      to > source.start + source.duration + 1e-5 ||
      to - from < 1 / 24 ||
      to - from > 30
    )
      throw Error(
        "Choose an effect range inside the selected clip, up to 30 seconds.",
      );
    range = { from, to };
  }
  if (placement === "replace" && !range && source.duration > 30)
    throw Error("Replace a clip up to 30 seconds, or insert a new transition.");
  const refs = intent.references;
  if (
    !Array.isArray(refs) ||
    refs.length !== 2 ||
    refs.filter((r) => r.role === "start").length !== 1 ||
    refs.filter((r) => r.role === "end").length !== 1
  )
    throw Error("Choose a first and last frame.");
  const fps = project.settings?.export?.fps || 24;
  const references = ["start", "end"].map((role) => {
    const r = refs.find((r) => r.role === role),
      s = resolveSource(project, r.target);
    if (!["first", "last", "time"].includes(r.edge))
      throw Error("Choose the first or last visible frame.");
    const frameTime =
      s.kind === "image"
        ? 0
        : r.edge === "time"
          ? r.time
          : s.in + (r.edge === "last" ? Math.max(0, s.duration - 1 / fps) : 0);
    if (
      !Number.isFinite(frameTime) ||
      frameTime < s.in - 1e-5 ||
      frameTime > s.in + Math.max(0, s.duration - 1 / fps) + 1e-5
    )
      throw Error("Choose a frame inside the visible source trim.");
    return {
      role,
      target: { kind: r.target.kind, id: r.target.id },
      edge: r.edge,
      source: s,
      time: frameTime,
    };
  });
  return {
    effectId: "ai-morph",
    version: 1,
    settings,
    placement,
    ...(insertion
      ? {
          insertion: {
            at: insertion.at,
            previousClipId: insertion.previousClipId || null,
            nextClipId: insertion.nextClipId || null,
          },
        }
      : {}),
    ...(range ? { range } : {}),
    ...(placement === "fill"
      ? {
          targetSlot: {
            start: targetClip.start,
            duration: targetClip.duration,
          },
        }
      : {}),
    target: { kind: target.kind, id: target.id },
    episodeId: project.episodeId,
    source,
    references,
    prompt: morphPrompt(settings),
  };
}
export function insertMorphClip(project, job) {
  if (project.clips.some((c) => c.effectJobId === job.id)) return;
  const target = project.clips.find((c) => c.id === job.input.target.id);
  const at =
    job.input.insertion?.at ??
    (target
      ? target.start + target.duration
      : Math.max(0, ...project.clips.map((c) => c.start + c.duration)));
  const node = insertPlannedNode(project, "clip", at);
  const slot = project.clips.find((c) => c.structureNodeId === node.id);
  editPlannedSlot(project, slot.id, { duration: job.media.duration });
  Object.assign(slot, {
    takes: [{ ...job.media, sourceIn: 0 }],
    activeTake: job.media.id,
    in: 0,
    effectJobId: job.id,
    intent: job.input.prompt,
    volume: 1,
    mute: false,
  });
  node.title = job.media.name;
  syncPlannedTimings(project);
}
export function morphDimensions(settings) {
  const short = parseInt(settings.resolution),
    [w, h] = settings.aspect.split(":").map(Number);
  return w >= h
    ? { width: Math.round((short * w) / h / 2) * 2, height: short }
    : { width: short, height: Math.round((short * h) / w / 2) * 2 };
}

export function fillMorphClip(project, job) {
  const clip = project.clips.find((c) => c.id === job.input.target.id);
  resizeSlot(project, clip, job.media.duration);
  clip.takes.push({ ...job.media, sourceIn: 0 });
  clip.activeTake = job.media.id;
  clip.in = 0;
  clip.effectJobId = job.id;
  syncPlannedTimings(project);
}
