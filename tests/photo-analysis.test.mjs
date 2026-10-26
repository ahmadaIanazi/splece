import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createPhotoAnalysis} from '../server/photo-analysis.mjs';
import {openStore} from '../server/store.mjs';
import {newProject} from '../server/domain.mjs';
import {upgradeProject} from '../shared/studio.mjs';
import {credentials} from '../server/connections.mjs';
import {activeStudioJobs} from '../server/launcher.mjs';
async function setup(t,options={}){
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'splece-photos-')),store=openStore(path.join(data,'db.sqlite')),p=upgradeProject(newProject('Photo Test'));
 store.save(p,0);const original=path.join(data,'image.jpg');await fs.writeFile(original,'test');
 const photos=['one','two'].map(id=>({id,kind:'image',projectId:p.id,original,duration:5,path:original}));photos.forEach(m=>store.putMedia(m));
 const service=createPhotoAnalysis({store,data,mode:async()=> 'test',transport:async()=>{throw Error('Unexpected network')},...options});
 t.after(async()=>{store.db.close();await fs.rm(data,{recursive:true,force:true});});return {data,store,p,photos,service};
}
test('Photo test mode makes no calls, returns honest fixture, and quotation is not active work',async t=>{
 const {p,service,store}=await setup(t);const q=await service.quote(p.id,['one','two']);assert.equal(activeStudioJobs(store.db),0);
 const j=await service.analyze(p.id,q.id);assert.equal(j.state,'ready');assert.match(j.result.photos[0].description,/no image analysis/);assert.equal(j.executionMode,'test');assert.deepEqual(await service.analyze(p.id,q.id),j);
});
test('Photo input validates ownership and mode before work',async t=>{
 let mode='test';const {p,service,store}=await setup(t,{mode:async()=>mode});
 await assert.rejects(service.quote(p.id,['foreign']),/project/);await assert.rejects(service.quote(p.id,['one','one']),/one or two/);
 const q=await service.quote(p.id,['one']);mode='live';await assert.rejects(service.analyze(p.id,q.id),/Mode changed/);assert.equal(service.list(p.id)[0].state,'quoted');
});
test('Live vision discovers capability, sends actual bounded images, validates output, and double-click does not resubmit',async t=>{
 let calls=[];const {p,service,data}=await setup(t,{mode:async()=> 'live',render:async args=>fs.writeFile(args.at(-1),'normalized-image'),transport:async(url,opts)=>{
 calls.push([url,opts]);if(url.includes('/models'))return Response.json({data:[{id:'text-only',model_spec:{capabilities:{}}},{id:'vision',model_spec:{capabilities:{supportsVision:true}}}]});
 return Response.json({model:'vision',usage:{prompt_tokens:500,completion_tokens:30},choices:[{message:{content:'A quiet riverside path in soft morning light.'}}]});
 }});await credentials(data,'venice').saveKey('test-only');
 const q=await service.quote(p.id,['one','two']);assert.equal(q.model,'vision');
 await Promise.all([service.analyze(p.id,q.id),service.analyze(p.id,q.id)]);
 const j=service.list(p.id)[0];assert.equal(j.state,'ready');assert.equal(calls.length,3);assert.equal(j.usage.length,2);
 const payload=JSON.parse(calls[1][1].body);assert.equal(payload.messages[1].content[1].image_url.url,'data:image/jpeg;base64,'+Buffer.from('normalized-image').toString('base64'));assert.match(j.result.writing,/riverside/);
});
test('Failed analysis never retries a paid request automatically',async t=>{
 let n=0;const {p,service,data}=await setup(t,{mode:async()=> 'live',render:async args=>fs.writeFile(args.at(-1),'test'),transport:async(url)=>{
 if(url.includes('/models'))return Response.json({data:[{id:'vision',model_spec:{capabilities:{supportsVision:true}}}]});n++;return new Response('',{status:422});
 }});await credentials(data,'venice').saveKey('test-only');const q=await service.quote(p.id,['one']);const j=await service.analyze(p.id,q.id);assert.equal(j.state,'failed');assert.match(j.error,/422/);await service.analyze(p.id,q.id);assert.equal(n,1);assert.equal(j.attempted,true);
});
test('Image timelines export full-length stills from the safe original, without needing the preview copy',async t=>{
 const {run,renderEpisode,probe}=await import('../server/media.mjs');
 const {p,photos,data}=await setup(t);
 const original=path.join(data,'original.png');
 await run(['-y','-f','lavfi','-i','color=c=navy:s=1600x900','-frames:v','1',original]);
 const m={...photos[0],original,path:path.join(data,'missing-proxy.mp4')};
 const out=path.join(data,'export.mp4');
 await renderEpisode([{id:'still',start:0,in:2,duration:1,activeTake:m.id,takes:[m]}],()=>m,path.join(data,'renders'),out,{aspect:'16:9',resolution:'480p',fps:24});
 const info=await probe(out);assert.ok(info.duration>=.95);assert.ok((await fs.stat(original)).size>0);
});
