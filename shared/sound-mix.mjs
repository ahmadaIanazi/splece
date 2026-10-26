export const mixRoles = ["original", "effect", "ambience", "dialogue"];
export function mixClips(project, role) {
  return role === "original"
    ? project.clips.filter((c) => c.activeTake)
    : (project.audioClips || []).filter((c) => c.soundtrack?.role === role && !c.soundtrack.pendingLipSync);
}
export function mixState(project, role) {
  const clips = mixClips(project, role);
  return {
    count: clips.length,
    muted: clips.length > 0 && clips.every((c) => c.mute),
    gain: clips.length ? Math.max(...clips.map((c) => c.volume ?? 1)) : 0,
  };
}
export function setMixGain(project, role, gain) {
  if (!mixRoles.includes(role) || !Number.isFinite(gain)) return;
  gain = Math.max(0, Math.min(1, gain));
  const clips = mixClips(project, role),
    peak = mixState(project, role).gain;
  for (const clip of clips)
    clip.volume = peak > 0 ? ((clip.volume ?? 1) * gain) / peak : gain;
}
export function setMixMute(project, role, mute) {
  for (const clip of mixClips(project, role)) clip.mute = !!mute;
}
