// Navigation reopens working drafts; it never overwrites authored edits.
export function openClipPrompt(
  project,
  clipId,
  jobs,
  makeId = () => crypto.randomUUID(),
) {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const take = clip.takes.find((t) => t.id === clip.activeTake);
  const job = take
    ? jobs.find((j) => j.id === take.jobId || j.media?.id === take.id)
    : [...jobs]
        .reverse()
        .find(
          (j) =>
            j.kind === "generation" &&
            (j.snapshot?.targetId === clip.id ||
              clip.generationTargets?.includes(j.snapshot?.targetId)),
        );
  const snapshot = job?.snapshot;
  let draft = project.drafts.find(
    (d) =>
      d.targetId === clip.id && d.sourceGenerationId === job?.id && job?.id,
  );
  if (!draft && snapshot?.draft) {
    draft = project.drafts.find(
      (d) =>
        d.id === snapshot.draft.id &&
        !d.sourceGenerationId &&
        (!d.targetId || d.targetId === clip.id),
    );
    if (!draft) {
      draft = structuredClone(snapshot.draft);
      draft.id = makeId();
      project.drafts.push(draft);
    }
    draft.sourceGenerationId = job.id;
  }
  if (!draft)
    draft = project.drafts.find(
      (d) => d.targetId === clip.id && d.episodeId === project.episodeId,
    );
  if (!draft) return null; // Imported footage has no generation prompt.
  draft.closed = false;
  draft.targetId = clip.id;
  draft.generationSlotId = clip.id;
  draft.episodeId = project.episodeId;
  draft.start = clip.start;
  project.activeDraftId = draft.id;
  return draft;
}

// A reference drop is an explicit request to author this slot, including imported footage.
export function attachClipReference(project, clipId, assetId, jobs, makeDraft) {
  const clip = project.clips.find((c) => c.id === clipId);
  let draft = clip
    ? openClipPrompt(project, clipId, jobs)
    : project.drafts.find((d) => d.id === project.activeDraftId);
  if (!draft && clip) {
    draft = makeDraft(clip.start);
    Object.assign(draft, {
      name:
        clip.intent ||
        clip.takes.find((t) => t.id === clip.activeTake)?.name ||
        "Clip prompt",
      targetId: clip.id,
      generationSlotId: clip.id,
      episodeId: project.episodeId,
      storyBeatId: clip.storyBeatId,
    });
    draft.settings.duration = clip.duration;
    project.drafts.push(draft);
  }
  if (!draft) return null;
  draft.closed = false;
  draft.referenceIds = [...new Set([...(draft.referenceIds || []), assetId])];
  project.activeDraftId = draft.id;
  return draft;
}
