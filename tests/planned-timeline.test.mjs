import test from "node:test";
import assert from "node:assert/strict";
import { reconcilePlannedTimeline } from "../shared/planned-timeline.mjs";
import {
  reserveGenerationSlot,
  adoptReadyGenerations,
  resizeSlot,
  reorderStorySlot,
} from "../shared/generation-slots.mjs";
import {
  editedStoryTiming,
  storyTimelineLabels,
} from "../shared/timeline-navigation.mjs";
const fixture = () => ({
  episodeId: "e",
  drafts: [],
  clips: [],
  storyPlans: {
    e: {
      structureVersion: 1,
      beats: [
        {
          id: "group",
          nodeType: "group",
          kind: "scene",
          title: "Journey",
          start: 0,
          duration: 30,
        },
        ...["Opening", "Middle", "Ending"].map((title, i) => ({
          id: "b" + i,
          nodeType: "clip",
          kind: "generation",
          parentId: "group",
          title,
          start: i * 10,
          duration: 10,
        })),
      ],
    },
  },
  remarks: [{ id: "fixed", start: 5, end: 10 }],
});
test("Entire plan reserves time before media exists; generating the ending first fills its existing slot", () => {
  const p = fixture();
  assert.equal(reconcilePlannedTimeline(p), true);
  assert.deepEqual(
    p.clips.map((c) => c.start),
    [0, 10, 20],
  );
  const ending = p.clips[2];
  const id = ending.id;
  p.drafts.push({
    id: "d",
    episodeId: "e",
    storyBeatId: "b2",
    start: 20,
    settings: { duration: 5 },
    scenes: [{ text: "The boat arrives." }],
  });
  assert.equal(reserveGenerationSlot(p, "d").id, id);
  assert.equal(p.clips.length, 3);
  const job = {
    id: "j",
    kind: "generation",
    state: "ready",
    snapshot: { targetId: id, draft: p.drafts[0] },
    media: { id: "m", jobId: "j", duration: 5 },
  };
  assert.ok(adoptReadyGenerations(p, [job]));
  assert.equal(ending.start, 20);
  assert.equal(ending.duration, 5);
  assert.equal(ending.activeTake, "m");
  assert.equal(p.clips[0].takes.length, 0);
  const saved = structuredClone(p);
  assert.equal(reconcilePlannedTimeline(p), false);
  assert.deepEqual(p, saved);
  assert.deepEqual(editedStoryTiming(p).get("group"), {
    start: 0,
    end: 25,
    placed: true,
  });
  assert.ok(storyTimelineLabels(p, 60).labels.some((n) => n.id === "group"));
});
test("Trims and manual order survive reconciliation, placeholders ripple while fixed remarks stay fixed", () => {
  const p = fixture();
  reconcilePlannedTimeline(p);
  const first = p.clips[0];
  first.takes = [{ id: "m", duration: 10 }];
  first.activeTake = "m";
  resizeSlot(p, first, 4);
  assert.equal(p.clips[2].start, 14);
  reconcilePlannedTimeline(p);
  assert.equal(first.duration, 4);
  reorderStorySlot(p, p.clips[2].id, 0);
  const ordered = [...p.clips]
    .sort((a, b) => a.start - b.start)
    .map((c) => c.id);
  reconcilePlannedTimeline(p);
  assert.deepEqual(
    [...p.clips].sort((a, b) => a.start - b.start).map((c) => c.id),
    ordered,
  );
  assert.deepEqual(p.remarks, [{ id: "fixed", start: 5, end: 10 }]);
});
test("An empty group owns time; adding children replaces only its unfilled reservation", () => {
  const p = fixture();
  p.storyPlans.e.beats = [p.storyPlans.e.beats[0]];
  reconcilePlannedTimeline(p);
  assert.equal(p.clips.length, 1);
  assert.equal(p.clips[0].duration, 30);
  assert.equal(editedStoryTiming(p).get("group").end, 30);
  p.storyPlans.e.beats.push({
    id: "child",
    nodeType: "clip",
    title: "First moment",
    parentId: "group",
    start: 0,
    duration: 5,
  });
  reconcilePlannedTimeline(p);
  assert.equal(p.clips.length, 1);
  assert.equal(p.clips[0].storyBeatId, "child");
  p.storyPlans.e.beats = [];
  reconcilePlannedTimeline(p);
  assert.equal(p.clips.length, 0);
});
test("Existing completed footage and in-flight slots are retained when structure changes", () => {
  const p = fixture();
  reconcilePlannedTimeline(p);
  p.clips[0].takes = [{ id: "m", duration: 10 }];
  p.clips[0].activeTake = "m";
  p.clips[1].generationRequested = true;
  p.storyPlans.e.beats = [];
  reconcilePlannedTimeline(p);
  assert.equal(p.clips.length, 2);
  assert.equal(p.clips[0].activeTake, "m");
});

test("Each planned clip has its own range before a prompt draft exists", () => {
  const p = fixture();
  reconcilePlannedTimeline(p);
  const timings = editedStoryTiming(p);
  assert.equal(timings.get("b1").start, 10);
  assert.equal(timings.get("b2").start, 20);
});

test("Restoring a removed clip fills its planned reservation without duplicating the sequence", async () => {
  const { removeStorySlot, restorePoolEntry } =
    await import("../shared/generation-pool.mjs");
  const p = fixture();
  reconcilePlannedTimeline(p);
  const removed = p.clips[2];
  removed.takes = [{ id: "media", duration: 7 }];
  removed.activeTake = "media";
  resizeSlot(p, removed, 7);
  removeStorySlot(p, removed.id);
  reconcilePlannedTimeline(p);
  const reserved = p.clips.find((c) => c.storyBeatId === "b2");
  const restored = restorePoolEntry(p, [], "slot:" + removed.id, 20);
  assert.equal(restored.id, reserved.id);
  assert.equal(restored.start, 20);
  assert.equal(restored.duration, 7);
  assert.equal(p.clips.length, 3);
});

test("Imported media fills a planned slot and trims to its budget instead of adding another slot", async () => {
  const { fillPlannedSlot } = await import("../shared/planned-timeline.mjs");
  const p = fixture();
  reconcilePlannedTimeline(p);
  const id = p.clips[1].id;
  const filled = fillPlannedSlot(
    p,
    {
      id: "import",
      duration: 45,
      in: 0,
      activeTake: "m",
      takes: [{ id: "m", duration: 45 }],
    },
    15,
    false,
  );
  assert.equal(filled.id, id);
  assert.equal(filled.duration, 10);
  assert.equal(filled.storyBeatId, "b1");
  assert.equal(p.clips.length, 3);
});

test("Planned resize persists across reconciliation and reload, ripples drafts and nested group ranges", async () => {
  const { editPlannedSlot } = await import("../shared/planned-timeline.mjs");
  const p = fixture();
  p.storyPlans.e.beats.unshift({
    id: "root",
    nodeType: "group",
    start: 0,
    duration: 30,
  });
  p.storyPlans.e.beats.find((n) => n.id === "group").parentId = "root";
  reconcilePlannedTimeline(p);
  p.drafts = ["a", "variation", "later"].map((id, i) => ({
    id,
    episodeId: "e",
    storyBeatId: i < 2 ? "b0" : "b2",
    settings: { model: "test", duration: 10 },
    start: i < 2 ? 0 : 20,
    closed: true,
    scenes: [{ text: "Keep my writing" }],
  }));
  const before = structuredClone(p);
  assert.equal(
    editPlannedSlot(p, p.clips[0].id, { duration: 15 }, [
      { id: "test", durations: [5, 10, 15] },
    ]),
    true,
  );
  assert.deepEqual(
    p.clips.map((c) => c.start),
    [0, 15, 25],
  );
  assert.equal(p.storyPlans.e.beats.find((n) => n.id === "root").duration, 35);
  assert.equal(p.storyPlans.e.beats.find((n) => n.id === "b0").duration, 15);
  for (const d of p.drafts.slice(0, 2)) {
    assert.equal(d.plannedDuration, 15);
    assert.equal(d.settings.duration, 15);
    assert.equal(d.scenes[0].text, "Keep my writing");
    assert.equal(d.closed, true);
  }
  assert.equal(p.drafts[2].start, 25);
  const reloaded = JSON.parse(JSON.stringify(p));
  assert.equal(reconcilePlannedTimeline(reloaded), false);
  assert.deepEqual(reloaded, p);
  editPlannedSlot(p, p.clips[0].id, { duration: 3.4 }, [
    { id: "test", durations: [5, 10, 15] },
  ]);
  assert.equal(p.drafts[0].plannedDuration, 3.4);
  assert.equal(
    p.drafts[0].settings.duration,
    15,
    "Unsupported durations never enter the provider settings",
  );
  assert.deepEqual(p.remarks, before.remarks);
  assert.equal(
    reconcilePlannedTimeline(before),
    false,
    "Undo snapshot remains valid",
  );
});

test("Moving planned slots updates outline and prompt positions without changing group membership", async () => {
  const { editPlannedSlot } = await import("../shared/planned-timeline.mjs");
  const p = fixture();
  reconcilePlannedTimeline(p);
  p.drafts = [
    {
      id: "ending",
      episodeId: "e",
      storyBeatId: "b2",
      start: 20,
      settings: { duration: 10 },
    },
  ];
  editPlannedSlot(p, p.clips[2].id, { dropTime: 0 });
  assert.equal(p.drafts[0].start, 0);
  assert.equal(p.storyPlans.e.beats.find((n) => n.id === "b2").start, 0);
  assert.equal(
    p.storyPlans.e.beats.find((n) => n.id === "b2").parentId,
    "group",
  );
  assert.equal(reconcilePlannedTimeline(p), false);
  assert.deepEqual(
    [...p.clips].sort((a, b) => a.start - b.start).map((c) => c.storyBeatId),
    ["b2", "b0", "b1"],
  );
});

test("Empty groups can be resized and moved, while submitted slots and invalid lengths are protected", async () => {
  const { editPlannedSlot } = await import("../shared/planned-timeline.mjs");
  const p = fixture();
  p.storyPlans.e.beats = [
    { id: "empty", nodeType: "group", start: 0, duration: 8 },
    ...p.storyPlans.e.beats,
  ];
  reconcilePlannedTimeline(p);
  const empty = p.clips.find((c) => c.structureNodeId === "empty");
  editPlannedSlot(p, empty.id, { duration: 12, dropTime: 100 });
  assert.equal(empty.start, 30);
  assert.equal(p.storyPlans.e.beats[0].duration, 12);
  assert.equal(p.storyPlans.e.beats[0].start, 30);
  const before = structuredClone(p);
  for (const duration of [NaN, Infinity, 0, -1])
    assert.equal(editPlannedSlot(p, empty.id, { duration }), false);
  assert.deepEqual(p, before);
  empty.generationRequested = true;
  assert.equal(editPlannedSlot(p, empty.id, { duration: 5 }), false);
  assert.equal(empty.duration, 12);
});

test("Whole group move carries nested generated, pending and planned slots in editorial order", async () => {
  const { moveTimelineGroup, groupSlots } =
    await import("../shared/planned-timeline.mjs");
  const p = fixture();
  p.storyPlans.e.beats.push(
    {
      id: "nested",
      nodeType: "group",
      parentId: "group",
      start: 0,
      duration: 20,
    },
    { id: "outside", nodeType: "clip", start: 30, duration: 5 },
  );
  for (const b of p.storyPlans.e.beats.filter((b) =>
    ["b0", "b1"].includes(b.id),
  ))
    b.parentId = "nested";
  reconcilePlannedTimeline(p);
  const members = groupSlots(p, "group");
  members[0].takes = [{ id: "media", duration: 10 }];
  members[0].activeTake = "media";
  members[1].generationRequested = true;
  p.drafts = members.map((c, i) => ({
    id: "d" + i,
    targetId: c.id,
    episodeId: "e",
    start: c.start,
    settings: { duration: 10 },
    closed: true,
  }));
  p.audioClips = [{ id: "audio", start: 7, duration: 3 }];
  const data = members.map((c) => ({
    id: c.id,
    takes: structuredClone(c.takes),
    activeTake: c.activeTake,
  }));
  const fixed = structuredClone({ remarks: p.remarks, audio: p.audioClips });
  assert.equal(moveTimelineGroup(p, "group", 100), true);
  assert.deepEqual(
    groupSlots(p, "group").map((c) => c.id),
    members.map((c) => c.id),
  );
  assert.deepEqual(
    p.drafts.map((d) => d.start),
    [5, 15, 25],
  );
  assert.equal(p.storyPlans.e.beats.find((n) => n.id === "nested").start, 5);
  assert.equal(editedStoryTiming(p).get("group").end, 35);
  assert.deepEqual(
    groupSlots(p, "group").map((c) => ({
      id: c.id,
      takes: c.takes,
      activeTake: c.activeTake,
    })),
    data,
  );
  assert.deepEqual({ remarks: p.remarks, audio: p.audioClips }, fixed);
  assert.equal(reconcilePlannedTimeline(p), false);
  assert.equal(moveTimelineGroup(p, "group", 100), false);
  assert.equal(moveTimelineGroup(p, "b0", 0), false);
  assert.equal(moveTimelineGroup(p, "group", 0), true);
  assert.deepEqual(
    p.drafts.map((d) => d.start),
    [0, 10, 20],
  );
});

test("Group move gathers separated descendants without including unrelated clips", async () => {
  const { moveTimelineGroup, groupSlots } =
    await import("../shared/planned-timeline.mjs");
  const p = fixture();
  p.storyPlans.e.beats.push({
    id: "outside",
    nodeType: "clip",
    start: 30,
    duration: 5,
  });
  reconcilePlannedTimeline(p);
  const outside = p.clips.find((c) => c.storyBeatId === "outside");
  reorderStorySlot(p, outside.id, 10);
  const members = groupSlots(p, "group").map((c) => c.id);
  moveTimelineGroup(p, "group", 100);
  assert.equal(outside.start, 0);
  assert.deepEqual(
    [...p.clips]
      .sort((a, b) => a.start - b.start)
      .slice(1)
      .map((c) => c.id),
    members,
  );
});

test("Cut insertion creates stable clips/groups at the cut and chooses the shared parent", async () => {
  const { insertPlannedNode } = await import("../shared/planned-timeline.mjs");
  const p = fixture();
  reconcilePlannedTimeline(p);
  p.drafts = [
    {
      id: "last",
      storyBeatId: "b2",
      episodeId: "e",
      start: 20,
      settings: { duration: 10 },
    },
  ];
  const newClip = insertPlannedNode(p, "clip", 10);
  assert.equal(newClip.parentId, "group");
  assert.equal(newClip.start, 10);
  assert.equal(p.clips.find((c) => c.storyBeatId === "b1").start, 20);
  assert.equal(p.drafts[0].start, 30);
  assert.equal(reconcilePlannedTimeline(p), false);
  const newGroup = insertPlannedNode(p, "group", 20);
  assert.equal(newGroup.parentId, "group");
  assert.equal(newGroup.start, 20);
  assert.equal(
    p.clips.find((c) => c.structureNodeId === newGroup.id).duration,
    30,
  );
  assert.equal(p.drafts[0].start, 60);
  assert.equal(reconcilePlannedTimeline(JSON.parse(JSON.stringify(p))), false);
  p.storyPlans.e.beats.push({
    id: "other",
    nodeType: "group",
    start: 70,
    duration: 10,
  });
  reconcilePlannedTimeline(p);
  const between = insertPlannedNode(p, "group", 70);
  assert.equal(between.parentId, "");
  assert.equal(between.start, 70);
  assert.deepEqual(p.remarks, [{ id: "fixed", start: 5, end: 10 }]);
});

test("Cut insertion works in an empty project and beside unstructured imported media", async () => {
  const { insertPlannedNode } = await import("../shared/planned-timeline.mjs");
  const p = { name: "Test", episodeId: "e", clips: [], drafts: [] };
  const node = insertPlannedNode(p, "group", 0);
  assert.equal(node.start, 0);
  assert.equal(node.parentId, "");
  assert.equal(p.clips.length, 1);
  p.clips.push({
    id: "imported",
    start: 30,
    duration: 5,
    takes: [{ id: "media" }],
    activeTake: "media",
  });
  const clip = insertPlannedNode(p, "clip", 30);
  assert.equal(clip.parentId, "");
  assert.equal(p.clips.find((c) => c.id === "imported").start, 40);
  const before = structuredClone(p);
  assert.equal(insertPlannedNode(p, "bogus", 0), null);
  assert.deepEqual(p, before);
});
