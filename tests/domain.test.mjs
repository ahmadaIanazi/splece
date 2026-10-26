import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  newProject,
  normalizeSettings,
  compilePrompt,
  splitClip,
  validateProject,
} from "../server/domain.mjs";
import { openStore } from "../server/store.mjs";

test("switching models preserves supported settings and reports incompatible changes", () => {
  const result = normalizeSettings(
    { duration: 5, resolution: "480p", aspect: "9:16" },
    "demo-motion",
  );
  assert.deepEqual(result.settings, {
    model: "demo-motion",
    duration: 4,
    resolution: "720p",
    aspect: "9:16",
  });
  assert.equal(result.changes.length, 2);
  assert.throws(() => normalizeSettings({}, "paid-provider"));
});
test("compilation preserves original writing and snapshots only selected assets and fixed-time remarks", () => {
  const p = newProject("Story"),
    d = p.drafts[0];
  d.scenes[0].text = "A quiet opening. Keep these exact words.";
  d.start = 5;
  p.assets = [
    {
      id: "hero",
      name: "Mira",
      kind: "character",
      description: "Curly hair",
      variant: "Blue coat",
    },
    { id: "other", name: "Excluded", description: "Not included" },
  ];
  d.referenceIds = ["hero"];
  d.scenes[0].dialogue = [
    { speaker: "hero", delivery: "Whispering", text: "Are you there?" },
  ];
  p.remarks = [
    { start: 5, end: 8, text: "Hook" },
    { start: 30, end: 32, text: "Not relevant" },
  ];
  const before = JSON.stringify(d),
    result = compilePrompt(p, d);
  assert.equal(JSON.stringify(d), before);
  assert.match(result.text, /A quiet opening. Keep these exact words./);
  assert.match(result.text, /Mira \(Whispering\): “Are you there\?”/);
  assert.match(result.text, /Hook/);
  assert.doesNotMatch(result.text, /Excluded|Not relevant/);
  p.assets[0].description = "Changed later";
  assert.equal(result.references[0].description, "Curly hair");
});
test("split uses source trim correctly and does not touch absolute remarks or link takes", () => {
  const p = newProject("Story");
  p.remarks = [{ id: "r", start: 2, end: 6, text: "Hook" }];
  p.clips = [
    {
      id: "c",
      start: 1,
      in: 3,
      duration: 8,
      takes: [{ id: "one" }, { id: "two" }],
      activeTake: "one",
    },
  ];
  const result = splitClip(p.clips, "c", 4);
  assert.equal(result[0].duration, 3);
  assert.equal(result[1].in, 6);
  assert.equal(result[1].duration, 5);
  result[1].takes[0].id = "changed";
  assert.equal(result[0].takes[0].id, "one");
  assert.deepEqual(p.remarks, [{ id: "r", start: 2, end: 6, text: "Hook" }]);
});
test("continuity samples outgoing and incoming frames at source trims", () => {
  const p = newProject("Story"),
    d = p.drafts[0];
  d.start = 5;
  p.clips = [
    {
      id: "before",
      start: 0,
      duration: 5,
      in: 4,
      activeTake: "a",
      intent: "Opening",
    },
    {
      id: "after",
      start: 10,
      duration: 5,
      in: 2,
      activeTake: "b",
      intent: "Next",
    },
  ];
  const r = compilePrompt(p, d);
  assert.equal(r.boundaries.start.time, 9 - 1 / 24);
  assert.equal(r.boundaries.end.time, 2);
  assert.equal(r.planningContext.after, "Next");
  assert.doesNotMatch(r.text, /Previous clip/);
});
test("disk revisions reject stale updates, retain history, and survive reopening", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "frame-test-"));
  try {
    const file = path.join(dir, "studio.sqlite");
    let store = openStore(file);
    const p = newProject("Persisted");
    assert.equal(store.save(p, 0), 1);
    p.drafts[0].scenes[0].text = "Keep my effort";
    assert.equal(store.save(p, 1), 2);
    assert.throws(
      () => store.save(p, 1),
      (e) => e.status === 409,
    );
    const j = {
      id: "j",
      projectId: p.id,
      state: "running",
      providerJobId: "local-accepted",
      snapshot: { prompt: "Frozen" },
    };
    store.putJob(j);
    store.db.close();
    store = openStore(file);
    assert.equal(
      store.get(p.id).project.drafts[0].scenes[0].text,
      "Keep my effort",
    );
    assert.equal(store.job("j").providerJobId, "local-accepted");
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM history").get().n, 2);
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test("invalid negative timeline ranges are rejected", () => {
  const p = newProject("Story");
  p.clips = [{ start: -1, duration: 5, in: 0 }];
  assert.throws(() => validateProject(p));
});
