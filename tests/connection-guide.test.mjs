import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionQueue,connectionRoutePatch,providerGuides} from '../shared/connection-guide.mjs';
import {routingDefaults} from '../shared/ai-routing.mjs';
import {providerDefinitions} from '../shared/providers.mjs';
test('setup connects a shared provider once and never invents unsupported provider lanes',()=>{
 assert.deepEqual(connectionQueue(['writing','visuals','sound'],{writing:'openai',visuals:'fal',sound:'fal'}),[{provider:'openai',lanes:['text','assistant']},{provider:'fal',lanes:['image','video','audio']}]);
 assert.deepEqual(connectionQueue(['visuals'],{visuals:'kie'}),[]);
 for(const p of providerDefinitions){assert.ok(providerGuides[p.id]);for(const k of ['account','credits','docs','billingDocs'])assert.equal(new URL(providerGuides[p.id][k]).protocol,'https:');}
});
test('setup preserves chosen models, excludes unverified providers and does not enable unsupported empty catalogs',()=>{
 const catalog={routes:routingDefaults(),models:{text:[{provider:'openai',id:'gpt-mini'},{provider:'openai',id:'gpt-manual'}],assistant:[],video:[],image:[],audio:[]}};
 catalog.routes.text={provider:'openai',model:'gpt-manual',enabled:false};
 const queue=[{provider:'openai',lanes:['text','assistant']},{provider:'fal',lanes:['image','video','audio']}];
 assert.deepEqual(connectionRoutePatch(queue,catalog,[{id:'openai',ready:true},{id:'fal',ready:false}]),{text:{provider:'openai',model:'gpt-manual',enabled:true}});
 assert.deepEqual(connectionRoutePatch([],catalog,[]),{});
});
