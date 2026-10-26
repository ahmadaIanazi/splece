import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { newProject } from '../server/domain.mjs';
import { upgradeProject } from '../shared/studio.mjs';
import { createSoundtrackPlan, applySoundtrackResults, activeSoundtrackRun, soundtrackReviewUnits } from '../shared/soundtrack.mjs';
import { createSoundtrackService } from '../server/soundtrack.mjs';
import { openStore } from '../server/store.mjs';
import { saveStudioMode } from '../server/mode.mjs';
import { editShortcut } from '../shared/editor-shortcuts.mjs';

function fixture() {
  const p = upgradeProject(newProject('Bug regression'));
  p.clips = [{id:'clip', start:0, in:0, duration:3, activeTake:'media', takes:[{id:'media',duration:3}], draftId:'draft'}];
  p.assets = [{id:'speaker',kind:'character',name:'Speaker'}];
  p.drafts = [{id:'draft',scenes:[{duration:3,text:'Hello',dialogue:[{speaker:'speaker',text:'Hello.'}]}]}];
  return p;
}
function ready(p, role) {
  const r = createSoundtrackPlan(p,{roles:[role]},randomUUID);
  r.state = 'ready';
  r.units.forEach(u => {u.state='ready';u.media={id:u.id,duration:u.duration,kind:'audio',name:role};});
  return r;
}

test('audio clip keyboard ownership permits deletion without stealing typing or toolbar keys', () => {
  for (const key of ['Backspace','Delete']) {
    assert.equal(editShortcut({key},{control:true,clip:true,timeline:true}), 'remove');
    assert.equal(editShortcut({key},{control:true,timeline:true}), null);
    assert.equal(editShortcut({key},{editable:true,clip:true}), null);
    assert.equal(editShortcut({key,defaultPrevented:true},{clip:true}), null);
  }
});

test('dialogue, effects and ambience accumulate as independent overlapping lanes in either order', () => {
  for (const roles of [['dialogue','effect','ambience'],['effect','ambience','dialogue']]) {
    const p=fixture();
    const ids=[];
    for (const role of roles) {const r=ready(p,role);ids.push(r.units[0].id);applySoundtrackResults(p,r);}
    assert.equal(p.audioClips.length,3);
    assert.equal(new Set(p.audioClips.map(a=>a.lane)).size,3);
    assert.deepEqual(new Set(p.audioClips.map(a=>a.id)),new Set(ids));
  }
});

test('archived results remain reviewable, latest successful replacement clears notice, undo stays respected', () => {
  const p=fixture(), old=ready(p,'effect');
  p.clips[0].in=0.1;
  applySoundtrackResults(p,old);
  assert.equal(p.audioClips.length,0);
  assert.equal(soundtrackReviewUnits(p,[old]).length,1);
  const replacement=ready(p,'effect');
  applySoundtrackResults(p,replacement);
  assert.deepEqual(soundtrackReviewUnits(p,[replacement,old]),[]);
  p.audioClips=[]; // User removal/undo must not be reintroduced as a failed placement.
  assert.deepEqual(soundtrackReviewUnits(p,[replacement,old]),[]);
});

test('backend queues effects while dialogue is running and rejects competing requests for the same layer', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'splece-layer-queue-'));
  const store=openStore(path.join(dir,'studio.sqlite'));
  let service;
  try {
    const p=fixture();p.folder=dir;
    const revision=store.save(p,0);
    store.putMedia({id:'media',projectId:p.id,path:path.join(dir,'picture.mp4'),duration:3});
    await saveStudioMode(dir,'test');
    service=createSoundtrackService({store,data:dir});
    const dialogue=await service.submit(p.id,{revision,roles:['dialogue'],requestId:'voice'});
    const effect=await service.submit(p.id,{revision,roles:['effect'],requestId:'effects'});
    assert.equal(activeSoundtrackRun([dialogue,effect],p.episodeId,['effect']).id,effect.id);
    assert.equal(activeSoundtrackRun([dialogue],p.episodeId,['effect']),undefined);
    await assert.rejects(()=>service.submit(p.id,{revision,roles:['effect'],requestId:'duplicate'}),/already running/);
    assert.equal((await service.submit(p.id,{revision,roles:['effect'],requestId:'effects'})).id,effect.id);
    await service.tick();
    assert.equal(service.get(dialogue.id).state,'ready');
    await service.tick();
    assert.equal(service.get(effect.id).state,'ready');
    applySoundtrackResults(p,service.get(dialogue.id));
    applySoundtrackResults(p,service.get(effect.id));
    assert.equal(p.audioClips.length,2);
    assert.notEqual(p.audioClips[0].lane,p.audioClips[1].lane);
  } finally {service?.close();store.db.close();await fs.rm(dir,{recursive:true,force:true});}
});
