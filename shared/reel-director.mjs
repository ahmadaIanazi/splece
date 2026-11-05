import { dialogueScript, dialogueSignature } from "./soundtrack-dialogue.mjs";
import { faceChoice } from "./face-assignment.mjs";
import { soundSource, soundSourceKey } from "./soundtrack.mjs";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const directorStyles = ["natural", "cinematic", "playful"];
export function portraitGeometry(source) {
  const ratio = source.width / source.height,
    portrait = 9 / 16;
  return {
    cw: Math.min(1, portrait / ratio),
    ch: Math.min(1, ratio / portrait),
    fit: Math.min(portrait / ratio, ratio / portrait),
  };
}
export function subjectAt(subject, time) {
  const points = (subject.points || []).filter((p) => p.confidence >= 0.55);
  const before = points.filter((p) => p.t <= time).at(-1),
    after = points.find((p) => p.t > time);
  const nearest = !before
    ? after
    : !after
      ? before
      : time - before.t < after.t - time
        ? before
        : after;
  if (!nearest || Math.abs(nearest.t - time) > 0.8) return null;
  if (!before || !after || after.t - before.t > 1.2) return nearest.box;
  const mix = (time - before.t) / (after.t - before.t);
  return Object.fromEntries(
    ["x", "y", "w", "h"].map((k) => [
      k,
      before.box[k] + (after.box[k] - before.box[k]) * mix,
    ]),
  );
}
// The source-matched, audible performance supplies measured timing. A script
// alone never claims to identify the active speaker in generated footage.
export function recordedDialogue(project, source, shot) {
  const clip = project?.clips?.find((c) => c.id === source.clipId);
  if (!clip) return [];
  const lines = dialogueScript(project, clip);
  const candidates = (project.audioClips || []).filter(
    (a) =>
      !a.mute &&
      (a.volume ?? 1) > 0 &&
      a.soundtrack?.scriptSignature === dialogueSignature(project, clip) &&
      a.soundtrack?.lineTimings?.length === lines.length &&
      a.soundtrack.sources?.some(
        (s) =>
          s.clipId === clip.id &&
          soundSourceKey(s) === soundSourceKey(soundSource(clip)),
      ),
  );
  if (candidates.length !== 1) return [];
  const audio = candidates[0],
    offset = audio.start - clip.start - (audio.in || 0) - shot.from;
  return lines.flatMap((line, i) => {
    const timing = audio.soundtrack.lineTimings[i];
    const start = Math.max(0, timing.start + offset),
      end = Math.min(
        shot.to - shot.from,
        timing.start + timing.duration + offset,
        audio.start - clip.start + audio.duration - shot.from,
      );
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return [];
    const subject = shot.subjects?.find((s) => s.characterId === line.speaker);
    return [
      {
        start,
        end,
        subjectId: subject?.id || "",
        characterId: line.speaker,
        name: line.name,
        text: line.text,
        timing: "recorded",
      },
    ];
  });
}
export function existingSubjectChoices(project, source, shot) {
  const clip = project?.clips?.find((c) => c.id === source.clipId);
  if (!clip) return [];
  return dialogueScript(project, clip).flatMap((line, i) => {
    const choice = faceChoice(project, clip, i);
    if (!choice || choice.time < shot.from || choice.time > shot.to) return [];
    const box = choice.box || {
      x: choice.point[0] - 0.08,
      y: choice.point[1] - 0.1,
      w: 0.16,
      h: 0.2,
    };
    return [
      {
        characterId: line.speaker,
        name: line.name,
        t: choice.time - shot.from,
        box,
      },
    ];
  });
}
export function directorLines(project, source, shot) {
  if (shot.director?.lines?.length) return shot.director.lines;
  const measured = recordedDialogue(project, source, shot);
  return measured.length
    ? measured
    : shot.captions.map((c) => ({ ...c, subjectId: "", timing: "caption" }));
}
export function directShot(shot, source) {
  if (shot.director?.locked) return shot;
  const duration = shot.to - shot.from,
    geometry = portraitGeometry(source),
    subjects = shot.subjects || [];
  const settings = { mode: "dialogue", style: "natural", ...shot.director };
  const count = Math.min(31, Math.max(1, Math.ceil(duration * 4)));
  let lastId = "",
    lastSwitch = -Infinity;
  const crop = Array.from({ length: count + 1 }, (_, i) => {
    const t = (duration * i) / count;
    const visible = subjects
      .map((s) => ({ subject: s, box: subjectAt(s, t) }))
      .filter((s) => s.box);
    const active = (settings.lines || []).filter(
      (l) => l.start <= t && l.end > t,
    );
    const ids = [...new Set(active.map((l) => l.subjectId).filter(Boolean))];
    let id =
      settings.mode === "subject"
        ? settings.subjectId
        : ids.length === 1
          ? ids[0]
          : "";
    const keepContext = active.some((l) => l.manual && !l.subjectId);
    if (!id && visible.length === 1 && settings.mode === "dialogue" && !keepContext)
      id = visible[0].subject.id;
    if (
      id &&
      id !== lastId &&
      t - lastSwitch < 1.2 &&
      visible.some((s) => s.subject.id === lastId)
    )
      id = lastId;
    if (id !== lastId) {
      lastId = id;
      lastSwitch = t;
    }
    const target = visible.find((s) => s.subject.id === id);
    // Unknown/overlapping speakers stay wide, including subjects outside the
    // portrait crop. A fitted frame is preferable to cutting someone out.
    if (settings.mode === "wide" || !target ||
      (settings.mode === "dialogue" && (ids.length > 1 || keepContext)))
      return { t, x: 0.5, y: 0.5, zoom: geometry.fit };
    const line = active.find((l) => l.subjectId === id);
    const phase = line
      ? clamp((t - line.start) / Math.max(1, line.end - line.start), 0, 1)
      : clamp(t / duration, 0, 1);
    const strength =
      settings.style === "playful"
        ? 0.2
        : settings.style === "cinematic"
          ? 0.13
          : 0.07;
    // Preserve headroom and cap enlargement; large subjects need more context.
    const room = Math.min(
      geometry.cw / (target.box.w * 1.7),
      geometry.ch / (target.box.h * 2.2),
    );
    const zoom = clamp(
      Math.min(1 + strength * Math.sin(Math.PI * phase), room),
      geometry.fit,
      1.3,
    );
    return {
      t,
      x: clamp(target.box.x + target.box.w / 2, 0, 1),
      y: clamp(target.box.y + target.box.h * 0.85, 0, 1),
      zoom,
    };
  });
  // Bound the camera's travel between targets. Smooth interpolation alone can
  // still produce a very fast pan when two adjacent samples switch speakers.
  for (let i = 1; i < crop.length; i++) {
    const previous = crop[i - 1], point = crop[i], dt = point.t - previous.t;
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const fraction = distance ? Math.min(1, dt * 0.6 / distance) : 1;
    point.x = previous.x + (point.x - previous.x) * fraction;
    point.y = previous.y + (point.y - previous.y) * fraction;
    point.zoom = clamp(point.zoom, previous.zoom - dt * 0.65, previous.zoom + dt * 0.65);
  }
  return { ...shot, crop, director: settings };
}
function cleanBox(box) {
  if (
    !box ||
    ![box.x, box.y, box.w, box.h].every(Number.isFinite) ||
    box.w <= 0 ||
    box.h <= 0 ||
    box.w > 1 ||
    box.h > 1 ||
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.w > 1.001 ||
    box.y + box.h > 1.001
  )
    throw Error("Check the selected subject area.");
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}
export function validateDirection(shot, duration) {
  if (!shot.subjects && !shot.director) return {};
  if (!Array.isArray(shot.subjects) || shot.subjects.length > 6)
    throw Error("Use up to six subjects per shot.");
  const ids = new Set();
  const subjects = shot.subjects.map((s) => {
    if (
      typeof s.id !== "string" ||
      s.id.length > 100 ||
      ids.has(s.id) ||
      !["face", "selected"].includes(s.kind) ||
      !Array.isArray(s.points) ||
      s.points.length > 32
    )
      throw Error("Check tracked subjects.");
    ids.add(s.id);
    let last = -1;
    const points = s.points.map((p) => {
      if (
        !Number.isFinite(p.t) ||
        p.t < 0 ||
        p.t > duration ||
        p.t <= last ||
        !Number.isFinite(p.confidence) ||
        p.confidence < 0 ||
        p.confidence > 1
      )
        throw Error("Check subject timing.");
      last = p.t;
      return { t: p.t, box: cleanBox(p.box), confidence: p.confidence };
    });
    const seed = s.seed && { t: s.seed.t, box: cleanBox(s.seed.box) };
    if (seed && (!Number.isFinite(seed.t) || seed.t < 0 || seed.t > duration))
      throw Error("Check subject selection time.");
    return {
      id: s.id,
      name: String(s.name || "Subject").slice(0, 80),
      characterId: String(s.characterId || "").slice(0, 100),
      kind: s.kind,
      points,
      ...(seed ? { seed } : {}),
      ...(typeof s.thumbnail === "string" &&
      /^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/.test(s.thumbnail) &&
      s.thumbnail.length < 30000
        ? { thumbnail: s.thumbnail }
        : {}),
    };
  });
  const d = shot.director || {};
  if (
    (d.mode && !["dialogue", "subject", "wide"].includes(d.mode)) ||
    (d.style && !directorStyles.includes(d.style)) ||
    (d.subjectId && !ids.has(d.subjectId)) ||
    !Array.isArray(d.lines || []) ||
    (d.lines || []).length > 100
  )
    throw Error("Check camera direction.");
  const lines = (d.lines || []).map((l) => {
    if (
      ![l.start, l.end].every(Number.isFinite) ||
      l.start < 0 ||
      l.end > duration + 0.001 ||
      l.end <= l.start ||
      (l.subjectId && !ids.has(l.subjectId))
    )
      throw Error("Check dialogue assignments.");
    return {
      start: l.start,
      end: l.end,
      subjectId: l.subjectId || "",
      characterId: String(l.characterId || "").slice(0, 100),
      name: String(l.name || "").slice(0, 80),
      text: String(l.text || "").slice(0, 500),
      timing: l.timing === "recorded" ? "recorded" : "caption",
      ...(l.manual ? { manual: true } : {}),
    };
  });
  return {
    subjects,
    director: {
      mode: d.mode || "dialogue",
      style: d.style || "natural",
      subjectId: d.subjectId || "",
      locked: !!d.locked,
      lines,
    },
  };
}
