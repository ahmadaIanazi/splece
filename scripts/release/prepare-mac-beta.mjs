// One local release-preparation command. Publication remains a separate explicit step.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(process.platform!=='darwin'||!process.env.APPLE_SIGNING_IDENTITY||process.env.APPLE_SIGNING_IDENTITY==='-'||!process.env.APPLE_NOTARY_PROFILE) throw Error('Set APPLE_SIGNING_IDENTITY and APPLE_NOTARY_PROFILE to existing Mac Keychain entries.');
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'splece-release-'));
const resultFile=path.join(scratch,'candidate.json');
const started=Date.now(), timings={};
async function run(label,command,args,env=process.env){
 const begin=Date.now();console.log(`\n${label}…`);
 await new Promise((resolve,reject)=>{const p=spawn(command,args,{cwd:root,env,stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(`${label} failed (${code}). Nothing was published.`)));});
 timings[label]=Math.round((Date.now()-begin)/1000);
}
await run('Build, regression tests and signing',process.execPath,['scripts/release/mac-beta.mjs'],{...process.env,SPLECE_BETA_RESULT_FILE:resultFile});
const candidate=JSON.parse(await fs.readFile(resultFile,'utf8'));
const mount=path.join(scratch,'volume'),installed=path.join(candidate.work,'installed');
await fs.mkdir(mount);await fs.mkdir(installed);
async function inspect(smoke){
 await run('Mount installer','hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,candidate.dmg]);
 try{
  const bundle=path.join(installed,'Splece.app');
  await run('Copy installed application','ditto',[path.join(mount,'Splece.app'),bundle]);
  await run('Verify application signature','codesign',['--verify','--deep','--strict',bundle]);
  if(smoke){
   await run('Scan packaged files for secrets','/opt/homebrew/bin/gitleaks',['dir',path.join(bundle,'Contents/Resources/studio'),'--redact','--no-banner','--report-format','json','--report-path',path.join(candidate.work,'secret-scan.json')]);
   await run('Installed application smoke test',process.execPath,['scripts/release/smoke-mac.mjs',bundle]);
  }else await run('Gatekeeper application check','spctl',['--assess','--type','execute','--verbose=2',bundle]);
 }finally{await run('Unmount installer','hdiutil',['detach',mount]);}
}
await inspect(true);
await run('Apple notarization and ticket checks',process.execPath,['scripts/release/notarize-mac.mjs',candidate.dmg]);
await inspect(false);
const manifestPath=path.join(candidate.work,'build.json');
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
Object.assign(manifest,{notarized:true,publishable:true,sha256:(await fs.readFile(candidate.dmg+'.sha256','utf8')).split(' ')[0],timings,totalSeconds:Math.round((Date.now()-started)/1000),physicalCleanMacTest:false});
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(`\nVerified release: ${candidate.dmg}\nRelease manifest: ${manifestPath}\nNothing published automatically.`);
