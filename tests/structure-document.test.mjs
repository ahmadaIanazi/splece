import test from "node:test";
import assert from "node:assert/strict";
import {
  moveStructureItem,
  attachStructureReference,
  structureReferences,
} from "../shared/structure-document.mjs";
import { storyTree } from "../shared/story-tree.mjs";
import { validateStory } from "../shared/authoring.mjs";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
const node = (id, parentId = "", nodeType = "group", start = 0) => ({
  id,
  parentId,
  nodeType,
  kind: nodeType === "clip" ? "generation" : "scene",
  start,
  duration: 10,
  title: id,
  description: "",
  characterIds: [],
  assetIds: [],
  locationId: "",
  dialogue: [],
});
const fixture = () => ({
  beats: [
    node("a"),
    node("child", "a", "clip"),
    node("b", "", "group", 30),
    node("c", "", "clip", 60),
  ],
});
test("Document reordering persists independently of timing, including after JSON validation", () => {
  const plan = fixture();
  moveStructureItem(plan, "b", "a", "before");
  assert.deepEqual(
    storyTree(plan.beats).map((b) => b.id),
    ["b", "a", "child", "c"],
  );
  assert.equal(plan.beats.find((b) => b.id === "b").start, 30);
  assert.equal(plan.beats.find((b) => b.id === "child").parentId, "a");
  const project = upgradeProject(newProject("Structure"));
  const restored = validateStory(
    { ...plan, title: "Structure", characters: [], assets: [] },
    project,
  );
  assert.deepEqual(
    storyTree(restored.beats).map((b) => b.id),
    ["b", "a", "child", "c"],
  );
  moveStructureItem(plan, "b", "c", "after");
  assert.deepEqual(
    storyTree(plan.beats).map((b) => b.id),
    ["a", "child", "c", "b"],
  );
});
test("Nesting and unnesting preserve the entire subtree and reject cycles or clip parents atomically", () => {
  const plan = fixture();
  moveStructureItem(plan, "a", "b", "inside");
  assert.equal(plan.beats.find((b) => b.id === "a").parentId, "b");
  assert.equal(plan.beats.find((b) => b.id === "child").parentId, "a");
  const before = structuredClone(plan);
  assert.throws(() => moveStructureItem(plan, "b", "a", "inside"), /itself/);
  assert.throws(() => moveStructureItem(plan, "a", "c", "inside"), /group/);
  assert.deepEqual(plan, before);
  moveStructureItem(plan, "a", null, "inside");
  assert.equal(plan.beats.find((b) => b.id === "a").parentId, "");
  assert.deepEqual(
    storyTree(plan.beats).map((b) => b.id),
    ["b", "c", "a", "child"],
  );
});
test("Reference drops maintain typed links and are idempotent", () => {
  const n = node("clip", "", "clip");
  const assets = [
    { id: "hero", kind: "character" },
    { id: "room", kind: "location" },
    { id: "book", kind: "prop" },
  ];
  for (const a of [...assets, ...assets]) attachStructureReference(n, a);
  assert.deepEqual(n.characterIds, ["hero"]);
  assert.deepEqual(n.assetIds, ["room", "book"]);
  assert.equal(n.locationId, "room");
  assert.deepEqual(structureReferences(n, assets), assets);
});

test("Ruler duration changes keep gaps, scale nested writing and shift only later siblings", async () => {
  const { adjustStructureTiming } =
    await import("../shared/structure-document.mjs");
  const plan = {
    beats: [
      node("a", "", "group", 10),
      node("child", "a", "clip", 12),
      node("b", "", "group", 30),
    ],
  };
  plan.beats[1].duration = 4;
  adjustStructureTiming(plan, "a", { duration: 20 });
  assert.equal(plan.beats[0].start, 10);
  assert.equal(plan.beats[1].start, 14);
  assert.equal(plan.beats[1].duration, 8);
  assert.equal(plan.beats[2].start, 40);
  adjustStructureTiming(plan, "a", { start: 5 });
  assert.equal(plan.beats[1].start, 9);
  assert.equal(plan.beats[2].start, 40);
  const before = structuredClone(plan);
  assert.throws(
    () => adjustStructureTiming(plan, "a", { duration: -10 }),
    /positive/,
  );
  assert.deepEqual(plan, before);
});
