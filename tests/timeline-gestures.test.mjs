import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubTime, wheelZoom } from '../shared/timeline-gestures.mjs';

test('scrubbing accounts for timeline position, scroll, grab offset and frame rate', () => {
  const input = {clientX: 412, left: 100, scrollLeft: 240, offset: 12, zoom: 120, fps: 24, maxTime: 15};
  assert.equal(scrubTime(input), 4.5);
  assert.equal(scrubTime({...input, clientX: 417}), 4.5 + 1/24);
  assert.equal(scrubTime({...input, clientX: -500}), 0);
  assert.equal(scrubTime({...input, clientX: 5000}), 15);
});

test('zoom keeps the time under the pointer fixed in a scrolled timeline', () => {
  const input = {zoom: 120, scrollLeft: 500, pointerX: 300, deltaY: -100};
  const next = wheelZoom(input);
  assert.ok(next.zoom > 120);
  assert.ok(Math.abs((next.left + 300) / next.zoom - 800/120) < 1e-10);
  const back = wheelZoom({...input, zoom: next.zoom, scrollLeft: next.left, deltaY: 100});
  assert.ok(Math.abs(back.zoom - 120) < 1e-10);
  assert.ok(Math.abs(back.left - 500) < 1e-10);
});

test('wheel zoom handles mouse lines, trackpad pixels and extreme zoom boundaries', () => {
  const base = {zoom: 120, scrollLeft: 0, pointerX: 0};
  assert.deepEqual(wheelZoom({...base,deltaY:3,deltaMode:1}),wheelZoom({...base,deltaY:48}));
  assert.equal(wheelZoom({...base,zoom:240,deltaY:-1000}).zoom,240);
  assert.equal(wheelZoom({...base,zoom:0.1,deltaY:1000}).zoom,0.1);
  assert.equal(wheelZoom({...base,deltaY:0}).zoom,120);
  assert.equal(wheelZoom({...base,deltaY:200,pointerX:300}).left,0);
});
