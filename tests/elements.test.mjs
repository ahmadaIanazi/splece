import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpeg from "../server/ffmpeg-path.mjs";
import {
  newElement,
  putKeyframe,
  elementPose,
  resizeElementTime,
  elementsSVG,
  validateElements,
  elementsFor,
  setElementPose,
} from "../shared/elements.mjs";
import { renderEpisode, run, probe } from "../server/media.mjs";
import { newProject, validateProject } from "../server/domain.mjs";
import { upgradeProject, exportSize } from "../shared/studio.mjs";
import { openStore } from "../server/store.mjs";
test("elements interpolate, scale keyframes, isolate episodes and escape user text", () => {
  let e = {
    ...newElement("text", 2, "episode-a"),
    duration: 2,
    easing: "linear",
    text: '<script>alert("hi")</script> & مرحبا',
  };
  e = putKeyframe(e, 2, { ...e, x: 0.2 });
  e = putKeyframe(e, 4, { ...e, x: 0.8 });
  assert.deepEqual(
    exportSize({ aspect: "4:5", resolution: "480p" }),
    [480, 600],
  );
  assert.equal(elementPose(e, 3).x, 0.5);
  assert.equal(elementPose({ ...e, easing: "hold" }, 3).x, 0.2);
  const resized = resizeElementTime(e, 5, 4);
  assert.equal(resized.keyframes[1].t, 4);
  assert.equal(elementPose(resized, 7).x, 0.5);
  assert.equal(setElementPose(e, { opacity: 0.4 }, 3).keyframes.length, 3);
  assert.equal(elementsFor({ elements: [e], episodeId: "other" }).length, 0);
  const svg = elementsSVG([e], 3, 640, 360);
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(!elementsSVG([e], 4, 640, 360).includes("<text"));
  validateElements([e]);
  assert.throws(() => validateElements([{ ...e, color: "url(http://evil)" }]));
  assert.throws(() => validateElements([{ ...e, x: NaN }]));
  assert.throws(() =>
    validateElements([{ ...e, keyframes: [{ ...e.keyframes[1], t: 8 }] }]),
  );
});
test("elements and media framing persist through save and reload", async () => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "splece-elements-store-"),
  );
  let store;
  try {
    store = openStore(path.join(folder, "test.sqlite"));
    const p = upgradeProject(newProject("Elements test"));
    p.folder = folder;
    p.elements = [newElement("arrow", 0, p.episodeId)];
    validateProject(p);
    store.save(p, 0);
    const loaded = store.get(p.id);
    assert.deepEqual(loaded.project.elements, p.elements);
    p.elements[0].color = "#ff00ff";
    store.save(p, loaded.revision);
    assert.equal(store.get(p.id).project.elements[0].color, "#ff00ff");
  } finally {
    store?.db.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
function pixel(file, time, x, y) {
  return execFileSync(ffmpeg, [
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
}
test("real export preserves sound, media transforms, animated shapes and elements-only timelines", async () => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "splece-elements-render-"),
  );
  try {
    const source = path.join(folder, "source.mp4");
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
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      source,
    ]);
    let e = {
      ...newElement("rectangle"),
      duration: 1,
      color: "#00ff00",
      w: 0.2,
      h: 0.2,
      easing: "linear",
    };
    e = putKeyframe(e, 0, { ...e, x: 0.2, y: 0.2 });
    e = putKeyframe(e, 1, { ...e, x: 0.8, y: 0.2 });
    const out = path.join(folder, "out.mp4");
    await renderEpisode(
      [
        {
          id: "clip",
          start: 0,
          duration: 1,
          in: 0,
          visual: {
            x: 0.5,
            y: 0.7,
            w: 0.5,
            h: 0.4,
            opacity: 1,
            rotation: 0,
            fit: "cover",
          },
        },
      ],
      () => ({ path: source, duration: 1, audio: true }),
      path.join(folder, "work"),
      out,
      { aspect: "16:9", resolution: "480p", fps: 24 },
      [],
      () => null,
      [
        e,
        {
          ...newElement("text"),
          duration: 1,
          text: "Hello · مرحبا",
          y: 0.5,
          font: "Noto Sans Arabic",
          fontSize: 0.08,
        },
      ],
    );
    const info = await probe(out);
    assert.ok(info.audio);
    assert.ok(Math.abs(info.duration - 1) < 0.1);
    const green = pixel(out, 0, 170, 96);
    assert.ok(green[1] > 180 && green[0] < 50, "initial green rectangle");
    const clear = pixel(out, 0.8, 170, 96);
    assert.ok(clear[1] < 40, "rectangle moved away");
    const red = pixel(out, 0.8, 425, 340);
    assert.ok(red[0] > 180 && red[1] < 50, "reframed red footage");
    const black = pixel(out, 0.8, 20, 340);
    assert.ok(black[0] < 40, "footage resized with black surround");
    const photo = path.join(folder, "photo.png");
    await run(["-i", source, "-frames:v", "1", photo]);
    const photoOut = path.join(folder, "photo.mp4");
    await renderEpisode(
      [
        {
          start: 0,
          duration: 1.5,
          in: 0,
          visual: { w: 0.7, h: 0.7, fit: "contain" },
        },
      ],
      () => ({
        path: photo,
        original: photo,
        kind: "image",
        duration: 1,
        audio: false,
      }),
      path.join(folder, "photo-work"),
      photoOut,
      { aspect: "4:5", resolution: "480p", fps: 24 },
    );
    const photoInfo = await probe(photoOut);
    assert.equal(photoInfo.width, 480);
    assert.equal(photoInfo.height, 600);
    assert.ok(photoInfo.duration >= 1.5);
    const only = path.join(folder, "only.mp4");
    await renderEpisode(
      [],
      () => null,
      path.join(folder, "only-work"),
      only,
      { aspect: "16:9", resolution: "480p", fps: 24 },
      [],
      () => null,
      [{ ...newElement("ellipse"), duration: 0.5 }],
    );
    assert.ok((await probe(only)).duration >= 0.5);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
