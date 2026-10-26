import {
  normalizeMediaTransform,
  normalizePose,
  elementPose,
} from "./elements.mjs";
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function validateMediaVisual(visual = {}) {
  normalizeMediaTransform(visual);
  if (
    visual.easing !== undefined &&
    !["smooth", "linear", "hold"].includes(visual.easing)
  )
    throw Error("Invalid footage animation easing.");
  if (visual.keyframes !== undefined) {
    if (!Array.isArray(visual.keyframes) || visual.keyframes.length > 200)
      throw Error("Use up to 200 keyframes per clip.");
    let previous = -1;
    for (const frame of visual.keyframes) {
      if (
        !Number.isFinite(frame.at) ||
        frame.at < 0 ||
        frame.at > 1 ||
        frame.at <= previous
      )
        throw Error("Invalid footage keyframe timing.");
      normalizePose(frame);
      previous = frame.at;
    }
  }
  return visual;
}
// Keyframes use clip-relative fractions, so moves and duration changes retain the motion.
export function mediaAnimation(clip) {
  return {
    ...normalizeMediaTransform(clip?.visual),
    start: clip?.start || 0,
    duration: clip?.duration || 1,
    easing: clip?.visual?.easing || "smooth",
    keyframes: (clip?.visual?.keyframes || []).map((k) => ({
      ...normalizePose(k),
      t: k.at * (clip.duration || 1),
    })),
  };
}
export function mediaPose(clip, time) {
  const animation = mediaAnimation(clip);
  return { ...elementPose(animation, time), fit: animation.fit };
}
export function setMediaPose(clip, patch, time, { keyframe = false } = {}) {
  const visual = clip.visual || {};
  const nearbyPose = visual.keyframes?.find(
    (k) => Math.abs(k.at * clip.duration - (time - clip.start)) < 0.025,
  );
  const pose = normalizePose({
    ...mediaPose(
      clip,
      nearbyPose ? clip.start + nearbyPose.at * clip.duration : time,
    ),
    ...patch,
  });
  if (!visual.keyframes?.length && !keyframe)
    return { ...visual, ...pose, fit: normalizeMediaTransform(visual).fit };
  let at =
    Math.round(clamp((time - clip.start) / clip.duration, 0, 1) * 1e6) / 1e6;
  const nearby = visual.keyframes?.find(
    (k) => Math.abs(k.at - at) * clip.duration < 0.025,
  );
  if (nearby) at = nearby.at;
  const frames = (visual.keyframes || []).filter(
    (k) => Math.abs(k.at - at) > 1e-6,
  );
  if (frames.length >= 200)
    throw Error(
      "This clip has 200 keyframes. Remove one before adding another.",
    );
  return {
    ...visual,
    ...normalizeMediaTransform(visual),
    easing: visual.easing || "smooth",
    keyframes: [...frames, { at, ...pose }].sort((a, b) => a.at - b.at),
  };
}
export function toggleMediaKeyframe(clip, time) {
  const animation = mediaAnimation(clip),
    key = animation.keyframes.findIndex(
      (k) => Math.abs(k.t - (time - clip.start)) < 0.025,
    );
  if (key < 0) return setMediaPose(clip, {}, time, { keyframe: true });
  const visual = {
    ...clip.visual,
    keyframes: clip.visual.keyframes.filter((_, i) => i !== key),
  };
  return visual.keyframes.length
    ? visual
    : { ...visual, ...mediaPose(clip, time) };
}
export const mediaMotionPresets = [
  { id: "zoom-in", label: "Zoom in" },
  { id: "zoom-out", label: "Zoom out" },
  { id: "pan-left", label: "Pan left" },
  { id: "pan-right", label: "Pan right" },
];
export function mediaMotionPreset(clip, id) {
  if (!mediaMotionPresets.some((p) => p.id === id))
    throw Error("Unknown motion preset.");
  const base = normalizePose(mediaPose(clip, clip.start)),
    zoom = {
      ...base,
      w: Math.min(2, base.w * 1.15),
      h: Math.min(2, base.h * 1.15),
    };
  let start = base,
    end = zoom;
  if (id === "zoom-out") {
    start = zoom;
    end = base;
  }
  if (id.startsWith("pan-")) {
    const direction = id === "pan-left" ? -1 : 1,
      travel = base.w * 0.055;
    start = { ...zoom, x: clamp(base.x - direction * travel, -1, 2) };
    end = { ...zoom, x: clamp(base.x + direction * travel, -1, 2) };
  }
  return {
    ...clip.visual,
    ...normalizeMediaTransform(clip.visual),
    easing: "smooth",
    keyframes: [
      { at: 0, ...start },
      { at: 1, ...end },
    ],
  };
}
export function mediaFrameSVG(clip, time, width, height, image) {
  const p = mediaPose(clip, time),
    w = p.w * width,
    h = p.h * height;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/><defs><clipPath id="frame"><rect width="${w}" height="${h}"/></clipPath></defs><g opacity="${p.opacity}" transform="translate(${p.x * width} ${p.y * height}) rotate(${p.rotation}) translate(${-w / 2} ${-h / 2})"><image width="${w}" height="${h}" clip-path="url(#frame)" preserveAspectRatio="xMidYMid ${p.fit === "cover" ? "slice" : "meet"}" xlink:href="data:image/png;base64,${image.toString("base64")}"/></g></svg>`;
}

export function mediaVisualKind(clip, project = {}) {
  const take = clip?.takes?.find((take) => take.id === clip.activeTake);
  const stored = Array.isArray(project.media)
    ? project.media.find((media) => media.id === clip?.activeTake)
    : project.media?.[clip?.activeTake];
  return (take?.kind || stored?.kind) === "image" ? "image" : "video";
}
