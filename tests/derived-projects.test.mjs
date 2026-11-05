import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.mjs';
import { newProject } from '../server/domain.mjs';
import { upgradeProject } from '../shared/studio.mjs';
import { createDerivedProjects } from '../server/derived-projects.mjs';
import { createPortableStore } from '../server/portable.mjs';
import { createReelEffects } from '../server/reel-effects.mjs';
import { run, probe, renderEpisode } from '../server/media.mjs';

async function fixture(t, real = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'derived-project-'));
  const store = openStore(path.join(root, 'db.sqlite'));
  t.after(async () => { store.db.close(); await fs.rm(root, {recursive:true,force:true}); });
  const p = upgradeProject(newProject('Noora test'));
  p.folder = path.join(root, 'original'); await fs.mkdir(p.folder);
  const file = path.join(p.folder, 'source.mp4');
  if (real) await run(['-f','lavfi','-i','color=c=blue:s=160x90:r=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file]);
  else await fs.writeFile(file, 'test source');
  const media = {id:'raw',projectId:p.id,path:file,kind:'video',duration:3,audio:true,width:160,height:90};
  store.putMedia(media);
  store.putMedia({...media,id:'music'});
  store.putMedia({...media,id:'result',name:'Reel result'});
  p.clips = [{id:'clip',start:4,in:0,duration:3,activeTake:'raw',takes:[media],volume:.6,mute:false}];
  p.audioClips = [{id:'sound',mediaId:'music',start:4.5,in:.2,duration:2,volume:.4,lane:1,fadeIn:.1,fadeOut:.2}];
  store.save(p,0);
  const folder = path.join(p.folder,'reel'); await fs.mkdir(folder);
  await fs.copyFile(file,path.join(folder,'part-0.mp4'));
  await fs.copyFile(file,path.join(folder,'base-0.mp4'));
  const job = {id:'reel',projectId:p.id,state:'ready',media:{id:'result'},folder,snapshot:p,
    options:{recipe:'reel',resolution:'480p',captions:true}, sources:[{id:'s',clipId:'clip',mediaId:'raw',in:0,duration:3,name:'Hello'}],
    plan:[{id:'shot',sourceId:'s',from:1,to:2.5,crop:[{t:0,x:.3,y:.5,zoom:.4}],subjects:[{id:'teacher',name:'Teacher',kind:'face',points:[]}],captions:[{start:.1,end:1,text:'أهلاً يا أطفال'}]}]};
  store.db.exec('CREATE TABLE reel_jobs(id TEXT PRIMARY KEY,projectId TEXT,state TEXT,body TEXT); CREATE TABLE effect_jobs(id TEXT PRIMARY KEY,projectId TEXT,state TEXT,body TEXT)');
  const save = () => store.db.prepare('INSERT OR REPLACE INTO reel_jobs VALUES(?,?,?,?)').run(job.id,p.id,job.state,JSON.stringify(job)); save();
  const opts = {store,projectsRoot:async()=>root,...(!real ? {makeThumbnail:async(_,out)=>fs.writeFile(out,'poster')} : {})};
  return {root,store,p,job,save,opts};
}

test('Reel projects own files, source intervals, separate sound, Arabic captions and exact camera recipe; retries survive service recreation', async t => {
  const {store,p,job,opts} = await fixture(t), before=store.get(p.id);
  const service=createDerivedProjects(opts);
  const [a,b]=await Promise.all([service.create(p.id,'reels',job.id),service.create(p.id,'reels',job.id)]);
  assert.equal(a.project.id,b.project.id); assert.equal(a.revision,1);
  assert.deepEqual(store.get(p.id),before);
  const q=a.project;
  assert.equal(q.clips[0].start,0); assert.equal(q.clips[0].duration,1.5); assert.equal(q.clips[0].mute,true);
  assert.equal(q.clips[0].reelSource.in,1); assert.deepEqual(q.clips[0].reelSource.shot,job.plan[0]);
  assert.equal(q.audioClips.length,2); assert.equal(q.audioClips[0].in,1); assert.equal(q.audioClips[0].volume,.6);
  assert.equal(q.audioClips[1].start,0); assert.ok(Math.abs(q.audioClips[1].in-.7)<1e-9); assert.equal(q.audioClips[1].duration,1.5);
  assert.equal(q.elements.find(e=>e.kind==='text').text,'أهلاً يا أطفال');
  assert.equal(q.elements.find(e=>e.kind==='text').font,'Noto Sans Arabic');
  assert.equal((await createDerivedProjects(opts).create(p.id,'reels',job.id)).project.id,q.id);
  const bundle=JSON.parse(await fs.readFile(path.join(q.folder,'.frame/project.bundle.json'),'utf8'));
  assert.ok(bundle.media.every(m=>m.projectId===q.id && !path.isAbsolute(m.path)));
  await fs.rm(p.folder,{recursive:true});
  for (const m of store.db.prepare('SELECT body FROM media WHERE projectId=?').all(q.id).map(r=>JSON.parse(r.body))) await fs.access(m.path);
  assert.equal((await createPortableStore(store).open(q.folder)).project.clips[0].reelSource.shot.crop[0].zoom,.4);
});

test('checkpoint and missing source failures publish nothing and can retry', async t => {
  const {store,p,job,opts,root}=await fixture(t);
  await assert.rejects(createDerivedProjects({...opts,checkpoint:async()=>{throw Error('Disk full');}}).create(p.id,'reels',job.id),/Disk full/);
  assert.equal(store.list().length,1);
  assert.deepEqual((await fs.readdir(root)).filter(n=>n.startsWith('Result-')),[]);
  await fs.rename(path.join(job.folder,'part-0.mp4'),path.join(job.folder,'saved.mp4'));
  await assert.rejects(createDerivedProjects(opts).create(p.id,'reels',job.id),/ENOENT/);
  assert.equal(store.list().length,1);
  await fs.rename(path.join(job.folder,'saved.mp4'),path.join(job.folder,'part-0.mp4'));
  assert.equal((await createDerivedProjects(opts).create(p.id,'reels',job.id)).revision,1);
});

test('rejects foreign project, foreign media, unready jobs and escaping symlinks', async t => {
  const {store,p,job,save,opts,root}=await fixture(t), service=createDerivedProjects(opts);
  await assert.rejects(service.create('other','reels',job.id),/unavailable/);
  job.state='running';save();await assert.rejects(service.create(p.id,'reels',job.id),/Finish rendering/);
  job.state='ready';save();const m=store.media('raw');store.putMedia({...m,projectId:'other'});
  await assert.rejects(service.create(p.id,'reels',job.id),/does not belong/);
  store.putMedia(m);
  const outside=path.join(root,'outside.mp4');await fs.writeFile(outside,'outside');
  await fs.rm(path.join(job.folder,'part-0.mp4'));await fs.symlink(outside,path.join(job.folder,'part-0.mp4'));
  await assert.rejects(service.create(p.id,'reels',job.id),/outside/);
  assert.equal(store.list().length,1);
});

test('upscale result opens independently with original source and idempotent concurrent service instances', async t => {
  const {store,p,opts}=await fixture(t);
  store.db.prepare('INSERT INTO effect_jobs VALUES(?,?,?,?)').run('effect',p.id,'ready',JSON.stringify({id:'effect',state:'ready',media:{id:'result'},input:{source:{mediaId:'raw'}}}));
  const [a,b]=await Promise.all([createDerivedProjects(opts).create(p.id,'effects','effect',{name:'My upscale'}),createDerivedProjects(opts).create(p.id,'effects','effect')]);
  assert.equal(a.project.id,b.project.id);assert.equal(store.list().length,2);
  assert.equal(a.project.clips[0].in,0);assert.equal(a.project.clips[0].mute,false);
  assert.equal(a.project.assets.length,2);assert.notEqual(a.project.clips[0].activeTake,'result');
});

test('real footage produces readable independent shot and thumbnail without provider calls',async t=>{
  const {store,p,opts}=await fixture(t,true);
  const {project}=await createDerivedProjects(opts).create(p.id,'reels','reel');
  const m=store.media(project.clips[0].activeTake);
  assert.equal((await probe(m.path)).video,true);assert.ok((await fs.stat(m.poster)).size>100);
  assert.ok((await fs.stat(path.join(project.folder,'.frame/project.bundle.json'))).size>0);
  const out=path.join(project.folder,'exports','test.mp4');
  await renderEpisode(project.clips,c=>store.media(c.activeTake),path.join(project.folder,'render-test'),out,{aspect:'9:16',resolution:'480p',fps:24},project.audioClips,c=>store.media(c.mediaId),project.elements);
  const info=await probe(out);assert.equal(info.audio,true);assert.ok(Math.abs(info.duration-1.5)<.1);assert.ok(info.height>info.width);
});

test('source changes and source removal during staging roll back every new row and file',async t=>{
  const {store,p,job,opts,root}=await fixture(t);
  await assert.rejects(createDerivedProjects({...opts,checkpoint:async(staged,id)=>{
    await createPortableStore(staged).checkpoint(id);
    await fs.appendFile(store.media('raw').path,'changed');
  }}).create(p.id,'reels',job.id),/changed/);
  assert.equal(store.list().length,1);
  await assert.rejects(createDerivedProjects({...opts,checkpoint:async(staged,id)=>{
    await createPortableStore(staged).checkpoint(id);store.removing.add(p.id);
  }}).create(p.id,'reels',job.id),/unavailable/);
  store.removing.delete(p.id);
  assert.equal(store.list().length,1);
  assert.deepEqual((await fs.readdir(root)).filter(n=>n.startsWith('Result-')),[]);
});

test('a missing destination does not silently create another project on retry',async t=>{
  const {store,p,opts}=await fixture(t), service=createDerivedProjects(opts);
  const {project}=await service.create(p.id,'reels','reel');
  store.db.prepare('DELETE FROM projects WHERE id=?').run(project.id);
  await assert.rejects(service.create(p.id,'reels','reel'),/previously created/);
});


test('derived Reel framing reopens with independently owned uncropped footage, editable captions and no speech setup', async t => {
  const {store,p,job,opts}=await fixture(t,true);
  const q=(await createDerivedProjects(opts).create(p.id,'reels',job.id)).project;
  assert.ok(q.clips[0].reelSource.reframeMediaId);
  await fs.rm(p.folder,{recursive:true});
  const before=structuredClone(store.get(q.id));
  const reels=createReelEffects({store,data:q.folder,addons:{requireReady(){throw Error('Must reuse saved captions');}}});
  t.after(()=>reels.close());
  const created=await reels.create(q.id,{requestId:'reframe-existing-result',revision:before.revision,recipe:'reel',duration:15,clipIds:q.clips.map(c=>c.id),reframe:true,captions:true});
  await reels.idle();
  const review=reels.get(q.id,created.id);
  assert.equal(review.state,'quoted',review.message);
  assert.equal(review.plan[0].crop[0].zoom,.4);
  assert.equal(review.plan[0].captions[0].text,'أهلاً يا أطفال');
  assert.equal(review.sources[0].mediaId,q.clips[0].reelSource.reframeMediaId);
  assert.ok(review.reviewedAt);
  assert.ok(!review.guardElements && !review.savedPlan);
  await reels.render(q.id,created.id,review.plan);await reels.idle();
  assert.equal(reels.get(q.id,created.id).state,'ready',reels.get(q.id,created.id).message);
  assert.deepEqual(store.get(q.id),before);
});
