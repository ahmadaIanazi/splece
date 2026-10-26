import test from "node:test";
import assert from "node:assert/strict";
import {nextTimelineFocus,auditionAudio,auditionSource} from "../shared/timeline-focus.mjs";
import {dialogueTiming} from "../shared/dialogue-timing.mjs";
test("Control selects, repeated click auditions, third click restores without editing mute state",()=>{
 const a={kind:"audio",id:"a"},original=[{id:"a",mute:true,volume:.5},{id:"b",mute:false,volume:.8}];
 let state=nextTimelineFocus(null,a,true);
 assert.equal(state.solo,null);
 state=nextTimelineFocus(state,a);
 assert.deepEqual(state.solo,a);
 assert.deepEqual(auditionAudio(original,state.solo).map(c=>c.mute),[false,true]);
 assert.equal(auditionSource({id:"video",mute:false},state.solo).mute,true);
 state=nextTimelineFocus(state,a);
 assert.equal(auditionAudio(original,state.solo),original);
 assert.deepEqual(original.map(c=>c.mute),[true,false]);
 assert.equal(nextTimelineFocus(state,{id:"b",kind:"audio"}).armed,null);
});
test("element isolation does not change the sound mix",()=>{
 const clips=[{id:"a",mute:false}];
 assert.equal(auditionAudio(clips,{kind:"element",id:"text"}),clips);
});
test("dialogue fitting caps acceleration, preserves complete line duration and separates speakers",()=>{
 const fitted=dialogueTiming([{start:0,audioDuration:6.61},{start:5,audioDuration:2}],10);
 assert.equal(fitted[0].speed,1.2);
 assert.equal(fitted[0].duration,6.61/1.2);
 assert.ok(fitted[1].start>=fitted[0].duration+.12);
 assert.ok(fitted[1].speed>=1&&fitted[1].speed<=1.2);
});
