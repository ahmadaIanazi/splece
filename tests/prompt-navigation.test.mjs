import test from "node:test";
import assert from "node:assert/strict";
import {
  promptGroups,
  promptPath,
  chooseGroupDraft,
} from "../shared/prompt-navigation.mjs";
import { reserveGenerationSlot } from "../shared/generation-slots.mjs";
test("Navigation groups closed variations under a story generation and scopes to the episode", () => {
  const p = {
    episodeId: "e",
    drafts: [
      { id: "a", episodeId: "e", storyBeatId: "g", closed: true },
      { id: "b", episodeId: "e", storyBeatId: "g" },
      { id: "other", episodeId: "x", storyBeatId: "g" },
    ],
    storyPlans: {
      e: {
        beats: [
          { id: "act", title: "Act" },
          { id: "scene", parentId: "act", title: "Scene" },
          { id: "g", parentId: "scene", title: "Generation" },
        ],
      },
    },
  };
  const groups = promptGroups(p);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].drafts.length, 2);
  assert.equal(chooseGroupDraft(groups[0], "a").id, "a");
  assert.equal(chooseGroupDraft(groups[0]).id, "b");
  assert.deepEqual(
    promptPath(p, p.drafts[0]).map((b) => b.title),
    ["Act", "Scene", "Generation"],
  );
});
test("Free prompt variations created before generation retain one group and one timeline slot", () => {
  const d = {
    id: "a",
    promptGroupId: "draft:a",
    episodeId: "e",
    start: 0,
    settings: { duration: 5 },
    scenes: [{ text: "Forest" }],
  };
  const p = {
    episodeId: "e",
    drafts: [d, { ...structuredClone(d), id: "b" }],
    clips: [],
    remarks: [],
    audioClips: [],
  };
  const first = reserveGenerationSlot(p, "a", [], () => "slot");
  const second = reserveGenerationSlot(p, "b", [], () => "other");
  assert.equal(first.id, second.id);
  assert.equal(p.clips.length, 1);
  assert.equal(promptGroups(p).length, 1);
});
