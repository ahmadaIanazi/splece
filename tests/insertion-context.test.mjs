import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineInsertionContext } from '../shared/insertion-context.mjs';

const project = {settings: {export: {fps: 24}}, clips: [
  {id:'b', start:5, duration:4}, {id:'a', start:0, duration:5},
  {id:'planned', start:9, duration:3}, {id:'d', start:15, duration:3},
]};
test('cut inference uses timeline order, captures both neighbours and never changes the project', () => {
  const before = structuredClone(project);
  assert.deepEqual(timelineInsertionContext(project, 5), {kind:'cut', at:5, previousClipId:'a', nextClipId:'b'});
  assert.deepEqual(project, before);
});
test('inside footage is distinct from a transition and carries a selected range', () => {
  assert.deepEqual(timelineInsertionContext(project, 6, {from:5.5,to:7.5}), {kind:'clip', at:6, clipId:'b', range:{from:5.5,to:7.5}});
  assert.equal(timelineInsertionContext(project, 6, {from:0,to:2}).range, undefined);
});
test('frame tolerance snaps to a cut, retaining planned neighbours instead of skipping missing footage', () => {
  assert.deepEqual(timelineInsertionContext(project, 9 + 1/48), {kind:'cut', at:9, previousClipId:'b', nextClipId:'planned'});
});
test('start, end and gaps do not invent a second source', () => {
  assert.deepEqual(timelineInsertionContext(project,0), {kind:'cut',at:0,nextClipId:'a'});
  assert.deepEqual(timelineInsertionContext(project,18), {kind:'cut',at:18,previousClipId:'d'});
  assert.deepEqual(timelineInsertionContext(project,13), {kind:'empty',at:13});
  assert.deepEqual(timelineInsertionContext({clips:[]},0), {kind:'empty',at:0});
});
