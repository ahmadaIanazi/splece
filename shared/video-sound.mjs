import { composerEvents } from './composer-sequence.mjs';

// Native video-audio direction only. No separate soundtrack generation jobs.
export const VIDEO_SOUND_VERSION = '2026-10-26.1';
export const videoSoundVibes = [
  {id:'natural', name:'Natural', text:'Restrained, realistic acoustic texture; natural dynamics and spatial depth.', music:'A sparse instrumental bed with soft sustained tones, no strong beat.'},
  {id:'calm', name:'Calm', text:'Quiet, spacious and unhurried; soft attacks and gentle dynamics.', music:'Warm sustained pads and sparse soft piano, slow unhurried pulse.'},
  {id:'tense', name:'Tense', text:'Restrained suspense, close detail and controlled low-frequency weight; avoid surprise stingers.', music:'A low sustained drone and sparse muted pulses, minimal harmony.'},
  {id:'warm', name:'Warm', text:'Intimate, rounded and gentle; clear near-field detail with a soft background.', music:'Soft acoustic plucks and warm keys, a restrained steady pulse.'},
  {id:'playful', name:'Playful', text:'Light, nimble and buoyant, with small clean accents; no cartoon effects unless authored.', music:'Light mallet tones and soft plucked strings, a gentle buoyant pulse.'},
  {id:'energetic', name:'Energetic', text:'Lively and crisp, with controlled peaks; preserve clarity and authored event timing.', music:'A steady restrained percussion pulse and warm bass with short instrumental accents.'},
  {id:'somber', name:'Somber', text:'Subdued and reflective, with sparse detail and gentle decay.', music:'Sparse low piano and soft sustained strings, slow restrained phrasing.'},
];
export const videoSoundDefaults = Object.freeze({enabled:false,ambience:true,effects:true,music:false,vibe:'auto'});
export function normalizeVideoSound(value) {
  if(!value || typeof value!=='object' || Array.isArray(value)) return {};
  const result={};
  for(const key of ['enabled','ambience','effects','music']) if(typeof value[key]==='boolean') result[key]=value[key];
  if(value.vibe==='auto' || videoSoundVibes.some(v=>v.id===value.vibe)) result.vibe=value.vibe;
  return result;
}
export function effectiveVideoSound(project,draft) {
  return {...videoSoundDefaults,...normalizeVideoSound(project.settings?.videoSound),...normalizeVideoSound(draft.videoSound)};
}
// Do not interpret dialogue, negatives or quoted material as sound evidence.
function positiveText(text) {
  return String(text || '').replace(/(?:Negative\s*:|\[Negative\])[^]*$/im,'').replace(/[“"]([^“”"\n]+)[”"]/g,'')
    .split(/[.!?\n؛؟]+/).filter(s=>!/(?:\b(?:no|not|without|never|silent|silently|says|speaks|whispers)\b|(?:^|\s)(?:لا|ليس|بدون|صامت)(?:\s|$))/i.test(s)).join('. ');
}
function sceneSource(project,scene) {
  const location=project.assets?.find(a=>a.id===scene.locationId && a.kind==='location');
  return positiveText([scene.text,...composerEvents(scene).filter(e=>e.kind!=='speak').map(e=>e.text),location?.name,location?.description].filter(Boolean).join('\n'));
}
export function detectVideoSoundVibe(project,draft) {
  const text=(draft.scenes || []).map(s=>sceneSource(project,s)).join('\n');
  const patterns=[['tense',/\b(?:tense|suspense|afraid|fearful|anxious|threat|frightened)\b|توتر|خائف|قلق/i],['somber',/\b(?:sad|grief|mourning|melancholy|sorrow)\b|حزين|حزن/i],['playful',/\b(?:playful|playfully|giggles|joyful)\b|مرح|بمرح/i],['energetic',/\b(?:energetic|racing|chase|celebration)\b|مطاردة|حماس/i],['warm',/\b(?:cozy|tender|affection|embrace|reunion)\b|حنان|عناق/i],['calm',/\b(?:calm|peaceful|serene|meditation|tranquil)\b|هادئ|هدوء/i]];
  const match=patterns.find(([,p])=>p.test(text));
  return {id:match?.[0] || 'natural',basis:match?'Suggested from your scene writing':'Neutral fallback; no clear mood in the scene'};
}
const ambienceRules=[
  [/\b(?:rain|rainfall|raining)\b|مطر/i,'A steady rain bed at the described distance'],
  [/\b(?:ocean|surf|seaside|beach)\b|شاطئ|أمواج/i,'A low steady surf bed'],
  [/\b(?:wind|breeze)\b|رياح|نسيم/i,'Soft air movement at the described intensity'],
  [/\b(?:street|traffic|city)\b|شارع|مدينة/i,'A restrained distant urban bed, without intelligible background voices'],
  [/\b(?:room|interior|office|hallway|kitchen)\b|غرفة|مكتب|مطبخ/i,'Quiet room tone with the space’s natural acoustic depth'],
];
const effectRules=[
  [/\b(?:walks?|walking|runs?|running|footsteps?)\b|يمشي|يركض|خطوات/i,'Footfalls matched to the described surface and visible contacts'],
  [/\b(?:opens?|closes?|shuts?)\b[^.\n]{0,35}\b(?:door|gate)\b|(?:يفتح|يغلق)\s+الباب/i,'Door movement and contact synchronized to the authored action'],
  [/\b(?:places?|sets?|puts?|drops?)\b[^.\n]{0,35}\b(?:cup|glass|bottle|object)\b/i,'Object contact using the described material, only at the visible contact'],
  [/\b(?:splashes?|pouring|pours?)\b|يسكب/i,'Liquid movement aligned to the described action'],
  [/\b(?:typing|types)\b/i,'Light key taps synchronized with the fingers'],
];
export function videoSoundPlan(project,draft) {
  const settings=effectiveVideoSound(project,draft), detected=detectVideoSoundVibe(project,draft);
  const vibe=videoSoundVibes.find(v=>v.id===(settings.vibe==='auto'?detected.id:settings.vibe));
  const scenes=(draft.scenes || []).map((scene,i)=>{
    const text=sceneSource(project,scene);
    return {scene:i+1,ambience:ambienceRules.filter(([re])=>re.test(text)).map(([,cue])=>cue),effects:effectRules.filter(([re])=>re.test(text)).map(([,cue])=>cue)};
  });
  const lines=[
    'Native sound direction for this video. Preserve exact dialogue, authored sound requests and event timing; do not invent actions, speakers or cuts to create sounds. These are background defaults; explicit authored sound instructions take precedence.',
    `Sound character: ${vibe.text}`,
    settings.ambience?'Ambience: a continuous, low background bed justified by the described location and weather; keep perspective and acoustic space stable. Do not add unmentioned crowds, animals or weather.':'Ambience: no added ambient bed.',
    settings.effects?'Effects: synchronize each sound with its visible cause, material, distance and intensity. Use only authored events; no decorative whooshes or dramatic impacts.':'Effects: no added sound effects.',
    settings.music?`BGM: instrumental only unless singing is explicitly authored. ${vibe.music} Retain this instrumentation, pulse and tonal character throughout; avoid an opening fanfare, new motif or ending sting. Do not change character voices to match the score.`:'BGM: no background music.',
    'Mix: keep authored voices intelligible and foregrounded; ambience and music remain below speech. Preserve the saved character voice identity and exact performance instructions. Do not add narration, lyrics, humming or extra vocalizations.',
  ];
  for(const scene of scenes) {
    if(settings.ambience && scene.ambience.length) lines.push(`Scene ${scene.scene} ambience cues, only where described: ${scene.ambience.join('; ')}.`);
    if(settings.effects && scene.effects.length) lines.push(`Scene ${scene.scene} effects cues, only when the authored event occurs: ${scene.effects.join('; ')}.`);
  }
  return {version:VIDEO_SOUND_VERSION,settings,vibe:vibe.id,detected,scenes,text:lines.join('\n'),inherited:!Object.keys(normalizeVideoSound(draft.videoSound)).length};
}
export function videoSoundAvailability(model,settings={}) {
  if(!model?.audio && !model?.audioConfigurable) return {ready:false,reason:'This video model does not advertise native audio. Your sound direction is saved for an audio-capable model.'};
  if(settings.audio===false) return {ready:false,reason:'Generated video audio is off. Enable it to include sound direction.'};
  return {ready:true,reason:''};
}
export function videoSoundSection(project,draft,model) {
  if(!videoSoundAvailability(model,draft.settings).ready || draft.sectionOverrides?.['Sound direction']==='') return null;
  const plan=videoSoundPlan(project,draft);
  if(!plan.settings.enabled && draft.sectionOverrides?.['Sound direction']===undefined) return null;
  return {label:'Sound direction',source:'Native video audio · saved sound choices and scene cues',text:plan.text};
}
// Sharing pins the currently resolved vibe so other clips don't redetect a different
// soundtrack identity. Local overrides remain explicit and are never overwritten.
export function shareVideoSound(project,draft) {
  const plan=videoSoundPlan(project,draft);
  project.settings.videoSound={...plan.settings,vibe:plan.vibe};
  delete draft.videoSound;
}

export function preserveVideoSoundSection(draft,compiled) {
  const section=compiled?.sections?.find(s=>s.label==='Sound direction');
  if(section) { draft.sectionOverrides ??= {}; draft.sectionOverrides['Sound direction']=section.text; }
  if(compiled?.soundReference) draft.soundContinuity={enabled:true,source:structuredClone(compiled.soundReference)};
}
