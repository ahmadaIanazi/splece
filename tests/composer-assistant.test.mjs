import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store.mjs";
import { newProject, models, compilePrompt } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import {
  createComposerAssistant,
  decisionRequest,
  assistantCostRecords,
} from "../server/composer-assistant.mjs";
import {
  assistantContext,
  assistantFingerprint,
  applyAssistantDecision,
  validateAssistantDecision,
  markAssistantManualEdits,
  fieldOwner,
  claimCamera,
  cameraValues,
  syncAssistantInheritance,
  suppressUndoneAssistance,
} from "../shared/composer-assistant.mjs";
const model = models[0];
const choice = {
  camera: [{ field: "framing", value: "Close-up", evidence: "close-up" }],
  appearances: [],
  issues: [],
};
function fixture(t, extra = {}) {
  const store = openStore(":memory:");
  t.after(() => store.db.close());
  const p = upgradeProject(newProject("Assistant QA")),
    d = p.drafts[0],
    s = d.scenes[0];
  s.text = "A close-up of a cup. The camera stays still.";
  s.dialogue = [
    { speaker: "", text: "Keep this exact line.", delivery: "Auto" },
  ];
  store.save(p, 0);
  let liveMode = "test",
    calls = 0;
  const service = createComposerAssistant({
    store,
    data: "/unused",
    models: async () => [model],
    mode: async () => liveMode,
    key: async () => "test-key",
    now: () => Date.parse("2026-10-24T10:00:00Z"),
    transport: async (url, opts) => {
      calls++;
      assert.equal(JSON.parse(opts.body).thinking.type, "disabled");
      return {
        ok: true,
        json: async () => ({
          id: "receipt",
          model: "deepseek-flash",
          usage: { prompt_tokens: 100, completion_tokens: 20 },
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(choice) },
            },
          ],
        }),
      };
    },
    ...extra,
  });
  service.configure({ enabled: true });
  const context = () =>
    assistantContext(
      store.get(p.id).project,
      store.get(p.id).project.drafts[0],
      s.id,
      model,
    );
  const request = () => ({
    projectId: p.id,
    draftId: d.id,
    sceneId: s.id,
    fingerprint: assistantFingerprint(context()),
    sessionId: "session",
  });
  return {
    store,
    p,
    d,
    s,
    service,
    context,
    request,
    setMode: (v) => {
      liveMode = v;
    },
    calls: () => calls,
  };
}
test("granular ownership preserves manual height while framing follows and never rewrites prose", (t) => {
  const { p, d, s, context } = fixture(t);
  const old = structuredClone(p);
  s.camera = "High angle";
  markAssistantManualEdits(old, p);
  assert.equal(fieldOwner(s, "elevation"), "manual");
  assert.equal(fieldOwner(s, "framing"), "inherited");
  const c = assistantContext(p, d, s.id, model),
    text = s.text,
    dialogue = structuredClone(s.dialogue);
  const validated = validateAssistantDecision(
    {
      ...choice,
      camera: [
        ...choice.camera,
        { field: "elevation", value: "Low angle", evidence: "cup" },
      ],
    },
    c,
  );
  assert.equal(validated.camera.length, 1);
  assert.equal(validated.issues.length, 1);
  assert.equal(applyAssistantDecision(p, d.id, c, validated, "r"), true);
  assert.equal(cameraValues(s).framing, "Close-up");
  assert.equal(cameraValues(s).elevation, "High angle");
  assert.equal(s.text, text);
  assert.deepEqual(s.dialogue, dialogue);
  assert.equal(
    assistantFingerprint(assistantContext(p, d, s.id, model)),
    assistantFingerprint(c),
  );
  assert.match(compilePrompt(p, d, model).text, /Close-up/);
  assert.match(compilePrompt(p, d, model).text, /Keep this exact line/);
});
test("legacy camera values remain manual; reset is granular; negation and dialogue do not become camera commands", (t) => {
  const { p, d, s } = fixture(t);
  delete s.assistantVersion;
  s.camera = "Wide shot · High angle";
  assert.equal(fieldOwner(s, "framing"), "manual");
  claimCamera(s, ["framing"], "following");
  assert.equal(fieldOwner(s, "elevation"), "manual");
  s.text = "Not a close-up. She speaks.";
  let c = assistantContext(p, d, s.id, model);
  assert.equal(validateAssistantDecision(choice, c).camera.length, 0);
  s.text = "She says close-up.";
  s.dialogue = [{ text: "close-up" }];
  c = assistantContext(p, d, s.id, model);
  assert.equal(validateAssistantDecision(choice, c).camera.length, 0);
});
test("Structure changes update inherited fields; local manual and assistant fields stay local", (t) => {
  const { p, d, s } = fixture(t);
  p.storyPlans = {
    [p.episodeId]: {
      beats: [
        { id: "group", creativeDirection: { lighting: "golden" } },
        {
          id: "beat",
          parentId: "group",
          camera: "Wide shot · Low angle",
          movement: "Pan left",
        },
      ],
    },
  };
  d.storyBeatId = "beat";
  s.assistant = { sourceStoryId: "beat" };
  syncAssistantInheritance(p);
  assert.equal(s.camera, "Wide shot · Low angle");
  claimCamera(s, ["framing"]);
  s.camera = "Close-up · Low angle";
  claimCamera(s, ["movement"], "following");
  s.movement = "Handheld";
  p.storyPlans[p.episodeId].beats[1].camera = "Medium shot · High angle";
  p.storyPlans[p.episodeId].beats[1].movement = "Pull back";
  syncAssistantInheritance(p);
  assert.equal(s.camera, "Close-up · High angle");
  assert.equal(s.movement, "Handheld");
  assert.equal(assistantContext(p, d, s.id, model).creative.lighting, "golden");
});
test("appearance IDs must exist, manual pins and opening states win, negated wardrobe abstains", (t) => {
  const { p, d, s } = fixture(t);
  p.assets = [
    {
      id: "alex",
      name: "Alex",
      kind: "character",
      description: "Actor",
      media: { id: "base" },
      variants: [{ id: "coat", name: "Red coat", media: { id: "coat-image" } }],
    },
  ];
  d.referenceIds = ["alex"];
  s.text = "Alex is no longer wearing the red coat.";
  const raw = {
    camera: [],
    appearances: [
      {
        assetId: "alex",
        variantId: "coat",
        evidence: "no longer wearing the red coat",
      },
    ],
    issues: [],
  };
  let c = assistantContext(p, d, s.id, model);
  assert.equal(validateAssistantDecision(raw, c).appearances.length, 0);
  s.text = "Alex wears the red coat.";
  raw.appearances[0].evidence = "wears the red coat";
  c = assistantContext(p, d, s.id, model);
  assert.equal(validateAssistantDecision(raw, c).appearances.length, 1);
  d.referenceOptions = { alex: { variantId: "none" } };
  c = assistantContext(p, d, s.id, model);
  assert.equal(validateAssistantDecision(raw, c).appearances.length, 0);
  d.referenceOptions = {};
  d.continuity = {
    opening: { text: "Blue shirt", provenance: "user-confirmed" },
  };
  c = assistantContext(p, d, s.id, model);
  assert.equal(validateAssistantDecision(raw, c).appearances.length, 0);
  assert.throws(() =>
    validateAssistantDecision(
      { ...raw, appearances: [{ ...raw.appearances[0], assetId: "invented" }] },
      c,
    ),
  );
  const request = JSON.stringify(decisionRequest(c));
  assert.match(request, /user-confirmed/);
  assert.doesNotMatch(request, /image_url/);
});
test("Test mode performs no inference; duplicate tabs share one persistent result", async (t) => {
  const f = fixture(t);
  const first = await f.service.decide(f.request());
  assert.equal(first.state, "ready");
  assert.equal(f.calls(), 0);
  assert.equal(first.amount, 0);
  const second = await f.service.decide({
    ...f.request(),
    sessionId: "other-tab",
  });
  assert.equal(second.id, first.id);
  assert.equal(second.cached, true);
  assert.equal(
    f.store.db
      .prepare("SELECT count(*) AS n FROM composer_assistant_receipts")
      .get().n,
    1,
  );
  assert.equal((await f.service.accept(first.id)).state, "applied");
  assert.equal(assistantCostRecords(f.store, f.p.id)[0].kind, "assistant");
});
test("Live mocked usage is settled and separately reported; no repair loop after malformed output", async (t) => {
  const f = fixture(t);
  f.setMode("live");
  const r = await f.service.decide(f.request());
  assert.equal(f.calls(), 1);
  assert.equal(r.state, "ready");
  assert.ok(r.amount > 0 && r.amount < r.reserved);
  assert.equal(f.service.status("session").today.unknown, 0);
  f.service.discard(r.id);
  assert.equal(f.service.load(r.id).state, "discarded");
  assert.equal(f.service.status("session").today.estimated, r.amount);
});
test("manual edits during a slow request discard the billed result", async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const f = fixture(t, {
    transport: async () => {
      await gate;
      return {
        ok: true,
        json: async () => ({
          model: "deepseek-flash",
          usage: { prompt_tokens: 200, completion_tokens: 40 },
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(choice) },
            },
          ],
        }),
      };
    },
  });
  f.setMode("live");
  const pending = f.service.decide(f.request());
  await new Promise((r) => setTimeout(r, 5));
  const saved = f.store.get(f.p.id),
    old = structuredClone(saved.project);
  saved.project.drafts[0].scenes[0].camera = "Wide shot";
  markAssistantManualEdits(old, saved.project);
  f.store.save(saved.project, saved.revision);
  release();
  const result = await pending;
  assert.equal(result.state, "stale");
  assert.ok(result.amount > 0);
  assert.equal((await f.service.accept(result.id)).state, "stale");
  assert.equal(
    f.store.get(f.p.id).project.drafts[0].scenes[0].camera,
    "Wide shot",
  );
});
test("OFF cancels in flight, invalidates results and retains unknown usage reservation", async (t) => {
  const f = fixture(t, {
    transport: async (_url, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(Error("cancelled")), {
          once: true,
        }),
      ),
  });
  f.setMode("live");
  const pending = f.service.decide(f.request());
  await new Promise((r) => setTimeout(r, 5));
  f.service.configure({ enabled: false });
  const r = await pending;
  assert.equal(r.state, "cancelled");
  assert.equal(r.amount, null);
  assert.ok(f.service.status("session").today.held > 0);
  assert.equal((await f.service.decide(f.request())).state, "off");
});
test("budget is reserved before dispatch, malformed/truncated/provider errors are not retried", async (t) => {
  const f = fixture(t);
  f.setMode("live");
  f.service.configure({ budget: 0 });
  assert.equal((await f.service.decide(f.request())).state, "budget");
  assert.equal(f.calls(), 0);
  for (const answer of [
    { ok: false, status: 503 },
    {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: "length", message: { content: "{}" } }],
      }),
    },
    {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: "stop", message: { content: "not json" } }],
      }),
    },
  ]) {
    let calls = 0;
    const x = fixture(t, {
      transport: async () => {
        calls++;
        return answer;
      },
    });
    x.setMode("live");
    const a = await x.service.decide(x.request());
    assert.equal(a.state, "failed");
    assert.equal(a.amount, null);
    assert.equal((await x.service.decide(x.request())).id, a.id);
    assert.equal(calls, 1);
    assert.ok(x.service.status("session").today.held > 0);
  }
});
test("no paid dispatch after switching to Test while credentials are loading", async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const f = fixture(t, {
    key: async () => {
      await gate;
      return "key";
    },
  });
  f.setMode("live");
  const pending = f.service.decide(f.request());
  await new Promise((r) => setTimeout(r, 5));
  f.setMode("test");
  release();
  const r = await pending;
  assert.equal(r.state, "cancelled");
  assert.equal(f.calls(), 0);
  assert.equal(r.amount, 0);
});
test("Undo suppression and generation snapshots keep late decisions from changing authored or submitted material", (t) => {
  const { p, d, s } = fixture(t),
    before = structuredClone(p),
    c = assistantContext(p, d, s.id, model),
    snapshot = structuredClone({
      draft: d,
      compiled: compilePrompt(p, d, model),
    });
  applyAssistantDecision(p, d.id, c, validateAssistantDecision(choice, c), "r");
  suppressUndoneAssistance(p, before);
  assert.equal(applyAssistantDecision(before, d.id, c, choice, "r2"), false);
  assert.ok(
    before.drafts[0].assistant.suppressed.includes(assistantFingerprint(c)),
  );
  assert.equal(snapshot.draft.scenes[0].camera, "Auto");
  assert.doesNotMatch(snapshot.compiled.text, /Camera: Close-up/);
  const changed = structuredClone(p);
  changed.drafts[0].scenes[0].text += " A new action.";
  assert.equal(applyAssistantDecision(changed, d.id, c, choice, "r3"), false);
});

test("only one decision runs across tabs, and distinct requests obey the server rate limit", async (t) => {
  let release, started;
  const gate = new Promise((r) => (release = r));
  const dispatched = new Promise((r) => (started = r));
  const f = fixture(t, {
    transport: async () => {
      started();
      await gate;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(choice) },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
      };
    },
  });
  f.setMode("live");
  const first = f.service.decide(f.request());
  await dispatched;
  assert.equal((await f.service.decide(f.request())).state, "running");
  const saved = f.store.get(f.p.id);
  saved.project.drafts[0].scenes[0].text += " The door opens.";
  f.store.save(saved.project, saved.revision);
  assert.equal((await f.service.decide(f.request())).state, "busy");
  release();
  assert.equal((await first).state, "stale");
  const x = fixture(t);
  for (let n = 0; n < 10; n++) {
    const saved = x.store.get(x.p.id);
    saved.project.drafts[0].scenes[0].text = `A close-up of cup number ${n}.`;
    x.store.save(saved.project, saved.revision);
    assert.equal((await x.service.decide(x.request())).state, "ready");
  }
  const savedAgain = x.store.get(x.p.id);
  savedAgain.project.drafts[0].scenes[0].text += " New request.";
  x.store.save(savedAgain.project, savedAgain.revision);
  assert.equal((await x.service.decide(x.request())).state, "rate-limited");
  assert.equal(x.calls(), 0);
});

test("Assistant includes neighboring clips and story boundaries; completions require explicit fresh acceptance", async (t) => {
  const { acceptAssistantCompletion } =
    await import("../shared/composer-assistant.mjs");
  const f = fixture(t),
    { p, d, s } = f;
  p.storyPlans = {
    [p.episodeId]: {
      title: "The signal",
      synopsis: "The traveler returns a lost radio.",
      beats: [
        { id: "act", title: "Return", description: "Find the owner" },
        {
          id: "beat",
          parentId: "act",
          title: "Examine radio",
          description: "Do not meet the owner yet",
        },
      ],
    },
  };
  d.storyBeatId = "beat";
  d.start = 5;
  p.drafts.push(
    {
      ...structuredClone(d),
      id: "prior",
      start: 0,
      name: "Discovery",
      scenes: [{ id: "prior-shot", text: "The traveler finds a radio." }],
    },
    {
      ...structuredClone(d),
      id: "next",
      start: 10,
      name: "Return",
      scenes: [
        {
          id: "next-shot",
          text: "The traveler returns the radio to its owner.",
        },
      ],
    },
  );
  s.text = "The traveler examines the radio.";
  const c = assistantContext(p, d, s.id, model);
  assert.equal(c.neighbors.before.title, "Discovery");
  assert.equal(c.neighbors.after.title, "Return");
  assert.equal(c.structure.at(-1).description, "Do not meet the owner yet");
  assert.equal(c.story.title, "The signal");
  const raw = {
    camera: [
      { field: "framing", value: "Close-up", evidence: "examines the radio" },
    ],
    appearances: [],
    issues: [],
    completion: {
      text: "A finger rests beside the silent tuning dial.",
      reason: "Stays with the current discovery.",
    },
  };
  const decision = validateAssistantDecision(raw, c),
    before = s.text,
    dialogue = structuredClone(s.dialogue);
  applyAssistantDecision(p, d.id, c, decision, "completion-1");
  assert.equal(s.text, before);
  assert.equal(cameraValues(s).framing, "Close-up");
  assert.equal(acceptAssistantCompletion(p, d.id, c, "completion-1"), true);
  assert.equal(s.text, before + "\n" + raw.completion.text);
  assert.deepEqual(s.dialogue, dialogue);
  assert.equal(acceptAssistantCompletion(p, d.id, c, "completion-1"), false);
});

test("Completions reject invented references, stale context and disabled suggestions", async (t) => {
  const { acceptAssistantCompletion } =
    await import("../shared/composer-assistant.mjs");
  const { p, d, s } = fixture(t),
    c = assistantContext(p, d, s.id, model);
  const raw = {
    camera: [],
    appearances: [],
    issues: [],
    completion: { text: "@[Unknown] enters.", reason: "Test" },
  };
  assert.throws(() => validateAssistantDecision(raw, c), /unavailable asset/);
  raw.completion.text = "The traveler pauses.";
  applyAssistantDecision(
    p,
    d.id,
    c,
    validateAssistantDecision(raw, c),
    "completion-2",
  );
  s.text += " Another action.";
  assert.equal(acceptAssistantCompletion(p, d.id, c, "completion-2"), false);
  c.policy.writingSuggestions = false;
  assert.equal(validateAssistantDecision(raw, c).completion, null);
  s.text = "";
  const empty = assistantContext(p, d, s.id, model);
  assert.equal(
    validateAssistantDecision(raw, empty).completion.text,
    "The traveler pauses.",
  );
});

test("Global director/suggestion preferences invalidate old receipts without any paid inference in Test", async (t) => {
  const f = fixture(t);
  const r = await f.service.decide(f.request());
  const epoch = f.service.status().epoch;
  f.service.configure({ writingSuggestions: false, creativeDecisions: false });
  assert.equal(f.service.status().epoch, epoch + 1);
  assert.equal((await f.service.accept(r.id)).state, "stale");
  assert.equal(f.calls(), 0);
});

test('Inferred camera choices respect project/timed direction; explicit wording can override a fallback', t => {
  const {p,d,s}=fixture(t);
  s.text='The traveler examines a radio.';
  p.settings.creativeDirection={movement:'pan'};
  const c=assistantContext(p,d,s.id,model);
  const raw={camera:[{field:'framing',value:'Close-up',evidence:'examines a radio'}],appearances:[],issues:[]};
  assert.equal(validateAssistantDecision(raw,c).camera.length,0);
  s.text='A close-up of the radio.';
  raw.camera[0].evidence='close-up';
  assert.equal(validateAssistantDecision(raw,assistantContext(p,d,s.id,model)).camera.length,1);
});
