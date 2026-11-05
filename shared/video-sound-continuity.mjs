import { priorClipContinuitySource } from './clip-continuity.mjs';
import { takeSourceIn } from './repair.mjs';

// Only the verified Wan reference workflow accepts this separate audio binding.
export function supportsSoundReference(model) {
  if (!model?.supported || model.providerId !== 'fal' || model.endpointId !== 'alibaba/wan-3.0/reference-to-video') return false;
  if (model.audioReferences !== undefined) return model.audioReferences === true;
  // Older cached catalogs still carry the provider schema.
  return !model.schema || Object.values(model.schema.components?.schemas || {}).some(s => s.properties?.prompt && s.properties?.reference_audio_urls);
}
export function validSoundSource(source) {
  return !!source && typeof source.clipId === 'string' && typeof source.takeId === 'string' &&
    Number.isFinite(source.start) && source.start >= 0 && Number.isFinite(source.duration) && source.duration >= 0.25 && source.duration <= 15;
}
export function soundContinuation(project, draft, model, settings) {
  if (!draft.soundContinuity?.enabled || !settings.enabled || draft.sectionOverrides?.['Sound direction'] === '') return {source:null, reason:''};
  if (!supportsSoundReference(model)) return {source:null, reason:'Continue previous sound needs Wan 3.0 References on fal.ai. Choose that model or turn this option off.'};
  if (draft.settings.audio === false) return {source:null, reason:'Enable generated video audio to continue the previous clip sound.'};
  if (!settings.music && !settings.ambience) return {source:null, reason:'Include Music or Ambience to continue the previous clip sound.'};
  const pinned = draft.soundContinuity.source;
  const prior = pinned ? {clip:project.clips?.find(c => c.id === pinned.clipId)} : priorClipContinuitySource(project,draft);
  const clip = prior?.clip;
  const take = clip?.takes?.find(t => t.id === (pinned?.takeId || clip.activeTake));
  if ((!pinned && prior?.reason?.startsWith('Multiple clips end')) || !clip || !take?.jobId || take.kind === 'image') return {source:null,reason:'A previous generated clip with an unambiguous active take is needed.'};
  if (clip.episodeId && clip.episodeId !== (draft.episodeId || project.episodeId)) return {source:null,reason:'The saved sound source belongs to a different episode.'};
  if (!take.audio || take.lipSync) return {source:null,reason:'The previous take has no native audio to continue. Choose a take with sound.'};
  const sourceIn = takeSourceIn(clip,take) ?? 0;
  const end = Math.min(sourceIn + clip.duration, take.duration);
  const duration = Math.min(10,end-sourceIn);
  const source = pinned || {clipId:clip.id,takeId:take.id,start:end-duration,duration};
  if (!validSoundSource(source) || source.start + source.duration > take.duration + 0.05) return {source:null,reason:'The saved sound sample is outside the source take. Select the previous sound again.'};
  return {source:{clipId:source.clipId,takeId:source.takeId,start:source.start,duration:source.duration},reason:'',name:clip.name || 'Previous clip',pinned:!!pinned};
}
export function soundContinuationText(settings) {
  const layers = [settings.music && 'instrumental music',settings.ambience && 'environmental ambience'].filter(Boolean).join(' and ');
  return `Audio 1 is a mixed audio sample from the preceding generated clip. Use only its ${layers} as a continuity reference. Continue from the sample ending with compatible texture, acoustic space${settings.music ? ', instrumentation, tempo, key and musical phrasing' : ''}; do not restart or replay the sample. Match enabled background layers before applying the suggested vibe. Do not copy speech, lyrics, vocalizations or speaker timbre from Audio 1. Character assets and authored dialogue remain authoritative for voices. Synchronize effects to the current scene, not events in the sample. Respect disabled sound layers and explicit authored changes.`;
}
