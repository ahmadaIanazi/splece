import test from "node:test";
import assert from "node:assert/strict";
import {
  audioClip,
  detachAudio,
  copyAudio,
  splitAudio,
  editAudio,
  blendAudio,
  matchAudioLevels,
} from "../shared/audio-editing.mjs";
import { audioGain } from "../shared/studio.mjs";
import { AudioTransport } from "../shared/audio-playback.mjs";

const media = { id: "sound", name: "Sound", duration: 12, audio: true };
const project = () => ({
  audioClips: [],
  audioLanes: 1,
  clips: [
    {
      id: "video",
      takes: [media],
      activeTake: media.id,
      start: 3,
      in: 2,
      duration: 6,
      volume: 0.7,
      fadeIn: 1,
      fadeOut: 2,
    },
  ],
});
test("detaching preserves the trimmed source, mutes only picture sound and is idempotent", () => {
  const p = project(),
    audio = detachAudio(p, "video", "audio");
  assert.deepEqual(
    [audio.start, audio.in, audio.duration, audio.volume],
    [3, 2, 6, 0.7],
  );
  assert.equal(p.clips[0].mute, true);
  assert.equal(audio.mute, false);
  assert.equal(detachAudio(p, "video", "duplicate").id, "audio");
  assert.equal(p.audioClips.length, 1);
  const restored = JSON.parse(JSON.stringify(p));
  assert.deepEqual(restored, p);
  assert.equal(restored.clips[0].takes[0].audio, true);
});
test("audio split preserves audible envelope even within fades; copy is independent and avoids hiding overlaps", () => {
  const p = project(),
    source = structuredClone(detachAudio(p, "video", "audio"));
  splitAudio(p, "audio", 3.5, "right");
  for (let at = 3; at < 9; at += 0.07) {
    const clip = p.audioClips.find(
      (c) => at >= c.start && at < c.start + c.duration,
    );
    assert.ok(Math.abs(audioGain(clip, at) - audioGain(source, at)) < 1e-8);
  }
  const copied = copyAudio(p, p.audioClips[1], "copy", 3.5);
  assert.equal(copied.lane, 1);
  copied.volume = 0.2;
  assert.equal(p.audioClips[1].volume, 0.7);
  assert.throws(() => splitAudio(p, "audio", 3, "invalid"), /playhead/);
});
test("trims stay inside source; crossfade uses handles without changing picture or following timing", () => {
  const p = project(),
    a = audioClip(media, "a"),
    b = audioClip(media, "b", 4);
  a.duration = 4;
  b.in = 4;
  b.duration = 4;
  p.audioClips = [a, b];
  const video = structuredClone(p.clips);
  assert.equal(blendAudio(p, "a"), 0.5);
  assert.equal(a.duration, 4.5);
  assert.equal(b.start, 4);
  for (let at = 4; at < 4.5; at += 0.05)
    assert.ok(Math.abs(audioGain(a, at) + audioGain(b, at) - 1) < 1e-8);
  assert.deepEqual(p.clips, video);
  editAudio(b, { in: 11, duration: 5 });
  assert.equal(b.duration, 1);
  editAudio(b, { start: -3, volume: 3, lane: 500 });
  assert.equal(b.start, 0);
  assert.equal(b.volume, 1);
  assert.equal(b.lane, 255);
  b.start = 10;
  b.lane = 0;
  assert.throws(() => blendAudio(p, "a"), /gap/);
});
test("level matching measures trimmed regions, skips silence and mute, attenuates without clipping", () => {
  const a = audioClip(media, "a"),
    b = audioClip({ ...media, id: "quiet" }, "b"),
    silent = audioClip({ ...media, id: "silent" }, "s");
  a.duration = b.duration = silent.duration = 1;
  const data = {
    sound: { step: 1, rms: [0.5, 0.01], peaks: [0.9, 0.02] },
    quiet: { step: 1, rms: [0.05], peaks: [0.1] },
    silent: { step: 1, rms: [0], peaks: [0] },
  };
  assert.equal(matchAudioLevels([a, b, silent], data), 2);
  assert.equal(a.volume, 0.1);
  assert.equal(b.volume, 1);
  assert.equal(silent.volume, 1);
  a.volume = 0.05;
  b.volume = 0.5;
  silent.volume = 0;
  assert.equal(matchAudioLevels([a, b, silent], data), 2);
  assert.equal(silent.volume, 0);
  assert.ok(a.volume <= 0.05 && b.volume <= 0.5);
});
class FakeAudio extends EventTarget {
  readyState = 4;
  paused = true;
  seeking = false;
  volume = 1;
  position = 0;
  seeks = [];
  plays = 0;
  get currentTime() {
    return this.position;
  }
  set currentTime(t) {
    this.position = t;
    this.seeks.push(t);
  }
  play() {
    this.plays++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
test("audio transport follows the decoder without seeking each display tick, handles scrubs and buffering resume", async () => {
  const a = new FakeAudio(),
    controller = new AudioTransport(a),
    clip = audioClip(media, "a");
  clip.in = 2;
  clip.duration = 5;
  controller.update({ clip, time: 0, playing: true, seekId: 0 });
  await Promise.resolve();
  assert.deepEqual(a.seeks, [2]);
  for (let i = 1; i < 40; i++) {
    a.position = 2 + i * 0.05;
    controller.update({ clip, time: i * 0.05, playing: true, seekId: 0 });
  }
  assert.equal(a.seeks.length, 1);
  assert.equal(a.plays, 1);
  controller.update({ clip, time: 1, playing: false, seekId: 1 });
  assert.equal(a.currentTime, 3);
  assert.ok(a.paused);
  controller.update({ clip, time: 1.1, playing: true, seekId: 1 });
  assert.equal(a.currentTime, 3.1);
  controller.update({ clip, time: 5, playing: true, seekId: 1 });
  assert.ok(a.paused);
  controller.destroy();
});
test("audio startup uses the live decoder time after asynchronous loading", () => {
  const a = new FakeAudio(),
    controller = new AudioTransport(a),
    clip = audioClip(media, "a");
  clip.in = 2;
  let actualTime = 0;
  controller.update({
    clip,
    time: 0,
    readTime: () => actualTime,
    playing: true,
    seekId: 0,
  });
  actualTime = 0.24;
  a.dispatchEvent(new Event("playing"));
  assert.equal(a.currentTime, 2.24);
  const count = a.seeks.length;
  for (let i = 1; i < 20; i++) {
    actualTime += 0.05;
    a.position = 2 + actualTime;
    controller.update({
      clip,
      time: actualTime - 0.04,
      readTime: () => actualTime,
      playing: true,
      seekId: 0,
    });
  }
  assert.equal(a.seeks.length, count);
  controller.destroy();
});
