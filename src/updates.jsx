import React, {useEffect,useState} from 'react';
import {RefreshCw,ArrowUpRight,ShieldCheck} from 'lucide-react';
import {api} from './state';
import './updates.css';

export function AppUpdates({beforeCheck}) {
  const [info,setInfo]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    let disposed=false, timer;
    async function refresh(){
      try { const value=await api('/updates'); if(!disposed) {setInfo(value);setError('');} }
      catch(e){if(!disposed)setError(e.message);}
      if(!disposed)timer=setTimeout(refresh,2500);
    }
    refresh();return()=>{disposed=true;clearTimeout(timer);};
  },[]);
  async function check(){
    setBusy(true);setError('');
    try {await beforeCheck?.();setInfo(await api('/updates/check',{}));}
    catch(e){setError(e.message);}
    finally{setBusy(false);}
  }
  const checking=busy||['opening','checking'].includes(info?.state);
  return <section className="app-updates" aria-labelledby="app-updates-title">
    <div className="app-updates-heading"><span className="app-updates-icon"><RefreshCw size={20}/></span><div><h3 id="app-updates-title">Splece updates</h3><p>{info?`Version ${info.version} · ${info.platform==='win32'?'Windows':info.platform==='linux'?'Linux':'Mac'} beta`:'Checking your installation…'}</p></div></div>
    <p>Keep your studio up to date. You choose when to install.</p>
    <p className="app-updates-status" role="status" aria-live="polite">{error || info?.message || 'Check for the latest improvements from splece.com.'}</p>
    <div className="app-updates-actions">
      <button className="primary" onClick={check} disabled={!info?.supported||checking}><RefreshCw size={15} className={checking?'app-updates-spin':''}/>{checking?'Checking…':'Check for updates'}</button>
      <a href={info?.platform==='linux'?'https://www.splece.com/beta/linux/':info?.platform==='win32'?'https://www.splece.com/beta/windows/':'https://www.splece.com/beta/'} target="_blank" rel="noreferrer">Downloads <ArrowUpRight size={14}/></a>
    </div>
    <small><ShieldCheck size={14}/> {info?.platform==='linux'?'Install a new .deb to update.':'Updates are verified before installation.'} Your projects and API keys stay on this computer.</small>
    {info?.supported && <p className="app-updates-hint">A Splece window will guide you through downloading and restarting. Finish editing in all tabs before installing. Active jobs must finish first.</p>}
  </section>;
}
