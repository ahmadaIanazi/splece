import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import express from 'express';
import {createUpdateService,installUpdateRoutes} from '../server/updates.mjs';
import {localSession} from '../server/security.mjs';
import {releaseFeed,verifyArchive} from '../scripts/release/update-feed.mjs';

async function fixture(t){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'splece-update-test-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const bundle=path.join(temp,'Splece.app'),root=path.join(bundle,'Contents/Resources/studio'),data=path.join(temp,'data'),executable=path.join(bundle,'Contents/Resources/runtime/node');
  await fs.mkdir(root,{recursive:true});await fs.mkdir(path.dirname(executable));await fs.writeFile(executable,'fixture');
  await fs.mkdir(path.join(data,'launcher'),{recursive:true});
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'0.1.2'}));
  await fs.writeFile(path.join(root,'desktop-update.json'),JSON.stringify({engine:'sparkle'}));
  return {bundle,root,data,executable,platform:'darwin'};
}
test('only a packaged Mac running its bundled runtime can open the updater',async t=>{
  const f=await fixture(t);let calls=0;
  for(const changed of [{platform:'win32'},{executable:process.execPath}]){
    const svc=await createUpdateService({...f,...changed,run:async()=>calls++});
    assert.equal((await svc.status()).supported,false);await assert.rejects(svc.check(),/installed desktop/);
  }
  assert.equal(calls,0);
  const svc=await createUpdateService({...f,run:async(command,args)=>{calls++;assert.equal(command,'/usr/bin/open');assert.deepEqual(args,['-a',f.bundle,'splece://updates']);}});
  assert.equal((await svc.status()).supported,true);assert.equal((await svc.check()).state,'opening');assert.equal(calls,1);
});
test('updater status ignores stale versions and other installations; launch failure is recoverable',async t=>{
  const f=await fixture(t),file=path.join(f.data,'launcher/update-state.json');
  const svc=await createUpdateService({...f,run:async()=>{throw Error('no app');}});
  const value={pid:process.pid,root:f.root,version:'0.1.2',state:'available',updatedAt:Date.now(),latestVersion:'0.1.3'};
  for(const wrong of [{root:'/other'},{version:'0.1.1'},{pid:0},{state:'invented'}]){
    await fs.writeFile(file,JSON.stringify({...value,...wrong}));assert.equal((await svc.status()).state,'idle');
  }
  await fs.writeFile(file,JSON.stringify(value));assert.equal((await svc.status()).latestVersion,'0.1.3');
  await assert.rejects(svc.check(),/Could not open/);assert.equal((await svc.status()).state,'available');
});
test('update actions require a local session and ignore caller-supplied application paths',async t=>{
  const f=await fixture(t);let calls=0;
  const app=express();app.use(localSession());app.use(express.json());
  await installUpdateRoutes(app,{...f,run:async(_cmd,args)=>{assert.deepEqual(args,['-a',f.bundle,'splece://updates']);calls++;}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  const url=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url+'/api/updates/check',{method:'POST'})).status,401);assert.equal(calls,0);
  const session=await fetch(url+'/api/session'),cookie=session.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(url+'/api/updates/check',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({url:'file:///tmp/evil',bundle:'/tmp/evil.app'})})).status,200);assert.equal(calls,1);
});
test('release feeds reject unsigned releases, changed archives and version reuse or downgrade',()=>{
  const bytes=Buffer.from('installer'),{publicKey,privateKey}=generateKeyPairSync('ed25519');
  const key=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
  const signature=sign(null,bytes,privateKey).toString('base64');
  assert.equal(verifyArchive(bytes,signature,key),true);assert.equal(verifyArchive(Buffer.from('tampered'),signature,key),false);
  const manifest={version:'0.1.2',arch:'arm64',signed:true,notarized:true,publishable:true,sha256:createHash('sha256').update(bytes).digest('hex'),builtAt:'2026-10-26T00:00:00Z'};
  const feed=releaseFeed(manifest,bytes,signature,'<script>not executable</script>','0.1.1');
  assert.match(feed,/https:\/\/www.splece.com\/beta\/Splece-0.1.2-beta-Apple-Silicon.dmg/);
  assert.match(feed,/&lt;script&gt;/);assert.ok(!feed.includes('<script>'));
  for(const change of [{signed:false},{notarized:false},{publishable:false},{version:'0.1.2<bad>'},{arch:'x64'}])assert.throws(()=>releaseFeed({...manifest,...change},bytes,signature,''));
  assert.throws(()=>releaseFeed(manifest,Buffer.from('changed'),signature,''),/checksum/);
  for(const version of ['0.1.2','0.1.3','1.0.0'])assert.throws(()=>releaseFeed(manifest,bytes,signature,'',version),/increasing/);
});
