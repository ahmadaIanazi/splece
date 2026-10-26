import { takeSourceIn } from "./repair.mjs";
import { resizeSlot } from "./generation-slots.mjs";
import { syncPlannedTimings } from "./planned-timeline.mjs";
export function treatmentSource(clip) {
  const media = clip.takes.find((t) => t.id === clip.activeTake);
  if (!media) throw Error("Choose a completed video clip.");
  const offset = takeSourceIn(clip, media) || 0;
  const old = media.treatment;
  if (!old) return { mediaId: media.id, in: offset, duration: clip.duration };
  // Encoded containers can report a few milliseconds of padding. Keep subsequent
  // adjustments bounded to the original trim rather than accumulating it.
  const duration = Math.min(old.source.duration, clip.duration * old.speed);
  const relativeIn = old.reverse
    ? old.source.duration - (offset * old.speed + duration)
    : offset * old.speed;
  const start = Math.max(0, Math.min(old.source.duration, relativeIn));
  return {
    mediaId: old.source.mediaId,
    in: old.source.in + start,
    duration: Math.min(duration, old.source.duration - start),
  };
}
export function treatmentSignature(c) {
  return JSON.stringify([
    c.id,
    c.activeTake,
    c.in,
    c.duration,
    c.repair,
    c.takes.find((t) => t.id === c.activeTake)?.sourceIn,
  ]);
}
export function applyClipTreatment(project, clipId, media, signature) {
  const c = project.clips.find((c) => c.id === clipId);
  if (!c || treatmentSignature(c) !== signature)
    throw Error(
      "This clip changed while processing. The processed take is saved; review the current clip before applying.",
    );
  c.takeEdits ??= {};
  c.takeEdits[c.activeTake] = { in: c.in, duration: c.duration };
  if (!c.takes.some((t) => t.id === media.id)) c.takes.push(media);
  c.activeTake = media.id;
  c.in = 0;
  if (c.repair)
    c.takes = c.takes.map((t) =>
      t.id === media.id ? { ...t, sourceIn: 0 } : t,
    );
  resizeSlot(project, c, media.duration);
  syncPlannedTimings(project);
}
