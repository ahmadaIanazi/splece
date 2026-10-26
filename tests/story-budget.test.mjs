import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateStoryTime,
  resizeStorySection,
  validateHierarchy,
  formatStoryTime,
} from "../shared/story-tree.mjs";
import { newProject, compilePrompt } from "../server/domain.mjs";
import { storySignature, validateStory } from "../shared/authoring.mjs";
import { smartSignature } from "../shared/smart.mjs";
import { requestStory } from "../server/authoring.mjs";
const fixture = () => ({
  setup: { targetDuration: 300 },
  beats: [
    { id: "a", kind: "chapter", start: 0, duration: 60 },
    { id: "b", kind: "chapter", start: 60, duration: 120 },
    { id: "s", kind: "scene", parentId: "b", start: 90, duration: 30 },
    { id: "g", kind: "generation", parentId: "s", start: 95, duration: 10 },
  ],
});
test("Fit large groups to target while preserving local proportions at every depth", () => {
  const p = fixture();
  allocateStoryTime(p);
  assert.equal(p.beats[0].duration, 100);
  assert.equal(p.beats[1].start, 100);
  assert.equal(p.beats[1].end, 300);
  assert.equal(p.beats[2].start, 150);
  assert.equal(p.beats[2].duration, 50);
  assert.ok(Math.abs(p.beats[3].start - (150 + 50 / 6)) < 1e-8);
  validateHierarchy(p.beats);
});
test("Chapter duration ripples siblings and their descendants; advisory target does not block edits", () => {
  const p = fixture();
  resizeStorySection(p, "a", 120);
  assert.equal(p.beats[1].start, 120);
  assert.equal(p.beats[2].start, 150);
  resizeStorySection(p, "a", 250);
  assert.ok(Math.abs(p.beats[0].duration - 250) < 1e-8);
  assert.equal(p.beats[1].start, 250);
});
test("Children divide the chapter range, not zero-based movie time", () => {
  const p = fixture();
  p.beats.push({
    id: "s2",
    kind: "scene",
    parentId: "b",
    start: 120,
    duration: 10,
  });
  allocateStoryTime(p, "b", true);
  assert.equal(p.beats.find((b) => b.id === "s").start, 60);
  assert.equal(p.beats.find((b) => b.id === "s2").start, 120);
  assert.equal(p.beats.find((b) => b.id === "s2").end, 180);
  validateHierarchy(p.beats);
  assert.equal(formatStoryTime(150), "2:30");
});
test("Legacy act and chapter labels do not constrain group nesting", () => {
  assert.doesNotThrow(() =>
    validateHierarchy([
      { id: "a", kind: "act", start: 0, duration: 300 },
      { id: "c", parentId: "a", kind: "chapter", start: 0, duration: 100 },
    ]),
  );
  assert.doesNotThrow(() =>
    validateHierarchy([
      { id: "c", kind: "chapter", start: 0, duration: 300 },
      { id: "a", parentId: "c", kind: "act", start: 0, duration: 100 },
    ]),
  );
});
test("Favorites do not invalidate creative proposals or change submitted prompts", () => {
  const p = newProject("Favorites"),
    d = p.drafts[0];
  p.assets = [
    { id: "hero", kind: "character", name: "Mira", description: "Traveler" },
  ];
  d.referenceIds = ["hero"];
  const smart = smartSignature(p, d),
    story = storySignature(p),
    prompt = compilePrompt(p, d).text;
  p.assets[0].favorite = true;
  assert.equal(smartSignature(p, d), smart);
  assert.equal(storySignature(p), story);
  assert.equal(compilePrompt(p, d).text, prompt);
});
test("Story setup preserves minor descriptions and optional act grouping; Test outline uses full minute budget", async () => {
  const p = newProject("Acts"),
    plan = {
      title: "Movie",
      brief: "Homecoming",
      synopsis: "",
      beats: [],
      setup: {
        targetDuration: 300,
        grouping: "act",
        minorCharacters: "An elderly station clerk in navy",
      },
    };
  const proposal = (
    await requestStory(
      { plan, assets: p.assets, episodeId: p.episodeId, action: "outline" },
      { mode: "demo" },
      null,
      () => {
        throw Error("No inference");
      },
    )
  ).proposal;
  assert.equal(proposal.beats[0].kind, "act");
  assert.equal(proposal.beats.at(-1).end, 300);
  assert.equal(proposal.setup.minorCharacters, plan.setup.minorCharacters);
});

test("AI timing is advisory and does not reject creative outlines", async () => {
  const p = newProject("Invalid AI timing");
  const plan = {
    title: "Movie",
    brief: "Homecoming",
    synopsis: "",
    beats: [],
    setup: { targetDuration: 300 },
  };
  const proposal = {
    ...plan,
    characters: [],
    beats: [
      {
        id: "chapter",
        kind: "chapter",
        title: "Opening",
        act: "Act 1",
        start: 0,
        duration: 5,
        description: "A traveler arrives",
        characterIds: [],
        dialogue: [],
      },
    ],
  };
  await assert.doesNotReject(
    requestStory(
      { plan, assets: p.assets, episodeId: p.episodeId, action: "outline" },
      { mode: "deepseek", model: "fake", guide: "" },
      "fake",
      async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(proposal) },
            },
          ],
        }),
      }),
    ),
  );
});

test("Roadmap distinguishes a usable draft from an actual generated video in this episode", async () => {
  const { storyReadiness } = await import("../shared/story-tree.mjs");
  const p = newProject("Roadmap");
  p.assets = [{ id: "hero", kind: "character" }];
  const b = {
    id: "scene",
    description: "A silent arrival",
    characterIds: ["hero"],
    dialogue: [],
  };
  assert.equal(storyReadiness(p, b), "ready");
  assert.equal(storyReadiness(p, { ...b, description: "" }), "draft");
  assert.equal(
    storyReadiness(p, {
      ...b,
      dialogue: [{ speaker: "missing", text: "Hello" }],
    }),
    "draft",
  );
  const job = {
    state: "running",
    snapshot: { draft: { storyBeatId: b.id, episodeId: p.episodeId } },
  };
  assert.equal(storyReadiness(p, b, [job]), "ready");
  job.state = "ready";
  assert.equal(storyReadiness(p, b, [job]), "generated");
  job.snapshot.draft.episodeId = "other";
  assert.equal(storyReadiness(p, b, [job]), "ready");
});

test("Live character output joins the main cast even when AI omits setup", async () => {
  const p = newProject("Cast");
  const plan = {
    title: "Movie",
    brief: "Arrival",
    synopsis: "",
    beats: [],
    setup: { format: "Movie", targetDuration: 1800, castCount: 1, castIds: [] },
  };
  const result = await requestStory(
    { plan, assets: p.assets, episodeId: p.episodeId, action: "characters" },
    { mode: "deepseek", model: "fake", guide: "" },
    "fake",
    async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                title: "Movie",
                brief: "Arrival",
                synopsis: "",
                beats: [],
                characters: [
                  { id: "newhero", name: "Hero", description: "Engineer" },
                ],
              }),
            },
          },
        ],
      }),
    }),
  );
  assert.deepEqual(result.proposal.setup.castIds, ["newhero"]);
  assert.equal(result.proposal.setup.targetDuration, 1800);
});

test("Live story echoes reuse existing cast without overwriting descriptions", async () => {
  const p = newProject("Reuse");
  p.assets = [
    {
      id: "hero",
      kind: "character",
      name: "Hero",
      description: "Saved identity",
    },
  ];
  const plan = {
    title: "Story",
    brief: "Arrival",
    synopsis: "",
    beats: [],
    setup: { targetDuration: 1800, castIds: ["hero"] },
  };
  let saved;
  const result = await requestStory(
    { plan, assets: p.assets, episodeId: p.episodeId, action: "outline" },
    { mode: "deepseek", model: "fake", guide: "" },
    "fake",
    async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                ...plan,
                characters: [
                  { id: "hero", name: "Hero", description: "Changed identity" },
                ],
              }),
            },
          },
        ],
      }),
    }),
    (v) => {
      saved = v;
    },
  );
  assert.deepEqual(result.proposal.characters, []);
  assert.equal(p.assets[0].description, "Saved identity");
  assert.match(result.warnings[0], /Reused existing/);
  assert.equal(saved.proposal.setup.targetDuration, 1800);
});

test("A paid story proposal is retained for review before validation failure", async () => {
  const p = newProject("Recover");
  const plan = { title: "Story", brief: "Arrival", synopsis: "", beats: [] };
  let saved;
  await assert.rejects(
    requestStory(
      { plan, assets: p.assets, episodeId: p.episodeId },
      { mode: "deepseek", model: "fake", guide: "" },
      "fake",
      async () => ({
        ok: true,
        json: async () => ({
          usage: { total_tokens: 5 },
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  ...plan,
                  characters: [],
                  beats: [{ id: "invalid", duration: -5 }],
                }),
              },
            },
          ],
        }),
      }),
      (v) => {
        saved = v;
      },
    ),
  );
  assert.equal(saved.proposal.beats[0].id, "invalid");
  assert.equal(saved.usage.total_tokens, 5);
});

test("Scoped child responses restore omitted parents and assign the requested child level", async () => {
  const p = newProject("Scoped");
  const plan = {
    title: "Story",
    brief: "Arrival",
    synopsis: "",
    beats: [
      {
        id: "ch",
        kind: "chapter",
        parentId: "",
        act: "Act 1",
        title: "Opening",
        start: 0,
        duration: 300,
        end: 300,
        description: "Wake up",
        characterIds: [],
        locationId: "",
        dialogue: [],
      },
    ],
  };
  const output = {
    ...plan,
    characters: [],
    beats: [
      {
        id: "new",
        kind: "generation",
        parentId: "ch",
        act: "Act 1",
        title: "Wake",
        start: 0,
        duration: 5,
        description: "Eyes open",
        characterIds: [],
        dialogue: [],
      },
    ],
  };
  const result = await requestStory(
    {
      plan,
      assets: p.assets,
      episodeId: p.episodeId,
      action: "children",
      expandId: "ch",
    },
    { mode: "deepseek", model: "fake", guide: "" },
    "fake",
    async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(output) },
          },
        ],
      }),
    }),
  );
  assert.equal(result.proposal.beats.find((b) => b.id === "new").kind, "scene");
  assert.equal(
    result.proposal.beats.find((b) => b.id === "ch").description,
    "Wake up",
  );
  assert.equal(result.proposal.beats.length, 2);
});
