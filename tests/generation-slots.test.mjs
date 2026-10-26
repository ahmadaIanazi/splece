import test from "node:test";
import assert from "node:assert/strict";
import {
  generationTarget,
  reserveGenerationSlot,
  adoptReadyGenerations,
  activateSlotTake,
  consolidateGenerationSlots,
  clipJobs,
  currentSlotJob,
} from "../shared/generation-slots.mjs";
const draft = (id = "d", beat = "beat", start = 0, duration = 5) => ({
  id,
  episodeId: "e",
  name: "Same title",
  storyBeatId: beat,
  targetId: null,
  start,
  settings: { duration },
  scenes: [{ text: "Scene" }],
});
const clip = (id, start = 0, duration = 5) => ({
  id,
  start,
  duration,
  in: 0,
  takes: [],
  activeTake: null,
});
const job = (id, target, d, createdAt = 1, state = "ready") => ({
  id,
  kind: "generation",
  createdAt,
  state,
  snapshot: { targetId: target, draft: structuredClone(d) },
  media:
    state === "ready"
      ? { id: "m-" + id, jobId: id, duration: d.settings.duration + 0.04 }
      : null,
});
const project = () => ({
  episodeId: "e",
  clips: [],
  drafts: [draft()],
  remarks: [{ id: "r", start: 10, end: 20 }],
  audioClips: [{ start: 10, duration: 5 }],
});
test("Story identity reuses one slot despite new draft IDs, changed timing, and stale deleted target", () => {
  const p = project(),
    first = reserveGenerationSlot(p, "d", [], () => "slot");
  const j = job("j", "slot", p.drafts[0]);
  const copy = draft("copy", "beat", 99, 10);
  copy.targetId = "deleted";
  p.drafts.push(copy);
  assert.equal(reserveGenerationSlot(p, "copy", [j]).id, first.id);
  assert.equal(copy.start, 0);
  assert.equal(p.clips.length, 1);
  assert.equal(first.duration, 5);
  const different = draft("different", "other", 0);
  p.drafts.push(different);
  reserveGenerationSlot(p, "different", [j], () => "other");
  assert.equal(p.clips.length, 2);
  assert.equal(first.start, 5); // insertion shifts, never overlaps
});
test("New requested position inside a clip inserts after that clip", () => {
  const p = project();
  p.clips = [clip("a", 0, 10), clip("b", 10, 5)];
  p.drafts[0].start = 5;
  const added = reserveGenerationSlot(p, "d", [], () => "new");
  assert.equal(added.start, 10);
  assert.equal(p.clips.find((c) => c.id === "b").start, 15);
});
test("Finished replacements front the stack, ripple length, preserve fixed remarks, and restore each take trim", () => {
  const p = project();
  const c = reserveGenerationSlot(p, "d", [], () => "slot");
  p.clips.push(clip("next", 5, 10));
  const j1 = job("j1", "slot", p.drafts[0]);
  adoptReadyGenerations(p, [j1]);
  c.in = 0.5;
  c.duration = 4.5;
  p.clips[1].start = 4.5;
  const d2 = draft("d2", "beat", 99, 10),
    j2 = job("j2", "slot", d2, 2);
  adoptReadyGenerations(p, [j1, j2]);
  assert.equal(c.takes.length, 2);
  assert.equal(c.activeTake, j2.media.id);
  assert.equal(c.start, 0);
  assert.equal(c.duration, 10);
  assert.equal(p.clips[1].start, 10);
  assert.deepEqual(p.remarks, [{ id: "r", start: 10, end: 20 }]);
  assert.equal(p.audioClips[0].start, 10);
  activateSlotTake(p, c, c.takes[0], [j1, j2]);
  assert.equal(c.in, 0.5);
  assert.equal(c.duration, 4.5);
  assert.equal(p.clips[1].start, 4.5);
  assert.equal(adoptReadyGenerations(p, [j1, j2]), false);
  assert.equal(c.activeTake, j1.media.id);
});
test("Failure and concurrent out-of-order completion cannot replace a successful newer take", () => {
  const p = project(),
    c = reserveGenerationSlot(p, "d", [], () => "slot");
  const early = job("early", "slot", p.drafts[0], 1, "running"),
    latest = job("latest", "slot", p.drafts[0], 2);
  adoptReadyGenerations(p, [early, latest]);
  assert.equal(c.activeTake, latest.media.id);
  const readyEarly = job("early", "slot", p.drafts[0], 1);
  adoptReadyGenerations(p, [readyEarly, latest]);
  assert.equal(c.activeTake, latest.media.id);
  assert.equal(c.takes.length, 2);
  assert.equal(
    currentSlotJob(
      c,
      [job("failure", "slot", p.drafts[0], 3, "failed"), early, latest],
      "e",
    ).id,
    "early",
  );
});
test("Legacy overlapping attempts consolidate without losing footage; split copies and repairs stay separate", () => {
  const p = project(),
    j1 = job("a", "one", p.drafts[0]),
    j2 = job("b", "two", draft("new", "beat", 3), 2);
  p.clips = [
    { ...clip("one"), takes: [j1.media], activeTake: j1.media.id },
    { ...clip("two", 3), takes: [j2.media], activeTake: j2.media.id },
  ];
  p.drafts.push({ ...draft("new"), targetId: "two" });
  assert.equal(consolidateGenerationSlots(p, [j1, j2]), true);
  assert.equal(p.clips.length, 1);
  assert.equal(p.clips[0].takes.length, 2);
  assert.equal(p.clips[0].activeTake, j2.media.id);
  assert.equal(p.drafts[1].targetId, "one");
  assert.equal(clipJobs(p.clips[0], [j1, j2], "e").length, 2);
  assert.equal(consolidateGenerationSlots(p, [j1, j2]), false);
  p.clips.push({ ...structuredClone(p.clips[0]), id: "split", start: 1 });
  assert.equal(consolidateGenerationSlots(p, [j1, j2]), false);
});
test("Deleted slots do not resurrect, and mismatched repair takes remain unselected", () => {
  const p = project(),
    j = job("j", "deleted", p.drafts[0]);
  assert.equal(adoptReadyGenerations(p, [j]), false);
  assert.equal(p.clips.length, 0);
  const c = {
    ...clip("repair", 0, 5),
    repair: true,
    takes: [{ id: "original", duration: 10, sourceIn: 2 }],
    activeTake: "original",
    in: 2,
  };
  p.clips = [c];
  assert.throws(
    () => activateSlotTake(p, c, { id: "short", duration: 2 }, []),
    /too short/,
  );
  assert.equal(c.activeTake, "original");
});
test("Same titles do not merge different scenes or imported footage", () => {
  const p = project();
  const c = clip("unrelated");
  p.clips = [c];
  const d = draft("unrelated-draft", "other");
  const j = job("j", "unrelated", d);
  assert.equal(generationTarget(p, p.drafts[0], [j]), null);
  c.independentSlot = true;
  p.drafts[0].storyBeatId = "other";
  assert.equal(generationTarget(p, p.drafts[0], [j]), null);
});

test("Drag reorder carries complete stacks, closes gaps and updates prompt positions", async () => {
  const { reorderStorySlot, markIndependentSegment } =
    await import("../shared/generation-slots.mjs");
  const p = project();
  p.clips = [clip("a", 0, 5), clip("b", 7, 10), clip("c", 17, 5)];
  p.drafts[0].targetId = "b";
  reorderStorySlot(p, "c", 0);
  assert.deepEqual(
    [...p.clips].sort((a, b) => a.start - b.start).map((c) => [c.id, c.start]),
    [
      ["c", 0],
      ["a", 5],
      ["b", 10],
    ],
  );
  assert.equal(p.drafts[0].start, 10);
  assert.equal(p.remarks[0].start, 10);
  const segment = {
    ...clip("segment", 0, 2),
    in: 3,
    takes: [{ id: "take", duration: 10 }],
  };
  markIndependentSegment(segment);
  assert.deepEqual(segment.takeEdits.take, { in: 3, duration: 2 });
});
