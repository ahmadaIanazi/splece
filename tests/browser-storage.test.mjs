import test from 'node:test';
import assert from 'node:assert/strict';
import {setBrowserPreference,saveUndoCache} from '../shared/local-draft.mjs';

test('full storage cannot throw from last-project or layout preferences',()=>{
  const full={setItem(){throw new DOMException('Full','QuotaExceededError');}};
  assert.equal(setBrowserPreference('frame-last-project','new-project',full),false);
  assert.equal(setBrowserPreference('frame-left-width',390,full),false);
  const writes=[];
  assert.equal(setBrowserPreference('frame-last-project','new-project',{setItem:(...v)=>writes.push(v)}),true);
  assert.deepEqual(writes,[['frame-last-project','new-project']]);
});
test('undo cache is bounded, retains newest snapshots and never mutates active history',()=>{
  const past=Array.from({length:15},(_,id)=>({id,svg:'x'.repeat(300)}));
  const original=JSON.stringify(past);let saved;
  const storage={setItem(key,value){assert.equal(key,'frame-undo-p');saved=value;}};
  assert.equal(saveUndoCache(storage,'frame-undo-p',past,[],1600),true);
  assert.ok(saved.length*2<=1600);
  assert.equal(JSON.parse(saved).past.at(-1).id,14);
  assert.equal(JSON.stringify(past),original);
});
test('quota retries shrink only the current optional undo cache, never recovery drafts',()=>{
  const values=new Map([['frame-journal-p','unsaved writing'],['frame-undo-other','keep']]);
  const storage={setItem(key,value){if(value.length>70)throw Error('Quota');values.set(key,value);}};
  assert.equal(saveUndoCache(storage,'frame-undo-p',[{id:1,text:'x'.repeat(80)},{id:2}],[]),true);
  assert.deepEqual(JSON.parse(values.get('frame-undo-p')).past,[{id:2}]);
  assert.equal(values.get('frame-journal-p'),'unsaved writing');
  assert.equal(values.get('frame-undo-other'),'keep');
  assert.equal(saveUndoCache({setItem(){throw Error('Unavailable');}},'x',[],[]),false);
});
