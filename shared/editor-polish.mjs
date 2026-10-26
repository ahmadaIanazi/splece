// One deliberate wheel gesture changes one take; trackpad momentum is ignored.
export function takeWheelGesture(
  previous,
  { clipId, deltaY, deltaX = 0, at, deltaMode = 0, metaKey, ctrlKey, altKey, shiftKey },
) {
  if (metaKey || ctrlKey || altKey || shiftKey) return { state: { clipId, at, sum: 0, consumed: true }, direction: 0 };
  const state =
    previous?.clipId === clipId && at - previous.at < 220
      ? { ...previous, at }
      : { clipId, at, sum: 0, consumed: false };
  if (Math.abs(deltaX) > Math.abs(deltaY) || !deltaY)
    return { state, direction: 0 };
  state.sum += deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  if (state.consumed || Math.abs(state.sum) < 32)
    return { state, direction: 0 };
  state.consumed = true;
  return { state, direction: state.sum > 0 ? -1 : 1 };
}
export function numberNewClips(before, after) {
  const old = new Set((before.drafts || []).map((d) => d.id));
  let next =
    Math.max(
      0,
      ...after.drafts.map((d) => +(d.name?.match(/^Clip #(\d+)$/i)?.[1] || 0)),
    ) + 1;
  for (const d of after.drafts)
    if (
      !old.has(d.id) &&
      /^(Untitled (clip|scene)|New clip \d+)$/i.test(d.name || "")
    )
      d.name = `Clip #${next++}`;
}
