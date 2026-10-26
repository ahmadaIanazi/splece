import { dialogueScript } from "./soundtrack-dialogue.mjs";
import { soundSource } from "./soundtrack.mjs";

export const TARGETED_LIP_MODEL = "fal-ai/sync-lipsync/v3";
export const SPEAKER_FPS = 25;
// Timeline moves keep assignments; source trims, alternate takes and retiming invalidate them.
export function faceSource(clip) {
  const s = soundSource(clip);
  return (
    s && {
      mediaId: s.mediaId,
      in: s.in,
      duration: s.duration,
      speed: clip.speed ?? 1,
      reverse: !!clip.reverse,
    }
  );
}
export const lineIdentity = (l) =>
  JSON.stringify([l.speaker, l.text, l.start, l.duration]);
export function faceChoice(project, clip, index, scope = "line") {
  const map = project.production?.faceAssignments?.[clip.id];
  const line = dialogueScript(project, clip)[index];
  if (
    !map ||
    !line ||
    JSON.stringify(map.source) !== JSON.stringify(faceSource(clip))
  )
    return null;
  const choice = map.lines?.[index];
  if (scope !== "character" && choice?.lineIdentity === lineIdentity(line))
    return { ...choice, scope: "line" };
  const fallback = map.characters?.[line.speaker];
  return fallback
    ? { ...fallback, scope: "character", speaker: line.speaker }
    : null;
}
export function assignFace(project, clip, index, choice, scope = "line") {
  const line = dialogueScript(project, clip)[index];
  if (!line || line.missing)
    throw Error("Choose the character speaking this line first.");
  validateFace(choice, clip.duration);
  project.production ??= { schemaVersion: 1 };
  project.production.faceAssignments ??= {};
  let map = project.production.faceAssignments[clip.id];
  if (!map || JSON.stringify(map.source) !== JSON.stringify(faceSource(clip)))
    map = { source: faceSource(clip), lines: {} };
  if (scope === "character") {
    if (!choice.box)
      throw Error(
        "Choose a detected face for automatic reuse, or use a line override.",
      );
    map.characters ??= {};
    map.characters[line.speaker] = { ...choice };
  } else
    map.lines[index] = {
      ...choice,
      lineIdentity: lineIdentity(line),
      speaker: line.speaker,
    };
  project.production.faceAssignments[clip.id] = map;
}
function validateFace(c, duration) {
  if (
    c?.box &&
    (!["x", "y", "w", "h"].every((k) => Number.isFinite(c.box[k])) ||
      c.box.w <= 0 ||
      c.box.h <= 0 ||
      c.box.x >= 1 ||
      c.box.y >= 1 ||
      c.box.x + c.box.w <= 0 ||
      c.box.y + c.box.h <= 0)
  )
    throw Error("Choose a valid detected face.");
  if (
    !c ||
    !Array.isArray(c.point) ||
    c.point.length !== 2 ||
    c.point.some((x) => !Number.isFinite(x) || x < 0 || x > 1) ||
    !Number.isFinite(c.time) ||
    c.time < 0 ||
    c.time >= duration
  )
    throw Error("Choose a visible face on a frame within this clip.");
}
export function targetedSegments(project, clip, audio) {
  const lines = dialogueScript(project, clip);
  const timings = audio?.soundtrack?.lineTimings;
  if (lines.length > 24)
    throw Error(
      "Use up to 24 spoken lines per clip; split a longer conversation into another clip.",
    );
  if (!lines.length || lines.some((l) => l.missing))
    throw Error("Assign a character to every spoken line.");
  if (!timings || timings.length !== lines.length)
    throw Error(
      "Create a new voice performance to save precise line timings for face matching.",
    );
  let end = 0;
  return lines.map((line, i) => {
    const t = timings[i],
      face = faceChoice(project, clip, i);
    if (!face) throw Error(`Choose a face for line ${i + 1}.`);
    validateFace(face, clip.duration);
    if (
      !Number.isFinite(t.start) ||
      !Number.isFinite(t.duration) ||
      t.duration < 0.2 ||
      t.start < end - 0.001 ||
      t.start + t.duration > clip.duration + 0.001
    )
      throw Error(
        "Dialogue timing does not fit this clip. Adjust the script and create a new voice.",
      );
    if (
      face.scope !== "character" &&
      (face.time < t.start || face.time >= t.start + t.duration)
    )
      throw Error(`Choose a frame inside line ${i + 1}’s recorded time range.`);
    end = t.start + t.duration;
    return {
      index: i,
      speaker: line.speaker,
      name: line.name,
      start: t.start,
      duration: t.duration,
      face: {
        point: face.point,
        time: face.time,
        ...(face.scope === "character"
          ? { box: face.box, reusable: true }
          : {}),
      },
    };
  });
}
export function speakerOptions(segment, width, height) {
  return {
    active_speaker_detection: {
      auto_detect: false,
      frame_number: Math.min(
        Math.ceil(segment.duration * SPEAKER_FPS) - 1,
        Math.max(
          0,
          Math.round((segment.face.time - segment.start) * SPEAKER_FPS),
        ),
      ),
      coordinates: [
        Math.min(width - 1, Math.round(segment.face.point[0] * width)),
        Math.min(height - 1, Math.round(segment.face.point[1] * height)),
      ],
    },
  };
}

export function clearLineFace(project, clip, index) {
  const map = project.production?.faceAssignments?.[clip.id];
  if (map?.lines) delete map.lines[index];
}
