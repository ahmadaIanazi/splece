import test from "node:test";
import assert from "node:assert/strict";
import { upgradeProject } from "../shared/studio.mjs";
import { newProject } from "../server/domain.mjs";
import { storyTree, validateHierarchy } from "../shared/story-tree.mjs";
import {
  normalizeStructurePlan,
  createStructureNode,
  structureLabel,
  structurePath,
  isStructureClip,
  groupTemplates,
} from "../shared/structure.mjs";
import { validateStory, beatDraft } from "../shared/authoring.mjs";
import {
  editedStoryTiming,
  draftTimelinePosition,
  storyTimelineLabels,
} from "../shared/timeline-navigation.mjs";
import { openClipPrompt } from "../shared/clip-prompt.mjs";

test("Structure has arbitrary group nesting, rejects cycles, missing parents, duplicate IDs and clip parents", () => {
  const nodes = Array.from({ length: 1500 }, (_, i) => ({
    id: "g" + i,
    nodeType: "group",
    parentId: i ? "g" + (i - 1) : "",
    start: 0,
    duration: 10,
  }));
  nodes.push({
    id: "c",
    nodeType: "clip",
    parentId: "g1499",
    start: 0,
    duration: 5,
  });
  assert.doesNotThrow(() => validateHierarchy(nodes));
  assert.equal(storyTree(nodes).length, 1501);
  assert.equal(structurePath(nodes, "c").length, 1501);
  const timing = editedStoryTiming({
    episodeId: "e",
    drafts: [],
    storyPlans: { e: { beats: nodes } },
    clips: [{ id: "slot", storyBeatId: "c", start: 2, duration: 3, takes: [] }],
  });
  assert.equal(timing.get("g0").end, 5);
  assert.throws(
    () =>
      validateHierarchy([
        { id: "a", nodeType: "group", parentId: "b" },
        { id: "b", nodeType: "group", parentId: "a" },
      ]),
    /ancestor/,
  );
  assert.throws(
    () =>
      validateHierarchy([
        { id: "a", nodeType: "clip" },
        { id: "b", nodeType: "group", parentId: "a" },
      ]),
    /Clips cannot/,
  );
  assert.throws(
    () =>
      validateHierarchy([{ id: "a", nodeType: "group", parentId: "absent" }]),
    /missing/,
  );
  assert.throws(
    () =>
      validateHierarchy([
        { id: "a", nodeType: "group" },
        { id: "a", nodeType: "clip" },
      ]),
    /unique/,
  );
});
test("Migration preserves IDs, authored timings, take histories and production extension data", () => {
  const p = newProject("Legacy");
  p.episodeId = "episode";
  p.storyPlans = {
    [p.episodeId]: {
      beats: [
        { id: "act", kind: "act", start: 0, duration: 30 },
        { id: "scene", kind: "scene", parentId: "act", start: 0, duration: 30 },
        {
          id: "shot",
          kind: "generation",
          parentId: "scene",
          start: 0,
          duration: 10,
        },
      ],
    },
  };
  p.clips = [
    {
      id: "slot",
      storyBeatId: "shot",
      start: 0,
      duration: 7,
      in: 2,
      activeTake: "take",
      takes: [{ id: "take", jobId: "old-job" }],
    },
  ];
  const old = structuredClone(p.clips);
  upgradeProject(p);
  assert.deepEqual(p.clips, old);
  assert.equal(p.storyPlans[p.episodeId].beats[0].nodeType, "group");
  assert.equal(p.storyPlans[p.episodeId].beats[2].nodeType, "clip");
  p.production.transitions.push({ id: "future", fromPlacementId: "slot" });
  const once = structuredClone(p);
  upgradeProject(p);
  assert.deepEqual(p, once);
});
test("Templates only change group labels; deep levels remain groups and clips keep identity", () => {
  const plan = { beats: [], groupLabels: groupTemplates.Film };
  let parent = "";
  for (let i = 0; i < 6; i++) {
    const n = createStructureNode(plan, "group", parent);
    plan.beats.push(n);
    parent = n.id;
  }
  const clip = createStructureNode(plan, "clip", parent);
  plan.beats.push(clip);
  const ids = plan.beats.map((n) => [n.id, n.parentId, n.nodeType]);
  assert.equal(structureLabel(plan, plan.beats[0]), "Act");
  assert.equal(structureLabel(plan, plan.beats[4]), "Group");
  assert.equal(structureLabel(plan, clip), "Clip");
  plan.groupLabels = groupTemplates["Music video"];
  assert.equal(structureLabel(plan, plan.beats[0]), "Song section");
  assert.deepEqual(
    plan.beats.map((n) => [n.id, n.parentId, n.nodeType]),
    ids,
  );
  assert.ok(isStructureClip(clip));
});
test("Canonical JSON survives round trip, group references navigate edited timing and closed clip drafts reopen", () => {
  const p = upgradeProject(newProject("Fixture")),
    plan = {
      title: "Fixture",
      brief: "Brief",
      synopsis: "",
      groupLabels: ["Part"],
      beats: [],
    };
  const group = createStructureNode(plan);
  plan.beats.push(group);
  const nested = createStructureNode(plan, "group", group.id);
  plan.beats.push(nested);
  const clip = createStructureNode(plan, "clip", nested.id);
  clip.description = "A boat crosses the pond.";
  plan.beats.push(clip);
  const imported = validateStory({ ...plan, characters: [] }, p);
  assert.equal(imported.beats[2].nodeType, "clip");
  assert.deepEqual(imported.groupLabels, ["Part"]);
  p.storyPlans = { [p.episodeId]: normalizeStructurePlan(imported) };
  const draft = beatDraft(p, clip, p.drafts[0]);
  draft.closed = true;
  p.drafts.push(draft);
  p.clips = [
    {
      id: "slot",
      storyBeatId: clip.id,
      sourceDraftId: draft.id,
      start: 0,
      duration: 3,
      in: 1,
      activeTake: "take",
      takes: [{ id: "take", duration: 10, jobId: "job" }],
    },
  ];
  assert.equal(editedStoryTiming(p).get(group.id).end, 3);
  assert.equal(draftTimelinePosition(p, draft).seek, 0);
  openClipPrompt(p, "slot", [
    { id: "job", snapshot: { draft: structuredClone(draft) } },
  ]);
  assert.equal(p.drafts.find((d) => d.id === draft.id).closed, false);
  const labels = storyTimelineLabels(p, 150);
  assert.ok(labels.labels.some((n) => n.id === clip.id));
  assert.throws(() => beatDraft(p, group, p.drafts[0]), /generation/);
});

test("AI can develop nested groups or clips independently of template labels and compact preferences", async () => {
  const { requestStory } = await import("../server/authoring.mjs");
  const p = upgradeProject(newProject("Universal AI"));
  const plan = {
    title: "Tutorial",
    brief: "Explain a quiet harbour",
    synopsis: "",
    groupLabels: ["Stage", "Step"],
    beats: [],
  };
  const parent = createStructureNode(plan);
  parent.childNodeType = "group";
  parent.generationMode = "compact";
  parent.generationDuration = 10;
  plan.beats.push(parent);
  const request = () =>
    requestStory(
      {
        plan,
        assets: [],
        episodeId: p.episodeId,
        action: "children",
        expandId: parent.id,
      },
      { mode: "demo" },
      null,
      () => {
        throw Error("Test must never call a provider");
      },
    );
  const groups = (await request()).proposal;
  assert.equal(groups.beats.filter((n) => n.parentId === parent.id).length, 2);
  assert.ok(
    groups.beats
      .filter((n) => n.parentId === parent.id)
      .every((n) => n.nodeType === "group"),
  );
  assert.deepEqual(groups.groupLabels, ["Stage", "Step"]);
  parent.childNodeType = "clip";
  const clips = (await request()).proposal.beats.filter(
    (n) => n.parentId === parent.id,
  );
  assert.equal(clips.length, 1);
  assert.equal(clips[0].nodeType, "clip");
  assert.equal(clips[0].duration, 10);
});
