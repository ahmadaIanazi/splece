import { fillPlannedSlot } from "./planned-timeline.mjs";
import {
  activateSlotTake,
  adoptReadyGenerations,
  insertStorySlot,
  stitchTimeline,
} from "./generation-slots.mjs";

const inEpisode = (j, p) =>
  !(j.snapshot?.draft?.episodeId || j.episodeId) ||
  (j.snapshot?.draft?.episodeId || j.episodeId) === p.episodeId;

// Removing a story slot never deletes media, prompts, or its edit decisions.
export function removeStorySlot(project, clipId, now = Date.now()) {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  project.removedClips ??= [];
  project.removedClips = project.removedClips.filter(
    (r) => r.clip.id !== clipId || r.episodeId !== project.episodeId,
  );
  project.removedClips.push({
    episodeId: project.episodeId,
    removedAt: now,
    clip: structuredClone(clip),
  });
  project.clips = project.clips.filter((c) => c.id !== clipId);
  stitchTimeline(project);
  return clip;
}

// Delete affects the visible generation; Cut still removes the whole slot.
// Keep a per-slot exclusion so completed jobs cannot silently reattach it.
export function removeActiveGeneration(project, clipId, jobs = []) {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  if (clip.takes.length <= 1) {
    removeStorySlot(project, clipId);
    return { removedClip: true };
  }
  const index = clip.takes.findIndex((t) => t.id === clip.activeTake);
  if (index < 0) throw Error("Select a generation before deleting it.");
  const removed = clip.takes[index];
  const candidates = [
    ...clip.takes.slice(0, index).reverse(),
    ...clip.takes.slice(index + 1),
  ];
  const next = candidates.find((take) => !clip.repair ||
    take.duration - (take.sourceIn || 0) >= clip.duration - 0.04);
  if (!next) throw Error("The remaining generations are too short for this repair. Choose another generation first.");
  activateSlotTake(project, clip, next, jobs);
  clip.takes = clip.takes.filter((t) => t.id !== removed.id);
  clip.removedTakeIds = [...new Set([...(clip.removedTakeIds || []), removed.id])];
  return { removedClip: false, takeId: removed.id, activeTake: next.id };
}

export function removeGeneration(project, clipId, takeId, jobs=[]) {
 const clip=project.clips.find(c=>c.id===clipId);
 if(!clip || !clip.takes.some(t=>t.id===takeId)) return null;
 if(clip.activeTake===takeId) return removeActiveGeneration(project,clipId,jobs);
 clip.takes=clip.takes.filter(t=>t.id!==takeId);
 clip.removedTakeIds=[...new Set([...(clip.removedTakeIds||[]),takeId])];
 return {removedClip:false,takeId,activeTake:clip.activeTake};
}

export function generationPool(project, jobs) {
  const removed = (project.removedClips || []).filter(
    (r) =>
      r.episodeId === project.episodeId &&
      !project.clips.some((c) => c.id === r.clip.id),
  );
  const ready = jobs.filter(
    (j) =>
      j.kind === "generation" &&
      j.state === "ready" &&
      j.media &&
      inEpisode(j, project),
  );
  const entries = removed
    .map((r) => {
      // A job may finish after its slot was removed. Make it recoverable too.
      const copy = { ...project, clips: [structuredClone(r.clip)], drafts: [] };
      adoptReadyGenerations(copy, ready);
      const clip = copy.clips[0];
      const media = clip.takes.find((t) => t.id === clip.activeTake);
      const job = ready.find((j) => j.media.id === media?.id);
      return {
        key: "slot:" + clip.id,
        clip,
        media,
        job,
        name: job?.snapshot?.draft?.name || media?.name || "Removed clip",
        removed: true,
        onTimeline: false,
        createdAt: r.removedAt,
      };
    })
    .filter((e) => e.media);
  // Saved slots include every take. Avoid repeating those videos as loose cards.
  const archivedMedia = new Set(
    entries.flatMap((e) => e.clip.takes.map((t) => t.id)),
  );
  for (const job of ready) {
    if (archivedMedia.has(job.media.id)) continue;
    entries.push({
      key: "job:" + job.id,
      job,
      media: job.media,
      name: job.snapshot?.draft?.name || job.media.name || "Generation",
      removed: false,
      onTimeline: project.clips.some((c) =>
        c.takes.some((t) => t.id === job.media.id),
      ),
      createdAt: job.createdAt,
    });
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

export function restorePoolEntry(
  project,
  jobs,
  key,
  dropTime,
  makeId = () => crypto.randomUUID(),
  preferredTakeId,
) {
  const entry = generationPool(project, jobs).find((e) => e.key === key);
  if (!entry)
    throw Error("This video is no longer available in this episode's pool.");
  let clip = entry.clip
    ? project.clips.find((c) => c.id === entry.clip.id)
    : project.clips.find((c) => c.takes.some((t) => t.id === entry.media.id));
  // Restoring an existing take selects it in its own slot, never duplicates it.
  if (clip) {
    activateSlotTake(
      project,
      clip,
      clip.takes.find((t) => t.id === entry.media.id),
      jobs,
    );
    return clip;
  }
  if (entry.clip) clip = structuredClone(entry.clip);
  else {
    const target = entry.job.snapshot?.targetId;
    clip = project.clips.find(
      (c) => c.id === target || c.generationTargets?.includes(target),
    );
    if (clip) {
      clip.removedTakeIds = (clip.removedTakeIds || []).filter(id => id !== entry.media.id);
      if (!clip.takes.some((t) => t.id === entry.media.id))
        clip.takes.push(structuredClone(entry.media));
      activateSlotTake(project, clip, entry.media, jobs);
      return clip;
    }
    const draft = entry.job.snapshot?.draft;
    clip = {
      id: target || makeId(),
      start: 0,
      in: 0,
      duration: Math.min(
        entry.media.duration,
        draft?.settings?.duration || entry.media.duration,
      ),
      takes: [structuredClone(entry.media)],
      activeTake: entry.media.id,
      volume: 1,
      mute: false,
      intent: draft?.scenes?.map((s) => s.text).join(" ") || "",
      sourceDraftId: draft?.id,
      storyBeatId: draft?.storyBeatId,
    };
    // Restore all successful attempts belonging to this historical slot.
    const isolated = { ...project, clips: [clip], drafts: [] };
    adoptReadyGenerations(
      isolated,
      jobs.filter((j) => inEpisode(j, project)),
    );
    activateSlotTake(
      isolated,
      clip,
      clip.takes.find((t) => t.id === entry.media.id),
      jobs,
    );
  }
  if (preferredTakeId && clip.takes.some((t) => t.id === preferredTakeId)) {
    activateSlotTake(
      { ...project, clips: [clip], drafts: [] },
      clip,
      clip.takes.find((t) => t.id === preferredTakeId),
      jobs,
    );
  }
  const recoveredId = clip.id;
  const filled = fillPlannedSlot(project, clip, dropTime);
  if (filled) clip = filled;
  else insertStorySlot(project, clip, dropTime);
  project.removedClips = (project.removedClips || []).filter(
    (r) => r.clip.id !== recoveredId || r.episodeId !== project.episodeId,
  );
  return clip;
}
