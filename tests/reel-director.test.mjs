import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  associateFaces,
  trackSelectedSubject,
} from "../shared/subject-tracking.mjs";
import {
  directShot,
  recordedDialogue,
  subjectAt,
  validateDirection,
  portraitGeometry,
} from "../shared/reel-director.mjs";
import { cropAt, validateReelPlan } from "../shared/reel-effects.mjs";
import { dialogueSignature } from "../shared/soundtrack-dialogue.mjs";
import { soundSource } from "../shared/soundtrack.mjs";
import { portraitFilter } from "../server/reel-effects.mjs";
import { run } from "../server/media.mjs";
const box = (x, y = 0.2, w = 0.1, h = 0.2) => ({ x, y, w, h });
const subject = (id, x) => ({
  id,
  name: id,
  kind: "face",
  points: Array.from({ length: 25 }, (_, i) => ({
    t: i / 4,
    box: box(x),
    confidence: 0.95,
  })),
});
const source = { id: "s", width: 320, height: 180, duration: 6 };

test("multiple faces retain tracks when detector order and size change", () => {
  const samples = Array.from({ length: 8 }, (_, i) => ({
    t: i / 4,
    faces:
      i % 2
        ? [
            { ...box(0.7 - i * 0.005), confidence: 0.9 },
            { ...box(0.1 + i * 0.005), confidence: 0.9 },
          ]
        : [
            { ...box(0.1 + i * 0.005), confidence: 0.9 },
            { ...box(0.7 - i * 0.005), confidence: 0.9 },
          ],
  }));
  const tracks = associateFaces(samples);
  assert.equal(tracks.length, 2);
  assert.ok(tracks.every((s) => s.points.length === 8));
  for (const track of tracks)
    assert.ok(
      Math.abs(track.points[0].box.x - track.points.at(-1).box.x) < 0.05,
    );
});
test("selected non-face subject follows texture and stops at loss instead of chasing background", () => {
  const frames = Array.from({ length: 8 }, (_, i) => {
    const width = 160,
      height = 100,
      pixels = new Uint8Array(width * height).fill(30),
      x = 35 + i * 2,
      y = 30;
    if (i < 6)
      for (let dy = 0; dy < 25; dy++)
        for (let dx = 0; dx < 25; dx++)
          pixels[(y + dy) * width + x + dx] =
            ((dx * 17 + dy * 31 + dx * dy) % 170) + 60;
    return { t: i * 0.25, width, height, pixels };
  });
  const points = trackSelectedSubject(frames, {
    t: 0.5,
    box: box(39 / 160, 0.3, 25 / 160, 0.25),
  });
  assert.ok(points.length >= 5, `tracked ${points.length} points`);
  assert.ok(points.at(-1).t <= 1.25, "must stop when the subject disappears");
  for (const p of points)
    assert.ok(
      Math.abs(p.box.x - (35 + p.t * 8) / 160) < 0.035,
      `wrong position at ${p.t}`,
    );
});
test("dialogue direction switches assigned subjects, eases zoom, and keeps uncertain exchanges wide", () => {
  const shot = {
    id: "shot",
    sourceId: "s",
    from: 0,
    to: 6,
    captions: [],
    subjects: [subject("a", 0.1), subject("b", 0.7)],
    director: {
      mode: "dialogue",
      style: "playful",
      lines: [
        { start: 0, end: 3, subjectId: "a" },
        { start: 3, end: 6, subjectId: "b" },
      ],
    },
  };
  const directed = directShot(shot, source);
  for (let i = 1; i < directed.crop.length; i++) {
    const a = directed.crop[i - 1], b = directed.crop[i], dt = b.t - a.t;
    assert.ok(Math.hypot(b.x-a.x, b.y-a.y) <= dt * .6 + 1e-9);
    assert.ok(Math.abs(b.zoom-a.zoom) <= dt * .65 + 1e-9);
  }
  assert.ok(cropAt(directed.crop, 1.5).x < 0.3);
  assert.ok(cropAt(directed.crop, 4.5).x > 0.65);
  assert.ok(cropAt(directed.crop, 1.5).zoom > 1.1);
  assert.ok(cropAt(directed.crop, 2.9).zoom < cropAt(directed.crop, 1.5).zoom);
  const wide = directShot(
    { ...shot, director: { ...shot.director, lines: [] } },
    source,
  );
  assert.ok(wide.crop.every((p) => p.zoom === portraitGeometry(source).fit));
  const overlap = directShot(
    {
      ...shot,
      director: {
        ...shot.director,
        lines: [
          { start: 0, end: 6, subjectId: "a" },
          { start: 0, end: 6, subjectId: "b" },
        ],
      },
    },
    source,
  );
  assert.ok(overlap.crop.every((p) => p.zoom < 1));
  const locked = {
    ...directed,
    director: { ...directed.director, locked: true },
  };
  assert.equal(directShot(locked, source), locked);
  assert.equal(subjectAt(subject("a", 0.2), 10), null);
  const clean = validateReelPlan([directed], [source])[0];
  assert.equal(clean.director.lines[1].subjectId, "b");
  assert.ok(clean.crop[5].zoom > 1);
  assert.throws(() =>
    validateDirection(
      {
        ...shot,
        subjects: [
          {
            ...subject("a", 0.1),
            points: [{ t: 0, box: box(-1), confidence: 1 }],
          },
        ],
      },
      6,
    ),
  );
});
test("manual subject and context choices take precedence over dialogue and survive validation", () => {
  const shot = {
    id: "manual", sourceId: "s", from: 0, to: 6, captions: [],
    subjects: [subject("a", 0.1), subject("b", 0.7)],
    director: { mode: "subject", subjectId: "a", style: "natural", lines: [
      { start: 0, end: 6, subjectId: "a" },
      { start: 0, end: 6, subjectId: "b" },
    ] },
  };
  assert.ok(directShot(shot, source).crop.every(p => p.x < .3));
  const lost = { ...shot, subjects: [subject("b", .7)] };
  assert.ok(directShot(lost, source).crop.every(p => p.zoom === portraitGeometry(source).fit));
  const context = { ...shot, subjects: [subject("a", .1)], director: {
    mode: "dialogue", lines: [{ start: 0, end: 6, subjectId: "", manual: true }],
  } };
  const directed = directShot(context, source);
  assert.ok(directed.crop.slice(0, -1).every(p => p.zoom === portraitGeometry(source).fit));
  assert.equal(validateReelPlan([directed], [source])[0].director.lines[0].manual, true);
  const locked = { ...shot, crop: [{ t: 0, x: .9, y: .6, zoom: .8 }], director: { ...shot.director, locked: true } };
  assert.deepEqual(directShot(locked, source).crop, locked.crop);
});
test("only source-matched audible performance timing is reused", () => {
  const clip = {
    id: "c",
    start: 10,
    duration: 6,
    in: 0,
    activeTake: "v",
    takes: [{ id: "v" }],
    sourceDraftId: "d",
  };
  const project = {
    clips: [clip],
    assets: [{ id: "person", kind: "character", name: "Person" }],
    drafts: [
      {
        id: "d",
        scenes: [{ dialogue: [{ speaker: "person", text: "Hello there" }] }],
      },
    ],
  };
  project.audioClips = [
    {
      start: 10,
      in: 0,
      duration: 6,
      volume: 1,
      soundtrack: {
        sources: [soundSource(clip)],
        scriptSignature: dialogueSignature(project, clip),
        lineTimings: [{ start: 1, duration: 2 }],
      },
    },
  ];
  const shot = {
    from: 0.5,
    to: 5,
    subjects: [{ id: "track", characterId: "person" }],
  };
  assert.deepEqual(
    recordedDialogue(project, { clipId: "c" }, shot).map((l) => [
      l.start,
      l.end,
      l.subjectId,
    ]),
    [[0.5, 2.5, "track"]],
  );
  project.audioClips[0].mute = true;
  assert.equal(recordedDialogue(project, { clipId: "c" }, shot).length, 0);
  project.audioClips[0].mute = false;
  clip.in = 2;
  assert.equal(recordedDialogue(project, { clipId: "c" }, shot).length, 0);
});
test("real portrait rendering moves from full context to close-up and matches preview centers", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "splece-camera-"));
  try {
    const shot = {
      crop: [
        { t: 0, x: 0.5, y: 0.5, zoom: 9 / 16 / (320 / 180) },
        { t: 1, x: 0.3, y: 0.4, zoom: 1.2 },
        { t: 2, x: 0.7, y: 0.5, zoom: 1 },
      ],
    };
    const file = path.join(folder, "frames.gray");
    await run([
      "-f",
      "lavfi",
      "-i",
      "nullsrc=s=320x180:r=24,format=gray,geq=lum='X/319*255'",
      "-t",
      "2",
      "-vf",
      portraitFilter(shot, source, 90, 160),
      "-pix_fmt",
      "gray",
      "-f",
      "rawvideo",
      file,
    ]);
    const data = await fs.readFile(file);
    assert.equal(data.length, 48 * 90 * 160);
    assert.ok(
      data[0] <= 16,
      "wide frame should fit source with black space above",
    );
    assert.ok(
      data[24 * 90 * 160 + 4 * 90] > 25,
      "close-up should fill the portrait canvas",
    );
    for (let i = 0; i < 48; i++) {
      const p = cropAt(shot.crop, i / 24),
        cw = portraitGeometry(source).cw / p.zoom;
      const center = cw > 1 ? 0.5 : Math.max(cw / 2, Math.min(1 - cw / 2, p.x));
      const actual = data[i * 90 * 160 + 80 * 90 + 45];
      assert.ok(
        Math.abs(actual - center * 255) < 7,
        `frame ${i}: got ${actual}, wanted ${center * 255}`,
      );
    }
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
