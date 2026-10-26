import test from "node:test";
import assert from "node:assert/strict";
import { newProject } from "../server/domain.mjs";
import { reconcilePlannedTimeline } from "../shared/planned-timeline.mjs";
import {
  structureStoryboard,
  moveStructureTime,
} from "../shared/structure-context.mjs";
import {
  resizeStructureClip,
  plannedStructureSlot,
  structureDurationTicks,
  structureGroupRuns,
} from "../shared/structure-timeline.mjs";
function fixture() {
  const p = newProject("Nested timing test");
  p.clips = [];
  p.storyPlans = {
    [p.episodeId]: {
      beats: [
        {
          id: "act",
          kind: "act",
          nodeType: "group",
          title: "Act",
          start: 0,
          duration: 50,
        },
        {
          id: "chapter",
          parentId: "act",
          kind: "chapter",
          nodeType: "group",
          title: "Chapter",
          start: 0,
          duration: 50,
        },
        {
          id: "scene",
          parentId: "chapter",
          kind: "scene",
          nodeType: "group",
          title: "Scene",
          start: 0,
          duration: 50,
        },
        ...[20, 30].map((duration, i) => ({
          id: "c" + i,
          parentId: "scene",
          kind: "generation",
          nodeType: "clip",
          title: "Clip " + i,
          start: i * 20,
          duration,
        })),
      ],
    },
  };
  p.drafts = [0, 1].map((i) => ({
    id: "d" + i,
    episodeId: p.episodeId,
    storyBeatId: "c" + i,
    start: i * 20,
    settings: { model: "test", duration: i ? 30 : 20 },
    scenes: [{ text: "Original " + i, dialogue: [{ text: "Keep this line" }] }],
  }));
  p.remarks = [{ id: "fixed", start: 12, end: 15 }];
  reconcilePlannedTimeline(p);
  return p;
}
test("Structure resizing ripples slots, nested spans and editable prompt timing together", () => {
  const p = fixture(),
    original = structuredClone(p.drafts.map((d) => d.scenes));
  assert.equal(
    resizeStructureClip(p, "c0", 25, [
      { id: "test", durations: [5, 10, 15, 20, 25, 30] },
    ]),
    true,
  );
  assert.deepEqual(
    p.clips.map((c) => [c.start, c.duration]),
    [
      [0, 25],
      [25, 30],
    ],
  );
  assert.deepEqual(
    p.drafts.map((d) => [d.start, d.plannedDuration, d.settings.duration]),
    [
      [0, 25, 25],
      [25, 30, 30],
    ],
  );
  for (const id of ["act", "chapter", "scene"])
    assert.equal(
      p.storyPlans[p.episodeId].beats.find((n) => n.id === id).duration,
      55,
    );
  assert.deepEqual(
    p.drafts.map((d) => d.scenes),
    original,
  );
  assert.deepEqual(p.remarks, [{ id: "fixed", start: 12, end: 15 }]);
  resizeStructureClip(p, "c0", 17, [
    { id: "test", durations: [5, 10, 15, 20, 25, 30] },
  ]);
  assert.equal(p.drafts[0].plannedDuration, 17);
  assert.equal(
    p.drafts[0].settings.duration,
    25,
    "unsupported provider timing stays valid",
  );
  assert.equal(p.drafts[1].start, 17);
  moveStructureTime(p, "c1", 0);
  assert.equal(p.drafts[0].start, 30);
  assert.equal(p.drafts[1].start, 0);
});
test("Structure resize preserves generated and in-flight clips and rejects invalid requests", () => {
  for (const status of ["ready", "pending"]) {
    const p = fixture(),
      slot = plannedStructureSlot(p, "c0");
    if (status === "ready") {
      slot.activeTake = "take";
      slot.takes = [
        { id: "take", sourceIn: 3, snapshot: { prompt: "immutable" } },
      ];
    } else slot.generationRequested = true;
    const before = JSON.stringify(p);
    assert.equal(resizeStructureClip(p, "c0", 10), false);
    assert.equal(JSON.stringify(p), before);
  }
  const p = fixture(),
    before = JSON.stringify(p);
  for (const duration of [0, -1, NaN, Infinity, 3601])
    assert.equal(resizeStructureClip(p, "c0", duration), false);
  assert.equal(resizeStructureClip(p, "scene", 10), false);
  assert.equal(JSON.stringify(p), before);
});
test("Ruler subdivisions communicate duration without changing equal card widths", () => {
  assert.deepEqual(
    structureDurationTicks(20, 152)
      .filter((t) => t.major)
      .map((t) => t.time),
    [5, 10, 15],
  );
  assert.deepEqual(
    structureDurationTicks(30, 152)
      .filter((t) => t.major)
      .map((t) => t.time),
    [5, 10, 15, 20, 25],
  );
  assert.ok(
    structureDurationTicks(20, 250).length >
      structureDurationTicks(20, 124).length,
  );
  assert.ok(structureDurationTicks(3600, 152).length <= 60);
  assert.deepEqual(structureDurationTicks(0, 152), []);
});
test("Nested group containers exclude unrelated interleaved clips and respect collapse", () => {
  const p = fixture();
  p.storyPlans[p.episodeId].beats.push({
    id: "outside",
    nodeType: "clip",
    kind: "generation",
    start: 20,
    duration: 5,
  });
  reconcilePlannedTimeline(p);
  moveStructureTime(p, "outside", 20);
  const board = structureStoryboard(p),
    runs = structureGroupRuns(
      p.storyPlans[p.episodeId],
      board.cells,
      board.groups,
    );
  assert.deepEqual(
    runs.filter((r) => r.node.id === "act").map((r) => [r.first, r.last]),
    [
      [0, 0],
      [2, 2],
    ],
  );
  const collapsed = structureStoryboard(p, { act: true });
  assert.ok(collapsed.cells.some((c) => c.id === "act"));
  assert.ok(!collapsed.cells.some((c) => c.id === "c0"));
});

import { moveStructureTimelineItem } from "../shared/structure-timeline.mjs";
test("Moving clips across nested groups updates both parent spans and every prompt timing", () => {
  const p = fixture(),
    plan = p.storyPlans[p.episodeId];
  plan.beats.push({
    id: "second",
    nodeType: "group",
    kind: "scene",
    parentId: "chapter",
    title: "Second scene",
    start: 50,
    duration: 10,
  });
  plan.beats.push({
    id: "c2",
    nodeType: "clip",
    kind: "generation",
    parentId: "second",
    title: "Closing",
    start: 50,
    duration: 10,
  });
  p.drafts.push({
    ...structuredClone(p.drafts[0]),
    id: "d2",
    storyBeatId: "c2",
    start: 50,
  });
  reconcilePlannedTimeline(p);
  moveStructureTimelineItem(p, "c0", "c2", "after");
  assert.equal(plan.beats.find((n) => n.id === "c0").parentId, "second");
  assert.deepEqual(
    p.clips.map((c) => [c.storyBeatId, c.start, c.duration]),
    [
      ["c1", 0, 30],
      ["c2", 30, 10],
      ["c0", 40, 20],
    ],
  );
  assert.deepEqual(
    p.drafts.map((d) => d.start),
    [40, 0, 30],
  );
  assert.equal(plan.beats.find((n) => n.id === "scene").duration, 30);
  assert.equal(plan.beats.find((n) => n.id === "second").duration, 30);
  assert.equal(plan.beats.find((n) => n.id === "chapter").duration, 60);
  assert.equal(reconcilePlannedTimeline(p), false);
});
test("Moving the last child leaves an empty group without inventing timeline time", () => {
  const p = fixture(),
    plan = p.storyPlans[p.episodeId];
  plan.beats.push({
    id: "empty",
    nodeType: "group",
    kind: "scene",
    parentId: "chapter",
    title: "Empty destination",
    start: 50,
    duration: 30,
  });
  reconcilePlannedTimeline(p);
  moveStructureTimelineItem(p, "c0", "empty", "inside");
  moveStructureTimelineItem(p, "c1", "empty", "inside");
  assert.equal(plan.beats.find((n) => n.id === "scene").duration, 0);
  assert.equal(plan.beats.find((n) => n.id === "empty").duration, 50);
  assert.equal(p.clips.length, 2);
  assert.equal(reconcilePlannedTimeline(p), false);
  assert.equal(Math.max(...p.clips.map((c) => c.start + c.duration)), 50);
});
test("Group drops reject cycles atomically and preserve generated takes and audio", () => {
  const p = fixture(),
    before = JSON.stringify(p);
  assert.throws(() => moveStructureTimelineItem(p, "act", "scene", "inside"));
  assert.equal(JSON.stringify(p), before);
  assert.throws(() => moveStructureTimelineItem(p, "c0", "missing", "inside"));
  assert.equal(JSON.stringify(p), before);
  const slot = plannedStructureSlot(p, "c0");
  slot.activeTake = "t";
  slot.takes = [{ id: "t", sourceIn: 2, snapshot: { prompt: "unchanged" } }];
  slot.in = 2;
  const media = structuredClone(slot.takes),
    remarks = structuredClone(p.remarks);
  moveStructureTimelineItem(p, "c0", "c1", "after");
  assert.deepEqual(slot.takes, media);
  assert.equal(slot.in, 2);
  assert.deepEqual(p.remarks, remarks);
  assert.equal(p.drafts[0].start, 30);
});
