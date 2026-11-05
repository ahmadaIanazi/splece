import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { openStore } from "../server/store.mjs";
import { run, probe } from "../server/media.mjs";
import {
  createReelEffects,
  intervalInputs,
  cropExpression,
} from "../server/reel-effects.mjs";
import {
  reelOptions,
  suggestHighlights,
  validateReelPlan,
  faceCrop,
  cropSampleTimes,
  cropAt,
  captionElements,
  saveLocalResult,
  localEffectPresets,
  readableCaptions,
} from "../shared/reel-effects.mjs";
import { validateElements } from "../shared/elements.mjs";
import { renderMorphPreview } from "../server/morph-effects.mjs";

test("highlight suggestions favor speech, keep chronology and enforce review bounds", () => {
  const sources = [
    {
      id: "a",
      order: 0,
      duration: 20,
      cuts: [10],
      activity: Array(20).fill(0),
      captions: [{ start: 12, end: 18, text: "Hello" }],
    },
    {
      id: "b",
      order: 1,
      duration: 8,
      cuts: [],
      activity: Array(8).fill(0.1),
      captions: [],
    },
  ];
  const options = reelOptions({ duration: 15, captions: true });
  const plan = suggestHighlights(sources, options);
  assert.ok(plan.some((s) => s.sourceId === "a" && s.from >= 10));
  assert.ok(plan.reduce((n, s) => n + s.to - s.from, 0) <= 15);
  assert.deepEqual(
    validateReelPlan(plan, sources, 15).map((p) => p.id),
    plan.map((p) => p.id),
  );
  assert.throws(() => validateReelPlan([{ ...plan[0], to: 99 }], sources));
  assert.throws(() =>
    validateReelPlan(
      [{ ...plan[0], crop: [{ t: 0, x: NaN, y: 0.5 }] }],
      sources,
    ),
  );
  assert.throws(() => reelOptions({ resolution: "4k" }));
  validateElements(captionElements(plan));
  const words =
    "A long sentence should stay readable and every word must survive splitting into small caption phrases.";
  const phrases = readableCaptions([{ start: 1, end: 9, text: words }]);
  assert.equal(phrases.map((p) => p.text).join(" "), words);
  assert.ok(phrases.every((p) => p.text.length <= 56));
  assert.equal(phrases.at(-1).end, 9);
  const quietTail = suggestHighlights(
    [
      {
        id: "quiet",
        order: 0,
        duration: 10,
        activity: Array(10).fill(0),
        captions: [{ start: 0, end: 6, text: "Speech" }],
      },
    ],
    reelOptions({ duration: 15, captions: true }),
  );
  assert.equal(quietTail.length, 1);
  assert.equal(quietTail[0].to, 6.25);
  const linear = suggestHighlights(
    sources,
    reelOptions({ duration: 15, highlights: false }),
  );
  assert.equal(linear[0].from, 0);
});
test("face following keeps its subject, rejects brief distractions, and follows sustained movement", () => {
  const face = (x, w = 0.1) => ({ x, y: 0.2, w, h: 0.2, confidence: 0.9 });
  const times = cropSampleTimes(4);
  assert.equal(times.at(-1), 4);
  assert.equal(cropSampleTimes(60).length, 32);
  const points = faceCrop(
    times.map((t) => ({
      t,
      faces:
        t === 2 ? [] : [face(0.1 + t * 0.08), face(0.75, t === 0 ? 0.05 : 0.2)],
    })),
    4,
  );
  assert.ok(
    points.every((p) => p.x < 0.5),
    "larger bystander must not steal framing",
  );
  assert.ok(
    points.at(-1).x > points[0].x + 0.25,
    "slow motion must not stick in a dead zone",
  );
  const distraction = faceCrop(
    times.map((t) => ({ t, faces: [face(t === 1 ? 0.8 : 0.2)] })),
    4,
  );
  assert.ok(distraction.every((p) => Math.abs(p.x - 0.25) < 1e-8));
  const switchSubject = faceCrop(
    times.map((t) => ({ t, faces: [face(t >= 2 ? 0.7 : 0.2)] })),
    4,
  );
  assert.ok(
    switchSubject.at(-1).x > 0.7,
    "a sustained new subject can be acquired",
  );
  assert.deepEqual(faceCrop([], 2), [{ t: 0, x: 0.5, y: 0.5 }]);
});
test("crop movement has continuous velocity through samples and never overshoots", () => {
  const points = [
    { t: 0, x: 0.1, y: 0.5 },
    { t: 1, x: 0.3, y: 0.4 },
    { t: 2.5, x: 0.6, y: 0.4 },
    { t: 3, x: 0.4, y: 0.8 },
  ];
  const epsilon = 0.0001;
  for (const point of points.slice(1, -1)) {
    const left =
      (cropAt(points, point.t).x - cropAt(points, point.t - epsilon).x) /
      epsilon;
    const right =
      (cropAt(points, point.t + epsilon).x - cropAt(points, point.t).x) /
      epsilon;
    assert.ok(Math.abs(left - right) < 0.001);
    if (point.t === 1)
      assert.ok(
        left > 0.1,
        "camera must keep moving through the intermediate keyframe",
      );
  }
  for (let t = 0; t <= 3; t += 0.01) {
    const a = points.filter((p) => p.t <= t).at(-1),
      b = points.find((p) => p.t > t) || a;
    for (const axis of ["x", "y"])
      assert.ok(
        cropAt(points, t)[axis] >= Math.min(a[axis], b[axis]) - 1e-9 &&
          cropAt(points, t)[axis] <= Math.max(a[axis], b[axis]) + 1e-9,
      );
  }
  assert.equal(cropAt(points, -1).x, 0.1);
  assert.equal(cropAt(points, 9).x, 0.4);
});
test("exported crop matches preview on every frame with a full 32-point path", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splece-crop-motion-"));
  try {
    const points = cropSampleTimes(8).map((t) => ({
      t,
      x: 0.2 + t * 0.075,
      y: 0.5,
    }));
    const output = path.join(dir, "frames.gray");
    await run([
      "-f",
      "lavfi",
      "-i",
      "nullsrc=s=320x180:r=24,format=gray,geq=lum='X/319*255'",
      "-t",
      "8",
      "-vf",
      `crop=80:180:x='clip(iw*(${cropExpression(points, "x")})-ow/2,0,iw-ow)':y=0:exact=1`,
      "-pix_fmt",
      "gray",
      "-f",
      "rawvideo",
      output,
    ]);
    const pixels = await fs.readFile(output);
    assert.equal(pixels.length, 192 * 80 * 180);
    for (let frame = 0; frame < 192; frame++) {
      const expected = ((320 * cropAt(points, frame / 24).x - 40) / 319) * 255;
      assert.ok(
        Math.abs(pixels[frame * 80 * 180] - expected) < 2,
        `preview/export disagree at frame ${frame}`,
      );
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("source intervals preserve trims, mixed audio and animation offsets", () => {
  const p = {
    episodeId: "e",
    clips: [
      {
        id: "a",
        start: 4,
        in: 2,
        duration: 10,
        visual: {
          keyframes: [
            { at: 0, x: 0.2 },
            { at: 1, x: 0.8 },
          ],
        },
      },
    ],
    audioClips: [{ id: "s", start: 5, in: 1, duration: 6, volume: 0.3 }],
    elements: [],
  };
  const r = intervalInputs(p, { clipId: "a", in: 2 }, 3, 5);
  assert.equal(r.clip.in, 5);
  assert.equal(r.clip.duration, 2);
  assert.equal(r.audio[0].in, 3);
  assert.equal(r.audio[0].duration, 2);
  assert.equal(r.clip.visual.keyframes[0].at, 0);
  assert.ok(r.clip.visual.keyframes[0].x > 0.2);
});
test(
  "real local renders cover all looks, portrait motion, captions, idempotency and stale edits",
  { timeout: 180000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splece-reel-test-")),
      store = openStore(path.join(dir, "db.sqlite"));
    let service;
    try {
      const p = upgradeProject(newProject("Synthetic reel QA"));
      p.folder = dir;
      const file = path.join(dir, "source.mp4");
      await run([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=24",
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
        file,
      ]);
      store.putMedia({
        id: "picture",
        projectId: p.id,
        kind: "video",
        path: file,
        audio: true,
        duration: 2,
      });
      p.clips = [
        {
          id: "c",
          name: "Synthetic movement",
          start: 0,
          in: 0.25,
          duration: 1.5,
          activeTake: "picture",
          takes: [{ id: "picture" }],
          volume: 0.4,
        },
      ];
      const revision = store.save(p);
      const originals = structuredClone(p.clips);
      let captionsCalls = 0;
      service = createReelEffects({
        store,
        data: dir,
        addons: {
          requireReady() {},
          async execute() {
            captionsCalls++;
            return {
              segments: [{ start: 0, end: 1.3, text: "Hello · مرحبا" }],
            };
          },
        },
      });
      for (const preset of localEffectPresets) {
        const body = {
          revision,
          requestId: `request-${preset.id}`,
          recipe: preset.id,
          resolution: preset.id === "reel" ? "1080p" : "480p",
          duration: 15,
          clipIds: ["c"],
          captions: preset.id === "reel",
        };
        const [a, b] = await Promise.all([
          service.create(p.id, body),
          service.create(p.id, body),
        ]);
        assert.equal(a.id, b.id);
        await service.idle();
        let job = service.get(p.id, a.id);
        assert.equal(job.state, "quoted", job.message);
        assert.ok(!job.snapshot && !job.folder && !job.files);
        let plan = job.plan;
        if (preset.id === "reel")
          plan[0].crop = [
            { t: 0, x: 0.2, y: 0.5 },
            { t: 1, x: 0.8, y: 0.5 },
          ];
        await Promise.all([
          service.render(p.id, a.id, plan),
          service.render(p.id, a.id, plan),
        ]);
        await service.idle();
        job = service.get(p.id, a.id);
        assert.equal(job.state, "ready", job.message);
        const info = await probe(store.media(job.media.id).path);
        assert.equal(info.audio, true);
        assert.ok(Math.abs(info.duration - 1.5) < 0.2);
        if (preset.id === "reel") {
          assert.equal(info.width, 1080);
          assert.equal(info.height, 1920);
        }
        assert.deepEqual(store.get(p.id).project.clips, originals);
        saveLocalResult(p, job);
        saveLocalResult(p, job);
        assert.equal(
          p.assets.filter((x) => x.media?.id === job.media.id).length,
          1,
        );
      }
      assert.equal(captionsCalls, 1);
      const cancelled = await service.create(p.id, {
        revision,
        requestId: "cancel-before-start",
        recipe: "warm",
        clipIds: ["c"],
      });
      service.cancel(p.id, cancelled.id);
      await service.idle();
      assert.equal(service.get(p.id, cancelled.id).state, "cancelled");
      const job = await service.create(p.id, {
        revision,
        requestId: "stale-request",
        recipe: "reel",
        duration: 15,
        clipIds: ["c"],
      });
      await service.idle();
      const changed = store.get(p.id);
      changed.project.clips[0].in = 0.1;
      store.save(changed.project, changed.revision);
      await assert.rejects(
        service.render(p.id, job.id, service.get(p.id, job.id).plan),
        /footage changed/,
      );
      const missing = createReelEffects({
        store,
        data: dir,
        addons: {
          requireReady() {
            throw Error("Set up captions");
          },
        },
      });
      await assert.rejects(
        missing.create(p.id, {
          revision: store.get(p.id).revision,
          requestId: "caption-setup",
          recipe: "reel",
          clipIds: ["c"],
          captions: true,
        }),
        /Set up captions/,
      );
      missing.close();
    } finally {
      service?.close();
      await service?.idle();
      store.db.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
test(
  "offline morph guide dissolves instead of hard-cutting",
  { timeout: 30000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splece-morph-guide-"));
    try {
      for (const color of ["red", "blue"])
        await run([
          "-f",
          "lavfi",
          "-i",
          `color=${color}:size=160x96`,
          "-frames:v",
          "1",
          path.join(dir, color + ".png"),
        ]);
      await renderMorphPreview(
        ["red", "blue"].map((c) => path.join(dir, c + ".png")),
        path.join(dir, "guide.mp4"),
        2,
      );
      const info = await probe(path.join(dir, "guide.mp4"));
      assert.ok(Math.abs(info.duration - 2) < 0.1);
      await run([
        "-ss",
        "1",
        "-i",
        path.join(dir, "guide.mp4"),
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        path.join(dir, "pixel.rgb"),
      ]);
      const pixels = await fs.readFile(path.join(dir, "pixel.rgb"));
      assert.ok(
        pixels[0] > 60 && pixels[2] > 60,
        "middle frame mixes both endpoints",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
