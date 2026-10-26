import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpeg from "../server/ffmpeg-path.mjs";
import { openStore } from "../server/store.mjs";
import { createAssetLibrary } from "../server/library.mjs";
import { renderTreatment } from "../server/clip-treatment.mjs";
import {
  applyClipTreatment,
  treatmentSignature,
  treatmentSource,
} from "../shared/clip-treatment.mjs";
import { insertPromptAtFrame } from "../shared/timeline-editing.mjs";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";

test("Shared library copies media independently, adopts into project folders, and respects Project only", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splece-library-")),
    store = openStore(path.join(dir, "test.sqlite"));
  try {
    const p = upgradeProject(newProject("Source")),
      q = upgradeProject(newProject("Target"));
    p.folder = path.join(dir, "source");
    q.folder = path.join(dir, "target");
    await fs.mkdir(p.folder, { recursive: true });
    await fs.mkdir(q.folder, { recursive: true });
    const file = path.join(p.folder, "portrait.png");
    await fs.writeFile(file, "synthetic image bytes");
    const m = {
      id: "img",
      projectId: p.id,
      path: file,
      original: file,
      poster: file,
      url: "/api/media/img",
      thumbnail: "/api/media/img/thumbnail",
      kind: "image",
      duration: 5,
    };
    store.putMedia(m);
    p.assets = [
      {
        id: "hero",
        name: "Shared explorer",
        kind: "character",
        media: m,
        variants: [{ id: "v", media: m }],
        description: "Fixture",
      },
      {
        id: "private",
        name: "Private",
        kind: "prop",
        scope: "project",
        media: m,
      },
    ];
    store.save(p, 0);
    store.save(q, 0);
    const library = createAssetLibrary(store, dir),
      entries = await library.list();
    assert.equal(entries.length, 1);
    assert.ok(
      entries[0].asset.media.path.startsWith(path.join(dir, "library")),
    );
    await fs.rm(file);
    const [adopted, repeated] = await Promise.all([
      library.adopt(entries[0].id, q),
      library.adopt(entries[0].id, q),
    ]);
    assert.equal(adopted.id, repeated.id);
    assert.ok(adopted.media.path.startsWith(q.folder));
    assert.equal(
      await fs.readFile(adopted.media.original, "utf8"),
      "synthetic image bytes",
    );
    assert.equal(adopted.media.id, adopted.variants[0].media.id);
    q.assets.push(adopted);
    store.save(q, 1);
    assert.equal((await library.adopt(entries[0].id, q)).id, adopted.id);
    p.assets[0].scope = "project";
    store.save(p, 1);
    await library.sync(p);
    assert.deepEqual(await library.list(), []);
    assert.equal(
      await fs.readFile(adopted.media.original, "utf8"),
      "synthetic image bytes",
    );
  } finally {
    store.db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Insert at a frame splits footage and ripples placeholders, draft timings and groups", () => {
  const p = upgradeProject(newProject("Insert test"));
  p.settings.export.fps = 24;
  p.clips = [
    {
      id: "a",
      start: 0,
      in: 1,
      duration: 6,
      takes: [{ id: "m", duration: 10 }],
      activeTake: "m",
    },
    {
      id: "b",
      start: 6,
      in: 0,
      duration: 4,
      takes: [{ id: "n", duration: 4 }],
      activeTake: "n",
    },
  ];
  p.drafts[0].targetId = "b";
  p.drafts[0].start = 6;
  const result = insertPromptAtFrame(p, "a", 2, 5, () => "right");
  assert.deepEqual(
    [...p.clips]
      .sort((a, b) => a.start - b.start)
      .map((c) => [c.start, c.duration]),
    [
      [0, 2],
      [2, 5],
      [7, 4],
      [11, 4],
    ],
  );
  assert.ok(Math.abs(result.frames.start.time - (3 - 1 / 24)) < 1e-9);
  assert.equal(result.frames.end.time, 3);
  assert.equal(p.clips.find((c) => c.id === "right").in, 3);
  assert.equal(p.drafts[0].start, 11);
  assert.equal(result.node.start, 2);
  assert.equal(result.node.end, 7);
});

test("Local reverse and micro-speed render playable media with audio; applying retains original and ripples", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splece-treatment-")),
    store = openStore(path.join(dir, "db.sqlite"));
  try {
    const p = upgradeProject(newProject("Treatment"));
    p.folder = dir;
    await fs.mkdir(path.join(dir, "media"));
    const file = path.join(dir, "media", "source.mp4");
    execFileSync(
      ffmpeg,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=red:s=64x64:r=24:d=2",
        "-f",
        "lavfi",
        "-i",
        "color=blue:s=64x64:r=24:d=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=330:duration=4",
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
        "-map",
        "2:a",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        file,
      ],
      { stdio: "ignore" },
    );
    const media = {
      id: "source",
      projectId: p.id,
      path: file,
      duration: 4,
      kind: "video",
      audio: true,
      name: "Test source",
    };
    store.putMedia(media);
    const clip = {
      id: "a",
      start: 0,
      in: 0.5,
      duration: 3,
      takes: [media],
      activeTake: "source",
    };
    p.clips = [
      clip,
      {
        id: "b",
        start: 3,
        in: 0,
        duration: 1,
        takes: [media],
        activeTake: "source",
      },
    ];
    p.drafts[0].targetId = "b";
    p.drafts[0].start = 3;
    const signature = treatmentSignature(clip),
      source = treatmentSource(clip);
    const adjusted = await renderTreatment(
      { id: "test", snapshot: { source, speed: 1.5, reverse: true, fps: 24 } },
      store,
      p,
    );
    assert.ok(Math.abs(adjusted.duration - 2) < 0.08);
    assert.equal(adjusted.audio, true);
    const pixel = execFileSync(ffmpeg, [
      "-v",
      "error",
      "-i",
      adjusted.path,
      "-frames:v",
      "1",
      "-vf",
      "scale=1:1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    assert.ok(pixel[2] > pixel[0] + 100, "reverse opens on blue end of source");
    applyClipTreatment(p, "a", adjusted, signature);
    assert.equal(clip.takes.length, 2);
    assert.equal(clip.in, 0);
    assert.equal(p.drafts[0].start, adjusted.duration);
    const mapped = treatmentSource(clip);
    assert.equal(mapped.mediaId, "source");
    assert.ok(Math.abs(mapped.duration - 3) < 0.12);
    assert.throws(
      () => applyClipTreatment(p, "a", adjusted, signature),
      /changed/,
    );
  } finally {
    store.db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Silent footage supports fine speed changes, and padded takes stay inside their original source bounds", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "splece-silent-treatment-"),
  );
  const store = openStore(path.join(dir, "db.sqlite"));
  try {
    const p = upgradeProject(newProject("Silent treatment"));
    p.folder = dir;
    const file = path.join(dir, "silent.mp4");
    execFileSync(
      ffmpeg,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=green:s=64x64:r=24:d=2",
        "-an",
        "-c:v",
        "libx264",
        file,
      ],
      { stdio: "ignore" },
    );
    store.putMedia({
      id: "silent",
      path: file,
      projectId: p.id,
      name: "Silent",
      duration: 2,
      kind: "video",
      audio: false,
    });
    const source = { mediaId: "silent", in: 0.25, duration: 1.1 };
    const media = await renderTreatment(
      {
        id: "slow",
        snapshot: { source, speed: 0.25, reverse: false, fps: 24 },
      },
      store,
      p,
    );
    assert.equal(media.audio, false);
    assert.ok(Math.abs(media.duration - 4.4) < 0.05);
    const padded = {
      ...media,
      treatment: { source, speed: 0.25, reverse: true },
    };
    const mapped = treatmentSource({
      in: 0,
      duration: 4.5,
      activeTake: media.id,
      takes: [padded],
    });
    assert.equal(mapped.in, source.in);
    assert.equal(mapped.duration, source.duration);
  } finally {
    store.db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
