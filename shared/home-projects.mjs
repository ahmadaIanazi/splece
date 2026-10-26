import { takeSourceIn } from "./repair.mjs";

// Home reads the current edit only. Never mutate project or take records here.
export function homeProjectSummary(project) {
  const clips = (project.clips || [])
    .filter(
      (clip) =>
        (!clip.episodeId || clip.episodeId === project.episodeId) &&
        Number.isFinite(clip.start) &&
        Number.isFinite(clip.duration) &&
        clip.duration > 0,
    )
    .sort((a, b) => a.start - b.start);
  const visible = clips.flatMap((clip) => {
    const take = clip.takes?.find((t) => t.id === clip.activeTake);
    return take?.id ? [{ clip, take }] : [];
  });
  const first = visible[0];
  const duration = clips.reduce(
    (end, clip) => Math.max(end, clip.start + clip.duration),
    0,
  );
  return {
    duration,
    aspect: project.settings?.export?.aspect || "16:9",
    hasFootage: !!first,
    pending: clips.length - visible.length,
    cover: first
      ? {
          // Use local media endpoints, never persisted provider URLs or private paths.
          thumbnail: `/api/media/${encodeURIComponent(first.take.id)}/thumbnail`,
          url: `/api/media/${encodeURIComponent(first.take.id)}`,
          start: Math.max(0, takeSourceIn(first.clip, first.take) || 0),
          duration: Math.min(3, first.clip.duration),
        }
      : null,
  };
}

export function homeDuration(seconds) {
  const n = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

// Continue is visible once; searching and Hidden always show their full result set.
export function homeProjectView(
  catalog,
  { currentId, query = "", hidden = false, sort = "recent" } = {},
) {
  const visible = catalog.filter((p) => !p.hidden);
  const hiddenCount = catalog.length - visible.length;
  const recent = [...visible].sort(
    (a, b) => new Date(b.updated) - new Date(a.updated),
  );
  const resume =
    !hidden && !query.trim()
      ? recent.find((p) => p.id === currentId) || recent[0] || null
      : null;
  const projects = catalog.filter(
    (p) =>
      !!p.hidden === hidden &&
      p.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      p.id !== resume?.id,
  );
  projects.sort(
    sort === "name"
      ? (a, b) => a.name.localeCompare(b.name)
      : (a, b) => new Date(b.updated) - new Date(a.updated),
  );
  return { resume, projects, hiddenCount, visibleCount: visible.length };
}
