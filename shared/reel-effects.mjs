import { validateDirection } from "./reel-director.mjs";
import { takeSourceIn } from "./repair.mjs";
import { newElement } from "./elements.mjs";
export const localEffectPresets = [
  {
    id: "reel",
    name: "Turn into a Reel",
    description: "Highlights, face-follow framing and captions.",
    className: "reel",
  },
  {
    id: "punch",
    name: "Punch in",
    description: "A subtle moving close-up.",
    className: "punch",
  },
  {
    id: "warm",
    name: "Golden hour",
    description: "Warm highlights and richer contrast.",
    className: "warm",
  },
  {
    id: "dream",
    name: "Dream glow",
    description: "Soft light and a gentle bloom.",
    className: "dream",
  },
  {
    id: "retro",
    name: "Retro film",
    description: "Faded color, grain and a vignette.",
    className: "retro",
  },
  {
    id: "trail",
    name: "Motion echo",
    description: "Leave a soft trail behind movement.",
    className: "trail",
  },
];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function reelSourceKey(clip) {
  return JSON.stringify([
    clip.id,
    clip.activeTake,
    takeSourceIn(
      clip,
      clip.takes?.find((t) => t.id === clip.activeTake),
    ),
    clip.start,
    clip.duration,
    clip.volume,
    clip.mute,
    clip.visual,
  ]);
}
export function reelOptions(input = {}) {
  const recipe = input.recipe || "reel";
  if (!localEffectPresets.some((p) => p.id === recipe))
    throw Error("Choose an available effect.");
  const duration = input.duration ?? 30,
    resolution = input.resolution || "480p",
    language = input.language || "auto";
  if (
    ![15, 30, 60].includes(duration) ||
    !["480p", "1080p"].includes(resolution) ||
    !["auto", "en", "ar"].includes(language)
  )
    throw Error("Check the reel duration, quality and language.");
  if (input.captions != null && typeof input.captions !== "boolean")
    throw Error("Choose whether to include captions.");
  return {
    recipe,
    duration,
    resolution,
    language,
    captions: recipe === "reel" && !!input.captions,
    highlights: recipe === "reel" && input.highlights !== false,
  };
}
// Score observable editing signals, never claim these are semantic or viral predictions.
export function suggestHighlights(sources, options) {
  const candidates = [];
  for (const source of sources) {
    const cuts = [
      0,
      ...(source.cuts || []).filter(
        (t) => t > 0.5 && t < source.duration - 0.5,
      ),
      source.duration,
    ].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const from = cuts[i],
        end = cuts[i + 1];
      for (let start = from; start < end - 0.15;) {
        let to = Math.min(end, start + 8);
        // Keep a transcribed phrase intact when a nearby boundary is available.
        const crossing = (source.captions || []).find(
          (c) => c.start < to && c.end > to,
        );
        if (crossing) {
          if (crossing.end <= Math.min(end, start + 15)) to = crossing.end;
          else if (crossing.start > start + 2) to = crossing.start;
        }
        const speech = (source.captions || []).filter(
          (c) => c.end > start && c.start < to,
        );
        const energy = (source.activity || []).slice(
          Math.floor(start),
          Math.ceil(to),
        );
        const score =
          (speech.reduce(
            (n, c) => n + Math.min(to, c.end) - Math.max(start, c.start),
            0,
          ) /
            (to - start)) *
            3 +
          energy.reduce((a, b) => a + b, 0) / (energy.length || 1) +
          (i > 0 ? 0.15 : 0);
        candidates.push({
          id: `${source.id}:${start.toFixed(3)}`,
          sourceId: source.id,
          from: start,
          to,
          score,
          reason: speech.length
            ? "Speech & shot rhythm"
            : energy.some((v) => v > 0.04)
              ? "Sound & shot rhythm"
              : "Visual passage",
          crop: [{ t: 0, x: 0.5, y: 0.5 }],
          captions: speech.map((c) => ({
            start: Math.max(0, c.start - start),
            end: Math.min(to - start, c.end - start),
            text: c.text,
          })),
          order: source.order * 100000 + start,
        });
        start = to;
      }
    }
  }
  let remaining = Math.min(
    options.duration,
    sources.reduce((n, s) => n + s.duration, 0),
  );
  const hasSpeech = candidates.some((c) => c.captions.length);
  const useful =
    options.highlights && hasSpeech
      ? candidates
          .filter((c) => c.captions.length || c.score > 0.18)
          .map((c) => {
            if (!c.captions.length) return c;
            const lead = Math.max(0, c.captions[0].start - 0.2),
              length = Math.min(c.to - c.from, c.captions.at(-1).end + 0.25);
            return {
              ...c,
              from: c.from + lead,
              to: c.from + length,
              captions: c.captions.map((x) => ({
                ...x,
                start: Math.max(0, x.start - lead),
                end: x.end - lead,
              })),
            };
          })
      : candidates;
  const ranked = options.highlights
    ? [...useful].sort((a, b) => b.score - a.score || a.order - b.order)
    : useful;
  const selected = [];
  for (const c of ranked) {
    if (remaining < 0.15) break;
    const length = Math.min(c.to - c.from, remaining);
    selected.push({
      ...c,
      to: c.from + length,
      captions: c.captions
        .filter((x) => x.start < length)
        .map((x) => ({ ...x, end: Math.min(x.end, length) })),
    });
    remaining -= length;
  }
  return selected.sort((a, b) => a.order - b.order);
}
export function validateReelPlan(plan, sources, limit = 60) {
  if (!Array.isArray(plan) || !plan.length || plan.length > 60)
    throw Error("Choose at least one highlight, up to 60 shots.");
  let total = 0;
  const ids = new Set();
  const clean = plan.map((p) => {
    const source = sources.find((s) => s.id === p.sourceId);
    if (
      !source ||
      typeof p.id !== "string" ||
      ids.has(p.id) ||
      ![p.from, p.to].every(Number.isFinite) ||
      p.from < 0 ||
      p.to > source.duration + 0.001 ||
      p.to - p.from < 0.15
    )
      throw Error("A highlight is outside its source. Analyze again.");
    ids.add(p.id);
    const duration = p.to - p.from;
    total += duration;
    if (!Array.isArray(p.crop) || !p.crop.length || p.crop.length > 32)
      throw Error("Check portrait framing.");
    let last = -1;
    const crop = p.crop.map((k) => {
      if (
        ![k.t, k.x, k.y].every(Number.isFinite) ||
        k.t < 0 ||
        k.t > duration ||
        k.t <= last ||
        k.x < 0 ||
        k.x > 1 ||
        k.y < 0 ||
        k.y > 1 ||
        (k.zoom !== undefined &&
          (!Number.isFinite(k.zoom) || k.zoom < 0.05 || k.zoom > 1.5))
      )
        throw Error("Invalid crop movement.");
      last = k.t;
      return {
        t: k.t,
        x: k.x,
        y: k.y,
        ...(k.zoom === undefined ? {} : { zoom: k.zoom }),
      };
    });
    if (!Array.isArray(p.captions) || p.captions.length > 100)
      throw Error("Check captions.");
    const captions = p.captions
      .map((c) => {
        if (
          ![c.start, c.end].every(Number.isFinite) ||
          c.start < 0 ||
          c.end > duration + 0.001 ||
          c.end <= c.start ||
          typeof c.text !== "string" ||
          c.text.length > 500
        )
          throw Error("Check caption timing and text.");
        return { start: c.start, end: c.end, text: c.text.trim() };
      })
      .filter((c) => c.text);
    return {
      id: p.id,
      sourceId: p.sourceId,
      from: p.from,
      to: p.to,
      crop,
      captions,
      ...validateDirection(p, duration),
    };
  });
  if (total > limit + 0.05)
    throw Error(`Keep this result within ${limit} seconds.`);
  if (clean.reduce((n, p) => n + p.captions.length, 0) > 48)
    throw Error("Use up to 48 caption phrases in one reel.");
  return clean;
}
// Bound analysis and saved paths while including the final frame of every shot.
export function cropSampleTimes(duration) {
  const intervals = Math.min(31, Math.max(1, Math.ceil(duration * 4)));
  return Array.from(
    { length: intervals + 1 },
    (_, i) => (duration * i) / intervals,
  );
}
export function faceCrop(samples, duration) {
  let target = null,
    pending = null,
    lastSeen = -Infinity;
  const points = [];
  const distance = (a, b) =>
    Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);
  for (const sample of samples) {
    const faces = (sample.faces || []).filter(
      (f) =>
        [f.x, f.y, f.w, f.h].every(Number.isFinite) &&
        f.w > 0 &&
        f.h > 0 &&
        f.confidence >= 0.45,
    );
    // Keep the current subject even when another face briefly becomes larger.
    const nearest =
      target &&
      [...faces].sort((a, b) => distance(a, target) - distance(b, target))[0];
    let next =
      nearest && distance(nearest, target) < 0.2
        ? nearest
        : [...faces].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (target && next && distance(next, target) >= 0.2) {
      if (!pending || distance(next, pending.face) > 0.15)
        pending = { face: next, since: sample.t };
      // A single stray detection must not pull the camera to another person.
      if (sample.t - pending.since < 0.4 || sample.t - lastSeen < 0.4)
        next = null;
    } else pending = null;
    if (next) {
      target = next;
      lastSeen = sample.t;
      pending = null;
    }
    if (target)
      points.push({
        t: clamp(sample.t, 0, duration),
        x: clamp(target.x + target.w / 2, 0, 1),
        y: clamp(target.y + target.h * 0.8, 0, 1),
      });
  }
  if (!points.length) return [{ t: 0, x: 0.5, y: 0.5 }];
  if (points[0].t > 0) points.unshift({ ...points[0], t: 0 });
  // Offline symmetric filtering damps detector noise without a trailing camera
  // or the old dead zone's repeated stick-and-jump motion.
  return points.map((point, i) => {
    if (i === 0 || i === points.length - 1) return point;
    let weight = 0,
      x = 0,
      y = 0;
    for (const neighbor of points) {
      const w = Math.max(0, 1 - Math.abs(neighbor.t - point.t) / 0.6);
      weight += w;
      x += neighbor.x * w;
      y += neighbor.y * w;
    }
    return { t: point.t, x: x / weight, y: y / weight };
  });
}
// Shape-preserving Hermite curves share velocity at every internal keyframe.
// The same coefficients drive the browser and FFmpeg, without overshoot.
export function cropSegments(input, axis) {
  const points = input.map((p) => ({
    ...p,
    [axis]: p[axis] ?? (axis === "zoom" ? 1 : 0.5),
  }));
  const slopes = points
    .slice(1)
    .map((b, i) => (b[axis] - points[i][axis]) / (b.t - points[i].t));
  const tangents = points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return 0;
    const left = slopes[i - 1],
      right = slopes[i];
    if (left * right <= 0) return 0;
    const before = p.t - points[i - 1].t,
      after = points[i + 1].t - p.t;
    const w1 = 2 * after + before,
      w2 = after + 2 * before;
    return (w1 + w2) / (w1 / left + w2 / right);
  });
  return points.slice(1).map((b, i) => {
    const a = points[i],
      dt = b.t - a.t,
      delta = b[axis] - a[axis];
    const start = tangents[i] * dt,
      end = tangents[i + 1] * dt;
    return {
      from: a.t,
      to: b.t,
      coefficients: [
        a[axis],
        start,
        3 * delta - 2 * start - end,
        -2 * delta + start + end,
      ],
    };
  });
}
export function cropAt(points, time) {
  if (time <= points[0].t) return points[0];
  if (time >= points.at(-1).t) return points.at(-1);
  const result = {};
  for (const axis of ["x", "y", "zoom"]) {
    const segment = cropSegments(points, axis).find((s) => time <= s.to);
    const u = clamp((time - segment.from) / (segment.to - segment.from), 0, 1);
    const [a, b, c, d] = segment.coefficients;
    result[axis] = a + u * (b + u * (c + u * d));
  }
  return result;
}
// Whisper supplies phrase timestamps. Split long phrases for readable captions;
// word timing within each phrase is approximate and stays editable in review.
export function readableCaptions(segments) {
  return segments.flatMap((c) => {
    const words = c.text.trim().split(/\s+/u),
      lines = [];
    let line = "";
    for (const word of words) {
      if (line && (line + " " + word).length > 42) {
        lines.push(line);
        line = "";
      }
      line += (line ? " " : "") + word;
    }
    if (line) lines.push(line);
    if (
      lines.length > 1 &&
      lines.at(-1).length < 12 &&
      lines.at(-2).length + lines.at(-1).length < 55
    ) {
      const tail = lines.pop();
      lines[lines.length - 1] += " " + tail;
    }
    const count = lines.reduce((n, l) => n + l.length, 0);
    let offset = 0;
    return lines.map((text) => {
      const start = c.start + ((c.end - c.start) * offset) / count;
      offset += text.length;
      return {
        start,
        end: c.start + ((c.end - c.start) * offset) / count,
        text,
      };
    });
  });
}
export function captionElements(plan) {
  let offset = 0;
  const result = [];
  for (const shot of plan) {
    for (const c of shot.captions) {
      const start = offset + c.start,
        duration = c.end - c.start;
      if (duration < 0.1) continue;
      result.push({
        ...newElement("rectangle", start),
        id: `bg-${result.length}`,
        duration,
        x: 0.5,
        y: 0.78,
        w: 0.88,
        h: 0.15,
        color: "#101015",
        opacity: 0.8,
      });
      result.push({
        ...newElement("text", start),
        id: `caption-${result.length}`,
        duration,
        text: c.text,
        x: 0.5,
        y: 0.78,
        w: 0.81,
        h: 0.13,
        font: /[\u0600-\u06ff]/u.test(c.text)
          ? "Noto Sans Arabic"
          : "Noto Sans",
        fontSize: Math.max(
          0.018,
          Math.min(0.035, 0.035 * Math.sqrt(42 / Math.max(42, c.text.length))),
        ),
        weight: 700,
        color: "#ffffff",
      });
    }
    offset += shot.to - shot.from;
  }
  return result;
}
export function saveLocalResult(project, job) {
  if (job.projectId !== project.id || !job.media || job.state !== "ready")
    throw Error("This result is not ready.");
  if (!project.assets.some((a) => a.media?.id === job.media.id))
    project.assets.push({
      id: job.media.id,
      kind: "footage",
      name: job.media.name,
      media: job.media,
      scope: "project",
      description: "Rendered locally · original preserved",
      tags: ["effect", "local"],
    });
}
