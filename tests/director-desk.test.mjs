import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDesk,
  deskSetupPatch,
  deskPrompt,
  shotPlan,
  extractExplicitFacts,
  validateSetupFacts,
  mergeSetupFacts,
  setupAssistantContext,
  deskRecipe,
  deskNudges,
  pinWeight,
} from "../shared/director-desk.mjs";
import {
  validateStorySetup,
  storyPromptContext,
} from "../shared/authoring.mjs";
import { assistantFingerprint } from "../shared/composer-assistant.mjs";
import {
  createComposerAssistant,
  decisionRequest,
} from "../server/composer-assistant.mjs";
import { openStore } from "../server/store.mjs";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
const idea =
  "A kindergarten teacher in a hijab and abaya teaches Arabic kids in Saudi Arabia. She says “Hello, blue bird!”";
function project() {
  const p = upgradeProject(newProject("Desk test"));
  p.storyPlans = {
    [p.episodeId]: {
      title: "Desk",
      brief: idea,
      synopsis: "",
      beats: [],
      setup: {
        concept: idea,
        targetDuration: 600,
        directorDesk: normalizeDesk({ format: "kids" }),
      },
    },
  };
  return p;
}

test("idea extraction validates evidence and keeps manual choices and original writing", () => {
  const p = project(),
    context = setupAssistantContext(p),
    raw = extractExplicitFacts(idea);
  const initial = normalizeDesk({
    facts: { region: "Riyadh", accent: "Najdi" },
    manualFacts: ["region", "accent"],
  });
  const result = validateSetupFacts(
    {
      facts: [
        ...raw.facts,
        { field: "accent", value: "Gulf", evidence: "not in idea" },
        { field: "character", value: "Someone else", evidence: "teacher" },
      ],
    },
    context,
  );
  const next = mergeSetupFacts(initial, result);
  assert.equal(next.facts.region, "Riyadh");
  assert.equal(next.facts.accent, "Najdi");
  assert.equal(next.facts.character, "kindergarten teacher");
  assert.equal(next.facts.wardrobe, "hijab and abaya");
  assert.equal(next.facts.language, "Arabic");
  assert.equal(p.storyPlans[p.episodeId].setup.concept, idea);
  const cleared = mergeSetupFacts(next, { facts: [] });
  assert.equal(cleared.facts.character, "");
  assert.equal(cleared.facts.region, "Riyadh");
});
test("applying extracted facts does not change request identity or trigger a request loop", () => {
  const p = project(),
    before = assistantFingerprint(setupAssistantContext(p));
  const s = p.storyPlans[p.episodeId].setup;
  Object.assign(
    s,
    deskSetupPatch(
      mergeSetupFacts(s.directorDesk, extractExplicitFacts(idea)),
      s,
    ),
  );
  assert.equal(assistantFingerprint(setupAssistantContext(p)), before);
  s.concept += " A red kite appears.";
  assert.notEqual(assistantFingerprint(setupAssistantContext(p)), before);
});
test("long lengths remain honest multi-shot plans and selected model limits guide exports", () => {
  assert.deepEqual(shotPlan(600), {
    duration: 600,
    perShot: 10,
    count: 60,
    multiple: true,
    estimated: true,
  });
  assert.equal(shotPlan(30, { durations: [4, 8] }).count, 4);
  assert.equal(shotPlan(5).multiple, false);
  assert.equal(shotPlan(30, { durations: [15, 20] }).perShot, 15);
});
test("desk survives validation and contributes to final clip context without rewriting dialogue", () => {
  const p = project(),
    s = p.storyPlans[p.episodeId].setup;
  const d = mergeSetupFacts(
    normalizeDesk({
      format: "kids",
      light: "rim",
      path: [
        { x: 10, y: 50 },
        { x: 50, y: 80 },
      ],
      pins: [{ id: "reference", x: 50, y: 50 }],
    }),
    extractExplicitFacts(idea),
  );
  const setup = validateStorySetup({ ...s, ...deskSetupPatch(d, s) }, [
    { id: "reference", kind: "style", name: "Pastel palette" },
  ]);
  assert.equal(setup.directorDesk.light, "rim");
  assert.equal(setup.directorDesk.pins.length, 1);
  assert.equal(setup.concept, idea);
  p.storyPlans[p.episodeId].setup = setup;
  assert.match(
    deskPrompt(setup, [
      { id: "reference", kind: "style", name: "Pastel palette" },
    ]),
    /relative creative influence 100%/,
  );
  assert.match(storyPromptContext(p, p.drafts[0]), /Light: rim/);
  assert.match(
    storyPromptContext(p, p.drafts[0]),
    /Preserve any authored dialogue exactly/,
  );
});
test("recipes omit private media and writing, normalize unsafe values, and nudges are actionable", () => {
  const d = normalizeDesk({
    format: "kids",
    light: "silhouette",
    sun: 999,
    realism: -10,
    pins: [{ id: "private", x: 50, y: 50 }],
    facts: { character: "Private person" },
  });
  assert.equal(d.sun, 100);
  assert.equal(d.realism, 0);
  assert.equal(deskNudges(d)[0].patch.light, "rim");
  const recipe = deskRecipe({ concept: "Private story", directorDesk: d });
  assert.doesNotMatch(JSON.stringify(recipe), /Private|private/);
  assert.deepEqual(recipe.directorDesk.pins, []);
  assert.equal(normalizeDesk(d, {}, []).pins.length, 0);
  assert.equal(pinWeight({ x: 50, y: 50 }), 100);
});
test("Test-mode extraction uses no provider calls, dedupes, and does not modify the project", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.db.close());
  const p = project();
  store.save(p, 0);
  let calls = 0;
  const service = createComposerAssistant({
    store,
    data: "/unused",
    models: async () => [],
    mode: async () => "test",
    transport: async () => {
      calls++;
      throw Error("No credits");
    },
  });
  service.configure({ enabled: true, writingSuggestions: true });
  const context = setupAssistantContext(p),
    input = {
      projectId: p.id,
      workspace: "setup",
      fingerprint: assistantFingerprint(context),
      sessionId: "desk-test",
    };
  const result = await service.decide(input);
  assert.equal(result.state, "ready", result.error);
  assert.equal(result.amount, 0);
  assert.ok(result.decision.facts.length >= 4);
  assert.equal(calls, 0);
  assert.equal((await service.decide(input)).cached, true);
  assert.equal(
    store.get(p.id).project.storyPlans[p.episodeId].setup.concept,
    idea,
  );
  assert.match(decisionRequest(context).messages[0].content, /Do not rewrite/);
});

test("explicit format wins over a legacy format and malformed recipe data stays bounded", () => {
  const d = normalizeDesk(
    {
      format: "kids",
      pins: [null, { id: "x", x: Infinity, y: -10 }],
      path: [null, { x: "bad", y: 200 }],
    },
    {
      format: "Movie",
      creativeMix: { look: ["not-a-style"], palette: ["not-a-palette"] },
    },
  );
  assert.equal(d.format, "kids");
  assert.equal(d.look, "cinematic");
  assert.equal(d.palette, "pastel");
  assert.equal(d.pins.length, 1);
  assert.deepEqual(d.path, [{ x: 0, y: 100 }]);
  assert.equal(pinWeight({ x: 95, y: 50 }), 20);
});

test("clip generation receives creative defaults without instructions to generate the whole film", () => {
  const p = project();
  const compiled = storyPromptContext(p, p.drafts[0]);
  assert.match(compiled, /only to the current clip/);
  assert.doesNotMatch(compiled, /Plan about 600|60 short shots/);
  assert.match(
    deskPrompt(p.storyPlans[p.episodeId].setup, [], {
      model: { durations: [4, 8] },
    }),
    /75 short shots/,
  );
});

test("Undo and a shareable recipe card preserve writing and exclude private media", async () => {
  const { restoreDeskSetup, deskRecipeCard } =
    await import("../shared/director-desk.mjs");
  const prior = {
    concept: "Earlier idea",
    targetDuration: 30,
    directorDesk: normalizeDesk({ look: "graphic" }),
  };
  const current = {
    ...prior,
    concept: "New words. “Exact dialogue.”",
    castIds: ["new-cast"],
    directorDesk: normalizeDesk({
      look: "analog",
      facts: { character: "Private name" },
      pins: [{ id: "secret", x: 50, y: 50 }],
    }),
  };
  const restored = restoreDeskSetup(current, prior);
  assert.equal(restored.concept, current.concept);
  assert.deepEqual(restored.castIds, current.castIds);
  assert.equal(restored.directorDesk.look, "graphic");
  const card = deskRecipeCard(current);
  assert.match(card, /<svg/);
  assert.match(card, /splece-recipe/);
  assert.doesNotMatch(card, /Private name|secret|New words/);
});

test("desk direction reaches generated video prompts while local cameras and timed directions win", async () => {
  const { compilePrompt, models } = await import("../server/domain.mjs");
  const p = project(),
    d = p.drafts[0],
    s = p.storyPlans[p.episodeId].setup;
  s.directorDesk = normalizeDesk({
    ...s.directorDesk,
    light: "rim",
    look: "graphic",
    softness: 82,
    lens: 90,
    angle: 90,
  });
  d.scenes[0].camera = "Auto";
  d.scenes[0].movement = "Auto";
  d.scenes[0].text = "A bird lands on the table.";
  let compiled = compilePrompt(p, d, models[0]);
  assert.match(compiled.text, /gentle front fill/);
  assert.match(compiled.text, /82%/);
  assert.match(compiled.text, /looking up toward/);
  assert.doesNotMatch(compiled.text, /Plan about 600/);
  d.scenes[0].cameraDirection = "An eye-level locked close-up.";
  compiled = compilePrompt(p, d, models[0]);
  assert.doesNotMatch(compiled.text, /looking up toward/);
  assert.match(compiled.text, /eye-level locked close-up/);
  p.directionRanges = [
    {
      id: "timed-light",
      start: 0,
      end: 20,
      settings: { lighting: "neon", look: "clean" },
    },
  ];
  compiled = compilePrompt(p, d, models[0]);
  assert.doesNotMatch(compiled.text, /gentle front fill/);
  assert.match(compiled.text, /neon/i);
  d.automation.specs = false;
  compiled = compilePrompt(p, d, models[0]);
  assert.doesNotMatch(compiled.text, /Light softness: 82/);
});
