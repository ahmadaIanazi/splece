import test from 'node:test';
import assert from 'node:assert/strict';
import { editShortcut, ownsTransport, shortcutHint } from '../shared/editor-shortcuts.mjs';
import { takeWheelGesture } from '../shared/editor-polish.mjs';
const event = (key, extra = {}) => ({key, code:key, ...extra});
test('Save can never split, including while writing; redo accepts shifted uppercase Z', () => {
  for (const mod of ['metaKey','ctrlKey']) {
    assert.equal(editShortcut(event('s', {[mod]:true})), 'save');
    assert.equal(editShortcut(event('s', {[mod]:true}), {editable:true,composer:true}), 'save');
    assert.equal(editShortcut(event('Z', {[mod]:true,shiftKey:true})), 'redo');
    assert.equal(editShortcut(event('z', {[mod]:true})), 'undo');
    assert.equal(editShortcut(event('Z', {[mod]:true,shiftKey:true}), {editable:true}), null);
  }
  assert.equal(editShortcut(event('s')), 'split');
  for (const flag of ['altKey','shiftKey','repeat','isComposing','defaultPrevented']) assert.equal(editShortcut(event('s',{[flag]:true})), null);
});
test('focused controls, dialogs, comparison and consumed events retain keyboard ownership', () => {
  const space = event(' ', {code:'Space'});
  for (const state of [{editable:true},{control:true},{blocked:true}]) assert.equal(ownsTransport(space,state), false);
  for (const flag of ['metaKey','ctrlKey','altKey','shiftKey','repeat','defaultPrevented','isComposing']) assert.equal(ownsTransport({...space,[flag]:true}),false);
  assert.equal(ownsTransport(space), true);
  assert.equal(ownsTransport(event('ArrowRight',{repeat:true,shiftKey:true})),true);
  assert.equal(editShortcut(event('Backspace'),{control:true}),null);
  assert.equal(editShortcut(event('c',{metaKey:true})), 'copy');
});
test('modified take wheel and its momentum do not switch takes; ordinary fresh gesture still works', () => {
  for (const modifier of ['metaKey','ctrlKey','altKey','shiftKey']) {
    const ignored = takeWheelGesture(null,{clipId:'c',deltaY:100,at:0,[modifier]:true});
    assert.equal(ignored.direction,0);
    assert.equal(takeWheelGesture(ignored.state,{clipId:'c',deltaY:90,at:50}).direction,0);
    assert.equal(takeWheelGesture(ignored.state,{clipId:'c',deltaY:90,at:1000}).direction,-1);
  }
});
test('shortcut hints use platform-appropriate modifier labels', () => {
 assert.equal(shortcutHint('z',true,'MacIntel'),'⇧⌘Z');
 assert.equal(shortcutHint('z',true,'Win32'),'Ctrl+Shift+Z');
});
