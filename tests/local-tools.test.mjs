import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { openStore } from "../server/store.mjs";
import { run } from "../server/media.mjs";
import { createLocalTools } from "../server/local-tools.mjs";
import {
  applyLocalResult,
  localSourceKey,
  rankLocalSounds,
  localSoundQuery,
  localClipName,
} from "../shared/local-tools.mjs";
import { validateElements } from "../shared/elements.mjs";

function fixture() {
  const p = upgradeProject(newProject("Local audio"));
  p.clips = [
    {
      id: "clip",
      activeTake: "picture",
      takes: [{ id: "picture" }],
      name: "Birds",
      start: 3,
      in: 0.5,
      duration: 1,
      volume: 0.2,
      mute: true,
    },
  ];
  p.assets = [
    {
      id: "bird",
      kind: "audio",
      name: "Bird chirping",
      tags: ["garden"],
      media: { id: "bird-media", audio: true, duration: 3 },
    },
    {
      id: "rain",
      kind: "audio",
      name: "Rain",
      media: { id: "rain-media", audio: true, duration: 0.4 },
    },
  ];
  return p;
}
test("local matching handles basic Arabic/English sound terms without discarding actions alongside dialogue", () => {
  const p = fixture();
  for (const query of [
    "Birds in a garden",
    "صوص عصفور",
    "She says hello while a bird chirps",
  ])
    assert.equal(rankLocalSounds(p.assets, query)[0].asset.id, "bird");
  assert.equal(rankLocalSounds(p.assets, "مَطَر")[0].asset.id, "rain");
  assert.equal(rankLocalSounds(p.assets, "unrelated spaceship").length, 0);
  assert.equal(localSoundQuery("زقزقة طيور"), "bird");
  assert.equal(localSoundQuery("معلمة تتحدث"), "speech woman");
  assert.equal(localSoundQuery("A woman speaking softly"), "A woman speaking softly");
  assert.equal(localClipName({ drafts: [{ id: "d", name: "Hello Noora" }] }, { sourceDraftId: "d" }), "Hello Noora");
});
test("applying reviewed results preserves manual work, rejects stale edits and is idempotent", () => {
  const p = fixture(),
    originals = structuredClone(p.clips);
  p.audioClips.push({
    id: "manual",
    mediaId: "bird-media",
    start: 3,
    duration: 1,
    in: 0,
    lane: 0,
    volume: 0.1,
    mute: true,
  });
  const job = {
    id: "job",
    projectId: p.id,
    episodeId: p.episodeId,
    state: "ready",
    sources: [{ id: "clip", key: localSourceKey(p.clips[0]) }],
    result: {
      sounds: [
        {
          id: "suggestion",
          assetId: "rain",
          mediaId: "rain-media",
          start: 3,
          duration: 0.4,
        },
      ],
      captions: [
        { id: "caption", start: 3, duration: 0.9, text: "مرحبا بالعالم" },
      ],
    },
  };
  assert.equal(applyLocalResult(p, job), 2);
  assert.equal(applyLocalResult(p, job), 0);
  assert.deepEqual(p.clips, originals);
  assert.equal(p.audioClips[0].volume, 0.1);
  assert.equal(p.audioClips[0].mute, true);
  assert.equal(p.audioClips[1].lane, 1);
  assert.equal(p.elements[0].font, "Noto Sans Arabic");
  validateElements(p.elements);
  const changed = structuredClone(p);
  changed.clips[0].in = 0;
  assert.throws(() => applyLocalResult(changed, job), /footage changed/);
  assert.throws(
    () => applyLocalResult({ ...p, episodeId: "other" }, job),
    /different edit/,
  );
});
test("local jobs run real FFmpeg analysis, honor manual sounds and recover interrupted jobs", async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "splece-local-tools-"));
  const store = openStore(path.join(data, "test.sqlite"));
  try {
    const file = path.join(data, "tone.wav");
    await run(["-f", "lavfi", "-i", "sine=frequency=400:duration=2", file]);
    const p = fixture();
    p.folder = data;
    for (const id of ["picture", "bird-media", "rain-media"])
      store.putMedia({
        id,
        projectId: p.id,
        path: file,
        audio: true,
        duration: 2,
      });
    const revision = store.save(p, 0),
      calls = [];
    const service = createLocalTools({
      store,
      data,
      addons: {
        requireReady: (id) => calls.push(id),
        execute: async (id, request) => {
          calls.push([id, request.action, request]);
          return { segments: [{ start: 0, end: 30, text: "مرحبا" }] };
        },
      },
    });
    const wait = async (id) => {
      for (let i = 0; i < 150; i++) {
        const j = service.list(p.id).find((j) => j.id === id);
        if (["ready", "failed", "cancelled"].includes(j.state)) return j;
        await new Promise((r) => setTimeout(r, 30));
      }
      assert.fail("Job timed out");
    };
    assert.throws(
      () => service.create(p.id, { revision: 0, action: "sound" }),
      /Save/,
    );
    assert.throws(
      () => service.create(p.id, { revision, action: "exec" }),
      /Unknown/,
    );
    const sound = await wait(
      service.create(p.id, {
        revision,
        action: "sound",
        query: "birds",
        assetId: "rain",
      }).id,
    );
    assert.equal(sound.state, "ready");
    assert.equal(sound.result.sounds[0].assetId, "rain");
    assert.equal(sound.result.sounds[0].duration, 0.4);
    const manualSemantic = await wait(
      service.create(p.id, {
        revision,
        action: "sound",
        query: "birds",
        assetId: "rain",
        semantic: true,
      }).id,
    );
    assert.equal(manualSemantic.result.sounds[0].assetId, "rain");
    assert.equal(
      calls.length,
      0,
      "manual choice bypasses semantic ranking entirely",
    );
    const levels = await wait(
      service.create(p.id, { revision, action: "levels" }).id,
    );
    assert.equal(levels.state, "ready", levels.error);
    assert.ok(levels.result.items[0].result.loudness < -10);
    assert.ok(levels.result.items[0].result.peak < 0);
    const caption = await wait(
      service.create(p.id, { revision, action: "captions", language: "ar", vocabulary: "نورة، صوص" }).id,
    );
    assert.equal(caption.result.captions[0].start, 3);
    assert.equal(caption.result.captions[0].duration, 1, "padded decoder timestamps stay inside the clip without losing the sentence");
    assert.ok(calls.includes("captions"));
    assert.equal(calls.find((c) => Array.isArray(c) && c[1] === "captions")[2].language, "ar");
    assert.equal(caption.result.captions[0].clipId, "clip");
    const revised = service.review(p.id, caption.id, [{ id: caption.result.captions[0].id, text: "مرحبا يا صوص" }]);
    assert.equal(revised.result.captions[0].text, "مرحبا يا صوص");
    assert.equal(service.list(p.id).find((j) => j.id === caption.id).result.captions[0].text, "مرحبا يا صوص");
    assert.throws(() => service.review(p.id, caption.id, [{ id: "unknown", text: "wrong" }]), /existing result/);
    assert.throws(() => service.review(p.id, caption.id, [{ id: caption.result.captions[0].id, text: " " }]), /caption text/);
    assert.throws(() => service.create(p.id, { revision, action: "captions", language: "bad" }), /Arabic/);
    assert.deepEqual(
      store.get(p.id).project,
      p,
      "analysis never edits a saved project",
    );
    p.clips.push({ ...p.clips[0], id: "earlier", start: 0 });
    const newer = store.save(p, revision);
    const ranked = await wait(service.create(p.id, { revision: newer, action: "rank", query: "معلمة تتحدث" }).id);
    assert.equal(ranked.state, "ready", ranked.error);
    assert.deepEqual(ranked.sources.map((s) => s.id), ["earlier", "clip"]);
    const rankCalls = calls.filter((c) => Array.isArray(c) && c[1] === "rank");
    assert.equal(rankCalls.length, 1, "an identical query is not rerun for each clip");
    assert.equal(rankCalls[0][2].query, "speech woman");
    store.db.prepare("INSERT INTO local_analysis VALUES(?,?,?)").run(
      "interrupted",
      p.id,
      JSON.stringify({
        id: "interrupted",
        projectId: p.id,
        state: "running",
      }),
    );
    const restarted = createLocalTools({ store, data, addons: {} });
    assert.equal(
      restarted.list(p.id).find((j) => j.id === "interrupted").state,
      "failed",
    );
  } finally {
    store.db.close();
    await fs.rm(data, { recursive: true, force: true });
  }
});
