import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const states=new Set(['idle','checking','available','current','downloading','ready','installing','error','cancelled']);

export async function createUpdateService({root,data,platform=process.platform,executable=process.execPath,run=exec}) {
  const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json')));
  const bundle=platform==='win32'?path.dirname(root):path.resolve(root,'../../..');
  const config=await fs.readFile(path.join(root,'desktop-update.json'),'utf8').then(JSON.parse).catch(()=>null);
  const real=file=>fs.realpath(file).catch(()=>null);
  const runtime=await real(platform==='win32'?path.join(bundle,'runtime/node.exe'):path.join(bundle,'Contents/Resources/runtime/node'));
  const supported=((platform==='darwin'&&config?.engine==='sparkle'&&path.basename(bundle)==='Splece.app')||(platform==='win32'&&config?.engine==='velopack'&&Boolean(await real(path.join(bundle,'Splece.exe')))))&&runtime!==null&&runtime===await real(executable);
  let opening=false, requestedAt=0;
  async function status() {
    const state=await fs.readFile(path.join(data,'launcher/update-state.json'),'utf8').then(JSON.parse).catch(()=>null);
    let alive=false;
    if(Number.isInteger(state?.pid) && state.pid>0) try { process.kill(state.pid,0); alive=true; } catch {}
    const valid=supported && alive && state?.root===root && state?.version===pkg.version && states.has(state?.state) && Number.isFinite(state?.updatedAt) && state.updatedAt>=requestedAt;
    return {supported,version:pkg.version,platform,channel:'beta',state:valid?state.state:requestedAt && Date.now()-requestedAt>30000?'error':requestedAt?'opening':'idle',
      latestVersion:valid && typeof state.latestVersion==='string'?state.latestVersion.slice(0,40):null,
      checkedAt:valid?state.checkedAt||null:null,
      message:!supported?'In-app updates are available in the installed desktop app.':valid?String(state.message||'').slice(0,500):requestedAt && Date.now()-requestedAt>30000?'The update window did not respond. Open Splece from your computer and try again.':requestedAt?'Opening the Splece update window…':''};
  }
  async function check() {
    if(!supported) throw Object.assign(Error('Open the installed desktop app to check for updates.'),{status:409});
    if(opening) return status();
    opening=true;
    try {
      requestedAt=Date.now();
      // A fixed application path and fixed action; no shell, caller URLs or feed overrides.
      if(platform==='win32')await new Promise((resolve,reject)=>{
        const child=spawn(path.join(bundle,'Splece.exe'),['--update'],{detached:true,stdio:'ignore',windowsHide:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
      });else await run('/usr/bin/open',['-a',bundle,'splece://updates'],{timeout:15000});
      return status();
    } catch(error) { requestedAt=0; throw Error('Could not open Splece’s update window. Open Splece from your computer and try again.'); }
    finally { opening=false; }
  }
  return {status,check};
}
export async function installUpdateRoutes(app,options) {
  const service=await createUpdateService(options);
  app.get('/api/updates',async (_req,res)=>res.json(await service.status()));
  app.post('/api/updates/check',async (_req,res)=>{
    try {res.json(await service.check());}
    catch(e){res.status(e.status||503).json({error:e.message});}
  });
}
