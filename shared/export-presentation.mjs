export function exportFileName(name) {
  const stem = String(name || "Project")
    .normalize("NFC")
    .replace(/\.mp4$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/^\.+|[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  return `${stem || "Project"}.mp4`;
}
export function jobElapsed(job, now = Date.now()) {
  const stamp = (value) =>
    typeof value === "number" ? value : Date.parse(value);
  const seconds = Math.max(
    0,
    Math.round(
      (stamp(job.completedAt || now) - stamp(job.startedAt || job.createdAt)) /
        1000,
    ),
  );
  return Number.isFinite(seconds)
    ? seconds < 1
      ? "Less than 1s"
      : `${seconds}s`
    : "";
}
export function exportSummary(project) {
  const clips = project.clips || [],
    audio = project.audioClips || [],
    elements = (project.elements || []).filter(
      (e) => !e.episodeId || e.episodeId === project.episodeId,
    );
  return {
    duration: Math.max(
      0,
      ...[...clips, ...audio, ...elements].map(
        (c) => (c.start || 0) + (c.duration || 0),
      ),
    ),
    clips: clips.length,
    audio: audio.filter((a) => !a.mute).length,
    muted: audio.filter((a) => a.mute).length,
    elements: elements.length,
  };
}
