import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveProjectDefaults,
  markSettingsOverrides,
  validateDefaults,
} from "../shared/settings-defaults.mjs";
import { timelineDropPreview } from "../shared/timeline-drop.mjs";
import { openStore } from "../server/store.mjs";
import { insertStorySlot } from "../shared/generation-slots.mjs";
test("Legacy projects preserve settings; inheritance follows globals until edited", () => {
  const old = { export: { fps: 24 }, systemPrompt: "mine" };
  assert.deepEqual(resolveProjectDefaults(old, { export: { fps: 30 } }), old);
  const inherited = { ...old, inherit: ["exports"] };
  const resolved = resolveProjectDefaults(inherited, {
    export: { fps: 30 },
    systemPrompt: "global",
  });
  assert.equal(resolved.export.fps, 30);
  assert.equal(resolved.systemPrompt, "mine");
  const changed = structuredClone(resolved);
  changed.export.fps = 60;
  markSettingsOverrides(resolved, changed);
  assert.deepEqual(changed.inherit, []);
  assert.equal(
    resolveProjectDefaults(changed, { export: { fps: 25 } }).export.fps,
    60,
  );
});
test("Stored projects resolve current inherited defaults without rewriting overrides", () => {
  let global = { audioDefaults: { volume: 0.7, mute: false } };
  const store = openStore(":memory:", (s) => resolveProjectDefaults(s, global));
  store.save(
    {
      id: "p",
      settings: {
        audioDefaults: { volume: 1, mute: false },
        inherit: ["audio"],
      },
    },
    0,
  );
  assert.equal(store.get("p").project.settings.audioDefaults.volume, 0.7);
  global.audioDefaults.volume = 0.5;
  assert.equal(store.get("p").project.settings.audioDefaults.volume, 0.5);
  assert.equal(store.get("p").revision, 1);
  store.db.close();
});
test("Defaults validate values and exclude keys and unrelated project content", () => {
  assert.deepEqual(
    validateDefaults({ apiKey: "private", clips: [], concurrency: 3 }),
    { concurrency: 3 },
  );
  assert.throws(() => validateDefaults({ concurrency: 99 }));
  assert.throws(() =>
    validateDefaults({ audioDefaults: { volume: -1, mute: false } }),
  );
  assert.throws(() =>
    validateDefaults({
      export: { fps: 0, aspect: "16:9", resolution: "480p" },
    }),
  );
});
const project = () => ({
  clips: [
    { id: "a", start: 0, duration: 5, takes: [{ id: "v" }], activeTake: "v" },
    {
      id: "b",
      start: 5,
      duration: 8,
      takes: [],
      activeTake: null,
      plannedReservation: true,
      storyBeatId: "b",
    },
  ],
  drafts: [],
});
test("Character drops attach references, music uses an audio lane, footage previews its duration", () => {
  const p = project(),
    before = JSON.stringify(p);
  assert.equal(
    timelineDropPreview(
      p,
      { asset: { kind: "character", media: { kind: "image" } } },
      2,
    ).mode,
    "reference",
  );
  assert.equal(
    timelineDropPreview(p, { asset: { kind: "character" } }, 2).clipId,
    "a",
  );
  assert.equal(
    timelineDropPreview(p, { media: { kind: "audio", duration: 20 } }, 3).start,
    3,
  );
  assert.equal(
    timelineDropPreview(p, { key: "job:x", media: { id: "v", duration: 5 } }, 8)
      .mode,
    "select",
  );
  const insert = timelineDropPreview(
    p,
    { media: { id: "new", duration: 7 } },
    2.7,
  );
  assert.equal(insert.start, 5);
  assert.equal(insert.duration, 7);
  assert.equal(insert.mode, "insert");
  assert.equal(JSON.stringify(p), before);
  insertStorySlot(
    p,
    { id: "new", start: 0, duration: 7, takes: [], activeTake: "new" },
    2.7,
  );
  assert.deepEqual(
    p.clips.map((c) => [c.id, c.start]).sort((a, b) => a[1] - b[1]),
    [
      ["a", 0],
      ["new", 5],
      ["b", 12],
    ],
  );
});
import { attachClipReference } from "../shared/clip-prompt.mjs";
test("Dropping a reference on imported footage creates its own prompt, never edits another clip", () => {
  const p = project();
  p.episodeId = "ep";
  p.drafts = [
    {
      id: "d",
      targetId: "a",
      episodeId: "ep",
      referenceIds: [],
      settings: { duration: 5 },
    },
  ];
  p.activeDraftId = "d";
  p.clips[1].takes = [{ id: "other", name: "Landing" }];
  p.clips[1].activeTake = "other";
  const draft = attachClipReference(p, "b", "character", [], (start) => ({
    id: "new-draft",
    start,
    settings: { duration: 5 },
    referenceIds: [],
  }));
  assert.equal(draft.targetId, "b");
  assert.equal(draft.start, 5);
  assert.equal(draft.settings.duration, 8);
  assert.deepEqual(p.drafts[0].referenceIds, []);
  assert.equal(p.activeDraftId, "new-draft");
  attachClipReference(p, "b", "character", [], () => {
    throw Error("Must reuse prompt");
  });
  assert.equal(p.drafts.length, 2);
  assert.deepEqual(draft.referenceIds, ["character"]);
});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { settingsDefaults } from "../server/settings-defaults.mjs";
test("Global defaults survive service restart and invalid writes preserve saved defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "splece-defaults-"));
  try {
    const service = settingsDefaults(dir, { concurrency: 3 });
    service.save({
      concurrency: 5,
      audioDefaults: { volume: 0.8, mute: false },
    });
    assert.throws(() => service.save({ concurrency: 0 }));
    assert.equal(
      settingsDefaults(dir, { concurrency: 3 }).get().concurrency,
      5,
    );
    assert.equal(settingsDefaults(dir, {}).get().audioDefaults.volume, 0.8);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("Saved generation drops preview the existing target slot instead of making a gap", () => {
  const p = project();
  const preview = timelineDropPreview(
    p,
    {
      key: "job:x",
      media: { id: "new-take", duration: 10 },
      job: { snapshot: { targetId: "a" } },
    },
    8,
  );
  assert.equal(preview.mode, "select");
  assert.equal(preview.start, 0);
  assert.equal(preview.duration, 5);
});
