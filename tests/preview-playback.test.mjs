import test from "node:test";
import assert from "node:assert/strict";
import { PreviewPlayback } from "../shared/preview-playback.mjs";

class Video extends EventTarget {
  readyState = 4;
  duration = 20;
  paused = true;
  seeking = false;
  ended = false;
  seeks = [];
  plays = 0;
  position = 0;
  get currentTime() {
    return this.position;
  }
  set currentTime(value) {
    this.position = value;
    this.seeks.push(value);
  }
  play() {
    this.plays++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  emit(name) {
    this.dispatchEvent(new Event(name));
  }
}
function fixture() {
  let at = 0,
    stopped = false,
    handle = 0;
  const times = [],
    statuses = [],
    frames = new Map();
  const video = new Video();
  let config = {
    scope: "test/episode",
    clip: { id: "first", start: 0, in: 0, duration: 5 },
    take: { id: "video", url: "/synthetic.mp4" },
    total: 10,
    playing: true,
    enabled: true,
    time: 0,
    seekId: 0,
    gain: () => 1,
  };
  const controller = new PreviewPlayback({
    now: () => at,
    requestFrame: (fn) => {
      frames.set(++handle, fn);
      return handle;
    },
    cancelFrame: (id) => frames.delete(id),
    onTime: (time) => {
      times.push(time);
      config = { ...config, time };
    },
    onStop: () => {
      stopped = true;
    },
    onStatus: (status) => statuses.push(status),
  });
  const update = (patch = {}) => {
    config = { ...config, ...patch };
    controller.update(video, config);
  };
  const tick = (elapsed = 50) => {
    at += elapsed;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn(at));
    update();
  };
  return {
    video,
    controller,
    update,
    tick,
    times,
    statuses,
    get stopped() {
      return stopped;
    },
  };
}

test("decoder stalls cannot make the editor repeatedly seek or skip ahead", () => {
  const f = fixture();
  f.video.readyState = 0;
  f.update();
  for (let i = 0; i < 60; i++) f.tick();
  assert.equal(f.video.seeks.length, 0);
  assert.equal(f.times.length, 0, "loading must not advance the timeline");
  f.video.readyState = 4;
  f.video.emit("loadedmetadata");
  f.video.emit("playing");
  for (let i = 1; i <= 24; i++) {
    f.video.position = i / 24;
    f.tick(1000 / 24);
  }
  assert.ok(Math.abs(f.times.at(-1) - 1) < 0.05);
  f.video.emit("waiting");
  for (let i = 0; i < 100; i++) f.tick();
  assert.equal(
    f.times.at(-1),
    1,
    "wall time cannot move a stalled video cursor",
  );
  assert.equal(f.video.seeks.length, 0);
  assert.equal(f.video.plays, 1, "renders must not repeatedly invoke play()");
  f.controller.destroy();
});

test("manual seeking happens once; trimming and consecutive slices of one source use their own ranges", () => {
  const f = fixture();
  f.update();
  f.update({ time: 2, seekId: 1 });
  for (let i = 0; i < 5; i++) f.tick();
  assert.deepEqual(f.video.seeks, [2]);
  f.update({
    clip: { id: "first", start: 0, in: 2, duration: 2 },
    time: 0,
    seekId: 2,
  });
  f.video.position = 4;
  f.tick();
  assert.equal(f.times.at(-1), 2);
  assert.equal(f.video.paused, true);
  f.update({
    clip: { id: "slice-two", start: 2, in: 7, duration: 3 },
    time: 2,
  });
  assert.equal(f.video.currentTime, 7);
  assert.equal(f.video.paused, false);
  f.video.position = 7.5;
  f.tick();
  assert.equal(f.times.at(-1), 2.5);
  f.controller.destroy();
});

test("a slow next clip loads at its trim instead of skipping its opening", () => {
  const f = fixture();
  f.update();
  f.video.position = 5;
  f.tick();
  assert.equal(f.times.at(-1), 5);
  f.video.readyState = 0;
  f.video.position = 0;
  f.update({
    clip: { id: "second", start: 5, in: 1, duration: 5 },
    take: { id: "second", url: "/second.mp4" },
    time: 5,
  });
  for (let i = 0; i < 100; i++) f.tick();
  assert.equal(f.times.at(-1), 5);
  f.video.readyState = 4;
  f.video.emit("loadedmetadata");
  assert.equal(f.video.currentTime, 1);
  f.video.position = 1.2;
  f.tick();
  assert.equal(f.times.at(-1), 5.2);
  f.controller.destroy();
});

test("pause, last frame, decoder errors and unexpectedly short takes stop cleanly", () => {
  const f = fixture();
  f.update();
  f.update({ playing: false, time: 3, seekId: 1 });
  f.tick(2000);
  assert.equal(f.video.currentTime, 3);
  assert.equal(f.video.paused, true);
  f.update({ playing: true, total: 5 });
  f.video.position = 5;
  f.video.ended = true;
  f.video.emit("ended");
  assert.equal(f.stopped, true);
  assert.equal(f.times.at(-1), 5);
  f.update({ playing: false, time: 5, seekId: 2 });
  assert.ok(f.video.currentTime < 5 && f.video.currentTime > 4.95);
  f.controller.destroy();
  const broken = fixture();
  broken.update();
  broken.video.emit("error");
  assert.equal(broken.stopped, true);
  assert.match(broken.statuses.at(-1).message, /optimizing/);
  broken.controller.destroy();
  const short = fixture();
  short.update();
  short.video.position = 1;
  short.video.ended = true;
  short.video.emit("ended");
  assert.equal(short.stopped, true);
  assert.equal(short.times.at(-1), 1);
  assert.match(short.statuses.at(-1).message, /ends before/);
  short.controller.destroy();
});

test("proxy preparation holds playback position while an unfilled planned slot may advance", () => {
  let cb,
    position = 0;
  const p = new PreviewPlayback({
    onTime: (t) => (position = t),
    onStop: () => {},
    onStatus: () => {},
    requestFrame: (f) => ((cb = f), 1),
    cancelFrame: () => {},
    now: () => 0,
  });
  const config = {
    scope: "test",
    clip: { id: "c", start: 0, in: 0, duration: 5 },
    take: { id: "media", url: null },
    time: 0,
    total: 10,
    playing: true,
    enabled: true,
    seekId: 0,
    gain: () => 1,
  };
  p.update(null, config);
  cb(1000);
  assert.equal(position, 0);
  p.update(null, { ...config, take: null });
  cb(2000);
  assert.ok(position > 0);
  p.destroy();
});
