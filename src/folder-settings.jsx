import React, {useEffect, useState} from "react";
import {FolderOpen, Folder, RotateCcw} from "lucide-react";
import {api} from "./state";
import "./folder-settings.css";

export function FolderSettings({project}) {
  const [locations,setLocations]=useState(null), [draft,setDraft]=useState(""), [busy,setBusy]=useState(false), [message,setMessage]=useState(""), [error,setError]=useState("");
  const projectId=project?.id;
  useEffect(()=>{
    let active=true;
    api("/studio/folders"+(projectId?"?projectId="+encodeURIComponent(projectId):""))
      .then(value=>{if(active){setLocations(value);setDraft(value.projectsRoot);}})
      .catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[projectId]);
  async function run(action) {
    setBusy(true);setError("");setMessage("");
    try {await action();} catch(e){setError(e.message);} finally {setBusy(false);}
  }
  const open=target=>run(()=>api("/studio/folders/reveal",{target,projectId}));
  const save=value=>run(async()=>{
    const result=await api("/studio/folders",{projectsRoot:value},"PUT");
    setLocations(old=>({...old,...result}));setDraft(result.projectsRoot);setMessage("New project location saved.");
  });
  return <div className="folder-settings">
    <header><Folder size={22}/><div><h3>Folders</h3><p>Your files, where you want them.</p></div></header>
    {error&&<p role="alert" className="folder-error">{error}</p>}
    {!locations ? <p role="status">{error?"Folders could not be loaded. Reopen this tab to try again.":"Loading folders…"}</p> : <>
      <section className="folder-card">
        <label htmlFor="projects-location"><strong>New projects</strong></label>
        <p>Each project gets its own folder with its media and exports.</p>
        <div className="folder-input"><input id="projects-location" value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} spellCheck={false}/><button disabled={busy} onClick={()=>run(async()=>setDraft((await api("/folder",{initial:draft})).path))}><FolderOpen size={16}/> Browse</button></div>
        <div className="folder-actions"><button className="primary" disabled={busy||!draft.trim()||(draft===locations.projectsRoot&&!locations.warning)} onClick={()=>save(draft)}>Save location</button><button disabled={busy} onClick={()=>open("projectsRoot")}>Open folder</button>
        {locations.projectsRoot!==locations.defaultProjectsRoot&&<button title="Restore default project location" disabled={busy} onClick={()=>save(locations.defaultProjectsRoot)}><RotateCcw size={14}/> Reset</button>}</div>
        <small>Applies to new projects. Existing projects stay where they are.</small>
      </section>
      {locations.warning&&<p role="alert">{locations.warning}</p>}
      {locations.project&&<section className="folder-card"><strong>This project</strong><div className="folder-path">{locations.project}</div><div className="folder-actions"><button disabled={busy} onClick={()=>open("project")}><FolderOpen size={16}/> Open folder</button><button disabled={busy} onClick={()=>open("media")}>Media</button><button disabled={busy} onClick={()=>open("exports")}>Exports</button></div></section>}
      <details className="folder-card"><summary>Shared library & app storage</summary><p>Managed by Splece, shared across your projects.</p>{[["library","Shared library"],["appData","App storage"]].map(([key,label])=><div className="folder-storage" key={key}><div><strong>{label}</strong><div className="folder-path">{locations[key]}</div></div><button disabled={busy} aria-label={"Open "+label.toLowerCase()} onClick={()=>open(key)}><FolderOpen size={16}/></button></div>)}</details>
      <p role="status" className="folder-status">{busy?"Working…":message}</p>
    </>}
  </div>;
}
