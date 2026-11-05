// Resolve the timeline location without modifying clips or creating a reservation.
// Keep planned neighbours: a missing frame must never silently use a later clip.
export function timelineInsertionContext(project, requestedAt, range) {
  const at = Math.max(0, Number(requestedAt) || 0);
  const tolerance = 1 / (project.settings?.export?.fps || 24);
  const clips = [...(project.clips || [])].filter(c => c.duration > 0)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const previous = clips.filter(c => Math.abs(c.start + c.duration - at) <= tolerance)
    .sort((a, b) => Math.abs(a.start + a.duration - at) - Math.abs(b.start + b.duration - at))[0];
  const next = clips.filter(c => Math.abs(c.start - at) <= tolerance)
    .sort((a, b) => Math.abs(a.start - at) - Math.abs(b.start - at))[0];
  const inside = clips.filter(c => at > c.start + tolerance && at < c.start + c.duration - tolerance).at(-1);
  const context = previous || next
    ? { at: next?.start ?? previous.start + previous.duration, kind: 'cut',
        ...(previous ? { previousClipId: previous.id } : {}), ...(next ? { nextClipId: next.id } : {}) }
    : inside ? { at, kind: 'clip', clipId: inside.id } : { at, kind: 'empty' };
  if (range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.to > range.from && at >= range.from && at <= range.to)
    context.range = { from: range.from, to: range.to };
  return context;
}
