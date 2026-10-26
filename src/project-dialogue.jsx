import {faceChoice} from "../shared/face-assignment.mjs";
import React,{useEffect,useRef,useState} from "react";
import {dialogueScript,dialogueSignature,characterVoice,dialogueVoices} from "../shared/soundtrack-dialogue.mjs";
import {soundSource} from "../shared/soundtrack.mjs";
import {lipSyncInput} from "../shared/lip-sync.mjs";
import {HoldGenerate} from "./composer-tools";
import {uid} from "./state";
export function ProjectDialogue({project,sound,testMode,update,onSelectClip,clipIds}) {
  const [step,setStep]=useState(0),[quote,setQuote]=useState(null),[lipQuotes,setLipQuotes]=useState([]),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const ref=useRef(sound);ref.current=sound;
  const all=project.clips.filter(c=>(!clipIds||clipIds.includes(c.id))&&soundSource(c)&&dialogueScript(project,c).length).sort((a,b)=>a.start-b.start);
  const clips=all.filter(c=>c.duration>=2&&c.duration<=30);
  const excluded=all.filter(c=>!clips.includes(c));
  const speakers=[...new Set(clips.flatMap(c=>dialogueScript(project,c).map(l=>l.speaker)))].map(id=>project.assets.find(a=>a.id===id)).filter(Boolean);
  const voiceFor=c=>[...(project.audioClips||[])].reverse().find(a=>a.soundtrack?.role==="dialogue"&&a.soundtrack.sources?.some(s=>s.clipId===c.id)&&a.soundtrack.scriptSignature===dialogueSignature(project,c));
  const missing=clips.filter(c=>!voiceFor(c));
  const options={roles:["dialogue"],clipIds:missing.map(c=>c.id),reviewDialogue:true};
  const key=JSON.stringify([project.id,project.episodeId,clips.map(c=>[c.id,c.activeTake,dialogueSignature(project,c),voiceFor(c)?.id]),testMode,step,project.production?.faceAssignments]);
  useEffect(()=>{
    let gone=false;setQuote(null);setLipQuotes([]);setError("");
    const timer=setTimeout(async()=>{
      try{
        if(step===1&&missing.length){const q=await ref.current.estimate(options);if(!gone)setQuote(q);}
        if(step===2){
          const results=[];
          for(const clip of clips) {
            const audio=voiceFor(clip),take=clip.takes.find(t=>t.id===clip.activeTake);
            if(take?.lipSync?.audioId===audio?.id) continue;
            try{
              if(dialogueScript(project,clip).some((_,i)=>!faceChoice(project,clip,i))) throw Error("Choose who speaks in this clip before matching lips.");
              lipSyncInput(project,clip.id,audio?.id);
              const q=await ref.current.lip.request("/estimate",{clipId:clip.id,audioId:audio.id});
              results.push({clipId:clip.id,audioId:audio.id,quote:q});
            }catch(e){results.push({clipId:clip.id,error:e.message});}
          }
          if(!gone)setLipQuotes(results);
        }
      }catch(e){if(!gone)setError(e.message);}
    },350);return()=>{gone=true;clearTimeout(timer);};
  },[key]);
  const ready=lipQuotes.filter(q=>q.quote);
  const active=sound.runs.some(r=>["queued","processing"].includes(r.state)&&r.units.some(u=>u.role==="dialogue"))||sound.lip.jobs.some(j=>["queued","processing","submitting","downloading"].includes(j.state));
  async function generate(){
    if(busy||active)return;setBusy(true);setError("");
    try{
      if(step===1){if(!quote||quote.mode!==(testMode?"test":"live"))return;await sound.create({...options,quoteId:quote.quoteId,executionMode:quote.mode});setQuote(null);}
      else for(const item of ready) {
        if(item.quote.mode!==(testMode?"test":"live"))throw Error("Mode changed. Review a fresh estimate.");
        await sound.lip.request("",{clipId:item.clipId,audioId:item.audioId,quoteId:item.quote.id,requestId:uid()});
      }
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <section className="dialogue-script" aria-label="Project dialogue">
    <nav className="dialogue-steps">{["1 · Voices","2 · Create speech","3 · Match lips"].map((label,i)=><button key={label} aria-pressed={step===i} onClick={()=>setStep(i)}>{label}</button>)}</nav>
    <small>{clips.length} speaking clips · {clips.length-missing.length} voices ready</small>
    {!!excluded.length&&<p role="status">{excluded.length} clip outside the 2–30 second dialogue range. <button onClick={()=>onSelectClip?.(excluded[0].id)}>Review timing</button></p>}
    {step===0&&<>{speakers.map(a=><label key={a.id}>{a.name}<select aria-label={a.name+" project voice"} value={characterVoice(project,a)} onChange={e=>{const voice=e.target.value;update(p=>{p.production??={};p.production.voiceAssignments??={};p.production.voiceAssignments[a.id]=voice;});}} disabled={active}>{dialogueVoices.map(v=><option key={v}>{v}</option>)}</select></label>)}<button onClick={()=>setStep(1)}>Continue to speech</button></>}
    {step===1&&<>{!missing.length?<button onClick={()=>setStep(2)}>Continue to matching lips</button>:<HoldGenerate enabled={!testMode} label="project voices" busy={busy||active} disabled={!quote||busy||active} requestKey={quote?.quoteId} price={quote?`≈ $${quote.estimate.amount.toFixed(3)}`:""} onGenerate={generate}/>}<small>Your exact dialogue stays unchanged. Voices wait muted until their picture is matched.</small></>}
    {step===2&&<>{lipQuotes.filter(q=>q.error).map(q=><p key={q.clipId}><button onClick={()=>onSelectClip?.(q.clipId)}>Set up this clip</button> {q.error}</p>)}{!!ready.length&&<HoldGenerate enabled={!testMode} label={"match "+ready.length+" clips"} busy={busy||active} disabled={busy||active} requestKey={ready.map(q=>q.quote.id).join()} price={`≈ $${ready.reduce((sum,q)=>sum+q.quote.amount,0).toFixed(3)}`} onGenerate={generate}/>}<small>Original takes remain available. Compare each completed take below before applying.</small></>}
    {active&&<p role="status">Creating dialogue · progress is shown on the timeline.</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
