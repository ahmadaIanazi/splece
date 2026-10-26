import test from "node:test";
import assert from "node:assert/strict";
import {
  removeStorySlot,
  generationPool,
  restorePoolEntry,
} from "../shared/generation-pool.mjs";
import {
  stitchTimeline,
  insertStorySlot,
  reserveGenerationSlot,
  adoptReadyGenerations,
} from "../shared/generation-slots.mjs";
import { openClipPrompt } from "../shared/clip-prompt.mjs";
const media = (id, duration = 5) => ({
  id,
  duration,
  jobId: "j" + id,
  kind: "video",
});
const clip = (id, start = 0) => ({
  id,
  start,
  duration: 5,
  in: 0,
  takes: [media(id)],
  activeTake: id,
  volume: 0.4,
  mute: true,
});
const draft = (id, target, episodeId = "e") => ({
  id,
  targetId: target,
  episodeId,
  name: "Scene " + id,
  settings: { duration: 5 },
  scenes: [{ text: "Action" }],
});
const job = (id, target, episodeId = "e") => ({
  id: "j" + id,
  createdAt: 1,
  kind: "generation",
  state: "ready",
  media: media(id),
  snapshot: { targetId: target, draft: draft("d" + id, target, episodeId) },
});
const project = () => ({
  episodeId: "e",
  drafts: [draft("da", "a"), draft("db", "b")],
  clips: [clip("a"), clip("b", 5), clip("c", 10)],
  remarks: [{ start: 5, end: 10 }],
  audioClips: [{ start: 3, duration: 8 }],
});

test("Remove and restore a trimmed stack across serialization, preserving all edits and fixed notes", () => {
  let p = project();
  p.clips[1].takes.push(media("b2", 10));
  Object.assign(p.clips[1], {
    in: 1,
    duration: 4,
    takeEdits: { b2: { in: 2, duration: 7 } },
    sourceDraftId: "db",
    storyBeatId: "scene-b",
  });
  stitchTimeline(p);
  removeStorySlot(p, "b", 2);
  assert.deepEqual(
    p.clips.map((c) => c.start),
    [0, 5],
  );
  p = JSON.parse(JSON.stringify(p));
  const entries = generationPool(p, [job("b", "b"), job("b2", "b")]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].clip.takes.length, 2);
  const restored = restorePoolEntry(
    p,
    [job("b", "b"), job("b2", "b")],
    entries[0].key,
    5,
  );
  assert.equal(restored.id, "b");
  assert.equal(restored.in, 1);
  assert.equal(restored.duration, 4);
  assert.equal(restored.volume, 0.4);
  assert.equal(restored.mute, true);
  assert.deepEqual(restored.takeEdits.b2, { in: 2, duration: 7 });
  assert.deepEqual(
    [...p.clips].sort((a, b) => a.start - b.start).map((c) => [c.id, c.start]),
    [
      ["a", 0],
      ["b", 5],
      ["c", 9],
    ],
  );
  assert.equal(p.drafts[1].start, 5);
  assert.deepEqual(p.remarks, [{ start: 5, end: 10 }]);
  assert.deepEqual(p.audioClips, [{ start: 3, duration: 8 }]);
  assert.equal(p.removedClips.length, 0);
});

test("Historical jobs deleted before the pool existed recover every take and the exact prompt", () => {
  const p = project(),
    j1 = job("old1", "gone"),
    j2 = job("old2", "gone");
  j2.createdAt = 2;
  const c = restorePoolEntry(p, [j1, j2], "job:jold1", 100);
  assert.equal(c.start, 15);
  assert.equal(c.takes.length, 2);
  assert.equal(c.activeTake, "old1");
  const d = openClipPrompt(p, c.id, [j1, j2], () => "reopened");
  assert.equal(d.sourceGenerationId, j1.id);
  assert.equal(d.start, 15);
  assert.equal(d.closed, false);
  assert.equal(restorePoolEntry(p, [j1, j2], "job:jold1", 0).id, c.id);
  assert.equal(p.clips.length, 4);
});

test("Restoring from an older generation record selects that exact take inside its saved stack", () => {
  const p = project();
  p.clips[1].takes.push(media("alternate", 10));
  p.clips[1].takeEdits = { alternate: { in: 2, duration: 6 } };
  removeStorySlot(p, "b");
  const restored = restorePoolEntry(
    p,
    [job("b", "b")],
    "slot:b",
    5,
    () => "unused",
    "alternate",
  );
  assert.equal(restored.activeTake, "alternate");
  assert.equal(restored.duration, 6);
  assert.equal(restored.in, 2);
  assert.equal(p.clips.find((c) => c.id === "c").start, 11);
});

test("An in-flight removed job stays off the timeline and becomes recoverable when ready", () => {
  const p = project();
  p.clips[1].takes = [];
  p.clips[1].activeTake = null;
  const j = job("new", "b");
  removeStorySlot(p, "b");
  assert.equal(adoptReadyGenerations(p, [j]), false);
  assert.equal(p.clips.length, 2);
  const entry = generationPool(p, [j])[0];
  assert.equal(entry.media.id, "new");
  const c = restorePoolEntry(p, [j], entry.key, 5);
  assert.equal(c.id, "b");
  assert.equal(c.activeTake, "new");
});

test("Pool is episode scoped, and independent removed slices sharing a source retain their trims", () => {
  const p = project();
  Object.assign(p.clips[0], { in: 2, duration: 2, independentSlot: true });
  p.clips[1].takes = p.clips[0].takes;
  p.clips[1].activeTake = "a";
  p.clips[1].in = 4;
  p.clips[1].duration = 1;
  p.clips[1].independentSlot = true;
  removeStorySlot(p, "a");
  removeStorySlot(p, "b");
  const entries = generationPool(p, [job("foreign", "x", "other")]);
  assert.equal(entries.length, 2);
  assert.equal(restorePoolEntry(p, [], "slot:b", 0).in, 4);
  assert.equal(restorePoolEntry(p, [], "slot:a", 0).in, 2);
  p.episodeId = "another";
  assert.equal(generationPool(p, [job("foreign", "x", "other")]).length, 0);
});

test("Legacy gaps, leading gaps, overlap, insertion and late suggestions all become continuous cuts", () => {
  const p = project();
  p.clips[0].start = 3;
  p.clips[1].start = 12;
  p.clips[2].start = 13;
  assert.equal(stitchTimeline(p), true);
  assert.deepEqual(
    p.clips.map((c) => c.start),
    [0, 5, 10],
  );
  assert.equal(stitchTimeline(p), false);
  insertStorySlot(p, clip("insert"), 7);
  assert.deepEqual(
    [...p.clips].sort((a, b) => a.start - b.start).map((c) => c.id),
    ["a", "insert", "b", "c"],
  );
  p.drafts.push({ ...draft("far", null), start: 500 });
  const reserved = reserveGenerationSlot(p, "far", [], () => "far");
  assert.equal(reserved.start, 20);
  assert.equal(p.drafts.at(-1).start, 20);
});
