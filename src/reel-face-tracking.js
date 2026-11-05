import { cropSampleTimes } from "../shared/reel-effects.mjs";
import {
  associateFaces,
  boundedBox,
  grayFrame,
  trackSelectedSubject,
} from "../shared/subject-tracking.mjs";
import {
  directShot,
  directorLines,
  existingSubjectChoices,
} from "../shared/reel-director.mjs";
function mediaEvent(video, event, signal, action) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
        clearTimeout(timer);
        video.removeEventListener(event, done);
        video.removeEventListener("error", fail);
        signal.removeEventListener("abort", abort);
        error ? reject(error) : resolve();
      },
      done = () => finish(),
      fail = () => finish(Error("Could not read this footage.")),
      abort = () => finish(Error("Cancelled")),
      timer = setTimeout(
        () => finish(Error("Footage took too long to load.")),
        20000,
      );
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", fail, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else action();
  });
}
// Track local face candidates and selected subjects without guessing identity or speaker.
export async function trackReelFaces(
  plan,
  sources,
  { signal, onProgress, project },
) {
  const worker = new Worker("/vision/face-worker.js"),
    video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  let request = 0,
    found = 0;
  try {
    const next = structuredClone(plan);
    for (const [index, shot] of next.entries()) {
      if (signal.aborted) throw Error("Cancelled");
      if (shot.director?.locked) continue;
      onProgress(`Framing shot ${index + 1} of ${next.length}`);
      const source = sources.find((s) => s.id === shot.sourceId);
      await mediaEvent(video, "loadeddata", signal, () => {
        video.src = source.preview;
        video.load();
      });
      const samples = [],
        frames = [],
        length = shot.to - shot.from;
      const selected = (shot.subjects || []).filter(
        (s) => s.kind === "selected" && s.seed,
      );
      const times = cropSampleTimes(length);
      for (const subject of selected) {
        const closest = times.reduce(
          (best, t, i) =>
            i > 0 &&
            i < times.length - 1 &&
            Math.abs(t - subject.seed.t) <
              Math.abs(times[best] - subject.seed.t)
              ? i
              : best,
          1,
        );
        if (subject.seed.t > 0 && subject.seed.t < length)
          times[closest] = subject.seed.t;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(320, video.videoWidth);
      canvas.height = Math.round(
        (canvas.width * video.videoHeight) / video.videoWidth,
      );
      const context = canvas.getContext("2d", { willReadFrequently: true });
      for (const t of [...new Set(times)].sort((a, b) => a - b)) {
        const seek = Math.min(shot.to - 0.04, shot.from + t);
        if (Math.abs(video.currentTime - seek) > 0.005)
          await mediaEvent(video, "seeked", signal, () => {
            video.currentTime = seek;
          });
        if (signal.aborted) throw Error("Cancelled");
        const bitmap = await createImageBitmap(video),
          id = ++request;
        const faces = await new Promise((resolve, reject) => {
          const done = (err, value) => {
              clearTimeout(timer);
              signal.removeEventListener("abort", abort);
              worker.onmessage = null;
              worker.onerror = null;
              err ? reject(err) : resolve(value);
            },
            abort = () => done(Error("Cancelled")),
            timer = setTimeout(
              () =>
                done(Error("Face detection timed out. Adjust the crop below.")),
              20000,
            );
          signal.addEventListener("abort", abort, { once: true });
          worker.onmessage = ({ data }) => {
            if (data.id === id)
              done(data.error ? Error(data.error) : null, data.faces || []);
          };
          worker.onerror = () =>
            done(
              Error("Face detection is unavailable. Adjust the crop below."),
            );
          if (signal.aborted) {
            bitmap.close();
            abort();
          } else worker.postMessage({ id, bitmap }, [bitmap]);
        });
        found += faces.length;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const color = context.getImageData(0, 0, canvas.width, canvas.height);
        frames.push({
          t,
          ...grayFrame(color.data, canvas.width, canvas.height),
          color,
        });
        samples.push({ t, faces });
      }
      const detected = associateFaces(samples).slice(0, 6 - selected.length);
      const choices = existingSubjectChoices(project, source, shot);
      const distance = (a, b) =>
        Math.hypot(
          a.x + a.w / 2 - b.x - b.w / 2,
          a.y + a.h / 2 - b.y - b.h / 2,
        );
      const claimed = new Set();
      for (const subject of detected) {
        const match = (shot.subjects || [])
          .filter((s) => s.kind === "face" && !claimed.has(s.id))
          .find((s) => {
            const prior = s.points[0];
            if (!prior) return false;
            const now = subject.points.reduce(
              (best, p) =>
                Math.abs(p.t - prior.t) < Math.abs(best.t - prior.t) ? p : best,
              subject.points[0],
            );
            return distance(prior.box, now.box) < 0.12;
          });
        if (match) {
          subject.id = match.id;
          subject.name = match.name;
          subject.characterId = match.characterId;
          claimed.add(match.id);
        } else subject.id = crypto.randomUUID();
        for (const choice of choices) {
          const point = subject.points.reduce(
            (best, p) =>
              Math.abs(p.t - choice.t) < Math.abs(best.t - choice.t) ? p : best,
            subject.points[0],
          );
          if (
            !subject.characterId &&
            Math.abs(point.t - choice.t) < 0.6 &&
            distance(point.box, choice.box) < 0.12
          ) {
            subject.characterId = choice.characterId;
            subject.name = choice.name;
          }
        }
      }
      for (const subject of selected)
        subject.points = trackSelectedSubject(frames, subject.seed);
      // Retain chosen identities when a refresh loses a face. An empty track
      // falls back to context rather than silently following somebody else.
      const chosenIds = new Set([
        shot.director?.subjectId,
        ...(shot.director?.lines || []).map((l) => l.subjectId),
      ].filter(Boolean));
      const missing = (shot.subjects || []).filter(
        (s) => s.kind === "face" && chosenIds.has(s.id) &&
          !detected.some((d) => d.id === s.id),
      ).map((s) => ({ ...s, points: [] }));
      shot.subjects = [...selected, ...missing, ...detected].slice(0, 6);
      for (const subject of shot.subjects) {
        const point = subject.points[0];
        if (!point) continue;
        const frame = frames.reduce(
          (best, f) =>
            Math.abs(f.t - point.t) < Math.abs(best.t - point.t) ? f : best,
          frames[0],
        );
        context.putImageData(frame.color, 0, 0);
        const thumb = document.createElement("canvas");
        thumb.width = 80;
        thumb.height = 80;
        const box = boundedBox(point.box);
        thumb
          .getContext("2d")
          .drawImage(
            canvas,
            box.x * canvas.width,
            box.y * canvas.height,
            box.w * canvas.width,
            box.h * canvas.height,
            0,
            0,
            80,
            80,
          );
        subject.thumbnail = thumb.toDataURL("image/jpeg", 0.7);
      }
      const ids = new Set(shot.subjects.map((s) => s.id));
      const lines = directorLines(project, source, shot).map((l) => ({
        ...l,
        subjectId: ids.has(l.subjectId)
          ? l.subjectId
          : !l.manual && shot.subjects.find(
              (s) => s.characterId && s.characterId === l.characterId,
            )?.id || "",
      }));
      shot.director = {
        mode: "dialogue",
        style: "natural",
        ...shot.director,
        lines,
      };
      if (!ids.has(shot.director.subjectId)) shot.director.subjectId = "";
      Object.assign(shot, directShot(shot, source));
    }
    return { plan: next, found };
  } finally {
    worker.terminate();
    video.removeAttribute("src");
    video.load();
  }
}
