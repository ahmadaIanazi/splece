import { jobProgress } from "./job-progress.mjs";
import { smartSignature } from "./smart.mjs";

const episodeOf = (j) => j.snapshot?.draft?.episodeId || j.episodeId;
export function clipJobs(clip, jobs, episodeId) {
  const targets = new Set([clip.id, ...(clip.generationTargets || [])]);
  const takeJobs = new Set(clip.takes.map((t) => t.jobId).filter(Boolean));
  return jobs
    .filter(
      (j) =>
        j.kind === "generation" &&
        (!episodeOf(j) || episodeOf(j) === episodeId) &&
        (targets.has(j.snapshot?.targetId) || takeJobs.has(j.id)),
    )
    .sort(
      (a, b) =>
        (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id),
    );
}
function identity(clip, jobs, project) {
  const origin =
    clipJobs(clip, jobs, project.episodeId)[0]?.snapshot?.draft ||
    project.drafts.find((d) => d.targetId === clip.id);
  return {
    beat: clip.storyBeatId || origin?.storyBeatId,
    draft: clip.sourceDraftId || origin?.id,
    promptGroup: origin?.promptGroupId,
  };
}
export function generationTarget(project, draft, jobs = []) {
  const explicit = project.clips.find(
    (c) =>
      c.id === draft.targetId || c.generationTargets?.includes(draft.targetId),
  );
  if (explicit) return explicit;
  const slot =
    draft.generationSlotId &&
    project.clips.find(
      (c) =>
        c.id === draft.generationSlotId ||
        c.generationTargets?.includes(draft.generationSlotId),
    );
  if (slot) return slot;
  if (draft.repair) return null;
  return (
    project.clips.find((c) => {
      if (c.repair || c.independentSlot) return false;
      const key = identity(c, jobs, project);
      return (
        (draft.generationSlotId && c.id === draft.generationSlotId) ||
        (draft.storyBeatId && key.beat === draft.storyBeatId) ||
        (draft.promptGroupId && key.promptGroup === draft.promptGroupId) ||
        (draft.id && key.draft === draft.id)
      );
    }) || null
  );
}
function syncDraftTimes(project, clip) {
  for (const d of project.drafts.filter(
    (d) =>
      (!d.episodeId || d.episodeId === project.episodeId) &&
      generationTarget(project, d)?.id === clip.id,
  )) {
    d.start = clip.start;
    if (d.repair) {
      d.repair.from = clip.start;
      d.repair.to = clip.start + d.repair.duration;
    }
  }
}
// A single, gapless story flow. Remarks and additional audio keep absolute time.
export function stitchTimeline(
  project,
  ordered = [...project.clips].sort((a, b) => a.start - b.start),
) {
  let at = 0,
    changed = false;
  for (const clip of ordered) {
    if (Math.abs(clip.start - at) > 0.000001) changed = true;
    clip.start = at;
    syncDraftTimes(project, clip);
    at += clip.duration;
  }
  return changed;
}

// Drop into the nearest cut, never over an existing story slot.
export function insertStorySlot(project, clip, dropTime) {
  const ordered = [...project.clips].sort((a, b) => a.start - b.start);
  const index = ordered.findIndex((c) => dropTime < c.start + c.duration / 2);
  ordered.splice(index < 0 ? ordered.length : index, 0, clip);
  project.clips.push(clip);
  stitchTimeline(project, ordered);
  return clip;
}

export function resizeSlot(project, clip, duration) {
  const oldEnd = clip.start + clip.duration,
    delta = duration - clip.duration;
  clip.duration = duration;
  for (const next of project.clips)
    if (next.id !== clip.id && next.start >= oldEnd - 0.01) {
      next.start = Math.max(0, next.start + delta);
      syncDraftTimes(project, next);
    }
  clip.fadeIn = Math.min(clip.fadeIn || 0, duration);
  clip.fadeOut = Math.min(clip.fadeOut || 0, duration);
  syncDraftTimes(project, clip);
}
export function reserveGenerationSlot(
  project,
  draftId,
  jobs = [],
  makeId = () => crypto.randomUUID(),
) {
  const draft = project.drafts.find((d) => d.id === draftId);
  const reviewed =
    !!draft.smartAccepted &&
    draft.smartAccepted.sourceSignature === smartSignature(project, draft);
  const reviewedContext = reviewed
    ? smartSignature(project, draft, { reservationContext: true })
    : null;
  let clip = generationTarget(project, draft, jobs);
  if (!clip) {
    if (draft.repair)
      throw Error("The repair slot is missing. Select the repair range again.");
    let start = Math.max(0, draft.start);
    const occupied = [...project.clips]
      .sort((a, b) => a.start - b.start)
      .find(
        (c) => start > c.start + 0.01 && start < c.start + c.duration - 0.01,
      );
    if (occupied) start = occupied.start + occupied.duration;
    const duration = draft.settings.duration;
    // New slots insert into the story flow, never on top of an existing clip.
    for (const next of project.clips)
      if (next.start >= start - 0.01) {
        next.start += duration;
        syncDraftTimes(project, next);
      }
    clip = {
      id: makeId(),
      start,
      in: 0,
      duration,
      takes: [],
      activeTake: null,
      volume: 1,
      mute: false,
      intent: draft.scenes.map((s) => s.text).join(" "),
      sourceDraftId: draft.id,
      storyBeatId: draft.storyBeatId,
    };
    project.clips.push(clip);
  }
  clip.generationRequested = true;
  clip.storyBeatId ??= draft.storyBeatId;
  clip.sourceDraftId ??= draft.id;
  draft.targetId = clip.id;
  draft.generationSlotId = clip.id;
  draft.start = clip.start;
  stitchTimeline(project);
  // Linking an existing reservation to a submission is bookkeeping, not new
  // creative context. Never renew an already-stale review or one whose edit,
  // timing, media, or neighboring context changed during reservation.
  if (
    reviewed &&
    reviewedContext ===
      smartSignature(project, draft, { reservationContext: true })
  )
    draft.smartAccepted.sourceSignature = smartSignature(project, draft);
  return clip;
}
export function activateSlotTake(project, clip, take, jobs = []) {
  if (clip.activeTake === take.id) return;
  clip.takeEdits ??= {};
  if (clip.activeTake)
    clip.takeEdits[clip.activeTake] = { in: clip.in, duration: clip.duration };
  const saved = clip.takeEdits[take.id];
  const job = jobs.find((j) => j.id === take.jobId);
  const sourceIn = clip.repair ? take.sourceIn || 0 : saved?.in || 0;
  const available = Math.max(0.04, take.duration - sourceIn);
  const duration = clip.repair
    ? clip.duration
    : Math.min(
        available,
        saved?.duration ||
          job?.snapshot?.draft?.settings?.duration ||
          take.duration,
      );
  if (
    !Number.isFinite(duration) ||
    (clip.repair && available < duration - 0.04)
  )
    throw Error("This take is too short for the repair slot.");
  clip.in = sourceIn;
  clip.activeTake = take.id;
  resizeSlot(project, clip, duration);
}
export function adoptReadyGenerations(project, jobs) {
  let changed = false;
  for (const clip of project.clips) {
    const related = clipJobs(clip, jobs, project.episodeId);
    const added = related.filter(
      (j) =>
        j.state === "ready" &&
        j.media &&
        !clip.takes.some((t) => t.id === j.media.id),
    );
    if (!added.length) continue;
    for (const j of added)
      clip.takes.push(
        clip.repair ? { ...j.media, sourceIn: 0 } : { ...j.media },
      );
    const order = new Map(related.map((j, i) => [j.id, i]));
    clip.takes.sort(
      (a, b) => (order.get(a.jobId) ?? -1) - (order.get(b.jobId) ?? -1),
    );
    const newest = related.filter((j) => j.state === "ready" && j.media).at(-1);
    // A slow older request finishing later must not replace a newer selected result.
    const nextTake = clip.takes.find((t) => t.id === newest.media.id);
    const fitsRepair =
      !clip.repair ||
      nextTake.duration - (nextTake.sourceIn || 0) >= clip.duration - 0.04;
    if (
      fitsRepair &&
      (!clip.activeTake || added.some((j) => j.id === newest?.id))
    ) {
      activateSlotTake(
        project,
        clip,
        clip.takes.find((t) => t.id === newest.media.id),
        jobs,
      );
    }
    changed = true;
  }
  return changed;
}
export function currentSlotJob(clip, jobs, episodeId) {
  const related = clipJobs(clip, jobs, episodeId);
  return (
    related.filter((j) => !jobProgress(j).terminal).at(-1) || related.at(-1)
  );
}
// Consolidate legacy overlapping regenerations only when their story identity is
// unambiguous. Split/copied clips sharing footage are intentionally independent.
export function consolidateGenerationSlots(project, jobs) {
  let changed = false;
  const ordered = [...project.clips].sort((a, b) => a.start - b.start);
  for (let i = 0; i < ordered.length; i++) {
    const first = ordered[i];
    if (!project.clips.includes(first) || first.repair || first.independentSlot)
      continue;
    const key = identity(first, jobs, project);
    if (!key.beat && !key.draft) continue;
    let merged = false;
    for (const other of ordered.slice(i + 1)) {
      if (
        !project.clips.includes(other) ||
        other.repair ||
        other.independentSlot
      )
        continue;
      const candidate = identity(other, jobs, project);
      if (
        !(key.beat
          ? key.beat === candidate.beat
          : key.draft === candidate.draft)
      )
        continue;
      if (
        other.start >= first.start + first.duration - 0.01 ||
        first.takes.some((t) => other.takes.some((o) => o.id === t.id))
      )
        continue;
      first.generationTargets = [
        ...new Set([
          ...(first.generationTargets || []),
          other.id,
          ...(other.generationTargets || []),
        ]),
      ];
      first.takeEdits ??= {};
      if (other.activeTake)
        first.takeEdits[other.activeTake] = {
          in: other.in,
          duration: other.duration,
        };
      first.takes.push(...other.takes);
      for (const d of project.drafts)
        if (d.targetId === other.id) {
          d.targetId = first.id;
          d.generationSlotId = first.id;
          d.start = first.start;
        }
      project.clips = project.clips.filter((c) => c !== other);
      merged = true;
      changed = true;
    }
    if (merged) {
      const newest = clipJobs(first, jobs, project.episodeId)
        .filter(
          (j) =>
            j.state === "ready" && first.takes.some((t) => t.jobId === j.id),
        )
        .at(-1);
      if (newest)
        activateSlotTake(
          project,
          first,
          first.takes.find((t) => t.jobId === newest.id),
          jobs,
        );
    }
  }
  return changed;
}

// Reordering moves whole slots, including their takes and draft links.
export function reorderStorySlot(project, clipId, dropTime) {
  const ordered = [...project.clips].sort((a, b) => a.start - b.start);
  const clip = ordered.find((c) => c.id === clipId);
  if (!clip || ordered.length < 2) return;
  const others = ordered.filter((c) => c.id !== clipId);
  const index = others.findIndex((c) => dropTime < c.start + c.duration / 2);
  others.splice(index < 0 ? others.length : index, 0, clip);
  stitchTimeline(project, others);
}
export function markIndependentSegment(clip) {
  clip.independentSlot = true;
  clip.generationTargets = [];
  clip.takeEdits = Object.fromEntries(
    clip.takes.map((t) => [
      t.id,
      { in: clip.repair ? t.sourceIn || 0 : clip.in, duration: clip.duration },
    ]),
  );
}
