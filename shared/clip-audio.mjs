import { takeSourceIn } from "./repair.mjs";

// Lip-sync pictures are silent; their associated dialogue remains on its own track.
export function clipAudioTarget(project, clip) {
  const take = clip?.takes?.find(t => t.id === clip.activeTake);
  if (!take) return null;
  const voice = project.audioClips?.find(a => a.id === take.lipSync?.audioId);
  if (voice) return {
    record: voice, linked: true, mediaId: voice.mediaId,
    sourceIn: Math.max(0, (voice.in || 0) + clip.start - voice.start),
    label: "Dialogue volume",
  };
  if (!take.audio) return null;
  return { record: clip, linked: false, mediaId: take.id,
    sourceIn: takeSourceIn(clip, take), label: "Clip audio volume" };
}

export function clipAudioGain(record) {
  return record?.mute ? 0 : (record?.volume ?? 1);
}

export function clipVolumePatch(value) {
  const volume = Math.max(0, Math.min(1, Number(value) || 0));
  return { volume, mute: volume === 0 };
}

export function toggleClipAudio(record) {
  return clipAudioGain(record) > 0
    ? { mute: true }
    : { mute: false, volume: record.volume || 1 };
}

export function patchClipAudio(project, clipId, patch) {
  const target = clipAudioTarget(project, project.clips.find(c => c.id === clipId));
  if (target) Object.assign(target.record, patch);
}
