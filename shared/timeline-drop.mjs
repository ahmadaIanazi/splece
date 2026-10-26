export function timelineDropPreview(project, item, time) {
  if (!item) return null;
  const clips = [...project.clips].sort((a, b) => a.start - b.start);
  if (item.asset && !["footage", "audio"].includes(item.asset.kind)) {
    const clip = clips.find(
      (c) => time >= c.start && time < c.start + c.duration,
    );
    return {
      mode: "reference",
      start: clip?.start ?? time,
      duration: clip?.duration ?? 0,
      clipId: clip?.id,
      label: "Attach reference",
    };
  }
  const media = item.media || item.asset?.media;
  if (media?.kind === "audio")
    return {
      mode: "audio",
      start: time,
      duration: media.duration,
      label: "Add audio",
    };
  const targetId = item.job?.snapshot?.targetId;
  const existing = clips.find(
    (c) =>
      c.takes?.some((t) => t.id === media?.id) ||
      (targetId &&
        (c.id === targetId || c.generationTargets?.includes(targetId))),
  );
  if (existing && item.key && !item.asset)
    return {
      mode: "select",
      start: existing.start,
      duration: existing.duration,
      label: "Use saved take",
    };
  const target = clips.find(
    (c) =>
      time >= c.start &&
      time < c.start + c.duration &&
      !c.activeTake &&
      c.plannedReservation &&
      c.storyBeatId &&
      !c.generationRequested,
  );
  const duration = item.clip?.duration || media?.duration || 0;
  if (target)
    return {
      mode: "fill",
      start: target.start,
      duration: item.asset ? Math.min(target.duration, duration) : duration,
      targetId: target.id,
      label: "Fill planned clip",
    };
  const next = clips.find((c) => time < c.start + c.duration / 2);
  return {
    mode: "insert",
    start:
      next?.start ?? Math.max(0, ...clips.map((c) => c.start + c.duration)),
    duration,
    label: `Insert ${duration.toFixed(1)}s`,
  };
}
