import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { openStore } from "../server/store.mjs";
import { run, probe } from "../server/media.mjs";
import { createEffectsService } from "../server/effects.mjs";
import {
  prepareEffectIntent,
  effectSignature,
  applyEffect,
  revertEffect,
  effectCostRecord,
} from "../shared/effects.mjs";
import { clipAudioTarget } from "../shared/clip-audio.mjs";
import { renderComparison } from "../server/comparison.mjs";
import { FalEffectsAdapter } from "../server/adapters/fal-effects.mjs";
const intent = {
  effectId: "ai-upscale",
  target: { kind: "clip", id: "clip" },
  settings: { scale: 2 },
};
async function sandbox(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splece-effects-"));
  const store = openStore(path.join(dir, "db.sqlite"));
  const p = upgradeProject(newProject("Effects test"));
  p.folder = dir;
  const file = path.join(dir, "source.mp4");
  await run([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x96:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=400",
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
  const media = {
    id: "source",
    projectId: p.id,
    kind: "video",
    url: "/api/media/source",
    path: file,
    original: file,
    duration: 2,
    width: 160,
    height: 96,
    audio: true,
  };
  store.putMedia(media);
  p.clips = [
    {
      id: "clip",
      start: 3,
      in: 0.4,
      duration: 1.2,
      activeTake: media.id,
      takes: [media],
      volume: 0.6,
    },
  ];
  let revision = store.save(p, 0);
  const service = createEffectsService({
    store,
    data: dir,
    mode: async () => "test",
    autoStart: false,
  });
  try {
    await fn({ dir, store, p, service, revision, file });
  } finally {
    service.close();
    store.db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
test("Offline video stages persist, preserve original and audio, compare and apply/revert without timing changes", async () =>
  sandbox(async ({ dir, store, p, service, revision, file }) => {
    const original = await fs.readFile(file),
      quote = await service.estimate(p.id, intent);
    const body = {
      ...intent,
      quoteId: quote.id,
      revision,
      requestId: "stable-request-1",
    };
    const [a, b] = await Promise.all([
      service.submit(p.id, body),
      service.submit(p.id, body),
    ]);
    assert.equal(a.id, b.id);
    await service.tick();
    assert.equal(service.get(p.id, a.id).stages[0].state, "ready");
    service.close();
    const resumed = createEffectsService({
      store,
      data: dir,
      mode: async () => "test",
      autoStart: false,
    });
    try {
      await resumed.tick();
      await resumed.tick();
      const j = resumed.get(p.id, a.id);
      assert.equal(j.state, "ready", j.error);
      assert.equal(j.media.width, 160);
      assert.equal(j.media.audio, true);
      assert.deepEqual(await fs.readFile(file), original);
      assert.equal(p.clips[0].activeTake, "source");
      assert.equal(effectCostRecord(j).amount, 0);
      applyEffect(p, j);
      assert.equal(p.clips[0].start, 3);
      assert.equal(p.clips[0].duration, 1.2);
      assert.equal(p.clips[0].in, 0);
      assert.equal(p.clips[0].volume, 0.6);
      assert.equal(p.assets.length, 1);
      revertEffect(p, intent.target);
      assert.equal(p.clips[0].activeTake, "source");
      assert.equal(p.clips[0].in, 0.4);
      p.clips[0].in = 0.5;
      assert.throws(() => applyEffect(p, j), /source changed/);
      const compared = await renderComparison(
        [
          { path: file, in: 0.4, duration: 1.2 },
          { path: j.media.path, in: 0, duration: 1.2 },
        ],
        path.join(dir, "compare.mp4"),
      );
      assert.equal(compared.duration, 1.2);
    } finally {
      resumed.close();
    }
  }));
test("Offline image uses original pixels, supports asset apply/revert and shared comparison", async () =>
  sandbox(async ({ dir, store, p, service, revision }) => {
    const original = path.join(dir, "photo.png");
    await run([
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x96",
      "-frames:v",
      "1",
      original,
    ]);
    const m = {
      id: "photo",
      projectId: p.id,
      kind: "image",
      original,
      path: original,
      url: "/api/media/photo",
      duration: 5,
    };
    store.putMedia(m);
    p.assets = [
      { id: "photo-asset", kind: "footage", name: "Photo", media: m },
    ];
    revision = store.save(p, revision);
    const i = { ...intent, target: { kind: "asset", id: "photo-asset" } },
      q = await service.estimate(p.id, i),
      j = await service.submit(p.id, {
        ...i,
        quoteId: q.id,
        revision,
        requestId: "image-request-1",
      });
    for (let n = 0; n < 3; n++) await service.tick();
    const result = service.get(p.id, j.id);
    assert.equal(result.state, "ready", result.error);
    assert.equal(result.media.kind, "image");
    assert.equal(result.media.width, 160);
    await renderComparison(
      [
        { path: result.stages[0].snapshot, kind: "image", in: 0, duration: 5 },
        { path: result.media.path, in: 0, duration: 5 },
      ],
      path.join(dir, "image-compare.mp4"),
    );
    applyEffect(p, result);
    assert.equal(p.assets[0].media.id, j.id);
    revertEffect(p, i.target);
    assert.equal(p.assets[0].media.id, "photo");
  }));
test("effect application keeps silent lip-sync voice routing and sound tracks unchanged", () => {
  const p = upgradeProject(newProject("linked"));
  const take = {
    id: "silent",
    url: "/api/media/silent",
    kind: "video",
    audio: false,
    lipSync: { audioId: "voice" },
  };
  p.clips = [
    {
      id: "clip",
      activeTake: "silent",
      takes: [take],
      start: 2,
      in: 0,
      duration: 2,
    },
  ];
  p.audioClips = [
    {
      id: "voice",
      mediaId: "speech",
      start: 2,
      in: 0,
      duration: 2,
      volume: 0.7,
    },
  ];
  const input = prepareEffectIntent(p, intent),
    tracks = JSON.stringify(p.audioClips);
  const j = {
    id: "result",
    projectId: p.id,
    input,
    signature: effectSignature(input),
    state: "ready",
    media: {
      id: "result",
      audio: false,
      kind: "video",
      url: "/api/media/result",
    },
  };
  applyEffect(p, j);
  assert.equal(clipAudioTarget(p, p.clips[0]).record.id, "voice");
  assert.equal(JSON.stringify(p.audioClips), tracks);
  revertEffect(p, intent.target);
  assert.equal(clipAudioTarget(p, p.clips[0]).record.id, "voice");
});
test("failed stage retry reuses completed snapshot and uncertain live acceptance never resubmits", async () =>
  sandbox(async ({ dir, store, p, revision }) => {
    let submits = 0,
      uploads = 0,
      currentMode = "live";
    const adapter = {
      estimate: async () => ({
        amount: 0.01,
        basis: "historical",
        note: "estimate",
      }),
      allowSubmit: async () => true,
      submitEffect: async () => {
        submits++;
        throw Object.assign(Error("lost response"), { uncertain: true });
      },
      pollEffect: async () => ({ state: "processing" }),
    };
    const s = createEffectsService({
      store,
      data: dir,
      mode: async () => currentMode,
      autoStart: false,
      adapterFactory: async () => adapter,
      upload: async () => {
        uploads++;
        return "https://fal.media/input.mp4";
      },
    });
    try {
      const q = await s.estimate(p.id, intent);
      await assert.rejects(
        s.submit(p.id, {
          ...intent,
          quoteId: q.id,
          revision,
          requestId: "unconfirmed-1",
        }),
        /Confirm/,
      );
      const j = await s.submit(p.id, {
        ...intent,
        quoteId: q.id,
        confirmedAmount: q.amount,
        revision,
        requestId: "uncertain-1",
      });
      await s.tick();
      const artifact = s.get(p.id, j.id).stages[0].artifact;
      currentMode = "test";
      await s.tick();
      assert.equal(submits, 0);
      currentMode = "live";
      await s.tick();
      assert.equal(submits, 1);
      assert.equal(s.get(p.id, j.id).stages[1].state, "submission_uncertain");
      await assert.rejects(s.recover(p.id, j.id, {}), /request ID/);
      await s.tick();
      assert.equal(submits, 1);
      await s.recover(p.id, j.id, { providerJobId: "known-provider-request" });
      await s.tick();
      assert.equal(submits, 1);
      assert.equal(uploads, 1);
      assert.equal(s.get(p.id, j.id).stages[0].artifact, artifact);
    } finally {
      s.close();
    }
  }));
test("missing connection can be recovered without discarding the prepared source", async () =>
  sandbox(async ({ dir, store, p, revision }) => {
    let connected = true;
    const s = createEffectsService({
      store,
      data: dir,
      mode: async () => "live",
      autoStart: false,
      adapterFactory: async () => {
        if (!connected) throw Error("Missing fal connection");
        return {
          estimate: async () => ({ amount: 0.01, basis: "historical" }),
          submitEffect: async () => ({
            providerJobId: "saved-provider-request",
          }),
          pollEffect: async () => ({ state: "processing" }),
        };
      },
      upload: async () => "https://fal.media/input.mp4",
    });
    try {
      const q = await s.estimate(p.id, intent),
        j = await s.submit(p.id, {
          ...intent,
          quoteId: q.id,
          confirmedAmount: q.amount,
          requestId: "connection-1",
          revision,
        });
      await s.tick();
      connected = false;
      await s.tick();
      assert.match(s.get(p.id, j.id).error, /connection/);
      connected = true;
      await s.recover(p.id, j.id, {});
      await s.tick();
      assert.equal(s.get(p.id, j.id).stages[0].state, "ready");
      assert.equal(
        s.get(p.id, j.id).stages[1].providerJobId,
        "saved-provider-request",
      );
    } finally {
      s.close();
    }
  }));
test("provider adapter uses documented payloads and blocks Offline submission", async () => {
  let calls = 0;
  const a = new FalEffectsAdapter({
    key: "test",
    allowSubmit: async () => false,
    transport: async () => {
      calls++;
    },
  });
  await assert.rejects(
    a.submitEffect("fal-ai/esrgan", { image_url: "x", scale: 2 }),
    /Offline/,
  );
  assert.equal(calls, 0);
});
test("mocked live result retries retrieval without another billable request and restores embedded audio", async () =>
  sandbox(async ({ dir, store, p, revision }) => {
    let submissions = 0,
      downloads = 0;
    const adapter = {
      estimate: async () => ({ amount: 0.02, basis: "historical" }),
      submitEffect: async () => {
        submissions++;
        return { providerJobId: "accepted-request-id" };
      },
      pollEffect: async () => ({
        state: "ready",
        downloadUrl: "https://fal.media/mock.mp4",
      }),
    };
    const service = createEffectsService({
      store,
      data: dir,
      autoStart: false,
      mode: async () => "live",
      adapterFactory: async () => adapter,
      upload: async () => "https://fal.media/input.mp4",
      download: async (_url, file) => {
        downloads++;
        if (downloads === 1) throw Error("Download interrupted");
        await run([
          "-i",
          path.join(path.dirname(file), "input.mp4"),
          "-vf",
          "scale=320:192",
          "-an",
          file,
        ]);
      },
    });
    try {
      const q = await service.estimate(p.id, intent),
        j = await service.submit(p.id, {
          ...intent,
          quoteId: q.id,
          confirmedAmount: q.amount,
          revision,
          requestId: "retrieval-1",
        });
      await service.tick();
      await service.tick();
      assert.equal(service.get(p.id, j.id).state, "needs_attention");
      await service.recover(p.id, j.id, {});
      await service.tick();
      await service.tick();
      const result = service.get(p.id, j.id);
      assert.equal(result.state, "ready", result.error);
      assert.equal(submissions, 1);
      assert.equal(downloads, 2);
      assert.equal(result.media.width, 320);
      assert.equal((await probe(result.media.path)).audio, true);
      assert.equal(effectCostRecord(result).amount, 0.02);
      assert.equal(result.media.provenance.source.in, 0.4);
    } finally {
      service.close();
    }
  }));
test("effect artifacts use safe project-relative paths in portable files", async () => {
  const { effectPortablePaths } = await import("../server/portable.mjs");
  const j = {
    folder: "/tmp/project/media/effect",
    sourcePath: "/tmp/project/media/source.mp4",
    stages: [
      {
        artifact: "/tmp/project/media/effect/result.mp4",
        snapshot: "/tmp/project/media/effect/source.mp4",
      },
    ],
  };
  const relative = effectPortablePaths(j, "/tmp/project");
  assert.equal(relative.folder, "media/effect");
  const moved = effectPortablePaths(relative, "/tmp/moved", true);
  assert.equal(moved.stages[0].artifact, "/tmp/moved/media/effect/result.mp4");
  assert.throws(
    () =>
      effectPortablePaths(
        { ...relative, folder: "../../outside" },
        "/tmp/moved",
        true,
      ),
    /escapes/,
  );
});
test("overlapping worker ticks cannot submit twice", async () =>
  sandbox(async ({ dir, store, p, revision }) => {
    let submits = 0;
    const service = createEffectsService({
      store,
      data: dir,
      autoStart: false,
      mode: async () => {
        await new Promise((r) => setTimeout(r, 2));
        return "live";
      },
      adapterFactory: async () => ({
        estimate: async () => ({ amount: 0.01, basis: "historical" }),
        submitEffect: async () => {
          submits++;
          return { providerJobId: "single-provider-request" };
        },
        pollEffect: async () => ({ state: "processing" }),
      }),
      upload: async () => "https://fal.media/input.mp4",
    });
    try {
      const q = await service.estimate(p.id, intent);
      await service.submit(p.id, {
        ...intent,
        quoteId: q.id,
        confirmedAmount: q.amount,
        revision,
        requestId: "concurrent-ticks",
      });
      await service.tick();
      await Promise.all([service.tick(), service.tick(), service.tick()]);
      assert.equal(submits, 1);
    } finally {
      service.close();
    }
  }));

const morphIntent = (placement = "insert") => ({
  effectId: "ai-morph",
  placement,
  target: { kind: "clip", id: "clip" },
  settings: { duration: 2 },
  references: [
    { role: "start", target: { kind: "clip", id: "clip" }, edge: "first" },
    { role: "end", target: { kind: "clip", id: "clip" }, edge: "last" },
  ],
});
test("morph Offline freezes two frames, inserts one structured clip, and never calls a provider", async () =>
  sandbox(async ({ dir, store, p, revision, file }) => {
    const bytes = await fs.readFile(file),
      sounds = JSON.stringify(p.audioClips);
    const s = createEffectsService({
      store,
      data: dir,
      autoStart: false,
      mode: async () => "test",
      adapterFactory: async () => {
        throw Error("Provider must not run");
      },
    });
    try {
      const i = morphIntent(),
        q = await s.estimate(p.id, i);
      assert.deepEqual(q.outputDimensions, { width: 854, height: 480 });
      const j = await s.submit(p.id, {
        ...i,
        quoteId: q.id,
        revision,
        requestId: "morph-offline",
      });
      for (let n = 0; n < 3; n++) await s.tick();
      const ready = s.get(p.id, j.id);
      assert.equal(ready.state, "ready", ready.error);
      assert.equal(ready.media.audio, false);
      assert.equal(ready.media.duration, 2);
      assert.equal(ready.media.generated, false);
      assert.equal(ready.stages[0].framePaths.length, 2);
      assert.ok(
        Math.abs(ready.input.references[1].time - (0.4 + 1.2 - 1 / 24)) < 1e-8,
      );
      assert.equal(s.view(ready).frameSources, undefined);
      assert.equal(s.view(ready).stages[0].framePaths, undefined);
      applyEffect(p, ready);
      applyEffect(p, ready);
      assert.equal(p.clips.length, 2);
      const added = p.clips.find((c) => c.effectJobId === j.id);
      assert.equal(added.duration, 2);
      assert.equal(added.start, 1.2);
      assert.ok(added.structureNodeId);
      assert.equal(p.clips[0].activeTake, "source");
      assert.equal(JSON.stringify(p.audioClips), sounds);
      assert.deepEqual(await fs.readFile(file), bytes);
    } finally {
      s.close();
    }
  }));
test("morph replacement fits endpoints to original duration, retains embedded audio and reverses", async () =>
  sandbox(async ({ p, service, revision }) => {
    const i = morphIntent("replace"),
      q = await service.estimate(p.id, i),
      j = await service.submit(p.id, {
        ...i,
        quoteId: q.id,
        revision,
        requestId: "morph-replace",
      });
    for (let n = 0; n < 3; n++) await service.tick();
    const ready = service.get(p.id, j.id);
    assert.equal(ready.state, "ready", ready.error);
    const output = await probe(ready.media.path);
    assert.equal(output.audio, true);
    assert.ok(Math.abs(output.duration - 1.2) < 0.1);
    applyEffect(p, ready);
    applyEffect(p, ready);
    assert.equal(p.clips[0].takes.length, 2);
    assert.equal(p.clips[0].duration, 1.2);
    assert.equal(p.clips[0].start, 3);
    assert.equal(p.clips[0].volume, 0.6);
    assert.equal(p.clips[0].takes[1].lipSync, undefined);
    revertEffect(p, i.target);
    assert.equal(p.clips[0].activeTake, "source");
    assert.equal(p.clips[0].in, 0.4);
    assert.equal(p.clips[0].duration, 1.2);
  }));
test("morph detects changed endpoint edits, changed files, and episode mismatch", async () =>
  sandbox(async ({ p, service, revision, file }) => {
    const i = morphIntent(),
      q = await service.estimate(p.id, i),
      j = await service.submit(p.id, {
        ...i,
        quoteId: q.id,
        revision,
        requestId: "morph-stale",
      });
    for (let n = 0; n < 3; n++) await service.tick();
    const ready = service.get(p.id, j.id);
    assert.equal(ready.state, "ready", ready.error);
    p.clips[0].duration = 1;
    assert.throws(() => applyEffect(p, ready), /source changed/);
    p.clips[0].duration = 1.2;
    p.episodeId = "different";
    assert.throws(() => applyEffect(p, ready), /active edit/);
    const q2 = await service.estimate(p.id, i);
    await fs.utimes(file, new Date(), new Date(Date.now() + 2000));
    await assert.rejects(
      service.submit(p.id, {
        ...i,
        quoteId: q2.id,
        revision,
        requestId: "morph-file-stale",
      }),
      /fresh effect estimate/,
    );
  }));
test("morph prompt and payload include endpoints without incompatible reference arrays or audio", async () =>
  sandbox(async ({ dir, store, p, revision }) => {
    let captured,
      submits = 0;
    const s = createEffectsService({
      store,
      data: dir,
      autoStart: false,
      mode: async () => "live",
      adapterFactory: async () => ({
        estimate: async () => ({ amount: 0.04, basis: "historical" }),
        submitEffect: async (model, input) => {
          assert.equal(model, "alibaba/wan-3.0/image-to-video");
          captured = input;
          submits++;
          return { providerJobId: "morph-accepted-request" };
        },
        pollEffect: async () => ({
          state: "ready",
          downloadUrl: "https://fal.media/mock.mp4",
        }),
      }),
      upload: async (_a, file) => "https://fal.media/" + path.basename(file),
      download: async (_u, file) =>
        fs.copyFile(path.join(path.dirname(file), "frame-preview.mp4"), file),
    });
    try {
      const i = morphIntent();
      i.settings = {
        preset: "whip",
        vibe: "cool",
        guidance: "Keep the doorway recognizable.",
      };
      const q = await s.estimate(p.id, i),
        j = await s.submit(p.id, {
          ...i,
          quoteId: q.id,
          confirmedAmount: q.amount,
          revision,
          requestId: "morph-live-mocked",
        });
      for (let n = 0; n < 3; n++) await s.tick();
      const ready = s.get(p.id, j.id);
      assert.equal(ready.state, "ready", ready.error);
      assert.equal(submits, 1);
      assert.equal(captured.duration, 2);
      assert.equal(captured.resolution, "480p");
      assert.equal(captured.audio, false);
      assert.equal(captured.enable_prompt_expansion, false);
      assert.match(captured.prompt, /Whip the camera/);
      assert.match(captured.prompt, /doorway/);
      assert.match(captured.start_image_url, /frame-0/);
      assert.match(captured.end_image_url, /frame-1/);
      assert.equal(captured.reference_image_urls, undefined);
    } finally {
      s.close();
    }
  }));
test("morph portable paths move both frame sources and artifacts", async () => {
  const { effectPortablePaths } = await import("../server/portable.mjs");
  const raw = {
    frameSources: [{ path: "/tmp/project/media/input.mp4", stamp: [4, 5] }],
    stages: [
      {
        framePaths: ["/tmp/project/media/frame.png"],
        frameSnapshots: ["/tmp/project/media/source.mp4"],
      },
    ],
  };
  const relative = effectPortablePaths(raw, "/tmp/project");
  const moved = effectPortablePaths(relative, "/tmp/moved", true);
  assert.equal(moved.frameSources[0].path, "/tmp/moved/media/input.mp4");
  assert.equal(moved.stages[0].framePaths[0], "/tmp/moved/media/frame.png");
});

test("insertion context chooses neighbouring trim endpoints and refuses a changed cut", async () =>
  sandbox(async ({ p }) => {
    const { effectContext, automaticEffectFrames, frameEffectReference } =
      await import("../shared/effect-context.mjs");
    p.clips[0].start = 0;
    p.clips.push({
      ...structuredClone(p.clips[0]),
      id: "next",
      start: 1.2,
      in: 0.2,
      duration: 1,
    });
    const c = effectContext(p, {
        id: "cut",
        kind: "cut",
        at: 1.2,
        previousClipId: "clip",
        nextClipId: "next",
      }),
      frames = automaticEffectFrames(p, c);
    assert.ok(Math.abs(frames.start.time - (0.4 + 1.2 - 1 / 24)) < 1e-8);
    assert.equal(frames.end.time, 0.2);
    const i = {
      ...morphIntent(),
      insertion: { at: 1.2, previousClipId: "clip", nextClipId: "next" },
      references: ["start", "end"].map((role) =>
        frameEffectReference(p, role, frames[role]),
      ),
    };
    const prepared = prepareEffectIntent(p, i);
    assert.equal(prepared.insertion.at, 1.2);
    p.clips[1].start = 1.5;
    assert.notEqual(
      effectSignature(prepareEffectIntent(p, i)),
      effectSignature(prepared),
    );
    p.clips.pop();
    assert.throws(() => prepareEffectIntent(p, i), /insertion point changed/);
  }));
test("range morph preserves full clip duration, outside footage and embedded sound", async () =>
  sandbox(async ({ p, service, revision, dir, file }) => {
    const i = { ...morphIntent("replace"), range: { from: 3.3, to: 3.9 } },
      q = await service.estimate(p.id, i),
      j = await service.submit(p.id, {
        ...i,
        quoteId: q.id,
        revision,
        requestId: "morph-range",
      });
    for (let n = 0; n < 3; n++) await service.tick();
    const ready = service.get(p.id, j.id);
    assert.equal(ready.state, "ready", ready.error);
    const info = await probe(ready.media.path);
    assert.ok(Math.abs(info.duration - 1.2) < 0.1);
    assert.equal(info.audio, true);
    assert.equal(info.width, 160);
    applyEffect(p, ready);
    assert.equal(p.clips[0].duration, 1.2);
    revertEffect(p, i.target);
    assert.equal(p.clips[0].in, 0.4);
    // The replacement's first picture is original footage, not the generated transition's fit/padding.
    const first = path.join(dir, "before.md5"),
      second = path.join(dir, "after.md5");
    await run([
      "-ss",
      "0.4",
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      "scale=16:10",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      first,
    ]);
    await run([
      "-i",
      ready.media.path,
      "-frames:v",
      "1",
      "-vf",
      "scale=16:10",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      second,
    ]);
    const [a, b] = await Promise.all([fs.readFile(first), fs.readFile(second)]);
    assert.equal(a.length, b.length);
    const mean =
      a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
    assert.ok(mean < 6, `Outside-range picture changed: mean error ${mean}`);
  }));
test("an existing empty slot uses neighbouring frames and fills once without adding another clip", async () =>
  sandbox(async ({ p, store, service, revision }) => {
    const { effectContext, automaticEffectFrames, frameEffectReference } =
      await import("../shared/effect-context.mjs");
    p.clips[0].start = 0;
    p.clips.push(
      {
        id: "empty",
        start: 1.2,
        in: 0,
        duration: 2,
        takes: [],
        activeTake: null,
      },
      { ...structuredClone(p.clips[0]), id: "after", start: 3.2 },
    );
    revision = store.save(p, revision);
    const c = effectContext(p, null, ["empty"]),
      frames = automaticEffectFrames(p, c);
    const i = {
      ...morphIntent("fill"),
      target: { kind: "clip", id: "empty" },
      references: ["start", "end"].map((role) =>
        frameEffectReference(p, role, frames[role]),
      ),
    };
    const q = await service.estimate(p.id, i),
      j = await service.submit(p.id, {
        ...i,
        quoteId: q.id,
        revision,
        requestId: "fill-empty-slot",
      });
    for (let n = 0; n < 3; n++) await service.tick();
    const result = service.get(p.id, j.id);
    assert.equal(result.state, "ready", result.error);
    applyEffect(p, result);
    applyEffect(p, result);
    assert.equal(p.clips.length, 3);
    assert.equal(p.clips[1].takes.length, 1);
    assert.equal(p.clips[1].activeTake, result.media.id);
  }));
test("all-videos batch has combined estimate, atomic durable jobs and idempotent retry", async () =>
  sandbox(async ({ p, store, service, revision }) => {
    p.clips.push({ ...structuredClone(p.clips[0]), id: "second", start: 4.2 });
    revision = store.save(p, revision);
    const body = { effectId: "ai-upscale", settings: { scale: 2 } },
      q = await service.estimateBatch(p.id, body);
    assert.equal(q.count, 2);
    assert.equal(q.amount, 0);
    const request = {
      ...body,
      quoteId: q.id,
      requestId: "batch-offline-stable",
      revision,
    };
    const [a, b] = await Promise.all([
      service.submitBatch(p.id, request),
      service.submitBatch(p.id, request),
    ]);
    assert.deepEqual(a.map((j) => j.id).sort(), b.map((j) => j.id).sort());
    assert.equal(service.list(p.id).length, 2);
    for (let n = 0; n < 6; n++) await service.tick();
    const jobs = service.list(p.id);
    assert.ok(jobs.every((j) => j.state === "ready"));
    for (const j of jobs) applyEffect(p, j);
    assert.ok(p.clips.every((c) => c.activeTake !== "source"));
  }));
test("a changed batch source prevents every submission", async () =>
  sandbox(async ({ p, store, service, revision }) => {
    p.clips.push({ ...structuredClone(p.clips[0]), id: "second", start: 4.2 });
    revision = store.save(p, revision);
    const body = { effectId: "ai-upscale", settings: { scale: 2 } },
      q = await service.estimateBatch(p.id, body);
    p.clips[1].in = 0.5;
    revision = store.save(p, revision);
    await assert.rejects(
      service.submitBatch(p.id, {
        ...body,
        quoteId: q.id,
        requestId: "batch-stale-stable",
        revision,
      }),
      /source changed/,
    );
    assert.equal(service.list(p.id).length, 0);
  }));
