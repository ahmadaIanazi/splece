// Audio uses absolute episode time. Editing sound never ripples the picture.
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export function audioClip(media, id, start = 0, lane = 0) {
  return {
    id,
    mediaId: media.id,
    name: media.name || "Clip audio",
    start,
    in: 0,
    duration: media.duration,
    sourceDuration: media.duration,
    volume: 1,
    mute: false,
    lane,
    fadeIn: 0,
    fadeOut: 0,
  };
}
export function detachAudio(project, clipId, id) {
  const video = project.clips.find((c) => c.id === clipId);
  const media = video?.takes.find((t) => t.id === video.activeTake);
  if (!media?.audio) throw new Error("This take has no audio to detach.");
  const existing = project.audioClips.find(
    (c) => c.id === video.detachedAudioId && c.mediaId === media.id,
  );
  if (existing) return existing;
  const audio = {
    ...audioClip(media, id, video.start),
    in: video.in,
    duration: video.duration,
    volume: video.volume ?? 1,
    mute: video.mute || false,
    fadeIn: video.fadeIn || 0,
    fadeOut: video.fadeOut || 0,
    sourceClipId: video.id,
  };
  audio.lane = freeAudioLane(project.audioClips, audio.start, audio.duration);
  project.audioClips.push(audio);
  project.audioLanes = Math.max(project.audioLanes || 1, audio.lane + 1);
  video.mute = true;
  video.detachedAudioId = id;
  return audio;
}
export function freeAudioLane(clips, start, duration, preferred = 0) {
  let lane = preferred;
  while (
    clips.some(
      (c) =>
        c.lane === lane &&
        c.start < start + duration - 0.001 &&
        c.start + c.duration > start + 0.001,
    )
  )
    lane++;
  return lane;
}
export function copyAudio(project, source, id, start) {
  const clip = { ...structuredClone(source), id, start: Math.max(0, start) };
  clip.lane = freeAudioLane(
    project.audioClips,
    clip.start,
    clip.duration,
    clip.lane,
  );
  project.audioClips.push(clip);
  project.audioLanes = Math.max(project.audioLanes || 1, clip.lane + 1);
  return clip;
}
export function splitAudio(project, id, at, newId) {
  const clip = project.audioClips.find((c) => c.id === id);
  if (
    !clip ||
    at <= clip.start + 0.02 ||
    at >= clip.start + clip.duration - 0.02
  )
    throw new Error("Place the playhead inside the audio clip to split it.");
  const offset = at - clip.start;
  // Preserve the source envelope across the split, including a split inside a fade.
  const envelope = clip.envelope || {
    in: clip.in,
    duration: clip.duration,
    fadeIn: clip.fadeIn || 0,
    fadeOut: clip.fadeOut || 0,
  };
  const right = {
    ...structuredClone(clip),
    id: newId,
    start: at,
    in: clip.in + offset,
    duration: clip.duration - offset,
    envelope: structuredClone(envelope),
  };
  clip.envelope = envelope;
  clip.duration = offset;
  project.audioClips.push(right);
  return right;
}
export function editAudio(
  clip,
  patch,
  sourceDuration = clip.sourceDuration || clip.in + clip.duration,
) {
  Object.assign(clip, patch);
  clip.start = Math.max(0, clip.start);
  clip.in = clamp(clip.in, 0, Math.max(0, sourceDuration - 0.02));
  clip.duration = clamp(clip.duration, 0.02, sourceDuration - clip.in);
  clip.volume = clamp(clip.volume ?? 1, 0, 1);
  clip.lane = Math.min(255, Math.max(0, Math.floor(clip.lane || 0)));
  clip.fadeIn = clamp(clip.fadeIn || 0, 0, clip.duration);
  clip.fadeOut = clamp(clip.fadeOut || 0, 0, clip.duration - clip.fadeIn);
  if (["fadeIn", "fadeOut"].some((key) => key in patch)) delete clip.envelope;
  return clip;
}
export function blendAudio(project, id, seconds = 0.5) {
  const first = project.audioClips.find((c) => c.id === id);
  if (!first) throw new Error("Select an audio clip to crossfade.");
  const next = project.audioClips
    .filter(
      (c) => c.id !== id && c.lane === first?.lane && c.start > first.start,
    )
    .sort((a, b) => a.start - b.start)[0];
  if (!first || !next)
    throw new Error("Add a following audio clip on this track to crossfade.");
  const duration = Math.min(seconds, first.duration / 2, next.duration / 2);
  const overlap = first.start + first.duration - next.start;
  if (overlap < -0.02)
    throw new Error(
      "Close the gap first: drag the next audio clip to this clip’s end.",
    );
  if (overlap > duration + 0.02)
    throw new Error(
      "The clips overlap too much. Trim or move the next clip before blending.",
    );
  // Extend into unused source handles where possible: keep dialogue timing intact.
  const need = Math.max(0, duration - Math.max(0, overlap));
  if (
    (first.sourceDuration || first.in + first.duration) -
      first.in -
      first.duration >=
    need
  )
    first.duration += need;
  else if (next.in >= need) {
    next.in -= need;
    next.start -= need;
    next.duration += need;
  } else
    throw new Error(
      "Trim a little off either edge first to leave source audio for the crossfade. Timing is kept fixed.",
    );
  first.fadeOut = duration;
  first.fadeIn = Math.min(first.fadeIn || 0, first.duration - duration);
  next.fadeIn = duration;
  next.fadeOut = Math.min(next.fadeOut || 0, next.duration - duration);
  delete first.envelope;
  delete next.envelope;
  return duration;
}
export function audioEnvelope(c) {
  return (
    c.envelope || {
      in: c.in,
      duration: c.duration,
      fadeIn: c.fadeIn || 0,
      fadeOut: c.fadeOut || 0,
    }
  );
}
export function audioLevel(data, clip) {
  const first = Math.max(0, Math.floor(clip.in / data.step));
  const last = Math.min(
    data.rms.length,
    Math.ceil((clip.in + clip.duration) / data.step),
  );
  let sum = 0,
    peak = 0;
  for (let i = first; i < last; i++) {
    sum += data.rms[i] ** 2;
    peak = Math.max(peak, data.peaks[i]);
  }
  return { rms: Math.sqrt(sum / Math.max(1, last - first)), peak };
}
export function matchAudioLevels(clips, analysis) {
  const levels = clips
    .filter((c) => !c.mute && (c.volume ?? 1) > 0)
    .map((c) => ({ clip: c, ...audioLevel(analysis[c.mediaId], c) }))
    .filter((v) => v.rms > 0.0001);
  if (levels.length < 2)
    throw new Error("Choose at least two audible clips to match their levels.");
  const target = Math.min(
    0.1,
    ...levels.map(
      (v) =>
        v.rms * Math.min(v.clip.volume ?? 1, 0.95 / Math.max(0.0001, v.peak)),
    ),
  );
  for (const { clip, rms } of levels) clip.volume = target / rms;
  return levels.length;
}
