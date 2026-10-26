import { takeSourceIn } from "./repair.mjs";
// Frame captures use the active take and visible trim of a timeline clip only.
export function timelineFrameSources(project) {
  const fps = project.settings?.export?.fps || 24;
  return project.clips
    .filter(
      (c) => c.duration > 0 && c.takes?.some((t) => t.id === c.activeTake),
    )
    .map((c) => {
      const take = c.takes.find((t) => t.id === c.activeTake);
      const min = take.kind === "image" ? 0 : Math.max(0, takeSourceIn(c, take) || 0);
      const max = take.kind === "image" ? 0 : Math.max(
        min,
        Math.min(min + c.duration, take.duration || Infinity) - 1 / fps,
      );
      return { clip: c, take, min, max };
    })
    .sort((a, b) => a.clip.start - b.clip.start);
}
export function captureTimelineFrame(source, time = source.min) {
  return {
    clipId: source.clip.id,
    takeId: source.take.id,
    time: Math.max(source.min, Math.min(source.max, Number(time) || 0)),
    timelineCapture: true,
    ...(source.take.kind === "image" ? {kind:"image",mediaId:source.take.id} : {}),
  };
}

// Usage is derived from saved prompts, not a second marker database.
export function timelineFrameUsages(project) {
  const usages = [];
  for (const draft of project.drafts || []) {
    if (draft.episodeId && draft.episodeId !== project.episodeId) continue;
    for (const key of ["start", "end"]) {
      const override = draft.frameOverrides?.[key],
        frame = override?.frame;
      if (!frame || override.mode === "none" || override.mode === "auto")
        continue;
      for (const source of timelineFrameSources(project)) {
        if (
          source.take.id !== frame.takeId ||
          frame.time < source.min - 1e-6 ||
          frame.time > source.max + 1e-6
        )
          continue;
        usages.push({
          id: `${draft.id}:${key}:${source.clip.id}`,
          draftId: draft.id,
          name: draft.name,
          key,
          clipId: source.clip.id,
          at: source.clip.start + frame.time - source.min,
          frame,
        });
      }
    }
  }
  return usages;
}
