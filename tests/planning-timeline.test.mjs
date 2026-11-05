import test from 'node:test';
import assert from 'node:assert/strict';
import {planningTimeline} from '../shared/planning-timeline.mjs';
test('parents become timed headings; only terminal nodes remain cards',()=>{
 const layout=planningTimeline({beats:[
  {id:'chapter',kind:'chapter',start:0,duration:60},
  {id:'scene',kind:'scene',parentId:'chapter',start:0,duration:30},
  {id:'a',kind:'clip',parentId:'scene',start:0,duration:10},
  {id:'b',kind:'clip',parentId:'scene',start:15,duration:15},
  {id:'empty',kind:'scene',parentId:'chapter',start:30,duration:30},
 ]});
 assert.deepEqual(layout.cards.map(n=>n.id),['a','b','empty']);
 assert.deepEqual(layout.groups.map(n=>[n.id,n.start,n.end,n.boardDepth]),[['chapter',0,60,0],['scene',0,30,1]]);
 assert.equal(layout.depth,2);assert.equal(layout.end,60);
 assert.equal(layout.cards[1].start,15); // preserve the gap, not equal-width columns
 assert.equal(layout.cards[1].duration/layout.cards[0].duration,1.5);
});
test('empty outline and orphan clips remain usable',()=>{
 assert.deepEqual(planningTimeline({beats:[]}),{cards:[],groups:[],depth:0,end:0});
 const layout=planningTimeline({beats:[{id:'a',parentId:'missing',kind:'clip',start:4,duration:6}]});
 assert.equal(layout.cards.length,1);assert.equal(layout.end,10);
});
test('placed clip timing follows the edit without rewriting the plan',()=>{
 const plan={beats:[{id:'a',kind:'clip',start:0,duration:15}]};
 const layout=planningTimeline(plan,new Map([['a',{placed:true,start:4,end:10}]]));
 assert.equal(layout.cards[0].start,4);assert.equal(layout.cards[0].duration,6);
 assert.equal(plan.beats[0].duration,15);
});

test('readable board includes imported clips and preserves short-clip seeking', async()=>{
 const {planningBoard}=await import('../shared/planning-timeline.mjs');
 const result=planningBoard({cards:[{id:'planned',start:0,duration:.01}],groups:[],end:.01,depth:0},[{id:'linked',storyBeatId:'planned',start:0,duration:.01},{id:'imported',start:.01,duration:5}],.1);
 assert.equal(result.cards.length,2);
 assert.equal(result.cards[1].importedClipId,'imported');
 assert.ok(result.cards.every(c=>c.width>=260));
 assert.ok(result.cards[1].left>=result.cards[0].width);
 assert.equal(result.atPixel(result.atTime(.005)),.005);
 assert.ok(Math.abs(result.atPixel(result.atTime(2))-2)<.001);
});

test('split clips linked to one plan card remain visible individually',async()=>{
 const {planningBoard}=await import('../shared/planning-timeline.mjs');
 const board=planningBoard({cards:[{id:'a',start:0,duration:5}],groups:[],end:5},[{id:'first',storyBeatId:'a',start:0,duration:5},{id:'split',storyBeatId:'a',start:5,duration:2}]);
 assert.equal(board.cards.length,2);assert.equal(board.cards[1].importedClipId,'split');
});
