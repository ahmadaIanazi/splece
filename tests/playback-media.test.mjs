import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run, preparePlayback, probe } from "../server/media.mjs";

test("playback imports normalize variable cadence, preserve portrait shape/audio and never change originals", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "splece-playback-media-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "variable-portrait.mkv"),
    out = path.join(dir, "preview.mp4");
  await run([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=180x320:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:sample_rate=44100",
    "-t",
    "2",
    "-vf",
    "select='if(lt(t,1),1,not(mod(n,2)))'",
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "pcm_s16le",
    source,
  ]);
  const original = await fs.readFile(source);
  const info = await preparePlayback(source, out);
  assert.deepEqual(await fs.readFile(source), original);
  assert.equal(info.width, 180);
  assert.equal(info.height, 320);
  assert.equal(info.audio, true);
  assert.equal(info.codec, "h264");
  assert.equal(info.playback.version, 3);
  assert.ok(Math.abs(info.duration - 2) < 0.15);
  const decoded = await run([
    "-i",
    out,
    "-vf",
    "showinfo",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const frameList = path.join(dir, "frames.txt");
  await run([
    "-i",
    out,
    "-map",
    "0:v:0",
    "-fps_mode",
    "passthrough",
    "-f",
    "framemd5",
    frameList,
  ]);
  const frames = await fs.readFile(frameList, "utf8");
  assert.match(frames, /#tb 0: 1\/30/);
  const timestamps = frames
    .split("\n")
    .filter((line) => /^0,/.test(line))
    .map((line) => +line.split(",")[2]);
  assert.ok(timestamps.length >= 50);
  for (let i = 1; i < timestamps.length; i++)
    assert.equal(timestamps[i] - timestamps[i - 1], 1);
  const bytes = await fs.readFile(out);
  assert.ok(
    bytes.indexOf("moov") < bytes.indexOf("mdat"),
    "MP4 index must be available before playback bytes",
  );
  assert.match(decoded, /sar:1\/1/);
  assert.equal(
    (await fs.readdir(dir)).some((file) => file.includes("partial")),
    false,
  );
});

test("anamorphic and rotated footage retain their display proportions with zero-based playback", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "splece-playback-layout-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const anamorphic = path.join(dir, "wide-pixels.mp4"),
    fixed = path.join(dir, "square-pixels.mp4");
  await run([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x240:rate=25",
    "-t",
    "1",
    "-vf",
    "setsar=2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    anamorphic,
  ]);
  const info = await preparePlayback(anamorphic, fixed);
  assert.equal(info.width / info.height, 8 / 3);
  assert.equal(info.fps, 25);
  const rotated = path.join(dir, "rotated.mov"),
    normalized = path.join(dir, "rotated-preview.mp4");
  // Explicit input display rotation works across the bundled FFmpeg 6/7 builds;
  // the old output rotate metadata tag is ignored by newer Linux builds.
  await run([
    "-display_rotation:v:0",
    "90",
    "-i",
    anamorphic,
    "-c",
    "copy",
    rotated,
  ]);
  const portrait = await preparePlayback(rotated, normalized);
  assert.ok(portrait.height > portrait.width);
  const log = await run([
    "-i",
    normalized,
    "-vf",
    "showinfo",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  assert.match(log, /pts_time:0\s/);
  assert.match(log, /sar:1\/1/);
  const invalid = path.join(dir, "invalid.mp4");
  await fs.writeFile(invalid, "not a video");
  await assert.rejects(
    preparePlayback(invalid, path.join(dir, "bad-preview.mp4")),
    /Unsupported/,
  );
  assert.ok((await probe(normalized)).video);
});
