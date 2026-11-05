import React, {useEffect,useRef,useState} from 'react';
import {ProviderAction} from './provider-connect';
import {ArrowRight,Sparkles,LoaderCircle} from 'lucide-react';
import {api} from './state';
import {HoldGenerate} from './composer-tools';
import {imageBridgeWriting} from '../shared/image-story.mjs';
import './photo-story.css';
export function PhotoStory({project,before,after,onCreate,flush}) {
  const photos=[before,after].filter(Boolean);
  const [writing,setWriting]=useState(imageBridgeWriting()),[quote,setQuote]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null);
  const lock=useRef(false),alive=useRef(true),writingRevision=useRef(0);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{let cancelled=false;api(`/projects/${project.id}/photos`).then(rows=>{
    const previous=rows.find(j=>j.state==='ready'&&JSON.stringify(j.mediaIds)===JSON.stringify(photos.map(p=>p.id)));
    if(!cancelled&&previous){setResult(previous);if(!writingRevision.current)setWriting(previous.result.writing);}
  }).catch(()=>{});return()=>{cancelled=true;};},[project.id,before.id,after?.id]);
  async function review(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await flush();const q=await api(`/projects/${project.id}/photos/quote`,{mediaIds:photos.map(p=>p.id)});if(alive.current)setQuote(q);}catch(e){if(alive.current)setError(e.message);}finally{lock.current=false;if(alive.current)setBusy(false);}}
  async function analyze(){if(lock.current||!quote)return;const revision=writingRevision.current;lock.current=true;setBusy(true);setError('');try{const j=await api(`/projects/${project.id}/photos/analyze`,{quoteId:quote.id},undefined,{timeoutMs:240000});if(j.state!=='ready')throw Error(j.error || 'Analysis is still running.');if(alive.current){setResult(j);if(revision===writingRevision.current)setWriting(j.result.writing);setQuote(null);}}catch(e){if(alive.current){setError(e.message);setQuote(null);}}finally{lock.current=false;if(alive.current)setBusy(false);}}
  return <section className="photo-story"><div className="photo-story-pair">{photos.map((p,i)=><React.Fragment key={p.id}>{i>0&&<ArrowRight size={20}/>}<figure><img src={`/api/media/${p.id}/original`} alt={i?'Closing photo':'Opening photo'}/><figcaption>{i?'End':'Start'}</figcaption></figure></React.Fragment>)}</div>
    <div className="photo-story-action"><ProviderAction lane="text" provider="deepseek" feature="photo analysis" returnLabel="Back to my photos">{quote?<><small>{quote.executionMode==='live'?'Selected vision model · token-priced, final cost varies':'Offline mode · local sample, $0'}</small><HoldGenerate enabled disabled={busy} busy={busy} price={quote.executionMode==='live'?'Token-priced':'$0 · Offline'} requestKey={quote.id} label="Analyze photos" onGenerate={analyze}/></>:<button type="button" disabled={busy} onClick={review}>{busy?<LoaderCircle size={15}/>:<Sparkles size={15}/>}Understand these photos</button>}</ProviderAction></div>
    {result?.executionMode!=='live'&&result&&<small>Offline sample — photos were not sent to AI.</small>}
    {result?.result?.photos && <details><summary>What the images show</summary>{result.result.photos.map((p,i)=><p key={i}>{p.description}</p>)}</details>}
    <label>Connecting action<textarea aria-label="Connecting action" rows={5} value={writing} onChange={e=>{writingRevision.current++;setWriting(e.target.value);}}/></label>
    {result?.result?.writing && result.result.writing!==writing && <button type="button" onClick={()=>{writingRevision.current++;setWriting(result.result.writing);}}>Use suggested action</button>}
    {error&&<p role="alert">{error}</p>}
    <button type="button" className="primary" disabled={busy||!writing.trim()} onClick={()=>onCreate(writing)}><ArrowRight size={15}/>Create connecting clip</button>
  </section>;
}
