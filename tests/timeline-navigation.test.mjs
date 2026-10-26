import test from "node:test";
import assert from "node:assert/strict";
import {
  draftTimelinePosition,
  editedStoryTiming,
  syncEditedDraftTimes,
  storyTimelineLabels,
} from "../shared/timeline-navigation.mjs";
import {
  resizeSlot,
  reorderStorySlot,
  generationTarget,
  stitchTimeline,
} from "../shared/generation-slots.mjs";
import { removeStorySlot } from "../shared/generation-pool.mjs";
const fixture = () => ({
  episodeId: "e",
  settings: { export: { fps: 24 } },
  clips: [0, 1, 2].map((i) => ({
    id: "c" + i,
    storyBeatId: "g" + i,
    start: i * 10,
    duration: 10,
    takes: [],
  })),
  drafts: [0, 1, 2].map((i) => ({
    id: "d" + i,
    episodeId: "e",
    storyBeatId: "g" + i,
    targetId: "c" + i,
    start: i * 10,
    settings: { duration: 10 },
  })),
  remarks: [{ id: "r", start: 10, end: 25 }],
  storyPlans: {
    e: {
      beats: [
        {
          id: "a",
          kind: "act",
          title: "The beginning",
          start: 0,
          duration: 30,
        },
        {
          id: "ch",
          parentId: "a",
          kind: "chapter",
          title: "Morning",
          start: 0,
          duration: 30,
        },
        {
          id: "s",
          parentId: "ch",
          kind: "scene",
          title: "The forest",
          start: 0,
          duration: 30,
        },
        ...[0, 1, 2, 3].map((i) => ({
          id: "g" + i,
          parentId: "s",
          kind: "generation",
          title: "Generation " + i,
          start: i * 10,
          duration: 10,
        })),
      ],
    },
  },
});
test("Trimming updates linked and closed variations without rewriting model duration, story plan, or fixed remarks", () => {
  const p = fixture();
  p.drafts.push({
    ...structuredClone(p.drafts[2]),
    id: "variant",
    closed: true,
    targetId: null,
    generationSlotId: "c2",
  });
  const story = structuredClone(p.storyPlans),
    remarks = structuredClone(p.remarks);
  resizeSlot(p, p.clips[0], 3);
  syncEditedDraftTimes(p);
  assert.equal(p.drafts[2].start, 13);
  assert.equal(p.drafts[3].start, 13);
  assert.equal(draftTimelinePosition(p, p.drafts[3]).seek, 13);
  assert.equal(p.drafts[3].settings.duration, 10);
  assert.deepEqual(p.storyPlans, story);
  assert.deepEqual(p.remarks, remarks);
  assert.deepEqual(editedStoryTiming(p).get("ch"), {
    start: 0,
    end: 23,
    placed: true,
  });
});
test("Reorder and deletion navigate current slots and safe insertion boundaries, never stale empty timestamps", () => {
  const p = fixture();
  reorderStorySlot(p, "c2", 0);
  syncEditedDraftTimes(p);
  assert.equal(draftTimelinePosition(p, p.drafts[2]).seek, 0);
  assert.equal(draftTimelinePosition(p, p.drafts[0]).seek, 10);
  removeStorySlot(p, "c0");
  syncEditedDraftTimes(p);
  assert.equal(p.drafts[0].start, 10);
  assert.equal(draftTimelinePosition(p, p.drafts[0]).clip, null);
  assert.equal(draftTimelinePosition(p, p.drafts[0]).seek, 10);
  const future = { storyBeatId: "g3", start: 999, settings: { duration: 5 } };
  const position = draftTimelinePosition(p, future);
  assert.equal(position.start, 10); // next story generation follows the moved g2
  assert.ok(position.seek <= 20);
  p.clips = [];
  assert.equal(draftTimelinePosition(p, future).start, 0);
  assert.equal(draftTimelinePosition(p, future).seek, 0);
});
test("End insertion previews the last real frame, including free removed drafts", () => {
  const p = fixture();
  const d = { storyBeatId: "g3", start: 999, settings: { duration: 5 } };
  assert.equal(draftTimelinePosition(p, d).start, 30);
  assert.equal(draftTimelinePosition(p, d).seek, 30 - 1 / 24);
  assert.equal(
    draftTimelinePosition(p, { targetId: "removed", start: 999 }).start,
    30,
  );
});
test("Explicit split segment and alias take priority over the shared story identity", () => {
  const p = fixture();
  const split = {
    ...structuredClone(p.clips[0]),
    id: "split",
    independentSlot: true,
    start: 30,
    duration: 3,
  };
  p.clips.push(split);
  const d = { ...p.drafts[0], targetId: null, generationSlotId: "split" };
  assert.equal(generationTarget(p, d).id, "split");
  assert.equal(draftTimelinePosition(p, d).seek, 30);
  p.clips[0].generationTargets = ["old-merged"];
  assert.equal(
    draftTimelinePosition(p, { ...d, targetId: "old-merged" }).seek,
    0,
  );
  removeStorySlot(p, "c0");
  assert.equal(draftTimelinePosition(p, p.drafts[0]).clip.id, "split");
});
test("Free prompt variants and episode isolation survive ripple edits", () => {
  const p = fixture();
  p.clips[2].storyBeatId = null;
  p.drafts[2].storyBeatId = null;
  p.drafts[2].promptGroupId = "free";
  p.drafts.push(
    { id: "v", promptGroupId: "free", episodeId: "e", start: 20 },
    { id: "foreign", episodeId: "other", targetId: "c2", start: 999 },
  );
  resizeSlot(p, p.clips[0], 2);
  syncEditedDraftTimes(p);
  assert.equal(p.drafts[3].start, 12);
  assert.equal(p.drafts[4].start, 999);
});
test("Semantic zoom shows hierarchy, prevents label overlap and keeps the active section visible after scrolling", () => {
  const p = fixture();
  assert.deepEqual(
    new Set(storyTimelineLabels(p, 12).labels.map((b) => b.kind)),
    new Set(["act"]),
  );
  assert.deepEqual(
    new Set(storyTimelineLabels(p, 30).labels.map((b) => b.kind)),
    new Set(["chapter"]),
  );
  assert.deepEqual(
    new Set(storyTimelineLabels(p, 60).labels.map((b) => b.kind)),
    new Set(["chapter", "scene"]),
  );
  const zoomed = storyTimelineLabels(p, 140);
  assert.ok(zoomed.labels.some((b) => b.kind === "generation"));
  assert.ok(!zoomed.labels.some((b) => b.id === "g3"));
  for (const lane of [0, 1]) {
    const labels = zoomed.labels.filter((b) => b.lane === lane);
    labels
      .slice(1)
      .forEach((b, i) => assert.ok(b.left >= labels[i].left + labels[i].width));
  }
  const scrolled = storyTimelineLabels(p, 60, editedStoryTiming(p), 900);
  assert.equal(scrolled.labels.find((b) => b.id === "ch").left, 900);
  p.clips[0].duration = 0.1;
  stitchTimeline(p);
  const dense = storyTimelineLabels(p, 140);
  assert.ok(!dense.labels.some((b) => b.id === "g0"));
});
