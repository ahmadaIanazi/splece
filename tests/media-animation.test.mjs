import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import ffmpeg from "../server/ffmpeg-path.mjs";
import {
  mediaPose,
  mediaMotionPreset,
  setMediaPose,
  toggleMediaKeyframe,
  validateMediaVisual,
} from "../shared/media-animation.mjs";
import { renderEpisode, run, probe } from "../server/media.mjs";
import { newProject, validateProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { openStore } from "../server/store.mjs";
const clip = () => ({
  id: "clip",
  start: 3,
  in: 0,
  duration: 2,
  visual: {
    w: 0.4,
    h: 0.3,
    x: 0.3,
    y: 0.5,
    opacity: 1,
    rotation: 0,
    fit: "cover",
  },
});
test("media keyframes interpolate every transform, survive moves and duration edits, and preserve fit", () => {
  let c = clip();
  c.visual = setMediaPose(c, {}, 3, { keyframe: true });
  c.visual = setMediaPose(
    c,
    { x: 0.7, y: 0.7, w: 0.8, h: 0.6, rotation: 90, opacity: 0 },
    5,
  );
  const p = mediaPose(c, 4);
  assert.equal(p.x, 0.5);
  assert.equal(p.rotation, 45);
  assert.equal(p.opacity, 0.5);
  assert.equal(p.fit, "cover");
  assert.equal(mediaPose({ ...c, start: 9, duration: 8 }, 13).rotation, 45);
  const endpoint = setMediaPose(c, { rotation: 80 }, 4.999);
  assert.equal(endpoint.keyframes.length, 2, "editing the end-frame seek updates the existing key");
  assert.equal(endpoint.keyframes[1].at, 1);
  c.visual = toggleMediaKeyframe(c, 5);
  assert.equal(c.visual.keyframes.length, 1);
  c.visual = toggleMediaKeyframe(c, 3);
  assert.equal(c.visual.keyframes.length, 0);
  assert.equal(mediaPose(c, 4).x, 0.3);
  for (const id of ["zoom-in", "zoom-out", "pan-left", "pan-right"]) {
    const visual = mediaMotionPreset(c, id);
    validateMediaVisual(visual);
    assert.equal(visual.keyframes.length, 2);
    assert.equal(visual.easing, "smooth");
    assert.equal(visual.fit, "cover");
  }
  const zoom = { ...c, visual: mediaMotionPreset(c, "zoom-in") };
  assert.ok(mediaPose(zoom, 5).w > mediaPose(zoom, 3).w);
  const pan = { ...c, visual: mediaMotionPreset(c, "pan-left") };
  assert.ok(mediaPose(pan, 5).x < mediaPose(pan, 3).x);
  assert.throws(() =>
    validateMediaVisual({ keyframes: [{ at: 0.8 }, { at: 0.2 }] }),
  );
  assert.throws(() => validateMediaVisual({ keyframes: [{ at: NaN }] }));
  assert.throws(() =>
    validateMediaVisual({ keyframes: [{ at: 0, opacity: 2 }] }),
  );
});
test("animated footage saves and reloads with validation on both project and storage boundaries", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "motion-save-")),
    s = openStore(path.join(folder, "db.sqlite"));
  try {
    const p = upgradeProject(newProject("Motion QA")),
      c = { ...clip(), takes: [], activeTake: null };
    c.visual = mediaMotionPreset(c, "zoom-out");
    p.clips = [c];
    p.folder = folder;
    validateProject(p);
    s.save(p, 0);
    assert.deepEqual(s.get(p.id).project.clips[0].visual, c.visual);
    p.clips[0].visual.keyframes[0].at = -1;
    assert.throws(() => s.save(p, 1));
    assert.throws(() => validateProject(p));
  } finally {
    s.db.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
const pixel = (file, time, x, y) =>
  execFileSync(ffmpeg, [
    "-v",
    "error",
    "-ss",
    String(time),
    "-i",
    file,
    "-vf",
    `crop=2:2:${x}:${y},format=rgb24`,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
test("local export animates footage and images, retains audio, trims source, and renders opacity and rotation", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "motion-render-"));
  try {
    const source = path.join(folder, "red.mp4");
    await run([
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x180:r=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      source,
    ]);
    let c = {
      ...clip(),
      start: 0,
      in: 0.5,
      duration: 1,
      visual: {
        ...clip().visual,
        easing: "linear",
        x: 0.2,
        y: 0.5,
        w: 0.3,
        h: 0.3,
      },
    };
    c.visual = setMediaPose(c, {}, 0, { keyframe: true });
    c.visual = setMediaPose(
      c,
      { x: 0.8, w: 0.5, h: 0.4, rotation: 90, opacity: 0.3 },
      1,
    );
    const out = path.join(folder, "out.mp4");
    await renderEpisode(
      [c],
      () => ({ path: source, duration: 2, audio: true }),
      path.join(folder, "video-work"),
      out,
      { aspect: "16:9", resolution: "480p", fps: 24 },
    );
    const info = await probe(out);
    assert.ok(info.audio);
    assert.ok(Math.abs(info.duration - 1) < 0.08);
    const first = pixel(out, 0, 170, 240),
      gone = pixel(out, 0.8, 170, 240),
      last = pixel(out, 0.8, 580, 240);
    assert.ok(first[0] > 200 && first[1] < 20);
    assert.ok(gone[0] < 20);
    assert.ok(last[0] > 70 && last[0] < 160, "opacity interpolated");
    assert.ok(
      pixel(out, 0.8, 580, 60)[0] > 70,
      "rotation extends the tall rotated frame above its unrotated bounds",
    );
    const photo = path.join(folder, "photo.png");
    await run(["-i", source, "-frames:v", "1", photo]);
    let still = { ...c, in: 0, visual: { ...c.visual, easing: "hold" } };
    const imageOut = path.join(folder, "image.mp4");
    await renderEpisode(
      [still],
      () => ({
        path: photo,
        original: photo,
        kind: "image",
        duration: 5,
        audio: false,
      }),
      path.join(folder, "image-work"),
      imageOut,
      { aspect: "1:1", resolution: "480p", fps: 24 },
    );
    assert.ok(
      pixel(imageOut, 0.7, 96, 240)[0] > 200,
      "hold retains start pose",
    );
    assert.equal((await probe(imageOut)).width, 480);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
