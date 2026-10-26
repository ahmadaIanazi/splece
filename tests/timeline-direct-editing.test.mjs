import test from "node:test";
import assert from "node:assert/strict";
import { upgradeProject } from "../shared/studio.mjs";
import { newProject } from "../server/domain.mjs";
import {
  trimTimelineClip,
  copyTimelineRange,
  removeTimelineRange,
  pasteTimelineRange,
} from "../shared/timeline-editing.mjs";
import {
  timelineFrameSources,
  captureTimelineFrame,
  timelineFrameUsages,
} from "../shared/timeline-frames.mjs";
import { editedStoryTiming } from "../shared/timeline-navigation.mjs";
const fixture = () => {
  const p = upgradeProject(newProject("Direct editing"));
  p.clips = [
    {
      id: "a",
      start: 0,
      in: 2,
      duration: 5,
      activeTake: "m",
      takes: [{ id: "m", duration: 12 }],
      storyBeatId: "beat",
    },
    {
      id: "b",
      start: 5,
      in: 0,
      duration: 4,
      activeTake: "b-media",
      takes: [{ id: "b-media", duration: 8 }],
    },
  ];
  p.drafts[0].targetId = "b";
  p.drafts[0].start = 5;
  p.storyPlans = {};
  p.storyPlans[p.episodeId] = {
    beats: [
      {
        id: "beat",
        nodeType: "clip",
        kind: "generation",
        parentId: "g",
        start: 0,
        duration: 5,
        end: 5,
      },
      {
        id: "g",
        nodeType: "group",
        kind: "scene",
        start: 0,
        end: 5,
        duration: 5,
      },
    ],
  };
  return p;
};
test("Trim preview and commit are identical, ripple draft and group times, and do not mutate source", () => {
  const p = fixture(),
    preview = structuredClone(p),
    commit = structuredClone(p);
  trimTimelineClip(preview, "a", "right", -1.5, 24);
  trimTimelineClip(commit, "a", "right", -1.5, 24);
  assert.deepEqual(preview, commit);
  assert.equal(p.clips[0].duration, 5);
  assert.equal(preview.clips[0].duration, 3.5);
  assert.equal(preview.clips[1].start, 3.5);
  assert.equal(preview.drafts[0].start, 3.5);
  assert.equal(editedStoryTiming(preview).get("g").end, 3.5);
  trimTimelineClip(commit, "a", "left", 1, 24);
  assert.equal(commit.clips[0].in, 3);
  assert.equal(commit.clips[0].duration, 2.5);
});
test("Trim clamps to source and one-frame minimum including repaired takes", () => {
  const p = fixture();
  trimTimelineClip(p, "a", "left", -100);
  assert.equal(p.clips[0].in, 0);
  assert.equal(p.clips[0].duration, 7);
  trimTimelineClip(p, "a", "right", 100);
  assert.equal(p.clips[0].duration, 12);
  trimTimelineClip(p, "a", "right", -100);
  assert.equal(p.clips[0].duration, 1 / 24);
  const c = p.clips[1];
  c.repair = true;
  c.in = 10;
  c.takes[0].sourceIn = 3;
  trimTimelineClip(p, "b", "right", 100);
  assert.equal(c.duration, 5);
});
test("Range copy/remove splits precisely, preserves media and restores paste at exact playhead", () => {
  const p = fixture(),
    original = structuredClone(p),
    range = { from: 1, to: 3 };
  const copy = copyTimelineRange(p, range);
  assert.deepEqual(p, original);
  assert.equal(copy.duration, 2);
  assert.equal(copy.clips[0].in, 3);
  let i = 0;
  const id = () => `new-${++i}`;
  removeTimelineRange(p, range, id);
  assert.deepEqual(
    p.clips.map((c) => [c.start, c.in, c.duration]),
    [
      [0, 2, 1],
      [1, 5, 2],
      [3, 0, 4],
    ],
  );
  assert.equal(p.drafts[0].start, 3);
  assert.equal(p.removedClips[0].clip.in, 3);
  pasteTimelineRange(p, copy, 1, id);
  assert.deepEqual(
    p.clips.map((c) => [c.start, c.in, c.duration]),
    [
      [0, 2, 1],
      [1, 3, 2],
      [3, 5, 2],
      [5, 0, 4],
    ],
  );
  assert.equal(p.drafts[0].start, 5);
});
test("Cross-clip ranges preserve source offsets; pending slots block before changing anything", () => {
  const p = fixture();
  const copy = copyTimelineRange(p, { from: 4, to: 7 });
  assert.deepEqual(
    copy.clips.map((c) => [c.in, c.duration]),
    [
      [6, 1],
      [0, 2],
    ],
  );
  p.clips[1].activeTake = null;
  const before = structuredClone(p);
  assert.throws(
    () => removeTimelineRange(p, { from: 4, to: 7 }),
    /planned slots/,
  );
  assert.deepEqual(p, before);
});
test("Frame markers derive from saved prompts and track source frames after trims and splits", () => {
  const p = fixture(),
    source = timelineFrameSources(p)[0];
  const frame = captureTimelineFrame(source, 5);
  p.drafts[0].frameOverrides = { start: { mode: "manual", frame } };
  assert.equal(timelineFrameUsages(p)[0].at, 3);
  trimTimelineClip(p, "a", "left", 1);
  assert.equal(timelineFrameUsages(p)[0].at, 2);
  trimTimelineClip(p, "a", "right", -3);
  assert.equal(timelineFrameUsages(p).length, 0);
  assert.equal(p.drafts[0].frameOverrides.start.frame.time, 5);
  p.clips[1].repair = true;
  p.clips[1].takes[0].sourceIn = 2;
  assert.equal(timelineFrameSources(p)[1].min, 2);
});
