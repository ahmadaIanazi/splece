export function createRepairDraft(
  project,
  clipId,
  from,
  to,
  sourceDraft,
  createDraft,
  makeId = () => crypto.randomUUID(),
) {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip?.activeTake)
    throw new Error("Select a clip with footage to replace");
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < clip.start ||
    to > clip.start + clip.duration ||
    to - from < 1 / 24
  )
    throw new Error("Select a range inside one clip");
  const source = structuredClone(clip),
    middleId = makeId(),
    duration = +(to - from).toFixed(6);
  const middle = {
    ...structuredClone(clip),
    id: middleId,
    start: from,
    in: clip.in + from - clip.start,
    duration,
    repair: true,
    independentSlot: true,
  };
  middle.takes = middle.takes.map((t) => ({ ...t, sourceIn: middle.in }));
  const parts = [];
  if (from > clip.start + 0.001)
    parts.push({ ...structuredClone(clip), duration: from - clip.start });
  parts.push(middle);
  if (to < clip.start + clip.duration - 0.001)
    parts.push({
      ...structuredClone(clip),
      id: makeId(),
      start: to,
      in: clip.in + to - clip.start,
      duration: clip.start + clip.duration - to,
    });
  for (const part of parts) part.independentSlot = true;
  project.clips.splice(
    project.clips.findIndex((c) => c.id === clipId),
    1,
    ...parts,
  );
  const d = sourceDraft ? structuredClone(sourceDraft) : createDraft(from);
  d.id = makeId();
  d.closed = false;
  d.name = "Repair " + from.toFixed(2) + "–" + to.toFixed(2) + "s";
  d.start = from;
  d.targetId = middleId;
  d.episodeId = project.episodeId;
  d.quantity = 1;
  d.settings.duration = duration;
  d.repair = { sourceClip: source, from, to, duration };
  // Keep the source prompt, references and variants; the new repair direction is separate.
  d.repairInstructions = "";
  delete d.smartAccepted;
  delete d.smartReviews;
  delete d.smartHistory;
  d.scenes.forEach((s) => {
    s.duration = null;
  });
  d.automation = {
    ...d.automation,
    frames: true,
    startFrame: true,
    endFrame: true,
  };
  d.frameOverrides = {
    start: {
      mode: "pinned",
      frame: {
        takeId: source.activeTake,
        clipId: source.id,
        time: Math.max(0, source.in + from - source.start - 1 / 24),
        origin: "Before repair",
      },
    },
    end: {
      mode: "pinned",
      frame: {
        takeId: source.activeTake,
        clipId: source.id,
        time: Math.min(
          source.takes.find((t) => t.id === source.activeTake).duration -
            1 / 24,
          source.in + to - source.start,
        ),
        origin: "After repair",
      },
    },
  };
  project.drafts.push(d);
  project.activeDraftId = d.id;
  return d;
}
export function takeSourceIn(clip, take) {
  return clip.repair ? (take.sourceIn ?? 0) : clip.in;
}
