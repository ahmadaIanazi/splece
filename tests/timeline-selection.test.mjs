import test from "node:test";
import assert from "node:assert/strict";
import {
  foldedTimeline,
  selectTimelineClips,
  moveTimelineSelection,
} from "../shared/timeline-selection.mjs";
import {
  groupSlots,
  moveTimelineGroup,
  reconcilePlannedTimeline,
} from "../shared/planned-timeline.mjs";
import { editedStoryTiming } from "../shared/timeline-navigation.mjs";
const fixture = () => ({
  episodeId: "e",
  drafts: [],
  storyPlans: {
    e: {
      beats: [
        { id: "g", nodeType: "group", start: 0, duration: 15 },
        {
          id: "nested",
          nodeType: "group",
          parentId: "g",
          start: 5,
          duration: 10,
        },
        ...["a", "b", "c", "d"].map((id, i) => ({
          id,
          nodeType: "clip",
          parentId: i === 0 ? "g" : i < 3 ? "nested" : "",
          start: i * 5,
          duration: 5,
        })),
      ],
    },
  },
  clips: ["a", "b", "c", "d"].map((id, i) => ({
    id: "slot-" + id,
    storyBeatId: id,
    structureNodeId: id,
    start: i * 5,
    duration: 5,
    takes: [],
    activeTake: null,
    plannedReservation: true,
  })),
  remarks: [{ start: 3, end: 7 }],
  audioClips: [{ start: 4, duration: 2 }],
});
test("Nested collapse hides descendants in one block and changes no underlying timing or data", () => {
  const p = fixture(),
    before = structuredClone(p);
  const items = foldedTimeline(p, ["nested", "g"]);
  assert.equal(items.length, 2);
  assert.equal(items[0].node.id, "g");
  assert.equal(items[0].duration, 15);
  assert.deepEqual(
    items[0].members.map((c) => c.id),
    ["slot-a", "slot-b", "slot-c"],
  );
  const expanded = foldedTimeline(p, ["nested"]);
  assert.equal(expanded.length, 3);
  assert.equal(expanded[1].node.id, "nested");
  assert.equal(expanded[1].start, 5);
  assert.equal(foldedTimeline(p).length, 4);
  assert.deepEqual(p, before);
});
test("Interleaved group members do not hide unrelated slots or occupy their time", () => {
  const p = fixture();
  p.clips[1].start = 10;
  p.clips[2].start = 15;
  p.clips[3].start = 5;
  const items = foldedTimeline(p, ["g"]);
  assert.deepEqual(
    items.map((i) => [i.type, i.start, i.duration]),
    [
      ["group", 0, 5],
      ["clip", 5, 5],
      ["group", 10, 10],
    ],
  );
  assert.equal(items[1].clip.id, "slot-d");
});
test("Command toggles individual clips/groups and Shift extends the anchored timeline range", () => {
  const p = fixture(),
    clips = p.clips;
  assert.deepEqual(
    selectTimelineClips(clips, ["slot-a"], ["slot-c"], { toggle: true }),
    ["slot-a", "slot-c"],
  );
  assert.deepEqual(
    selectTimelineClips(clips, ["slot-a", "slot-c"], ["slot-a"], {
      toggle: true,
    }),
    ["slot-c"],
  );
  assert.deepEqual(
    selectTimelineClips(clips, ["slot-a"], ["slot-c"], {
      range: true,
      anchor: "slot-a",
    }),
    ["slot-a", "slot-b", "slot-c"],
  );
  assert.deepEqual(
    selectTimelineClips(
      clips,
      ["slot-d"],
      groupSlots(p, "g").map((c) => c.id),
      { toggle: true },
    ),
    clips.map((c) => c.id),
  );
  assert.deepEqual(
    selectTimelineClips(
      clips,
      clips.map((c) => c.id),
      groupSlots(p, "g").map((c) => c.id),
      { toggle: true },
    ),
    ["slot-d"],
  );
  assert.deepEqual(
    selectTimelineClips(clips, ["slot-d"], ["slot-b"], {
      range: true,
      toggle: true,
      anchor: "slot-a",
    }),
    ["slot-a", "slot-b", "slot-d"],
  );
});
test("Selection drag preserves editorial order, nested membership, media and fixed notes/audio", () => {
  const p = fixture();
  p.clips[0].activeTake = "m";
  p.clips[0].takes = [{ id: "m", duration: 5 }];
  p.drafts = p.clips.map((c) => ({
    id: "draft-" + c.id,
    episodeId: "e",
    targetId: c.id,
    start: c.start,
    settings: { duration: 5 },
    closed: true,
  }));
  const before = structuredClone(p);
  assert.equal(moveTimelineSelection(p, ["slot-c", "slot-a"], 100), true);
  assert.deepEqual(
    [...p.clips].sort((a, b) => a.start - b.start).map((c) => c.id),
    ["slot-b", "slot-d", "slot-a", "slot-c"],
  );
  assert.deepEqual(
    p.drafts.map((d) => d.start),
    [10, 0, 15, 5],
  );
  assert.equal(
    p.storyPlans.e.beats.find((n) => n.id === "c").parentId,
    "nested",
  );
  assert.deepEqual(p.clips[0].takes, before.clips[0].takes);
  assert.deepEqual(p.remarks, before.remarks);
  assert.deepEqual(p.audioClips, before.audioClips);
  assert.equal(reconcilePlannedTimeline(p), false);
  assert.equal(moveTimelineSelection(p, ["slot-c", "slot-a"], 100), false);
});
test("Collapsed group can still move, update nested ranges and expand in its new position", () => {
  const p = fixture();
  moveTimelineGroup(p, "g", 100);
  const items = foldedTimeline(p, ["g", "nested"]);
  assert.equal(items[0].clip.id, "slot-d");
  assert.equal(items[1].start, 5);
  assert.equal(items[1].duration, 15);
  assert.equal(editedStoryTiming(p).get("nested").start, 10);
  assert.deepEqual(
    foldedTimeline(p, ["nested"]).map((i) => i.start),
    [0, 5, 10],
  );
});
