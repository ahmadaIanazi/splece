import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStoryResponse} from '../shared/story-response.mjs';
import {requestStory} from '../server/authoring.mjs';
import {newProject} from '../server/domain.mjs';
import {storyPlan,validateStorySetup} from '../shared/authoring.mjs';
import {conversationFixture} from '../shared/planning-conversation.mjs';
import {applyStructureJob} from '../shared/structure-workflow.mjs';

test('provider minor-character notes accept empty and text-only lists without mutating the response',()=>{
 for(const notes of [[],['صوص يطير','Birds in the garden'],['']]){
  const raw={setup:{minorCharacters:notes}}, before=structuredClone(raw), result=normalizeStoryResponse(raw);
  assert.equal(result.setup.minorCharacters,notes.join('\n'));assert.deepEqual(raw,before);
  assert.equal(validateStorySetup(result.setup,[]).minorCharacters,notes.join('\n'));
 }
 assert.equal(normalizeStoryResponse({setup:{minorCharacters:'Original\nwriting'}}).setup.minorCharacters,'Original\nwriting');
});
test('normalization does not coerce objects, mixed lists, IDs or oversized text',()=>{
 for(const notes of [{name:'Bird'},['Bird',42],['x'.repeat(50001)]]){
  const normalized=normalizeStoryResponse({setup:{minorCharacters:notes}});
  assert.throws(()=>validateStorySetup(normalized.setup,[]),/Minor character descriptions must be text/);
 }
 const value={setup:{minorCharacters:[],castIds:'invalid',language:['Arabic']}};
 assert.deepEqual(normalizeStoryResponse(value).setup.castIds,'invalid');assert.deepEqual(normalizeStoryResponse(value).setup.language,['Arabic']);
 assert.throws(()=>validateStorySetup({minorCharacters:[]},[]),/must be text/);
});
test('saved Live-format outline can be replayed locally and applied once with exact dialogue and references',async()=>{
 const p=newProject('The teacher regression');p.assets=[];
 const input={action:'conversation',planningMessage:'The teacher introduces herself and a small bird.',plan:structuredClone(storyPlan(p)),assets:[],episodeId:p.episodeId};
 const raw=conversationFixture(input);raw.setup.minorCharacters=[];
 const actor=raw.characters[0].id;raw.beats.find(b=>b.nodeType==='clip').dialogue=[{speaker:actor,text:'مرحباً! أنا المعلمة نورة.',delivery:'Warmly',direction:''}];
 let calls=0,request;const result=await requestStory(input,{mode:'deepseek',model:'local-replay'},'not-a-provider-key',async(url,options)=>{
  calls++;request=JSON.parse(options.body);
  return {ok:true,json:async()=>({usage:{prompt_tokens:10,completion_tokens:20},choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]})};
 });
 assert.equal(calls,1);assert.match(request.messages[0].content,/minorCharacters must be a plain text string/);
 assert.equal(result.proposal.setup.minorCharacters,'');assert.deepEqual(result.proposal.beats.flatMap(b=>b.dialogue.map(l=>l.text)),['مرحباً! أنا المعلمة نورة.']);
 const job={id:'saved-response',state:'ready',action:'conversation',episodeId:p.episodeId,result};
 assert.equal(applyStructureJob(p,job).applied,true);assert.equal(p.assets.length,1);assert.equal(applyStructureJob(p,job).skipped,true);
 assert.equal(p.planningSessions[p.episodeId].messages.length,1);
});
