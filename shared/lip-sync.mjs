import { dialogueDraft, dialogueSignature } from "./soundtrack-dialogue.mjs";
import { soundSource } from "./soundtrack.mjs";
import {
  targetedSegments,
  TARGETED_LIP_MODEL,
  faceSource,
} from "./face-assignment.mjs";
export const LIP_SYNC_MODEL = "fal-ai/sync-lipsync/v2";
export function lipSyncInput(project, clipId, audioId) {
  const clip = project.clips.find((c) => c.id === clipId),
    source = clip && soundSource(clip);
  const audio = project.audioClips?.find(
    (a) => a.id === audioId && a.soundtrack?.role === "dialogue",
  );
  if (!source || !audio)
    throw Error("Choose a completed clip and its generated voice-over first.");
  if (!audio.soundtrack.sources?.some((s) => s.clipId === clip.id))
    throw Error("Choose the voice-over belonging to this clip.");
  if (
    audio.soundtrack.scriptSignature != null &&
    audio.soundtrack.scriptSignature !== dialogueSignature(project, clip)
  )
    throw Error(
      "The script or character voice changed. Create an updated voice before matching lips.",
    );
  if ((clip.speed ?? 1) !== 1 || clip.reverse)
    throw Error("Render the speed or reverse edit before matching lips.");
  if (source.duration < 2 || source.duration > 30)
    throw Error("Choose a speaking clip between 2 and 30 seconds.");
  if (
    audio.start > clip.start + 0.04 ||
    audio.start + audio.duration < clip.start + clip.duration - 0.04
  )
    throw Error(
      "The voice-over must cover the selected clip. Align its waveform first.",
    );
  const draft = dialogueDraft(project, clip);
  const speakers = new Set(
    (draft?.scenes || []).flatMap((s) =>
      (s.dialogue || []).filter((l) => l.text?.trim()).map((l) => l.speaker),
    ),
  );
  const cast = (draft?.referenceIds || []).filter((id) =>
    project.assets.some((a) => a.id === id && a.kind === "character"),
  );
  const hasAssignments = !!project.production?.faceAssignments?.[clipId];
  const targeted = speakers.size > 1 || cast.length > 1 || hasAssignments;
  const segments = targeted ? targetedSegments(project, clip, audio) : null;
  return {
    clipId,
    source,
    audioId,
    audioMediaId: audio.mediaId,
    audioIn: (audio.in || 0) + clip.start - audio.start,
    duration: clip.duration,
    episodeId: project.episodeId,
    ...(segments ? { model: TARGETED_LIP_MODEL, segments } : {}),
  };
}
export function lipSyncSignature(input) {
  return JSON.stringify(input);
}
export function applyLipSync(project, job) {
  if (
    job.projectId !== project.id ||
    job.episodeId !== project.episodeId ||
    !job.media
  )
    throw Error("This lip-sync result belongs to another edit.");
  const current = lipSyncInput(project, job.input.clipId, job.input.audioId);
  if (lipSyncSignature(current) !== job.signature)
    throw Error(
      "The clip or voice-over changed. The result remains saved in Assets; make a fresh lip-sync pass for this edit.",
    );
  const clip = project.clips.find((c) => c.id === current.clipId);
  clip.takeEdits ??= {};
  clip.takeEdits[clip.activeTake] = { in: clip.in, duration: clip.duration };
  const take = {
    ...job.media,
    sourceIn: 0,
    lipSync: { source: current.source, audioId: current.audioId },
  };
  if (!clip.takes.some((t) => t.id === take.id)) clip.takes.push(take);
  for (const audio of project.audioClips || []) {
    if (
      audio.soundtrack?.role === "dialogue" &&
      audio.soundtrack.sources?.length &&
      audio.soundtrack.sources.every((s) => s.clipId === clip.id)
    ) {
      audio.mute = audio.id !== current.audioId;
      if (audio.id === current.audioId) delete audio.soundtrack.pendingLipSync;
    }
  }
  clip.activeTake = take.id;
  clip.in = 0;
  if (project.production?.faceAssignments?.[clip.id])
    project.production.faceAssignments[clip.id].source = faceSource(clip);
  // Synced take is silent: the same timed voice-over remains the only speech track.
  // Refresh audio dependencies for a picture-only mouth edit so it doesn't look stale.
  for (const audio of project.audioClips || [])
    for (const source of audio.soundtrack?.sources || []) {
      if (
        source.clipId === clip.id &&
        source.mediaId === current.source.mediaId
      ) {
        source.mediaId = take.id;
        source.in = 0;
      }
    }
}
export function lipSyncCosts(job) {
  return {
    key: `lip-sync:${job.id}`,
    id: job.id,
    kind: "soundtrack",
    provider: job.executionMode === "test" ? "local-test" : "fal",
    model: job.model || LIP_SYNC_MODEL,
    test: job.executionMode === "test",
    state: job.state,
    title: "Lip-sync",
    episodeId: job.episodeId,
    targetId: job.input.clipId,
    start: job.input.source.start,
    duration: job.input.duration,
    createdAt: job.createdAt,
    amount:
      job.executionMode === "test"
        ? 0
        : job.parts
          ? job.parts.some((p) => p.state === "submission_uncertain")
            ? null
            : job.parts.reduce(
                (n, p) => n + (p.providerJobId ? p.amount || 0 : 0),
                0,
              )
          : job.state === "submission_uncertain"
            ? null
            : job.providerJobId || job.parts?.some((p) => p.providerJobId)
              ? job.amount
              : 0,
    status:
      job.executionMode === "test"
        ? "test"
        : job.state === "submission_uncertain"
          ? "unknown"
          : job.providerJobId || job.parts?.some((p) => p.providerJobId)
            ? "estimated"
            : "pending",
    charges: [],
  };
}

export function saveLipSyncAsset(project, job) {
  if (!job.media || project.assets.some((a) => a.id === job.media.id)) return;
  project.assets.push({
    id: job.media.id,
    kind: "footage",
    name: job.media.name,
    description: "Lip-sync variation · original picture preserved",
    media: job.media,
    scope: "project",
    tags: ["lip-sync", job.executionMode === "test" ? "test" : "ai"],
    version: 1,
  });
}
