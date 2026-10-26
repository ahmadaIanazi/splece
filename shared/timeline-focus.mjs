// Preview-only audition. Never edits the project's saved mute/visibility values.
export function nextTimelineFocus(state, target, control = false) {
  const same = state?.armed?.id === target.id && state?.armed?.kind === target.kind;
  if (!control && !same) return { armed: null, solo: null };
  if (!same) return { armed: target, solo: null };
  return { armed: target, solo: state.solo ? null : target };
}
export function auditionAudio(clips, solo) {
  if (!solo || solo.kind === "element") return clips;
  return clips.map(c => ({...c, mute: solo.kind !== "audio" || c.id !== solo.id, ...(c.id === solo.id ? {volume:c.volume || 1} : {})}));
}
export function auditionSource(clip, solo) {
  if (!clip || !solo || solo.kind === "element") return clip;
  return {...clip, mute: solo.kind !== "video" || solo.id !== clip.id, ...(solo.id === clip.id ? {volume:clip.volume || 1} : {})};
}
