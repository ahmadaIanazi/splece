import test from "node:test";
import assert from "node:assert/strict";
import { requestStory } from "../server/authoring.mjs";
import { newProject } from "../server/domain.mjs";
import {
  validateStory,
  applyStory,
  storySignature,
  beatDraft,
} from "../shared/authoring.mjs";
const fixture = () => {
  const p = newProject("Production");
  p.assets = [
    { id: "hero", kind: "character", name: "Hero", description: "Engineer" },
  ];
  const b = {
    id: "s",
    kind: "scene",
    parentId: "",
    title: "Arrival",
    act: "Act 1",
    start: 0,
    duration: 30,
    end: 30,
    description: "An engineer enters the empty city.",
    characterIds: ["hero"],
    locationId: "",
    dialogue: [],
    generationMode: "compact",
    generationDuration: 20,
  };
  const plan = {
    title: "Film",
    brief: "Survival",
    synopsis: "Find shelter",
    setup: {
      language: "Arabic",
      region: "Riyadh",
      accent: "Najdi",
      dialogueStyle: "dialogue-led",
      castIds: ["hero"],
    },
    beats: [b],
  };
  p.storyPlans = { [p.episodeId]: plan };
  return { p, plan, b };
};
const demo = (p, plan, action, expandId) =>
  requestStory(
    { plan, assets: p.assets, episodeId: p.episodeId, action, expandId },
    { mode: "demo" },
    null,
    () => {
      throw Error("Paid call forbidden");
    },
  );
test("Compact scene makes one preset-duration generation with dialogue and preserved scene", async () => {
  const { p, plan, b } = fixture();
  const r = await demo(p, plan, "children", "s");
  const children = r.proposal.beats.filter((x) => x.parentId === "s");
  assert.equal(children.length, 1);
  assert.equal(children[0].duration, 20);
  assert.equal(children[0].kind, "generation");
  assert.ok(children[0].dialogue[0].text.includes("ما"));
  assert.equal(
    r.proposal.beats.find((x) => x.id === "s").description,
    b.description,
  );
});
test("Multi-generation estimates are preset lengths and sequential", async () => {
  const { p, plan, b } = fixture();
  b.generationMode = "multiple";
  b.duration = 13;
  b.end = 13;
  const r = await demo(p, plan, "children", "s");
  const cuts = r.proposal.beats.filter((x) => x.parentId === "s");
  assert.equal(cuts.length, 2);
  assert.ok(cuts.every((b) => [5, 10, 15, 20, 25, 30].includes(b.duration)));
  assert.equal(cuts[1].start, cuts[0].end);
});
test("Generation refinement preserves identity, timing, exact dialogue and surrounding scenes", async () => {
  const { p, plan, b } = fixture();
  b.kind = "generation";
  b.duration = 10;
  b.end = 10;
  b.dialogue = [
    { speaker: "hero", text: "Stay here.", delivery: "Softly", direction: "" },
  ];
  plan.beats.push({ ...b, id: "next", start: 10, end: 20 });
  const r = await demo(p, plan, "enhance", "s");
  const chosen = r.proposal.beats.find((x) => x.id === "s");
  assert.notEqual(chosen.description, b.description);
  assert.equal(chosen.duration, 10);
  assert.equal(chosen.dialogue[0].text, "Stay here.");
  assert.equal(
    r.proposal.beats.find((x) => x.id === "next").description,
    b.description,
  );
});
test("Suggested locations and props apply to library and survive story JSON references", async () => {
  const { p, plan } = fixture();
  const r = await demo(p, plan, "assets");
  assert.deepEqual(
    r.proposal.assets.map((a) => a.kind),
    ["location", "prop"],
  );
  applyStory(p, r.proposal, storySignature(p));
  assert.equal(p.assets.length, 3);
  const next = {
    ...plan,
    characters: [],
    assets: [],
    beats: [
      {
        ...plan.beats[0],
        assetIds: [p.assets[2].id],
        locationId: p.assets[1].id,
      },
    ],
  };
  const validated = validateStory(next, p);
  assert.deepEqual(validated.beats[0].assetIds, [p.assets[2].id]);
  assert.throws(
    () =>
      validateStory(
        { ...next, beats: [{ ...next.beats[0], assetIds: ["unknown"] }] },
        p,
      ),
    /unknown/,
  );
});
test("Only generations hand off; full asset references and dialogue language travel to composer", () => {
  const { p, b } = fixture();
  assert.throws(() => beatDraft(p, b, p.drafts[0]), /generation/);
  p.assets.push({
    id: "prop",
    kind: "prop",
    name: "Radio",
    description: "Old radio",
  });
  const d = beatDraft(
    p,
    { ...b, kind: "generation", assetIds: ["prop"] },
    p.drafts[0],
  );
  assert.ok(d.referenceIds.includes("prop"));
  assert.match(d.notes, /Arabic/);
  assert.match(d.notes, /Najdi/);
});
test("Live request includes production contract and supplied neighboring story context without actual inference", async () => {
  const { p, plan, b } = fixture();
  b.kind = "generation";
  let request;
  await requestStory(
    {
      plan,
      assets: p.assets,
      episodeId: p.episodeId,
      action: "enhance",
      expandId: "s",
      context: {
        previous: [{ description: "Previous beat" }],
        next: [{ description: "Next beat" }],
      },
    },
    { mode: "deepseek", model: "mock" },
    "mock",
    async (_url, options) => {
      request = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  ...plan,
                  characters: [],
                  assets: [],
                }),
              },
            },
          ],
        }),
      };
    },
  );
  assert.match(
    request.messages.map((m) => m.content).join("\n"),
    /Previous beat/,
  );
  assert.match(
    request.messages.map((m) => m.content).join("\n"),
    /dialogue in most scenes/,
  );
});
