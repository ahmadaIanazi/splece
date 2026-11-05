import {
  timelineFrameSources,
  captureTimelineFrame,
} from "./timeline-frames.mjs";

// Resolve the visible edit, not the current selection in a second panel.
export function effectContext(project, context, selectedIds = []) {
  const ordered = [...project.clips].sort((a, b) => a.start - b.start);
  if (context?.kind === "clip") {
    const clip = ordered.find((c) => c.id === context.clipId),
      index = ordered.indexOf(clip);
    return {
      ...context,
      clip,
      before: ordered[index - 1],
      after: ordered[index + 1],
    };
  }
  if (context)
    return {
      ...context,
      before: ordered.find((c) => c.id === context.previousClipId),
      after: ordered.find((c) => c.id === context.nextClipId),
    };
  const selected = ordered.filter((c) => selectedIds.includes(c.id));
  if (selected.length === 1) {
    const clip = selected[0];
    if (!clip.activeTake)
      return {
        kind: "clip",
        at: clip.start,
        clipId: clip.id,
        clip,
        before: ordered[ordered.indexOf(clip) - 1],
        after: ordered[ordered.indexOf(clip) + 1],
      };
    return { kind: "clip", at: clip.start, clipId: clip.id, clip };
  }
  return {
    kind: "empty",
    at: Math.max(0, ...ordered.map((c) => c.start + c.duration)),
    before: ordered.at(-1),
  };
}
export function automaticEffectFrames(project, context, range) {
  const sources = timelineFrameSources(project),
    find = (c) => sources.find((s) => s.clip.id === c?.id);
  if (context.kind === "clip" && context.clip?.activeTake) {
    const s = find(context.clip);
    if (!s) return {};
    return {
      start: captureTimelineFrame(
        s,
        s.min + (range ? range.from - context.clip.start : 0),
      ),
      end: captureTimelineFrame(
        s,
        range
          ? s.min +
              range.to -
              context.clip.start -
              1 / (project.settings?.export?.fps || 24)
          : s.max,
      ),
    };
  }
  const left = find(context.before),
    right = find(context.after);
  return {
    start: left ? captureTimelineFrame(left, left.max) : null,
    end: right ? captureTimelineFrame(right, right.min) : null,
  };
}
export function frameEffectReference(project, role, frame) {
  if (!frame) return { role };
  const clip = project.clips.find(
    (c) => c.id === frame.clipId && c.activeTake === frame.takeId,
  );
  if (clip)
    return {
      role,
      target: { kind: "clip", id: clip.id },
      edge: "time",
      time: frame.time,
    };
  const asset = project.assets.find(
    (a) => a.media?.id === (frame.mediaId || frame.takeId),
  );
  return {
    role,
    target: asset ? { kind: "asset", id: asset.id } : null,
    edge: "first",
  };
}
