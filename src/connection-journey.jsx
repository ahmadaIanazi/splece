import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ExternalLink, Film, MessageSquare, AudioLines, ShieldCheck, Cable, HardDrive } from 'lucide-react';
import { api } from './state';
import { useAIRouting } from './ai-providers';
import { ProviderConnection } from './provider-connection';
import { providerDefinitions } from '../shared/providers.mjs';
import { connectionGoals, providerGuides, connectionQueue, connectionRoutePatch } from '../shared/connection-guide.mjs';
import './connection-journey.css';
const names=Object.fromEntries(providerDefinitions.map(p=>[p.id,p.name]));
const icons={writing:MessageSquare,visuals:Film,sound:AudioLines};
const storageKey='splece-connection-journey-v2';
function remembered(){try { const v=JSON.parse(localStorage.getItem(storageKey));return v?.version===2 && Array.isArray(v.goals) && Number.isInteger(v.stage) && Number.isInteger(v.index) && v.index >= 0 ? v : null; }catch{} return null;}
const defaults={writing:'deepseek',visuals:'venice',sound:'fal'};
export function ConnectionJourney({connections,onRefresh,onDone,onboarding,initialProvider,feature,returnLabel,onBusy}) {
  const contextual=!!providerGuides[initialProvider];
  const [saved]=useState(()=>contextual?null:remembered());
  const [stage,setStage]=useState(contextual?2:Math.min(3,Math.max(0,saved?.stage||0))),
    [goals,setGoals]=useState(saved?.goals?.filter(id=>connectionGoals.some(g=>g.id===id))||['writing','visuals']),
    [choices,setChoices]=useState({...defaults,...saved?.choices}),[index,setIndex]=useState(saved?.index||0),
    [busy,setBusy]=useState(false),[error,setError]=useState('');
  const {state:catalog,error:catalogError,save,setOnline}=useAIRouting({preferences:true});
  const heading=useRef(null), completing=useRef(false);
  const queue=contextual?[{provider:initialProvider,lanes:[]}]:connectionQueue(goals,choices);
  const current=queue[Math.min(index,Math.max(0,queue.length-1))];
  const provider=connections.find(p=>p.id===current?.provider);
  const patch=catalog?connectionRoutePatch(queue,catalog,connections):{};
  useEffect(()=>{heading.current?.focus();},[stage,index]);
  useEffect(()=>{if(contextual)return;try{localStorage.setItem(storageKey,JSON.stringify({version:2,stage,goals,choices,index}));}catch{}},[stage,goals,choices,index,contextual]);
  function working(value){setBusy(value);onBusy?.(value);}
  async function finish(local=false) {
    if(completing.current)return;
    completing.current=true;working(true);setError('');
    try {
      if(contextual){onDone({});return;}
      if(!local && Object.keys(patch).length){
        await save(patch);
        if(patch.assistant?.enabled)await api('/composer-assistant',{enabled:true},'PUT');
        await setOnline(true);
      } else if(onboarding) await setOnline(false);
      await api('/onboarding',{skipped:local},'PUT');
      try{localStorage.removeItem(storageKey);}catch{}
      onDone({create:onboarding});
    } catch(e){setError(e.message);}finally{completing.current=false;working(false);}
  }
  const titles=['Make yourself at home.','A few good connections.','Let’s get you connected.','Ready for your next idea.'];
  function nextProvider(){setError('');if(contextual){finish();return;}if(index<queue.length-1)setIndex(index+1);else setStage(3);}
  return <section className="connections connection-journey" aria-label={contextual?'Provider setup guide':'Welcome to Splece'}>
    <header className="journey-brand"><span><img src="/splece.svg" alt=""/> Splece</span><button disabled={busy} onClick={()=>contextual?onDone({}):finish(true)}>{contextual?returnLabel:'Explore without connecting'}</button></header>
    {!contextual&&<ol className="journey-progress" aria-label="Setup progress">{['Start','Providers','Connect','Ready'].map((label,i)=><li key={label} aria-current={stage===i?'step':undefined} data-done={stage>i}><span>{stage>i?<Check size={13}/>:i+1}</span>{label}</li>)}</ol>}
    <div className="journey-intro"><p className="setup-eyebrow">{contextual?feature||'PICK UP WHERE YOU LEFT OFF':stage===2?`CONNECTION ${Math.min(index+1,queue.length)} OF ${queue.length}`:'YOUR STUDIO, YOUR WAY'}</p><h2 ref={heading} tabIndex={-1}>{contextual?`Connect ${names[initialProvider]}`:titles[stage]}</h2>
      <p>{contextual?'Your project stays right here. We’ll bring you back when you’re done.':[
        'What would you like a hand with? Pick any, or start with your own footage.',
        'Choose one provider for each part of your workflow. You can change these later.',
        'One account, one key. We’ll walk through it together.',
        Object.keys(patch).length ? 'Your connections are saved. Nothing generates until you choose to use it.' : 'You’re ready to edit locally. Add connections whenever you like.'
      ][stage]}</p></div>
    {(error||catalogError)&&<p className="connection-message" role="alert">{error||catalogError}</p>}
    <div className="journey-content" key={`${stage}-${index}`}>
    {stage===0&&<><div className="journey-goals">{connectionGoals.map(g=>{const Icon=icons[g.id],selected=goals.includes(g.id);return <button key={g.id} aria-pressed={selected} className="journey-goal" onClick={()=>setGoals(selected?goals.filter(id=>id!==g.id):[...goals,g.id])}><Icon size={26}/><span><strong>{g.name}</strong><small>{g.description}</small></span><span className="journey-selection">{selected&&<Check size={15}/>}</span></button>;})}</div><div className="journey-local"><HardDrive size={20}/><p><strong>Your footage is welcome here.</strong><br/>Import, edit and export locally. Connections are optional; providers charge separately for generation.</p></div></>}
    {stage===1&&<div className="journey-provider-groups">{connectionGoals.filter(g=>goals.includes(g.id)).map(g=><section key={g.id}><h3>{g.name}</h3><div className="journey-provider-options">{g.providers.map(id=><button key={id} aria-pressed={choices[g.id]===id} onClick={()=>setChoices({...choices,[g.id]:id})}><span><strong>{names[id]}</strong><small>{providerGuides[id].summary}</small></span>{connections.find(c=>c.id===id)?.ready?<span className="journey-connected"><Check size={14}/>Connected</span>:choices[g.id]===id?<Check size={17}/>:null}</button>)}</div></section>)}<p className="journey-footnote">Already have an account? Use it here. You only need to connect each provider once.</p></div>}
    {stage===2&&provider&&<ProviderWalkthrough key={provider.id} provider={provider} onRefresh={onRefresh} onBusy={working} busy={busy} onContinue={nextProvider}/>}
    {stage===3&&<><div className="journey-review">{queue.map(entry=>{const p=connections.find(c=>c.id===entry.provider),enabled=entry.lanes.filter(l=>patch[l]);return <div key={entry.provider}><Cable size={20}/><span><strong>{p?.name}</strong><small>{enabled.length?`${enabled.map(l=>({text:'Writing',assistant:'Assistance',image:'Images',video:'Video',audio:'Sound'})[l]).join(' · ')} ready to use`:p?.ready?'Connected · choose a supported model in Connections':'Not connected · you can add it later'}</small></span><button onClick={()=>{setIndex(queue.indexOf(entry));setStage(2);}}>{p?.ready?'Review':'Connect'}</button></div>;})}</div><div className="journey-local"><ShieldCheck size={20}/><p><strong>You set the pace.</strong><br/>Connections → Online pauses new provider requests in one click. Your enabled features and model choices stay saved.</p></div>
      {catalog&&Object.keys(patch).length>0&&<details className="journey-models"><summary>Starting models</summary>{Object.entries(patch).map(([lane,r])=><p key={lane}><strong>{{text:'Writing',assistant:'Assistance',image:'Images',video:'Video',audio:'Sound'}[lane]}</strong><span>{catalog.models[lane].find(m=>m.id===r.model&&m.provider===r.provider)?.name||r.model||'Current default'}</span></p>)}<p>Change any of these from Connections in the studio.</p></details>}</>}
    </div>
    {!contextual&&<footer className="journey-footer"><button disabled={busy||stage===0} onClick={()=>{setError('');if(stage===2&&index>0)setIndex(index-1);else setStage(Math.max(0,stage-1));}}><ArrowLeft size={16}/>Back</button>
      {stage===0?<button className="primary" onClick={()=>goals.length?setStage(1):finish(true)}>{goals.length?'Find my connections':'Start locally'}<ArrowRight size={16}/></button>:
       stage===1?<button className="primary" disabled={!queue.length} onClick={()=>{setIndex(0);setStage(2);}}>Continue<ArrowRight size={16}/></button>:
       stage===2?<button disabled={busy} onClick={nextProvider}>Skip for now<ArrowRight size={16}/></button>:
       <button className="primary" disabled={busy||!catalog} onClick={()=>finish(!Object.keys(patch).length)}>{busy?'Getting ready…':Object.keys(patch).length?'Start creating online':'Start locally'}<ArrowRight size={16}/></button>}
    </footer>}
    <p className="journey-privacy"><ShieldCheck size={15}/>Your key stays on this computer. Provider requests send the prompts and media needed for the task.</p>
  </section>;
}
function ProviderWalkthrough({provider:p,onRefresh,onBusy,busy,onContinue}) {
  const [step,setStep]=useState(p.ready?2:0), [showImage,setShowImage]=useState(false);
  const stepHeading=useRef(null);
  useEffect(()=>{stepHeading.current?.focus();},[step]);
  const guide=providerGuides[p.id], screenshot=['venice','openai'].includes(p.id)?`/connection-guides/${p.id}.png`:null;
  return <div className="provider-walkthrough"><header><span className="journey-provider-name">{p.name}</span><span className="journey-connected">{p.ready?<><Check size={15}/>Connected</>:'Connect once'}</span></header>
    <nav className="provider-steps" aria-label={`${p.name} setup steps`}>{['Account','Credits','Connect'].map((label,i)=><button key={label} disabled={busy} aria-current={step===i?'step':undefined} onClick={()=>setStep(i)}><span>{i+1}</span>{label}</button>)}</nav>
    <div className="provider-instruction" hidden={step===2}><h3 ref={step!==2?stepHeading:undefined} tabIndex={-1}>{step===0?'Open your account.':'Give your ideas a starting balance.'}</h3><p>{step===0?guide.accountText:guide.creditText}</p>
      <a className="journey-external" href={step===0?guide.account:guide.credits} target="_blank" rel="noreferrer">{step===0?`Open ${p.name}`:'Open billing & credits'}<ExternalLink size={16}/></a>
      <p className="journey-footnote">Opens in another tab. Come back here when you’re ready.</p>
      <div className="provider-step-actions"><button className="primary" onClick={()=>setStep(step+1)}>{step===0?'I’m signed in':'Continue to my key'}<ArrowRight size={15}/></button>{step===0&&<button onClick={()=>setStep(2)}>I already have a key</button>}{step===1&&<button onClick={()=>setStep(2)}>Add credits later</button>}</div>
    </div>
    <div hidden={step!==2} className="provider-key-step"><h3 ref={step===2?stepHeading:undefined} tabIndex={-1}>{p.ready?'You’re connected.':'Bring your key back here.'}</h3><p>{p.ready?'Your saved key is verified. You can continue, or replace it below.':guide.keyText}</p>
      <a href={p.keyUrl} target="_blank" rel="noreferrer">{p.ready?'Manage':'Create'} {p.name} key<ExternalLink size={15}/></a>
      <ProviderConnection connection={p} onRefresh={onRefresh} onBusy={onBusy} compact hideGuide/>
      {p.ready&&<button className="primary provider-continue" disabled={busy} onClick={onContinue}>Continue<ArrowRight size={16}/></button>}
    </div>
    <details className="provider-visual-guide"><summary>Need a visual guide?</summary><p>Follow the provider’s own instructions. Screens can change; the official guide has the latest steps.</p>
      {screenshot&&<><button onClick={()=>setShowImage(!showImage)} aria-expanded={showImage}>{showImage?'Hide screenshot':'See official guide screenshot'}</button>{showImage&&<figure><a href={screenshot} target="_blank" rel="noreferrer"><img src={screenshot} alt={`${p.name} official documentation showing ${p.id==='openai'?'API billing':'API key setup'} steps`} loading="lazy"/></a><figcaption>Official documentation · captured 27 October 2026 · click to enlarge</figcaption></figure>}</>}
      <a href={step===1?guide.billingDocs:guide.docs} target="_blank" rel="noreferrer">Open official {step===1?'billing':'setup'} guide<ExternalLink size={15}/></a>
    </details>
  </div>;
}
