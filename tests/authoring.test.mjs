import test from "node:test";
import assert from "node:assert/strict";
import { newProject, compilePrompt, models } from "../server/domain.mjs";
import {
  exportPrompt,
  importPrompt,
  storyPlan,
  storyContext,
  storySignature,
  validateStory,
  applyStory,
  addStoryRemarks,
  beatDraft,
} from "../shared/authoring.mjs";
import { requestStory } from "../server/authoring.mjs";
import { smartSignature, normalizeSmartProposal } from "../shared/smart.mjs";
function fixture() {
  const p = newProject("Story QA"),
    d = p.drafts[0];
  p.assets = [
    {
      id: "hero",
      kind: "character",
      name: "Mira",
      description: "A traveler",
      variants: [{ id: "coat", name: "Coat", description: "Blue winter coat" }],
      history: [],
    },
  ];
  d.referenceIds = ["hero"];
  d.scenes[0].text = "Mira arrives.";
  d.scenes[0].dialogue = [
    { speaker: "hero", text: "I am home.", delivery: "Softly", direction: "" },
  ];
  return { p, d };
}
const beat = () => ({
  id: "opening",
  title: "Arrival",
  act: "Act 1",
  start: 10,
  duration: 10,
  description: "Mira approaches the cabin.",
  characterIds: ["hero"],
  locationId: "",
  camera: "Auto",
  movement: "Auto",
  transition: "Auto",
  dialogue: [
    { speaker: "hero", text: "I am home.", delivery: "Softly", direction: "" },
  ],
});
test("JSON round trip preserves editable inputs and recomputes injections without trusting external snapshots", () => {
  const { p, d } = fixture();
  const envelope = exportPrompt(p, d, compilePrompt(p, d));
  envelope.injections.text = "untrusted replacement";
  const copy = importPrompt(envelope, p, models);
  assert.notEqual(copy.id, d.id);
  assert.deepEqual(copy.scenes[0].dialogue, d.scenes[0].dialogue);
  assert.deepEqual(copy.settings, d.settings);
  assert.equal(compilePrompt(p, copy).text, compilePrompt(p, d).text);
  assert.equal(p.drafts.length, 1);
});
test("JSON rejects unknown IDs, invalid timing, invalid variants, unsupported model settings and remote frame URLs", () => {
  const { p, d } = fixture();
  const value = exportPrompt(p, d, compilePrompt(p, d));
  for (const mutate of [
    (v) => (v.composer.referenceIds = ["invented"]),
    (v) => (v.composer.start = -5),
    (v) => (v.composer.settings.duration = 999),
    (v) => (v.composer.referenceOptions = { hero: { variantId: "invented" } }),
    (v) => (v.composer.scenes[0].dialogue[0].speaker = "invented"),
    (v) =>
      (v.composer.frameOverrides = {
        start: {
          mode: "manual",
          frame: { url: "https://evil.example/image.png" },
        },
      }),
  ]) {
    const v = structuredClone(value);
    mutate(v);
    assert.throws(() => importPrompt(v, p, models));
  }
});
test("Story proposals are reviewed, stale-protected, archived and produce fixed-time linked remarks", () => {
  const { p } = fixture();
  const signature = storySignature(p),
    proposal = {
      title: "Home",
      brief: "A return",
      synopsis: "Coming home",
      characters: [],
      beats: [beat()],
    };
  applyStory(p, proposal, signature);
  assert.equal(storyPlan(p).beats.length, 1);
  assert.equal(storyPlan(p).history.length, 1);
  assert.throws(() => applyStory(p, proposal, signature), /changed/);
  addStoryRemarks(p, ["opening"]);
  addStoryRemarks(p, ["opening"]);
  assert.equal(p.remarks.length, 1);
  assert.equal(p.remarks[0].lane, 0);
  assert.equal(p.remarks[0].start, 10);
  assert.equal(p.remarks[0].end, 20);
  p.clips.push({ id: "c", start: 99, duration: 5 });
  assert.equal(p.remarks[0].start, 10);
});
test("Generation handoff carries dialogue, characters, position and suggested duration", () => {
  const { p, d } = fixture();
  const fresh = beatDraft(p, { ...beat(), kind: "generation" }, d);
  assert.equal(fresh.start, 10);
  assert.equal(fresh.plannedDuration, 10);
  assert.equal(fresh.settings.duration, 10);
  assert.equal(fresh.storyBeatId, "opening");
  assert.equal(fresh.scenes[0].dialogue[0].text, "I am home.");
  assert.deepEqual(fresh.referenceIds, ["hero"]);
  assert.equal(fresh.targetId, null);
});
test("Story and adjacent authored context reach prompts and invalidate older smart decisions", () => {
  const { p, d } = fixture();
  const before = smartSignature(p, d);
  p.storyPlans = {
    [p.episodeId]: {
      title: "Home",
      brief: "Return",
      synopsis: "A winter reunion",
      beats: [beat()],
    },
  };
  assert.notEqual(before, smartSignature(p, d));
  assert.equal(storyContext(p, d).after[0].id, "opening");
  assert.ok(
    compilePrompt(p, d).planningContext.episode.includes("winter reunion"),
  );
  assert.ok(!compilePrompt(p, d).text.includes("winter reunion"));
});
test("Story demo generation and expansion make zero network calls and preserve exact dialogue", async () => {
  const { p } = fixture();
  const input = {
    episodeId: p.episodeId,
    plan: {
      title: "Home",
      brief: "Coming home",
      synopsis: "A return",
      beats: [beat()],
    },
    assets: p.assets,
    expandId: "opening",
  };
  let calls = 0;
  const result = await requestStory(
    input,
    { mode: "demo" },
    "fake",
    async () => {
      calls++;
      throw Error("network");
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.proposal.beats.length, 2);
  assert.equal(result.proposal.beats[1].start, 15);
  assert.equal(result.proposal.beats[0].dialogue[0].text, "I am home.");
  assert.equal(result.usage, null);
});
test("DeepSeek story request uses structured JSON and rejects lost dialogue before applying", async () => {
  const { p } = fixture();
  const input = {
    episodeId: p.episodeId,
    plan: {
      title: "Home",
      brief: "Coming home",
      synopsis: "A return",
      beats: [beat()],
    },
    assets: p.assets,
  };
  let calls = 0;
  await assert.rejects(
    requestStory(
      input,
      { mode: "deepseek", model: "deepseek-flash", guide: "Preserve intent" },
      "fake",
      async (url, options) => {
        calls++;
        assert.equal(url, "https://api.deepseek.com/beta/chat/completions");
        const req = JSON.parse(options.body);
        assert.equal(req.tools[0].function.strict, true);
        assert.equal(req.tool_choice.function.name, "submit_story_changes");
        assert.ok(
          req.messages
            .find((m) => m.role === "user")
            .content.includes("I am home."),
        );
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  ...input.plan,
                  beats: [{ ...beat(), dialogue: [] }],
                }),
              },
            },
          ],
        });
      },
    ),
    /dialogue/,
  );
  assert.equal(calls, 1);
});
test("Story schema rejects duplicate characters and unknown speakers", () => {
  const { p } = fixture();
  assert.throws(
    () =>
      validateStory(
        {
          title: "Home",
          beats: [beat()],
          characters: [
            { id: "hero", name: "Replacement", description: "overwrite" },
          ],
        },
        p,
      ),
    /unique/,
  );
  assert.throws(
    () =>
      validateStory(
        {
          title: "Home",
          beats: [
            { ...beat(), dialogue: [{ speaker: "unknown", text: "Hello" }] },
          ],
        },
        p,
      ),
    /unknown/,
  );
});

test("Smart reference selection preserves existing numbered roles even if AI decisions are reordered", () => {
  const { p, d } = fixture();
  const a = p.assets[0];
  a.media = { id: "image-a" };
  p.assets.push({
    id: "place",
    kind: "location",
    name: "Cabin",
    description: "Snowy cabin",
    media: { id: "image-b" },
  });
  d.referenceIds = ["hero", "place"];
  const model = { ...models[0], referenceMode: "flat", maxReferences: 7 };
  const compiled = compilePrompt(p, d, model);
  const result = normalizeSmartProposal(
    {
      prompt: compiled.text,
      decisions: [
        {
          assetId: "place",
          variantId: null,
          details: "Cabin",
          reason: "Scene setting",
        },
        {
          assetId: "hero",
          variantId: null,
          details: "Traveler",
          reason: "Scene actor",
        },
      ],
    },
    {
      draft: d,
      compiled,
      library: p.assets,
      videoCapabilities: model,
      limit: 10000,
    },
  );
  assert.deepEqual(
    result.decisions.map((d) => d.assetId),
    ["hero", "place"],
  );
  assert.ok(result.prompt.startsWith("@Image1 controls Mira only"));
  assert.ok(result.prompt.includes("@Image2 controls Cabin only"));
});
test("JSON preserves audio settings and includes native model choices", () => {
  const { p, d } = fixture();
  const model = { ...models[0], audioConfigurable: true };
  d.settings.audio = true;
  const doc = exportPrompt(p, d, compilePrompt(p, d, model), [model]);
  assert.equal(doc.supportedModels[0].audioConfigurable, true);
  assert.equal(importPrompt(doc, p, [model]).settings.audio, true);
  assert.throws(() => importPrompt(doc, p, models), /audio/);
});
