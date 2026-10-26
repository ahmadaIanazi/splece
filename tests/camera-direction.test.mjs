import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraAtPoint, readCamera, writeCamera } from '../shared/camera-direction.mjs';
import { newProject, compilePrompt, models } from '../server/domain.mjs';
import { exportPrompt, importPrompt } from '../shared/authoring.mjs';

test('camera position clamps drag coordinates and preserves independent framing', () => {
  assert.deepEqual(cameraAtPoint(-10, -4), { elevation: 'Overhead', viewpoint: 'Left profile' });
  assert.deepEqual(cameraAtPoint(4, 8), { elevation: 'Low angle', viewpoint: 'Right profile' });
  const value = writeCamera('Close-up', cameraAtPoint(.5, 1));
  assert.equal(value, 'Close-up · Low angle · Front view');
  assert.equal(writeCamera(value, { framing: 'Wide shot' }), 'Wide shot · Low angle · Front view');
  assert.equal(readCamera('Aerial').elevation, 'Overhead');
  assert.equal(readCamera('An authored custom framing').recognized, false);
});
test('visual camera choices compile and survive JSON without changing writing, dialogue or cuts', () => {
  const p = newProject('Camera test'), d = p.drafts[0], s = d.scenes[0];
  p.assets.push({ id: 'speaker-test', kind: 'character', name: 'Speaker' });
  s.text = 'The dancer turns while the audience watches.';
  s.dialogue = [{ id: 'line', speaker: 'speaker-test', text: 'Keep this exact line.', delivery: 'Softly' }];
  s.transition = 'Cut'; s.movement = 'No movement';
  const authored = JSON.stringify({ text: s.text, dialogue: s.dialogue, transition: s.transition });
  s.camera = writeCamera('Medium shot', { elevation: 'Low angle', viewpoint: 'Three-quarter left' });
  const compiled = compilePrompt(p, d);
  assert.match(compiled.text, /Medium shot · Low angle · Three-quarter left/);
  assert.equal(JSON.stringify({ text: s.text, dialogue: s.dialogue, transition: s.transition }), authored);
  const imported = importPrompt(exportPrompt(p, d, compiled, models), p, models);
  assert.equal(imported.scenes[0].camera, s.camera);
  s.cameraDirection = 'My exact camera instructions.';
  const custom = compilePrompt(p, d).text;
  assert.match(custom, /My exact camera instructions/);
  assert.doesNotMatch(custom, /Medium shot · Low angle/);
});
