import React, { useEffect, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useAIRouting } from "./ai-providers";
import { api } from "./state";
import { providerDefinitions } from "../shared/providers.mjs";
import { ProviderConnection } from "./provider-connection";
import { ConnectionJourney } from "./connection-journey";
import "./connections.css";
export function Connections({onChange=()=>{},onboarding=false,onDone=()=>{},initialProvider,feature="",returnLabel="Back to my work",onBusy=()=>{}}) {
  const contextual=providerDefinitions.some(p=>p.id===initialProvider);
  const [state,setState]=useState(null),[error,setError]=useState(""),[guided,setGuided]=useState(onboarding||contextual);
  async function refresh(){const value=await api('/connections');setState(value);return value;}
  useEffect(()=>{let alive=true;api('/connections').then(v=>{if(alive)setState(v);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
  if(!state) return <section className="connections"><p role={error?'alert':'status'}>{error||'Loading your connections…'}</p>{error&&<button onClick={()=>{setError('');refresh().catch(e=>setError(e.message));}}>Try again</button>}</section>;
  if(guided) return <ConnectionJourney connections={state.connections} onboarding={onboarding} initialProvider={initialProvider} feature={feature} returnLabel={returnLabel} onBusy={onBusy}
    onRefresh={async()=>{const value=await refresh();onChange();return value;}}
    onDone={async(result)=>{if(onboarding||contextual)onDone(result);else{setGuided(false);await refresh();}}}/>;
  return <section className="connections" aria-label="Connections"><div className="connections-intro"><h2>Connections</h2><p>Choose who powers your studio. Your projects stay on this computer.</p></div>
    <button className="setup-guide-button" onClick={()=>setGuided(true)}>Set up with a little guidance <ArrowRight size={15}/></button>
    <SimpleConnectionDefaults connections={state.connections} onRefresh={async()=>{await refresh();onChange();}} onBusy={onBusy}/>
    <p className="connection-local"><ShieldCheck size={16}/>Keys stay on this computer. Requests send the necessary prompts and media to your chosen provider.</p></section>;
}

function SimpleConnectionDefaults({connections,onRefresh,onBusy}) {
 const {state,save}=useAIRouting({preferences:true});
 const [text,setText]=useState('deepseek'),[media,setMedia]=useState('venice'),[error,setError]=useState('');
 useEffect(()=>{if(state){setText(state.routes.text.provider);setMedia(state.routes.video.provider);}},[!!state]);
 async function useDefault(provider,lanes){try{await save(Object.fromEntries(lanes.map(lane=>[lane,{provider,model:'',enabled:false}])));setError('Defaults saved. Turn on a feature in the header when you are ready.');}catch(e){setError(e.message);}}
 return <div className="connection-defaults">

 {[{title:'Writing & assistance',value:text,set:setText,ids:['deepseek','openai','openrouter','venice'],lanes:['text','assistant'],description:'Planning, prompt writing, assistance and supported analysis.'},{title:'Images & video',value:media,set:setMedia,ids:['venice','fal','xai'],lanes:['image','video'],description:'Choose Venice, fal.ai or xAI for images and video. fal.ai also supports optional voices and sound.'}].map(group=><section className="connection-default-group" key={group.title}>
 <header><strong>{group.title}</strong><select aria-label={`${group.title} connection`} value={group.value} onChange={e=>group.set(e.target.value)}>{connections.filter(p=>group.ids.includes(p.id)).map(p=><option key={p.id} value={p.id}>{p.name}{p.ready?' · connected':''}</option>)}</select></header>
 <p>{group.description}</p>
 {connections.filter(p=>p.id===group.value).map(p=><React.Fragment key={p.id}>
 <details className="connection-expand"><summary>{p.ready?'Connected · manage connection':`Connect ${p.name}`}</summary><ProviderConnection compact connection={p} onRefresh={onRefresh} onBusy={onBusy}/></details>
 {p.ready&&<button className="connection-use-default" onClick={()=>useDefault(group.value,group.lanes)}>Use for all {group.title.toLowerCase()}</button>}
 </React.Fragment>)}
 {group.value==='fal'&&connections.some(p=>p.id==='fal'&&p.ready)&&<button className="connection-use-default" onClick={()=>useDefault('fal',['audio'])}>Also use this connection for audio · optional</button>}
 </section>)}
 {error&&<p role="status">{error}</p>}
 <details className="connection-preferences"><summary>Individual providers & overrides</summary><p>Use Connections in the studio header to choose a different provider or model.</p>{connections.map(p=><ProviderConnection compact key={p.id} connection={p} onRefresh={onRefresh} onBusy={onBusy}/>)}</details>
 </div>;
}
