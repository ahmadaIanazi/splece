import React, { useState } from 'react';
import { ArrowLeft, Wind, AudioLines, Music2, Sparkles } from 'lucide-react';
import { videoSoundPlan, videoSoundVibes, videoSoundAvailability, shareVideoSound } from '../shared/video-sound.mjs';
import { soundContinuation, soundContinuationText } from '../shared/video-sound-continuity.mjs';
import './video-sound-composer.css';

export function VideoSoundComposer({project,draft,model,editDraft,update,onBack}) {
  const [notice,setNotice]=useState('');
  const plan=videoSoundPlan(project,draft);
  const availability=videoSoundAvailability(model,draft.settings);
  const continuation=soundContinuation(project,{...draft,soundContinuity:{...draft.soundContinuity,enabled:true}},model,{...plan.settings,enabled:true});
  const continueSound=draft.soundContinuity?.enabled === true;
  const soundPreview=plan.text+(continueSound && continuation.source ? "\n"+soundContinuationText(plan.settings) : "");
  const frozen=draft.sectionOverrides?.['Sound direction'];
  const change=patch=>{setNotice('');editDraft(d=>{d.videoSound={...plan.settings,...patch};if(d.sectionOverrides) delete d.sectionOverrides['Sound direction'];});};
  const layers=[['ambience','Ambience','A steady sense of place',Wind],['effects','Effects','Sounds that follow the action',AudioLines],['music','Music','An instrumental background score',Music2]];
  const detectedVibe=videoSoundVibes.find(v=>v.id===plan.detected.id);
  return <section className="video-sound-composer" aria-label="Sound prompt composer">
    <label className="video-sound-enable"><span>Include sound direction</span><input type="checkbox" role="switch" checked={plan.settings.enabled} onChange={e=>change({enabled:e.target.checked})}/></label>
    {!availability.ready && <div className="video-sound-note" role="status"><p>{availability.reason}</p>{draft.settings.audio===false && (model?.audio || model?.audioConfigurable) && <button type="button" onClick={()=>editDraft(d=>{d.settings.audio=true;})}>Enable video audio</button>}</div>}
    <fieldset disabled={!plan.settings.enabled}><legend>Sound layers</legend><div className="video-sound-layers">{layers.map(([key,name,hint,Icon])=><label key={key} className={plan.settings[key]?'is-on':''}><Icon size={18} aria-hidden="true"/><span><strong>{name}</strong><small>{hint}</small></span><input type="checkbox" checked={plan.settings[key]} onChange={e=>change({[key]:e.target.checked})}/></label>)}</div>
      <label className="video-sound-vibe"><span>Vibe</span><select value={plan.settings.vibe} onChange={e=>change({vibe:e.target.value})}><option value="auto">Auto · {detectedVibe.name}</option>{videoSoundVibes.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <p className="video-sound-detected"><Sparkles size={13} aria-hidden="true"/>{plan.settings.vibe==='auto'?plan.detected.basis:'Your chosen vibe stays fixed.'}</p>
      <label className="video-sound-enable"><span>Continue previous clip sound{continuation.source && <small role="status">{continueSound?'From':'Available:'} {continuation.name} · final {Number(continuation.source.duration.toFixed(1))}s{continuation.pinned?' · saved take':''}</small>}</span><input aria-label="Continue previous clip sound" type="checkbox" checked={continueSound} onChange={e=>editDraft(d=>{d.soundContinuity={enabled:e.target.checked};if(d.sectionOverrides)delete d.sectionOverrides['Sound direction'];})}/></label>
      {!continuation.source && continuation.reason && <p className="video-sound-note" role="status">{continuation.reason}</p>}
      {continueSound && <p className="video-sound-note">Uses the original mixed audio for music and ambience. Voices remain directed by character assets; a seamless match is not guaranteed.</p>}
    </fieldset>
    <p className="video-sound-intro">Sound direction is included in the same video generation.</p>
    <div className="video-sound-continuity"><strong>{plan.inherited && project.settings.videoSound?'Following project sound':'Sound for this clip'}</strong><p>Share this vibe and instrumentation across clips. Each scene keeps its own ambience and action cues.</p>
      <div><button type="button" disabled={!plan.settings.enabled} onClick={()=>{update(p=>{const d=p.drafts.find(d=>d.id===draft.id);if(!d)return;shareVideoSound(p,d);if(d.sectionOverrides)delete d.sectionOverrides['Sound direction'];});setNotice('Project sound applied. Other clips follow it unless they have their own sound choices.');}}>Use across project</button>
      {!plan.inherited && project.settings.videoSound && <button type="button" onClick={()=>editDraft(d=>{delete d.videoSound;if(d.sectionOverrides)delete d.sectionOverrides['Sound direction'];})}>Follow project sound</button>}</div>
    </div>
    <p className="video-sound-note">Character voices come from character assets. These controls leave their voice and exact dialogue intact.</p>
    <details><summary>Sound direction preview</summary>{frozen!==undefined && <p>Saved generation direction is frozen. Changing a sound choice rebuilds it.</p>}<p>{plan.settings.enabled && availability.ready?'Included in the video prompt.':'Saved choices; not currently included in generation.'}</p><pre tabIndex={0}>{frozen!==undefined ? frozen || 'No saved sound injection.' : soundPreview}</pre></details>
    <details><summary>Consistency & audio references</summary><p>Shared prompts help maintain a sound style. They cannot guarantee the exact same melody, recording or voice across separate generations.</p><p>Wan 3.0 References on fal.ai can use up to 10 seconds from the previous generated take as Audio 1 in the same video request. The sample can contain speech; the prompt asks the model to use only music and ambience. Exact, uninterrupted music needs a shared track in the edit.</p><a href="https://fal.ai/models/alibaba/wan-3.0/reference-to-video/api" target="_blank" rel="noreferrer">Wan reference API</a></details>
    {notice && <p role="status">{notice}</p>}
    <button type="button" onClick={onBack}><ArrowLeft size={15} aria-hidden="true"/> Back to scene</button>
  </section>;
}
