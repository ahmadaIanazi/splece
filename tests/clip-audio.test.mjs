import test from "node:test";
import assert from "node:assert/strict";
import { clipAudioTarget, clipAudioGain, clipVolumePatch, toggleClipAudio, patchClipAudio } from "../shared/clip-audio.mjs";

test("a zero-volume clip can be unmuted whether or not its mute flag is set", () => {
  for (const mute of [true, false]) {
    const clip = {volume: 0, mute};
    Object.assign(clip, toggleClipAudio(clip));
    assert.equal(clipAudioGain(clip), 1);
    Object.assign(clip, clipVolumePatch(0));
    assert.equal(clipAudioGain(clip), 0);
    Object.assign(clip, clipVolumePatch(0.35));
    assert.equal(clipAudioGain(clip), 0.35);
    assert.equal(clip.mute, false);
  }
  const clip = {volume: 0.45};
  Object.assign(clip, toggleClipAudio(clip));
  assert.equal(clipAudioGain(clip), 0);
  Object.assign(clip, toggleClipAudio(clip));
  assert.equal(clipAudioGain(clip), 0.45);
});

test("clip controls resolve the active take and change only its linked voice", () => {
  const clip = {id:'c', activeTake:'sync', start:10, in:0, duration:5, mute:true,
    takes:[{id:'source',audio:true},{id:'sync',audio:false,lipSync:{audioId:'voice'}}]};
  const voice = {id:'voice',mediaId:'speech',start:9,in:1,duration:6,volume:0,mute:true};
  const ambience = {id:'bed',volume:0.2};
  const project = {clips:[clip], audioClips:[voice,ambience]};
  const sound = clipAudioTarget(project,clip);
  assert.equal(sound.mediaId,'speech');
  assert.equal(sound.sourceIn,2);
  assert.equal(sound.record,voice);
  patchClipAudio(project,'c',clipVolumePatch(0.7));
  assert.equal(voice.volume,0.7);
  assert.equal(voice.mute,false);
  assert.equal(clip.mute,true);
  assert.equal(ambience.volume,0.2);
  clip.activeTake='source';
  assert.equal(clipAudioTarget(project,clip).record,clip);
  patchClipAudio(project,'c',clipVolumePatch(0.4));
  assert.equal(clip.volume,0.4);
  assert.equal(voice.volume,0.7);
  clip.activeTake='sync';
  project.audioClips=[];
  assert.equal(clipAudioTarget(project,clip),null);
  assert.equal(clipAudioTarget(project,null),null);
});
