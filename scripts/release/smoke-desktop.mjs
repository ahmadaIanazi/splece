import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {pathToFileURL} from 'node:url';
const exec=promisify(execFile),repo=process.cwd(),release=path.join(repo,'release/windows-beta');
const linux=process.platform==='linux';
if(!linux&&process.platform!=='win32')throw Error('Run desktop installer checks on its target OS.');
if(linux){const deb=(await fs.readdir('release/linux-beta')).find(x=>x.endsWith('.deb'));await exec('sudo',['dpkg','-i',path.resolve('release/linux-beta',deb)],{timeout:120000});}
else {const setup=(await fs.readdir(release)).find(x=>x.endsWith('Setup.exe'));assert.ok(setup,'Setup.exe exists');await exec(path.join(release,setup),['--silent'],{timeout:120000});}
const app=linux?'/opt/splece':path.join(process.env.LOCALAPPDATA,'SpleceDesktop/current'),root=path.join(app,'studio'),node=path.join(app,linux?'runtime/node':'runtime/node.exe'),data=linux?path.join(process.env.HOME,'.local/share/Splece'):path.join(process.env.LOCALAPPDATA,'Splece');
await fs.access(linux?'/usr/bin/splece':path.join(app,'Splece.exe'));await fs.access(node);
async function action(name){const script=`import {${name}} from ${JSON.stringify(pathToFileURL(path.join(root,'scripts/release/bundled-launcher.mjs')).href)}; console.log(JSON.stringify(await ${name}({root:${JSON.stringify(root)},data:${JSON.stringify(data)}})));`;return JSON.parse((await exec(node,['--input-type=module','-e',script],{env:{...process.env,PATH:linux?'/usr/bin:/bin':process.env.SystemRoot+'\\System32',NODE_OPTIONS:'',NODE_PATH:''},timeout:30000})).stdout);}
const started=await action('launchPackaged');assert.ok(started.ok);const base=new URL(started.url).origin;
let cookie=(await fetch(base+'/api/session')).headers.get('set-cookie').split(';')[0];
async function api(p,body,method=body?'POST':'GET'){const response=await fetch(base+'/api'+p,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(response.ok,await response.clone().text());return response.json();}
assert.equal((await api('/updates')).supported,!linux);assert.equal((await api('/studio/mode')).mode,'test');
await api('/onboarding',{skipped:true},'PUT');const project=await api('/projects',{name:'Windows installer smoke test',templateId:'product',includeSample:true});assert.ok(project.project.clips.length);
project.project.clips=[{...project.project.clips[0],start:0,in:0,duration:2}];project.project.settings.export={...project.project.settings.export,resolution:'480p',fps:24};
const saved=await api('/projects/'+project.project.id,project,'PUT');const job=await api('/projects/'+project.project.id+'/export',{revision:saved.revision});
let done=false;for(let i=0;i<120;i++){const current=(await api('/projects/'+project.project.id+'/jobs')).find(x=>x.id===job.id);if(current?.state==='failed')throw Error(JSON.stringify(current));if(current?.state==='ready'){done=true;break;}await new Promise(r=>setTimeout(r,500));}assert.ok(done,'Local FFmpeg export completed');
await action('stopPackaged');const reopened=await action('launchPackaged');cookie=(await fetch(new URL('/api/session',reopened.url))).headers.get('set-cookie').split(';')[0];assert.equal((await api('/projects/'+project.project.id)).project.name,project.project.name);assert.equal((await api('/connections')).onboarding.completed,true);await action('stopPackaged');
await fs.writeFile(path.join(repo,linux?'release/linux-smoke.json':'release/windows-smoke.json'),JSON.stringify({ok:true,installed:true,bundledRuntime:true,localExport:true,projectPreserved:true,onboardingPreserved:true,updatesSupported:!linux,aiCreditsSpent:0,signed:false,physicalConsumerWindowsTest:false},null,2));
console.log('Desktop installer, bundled runtime, offline export and persistence passed.');
