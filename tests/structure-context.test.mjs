import test from "node:test";
import assert from "node:assert/strict";
import { newProject, models } from "../server/domain.mjs";
import { openStore } from "../server/store.mjs";
import { createComposerAssistant } from "../server/composer-assistant.mjs";
import {
  structureAssistantContext,
  acceptStructureSuggestion,
  validateStructureSuggestions,
  editorPlanningContext,
  editorPlanningSignature,
  structureStoryboard,
  moveStructureTime,
} from "../shared/structure-context.mjs";
import { applyStructureJob } from "../shared/structure-workflow.mjs";
const fixture = () => {
  const p = newProject("Structure context Test");
  p.assets = [];
  p.storyPlans = {
    [p.episodeId]: {
      title: "Garden",
      brief: "A traveler finds a garden.",
      synopsis: "",
      beats: [
        {
          id: "g",
          nodeType: "group",
          kind: "scene",
          parentId: "",
          title: "Discovery",
          start: 0,
          duration: 20,
          description: "Discover the garden",
          dialogue: [],
        },
        ...[0, 1].map((i) => ({
          id: "c" + i,
          nodeType: "clip",
          kind: "generation",
          parentId: "g",
          title: "Moment " + i,
          start: i * 10,
          duration: 10,
          description: "The traveler pauses.",
          dialogue: [],
        })),
      ],
    },
  };
  return p;
};
test("Structure suggestions use the shared assistant budget and never change the project automatically", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.db.close());
  const p = fixture();
  store.save(p, 0);
  let calls = 0;
  const svc = createComposerAssistant({
    store,
    data: "/unused",
    models: async () => models,
    mode: async () => "test",
    key: async () => {
      throw Error("No key in Test");
    },
    transport: async () => {
      calls++;
      throw Error("No network");
    },
  });
  svc.configure({ enabled: true });
  const ctx = structureAssistantContext(p),
    before = JSON.stringify(store.get(p.id).project);
  const answer = await svc.decide({
    projectId: p.id,
    workspace: "structure",
    fingerprint: JSON.stringify(ctx),
    sessionId: "structure-test",
  });
  assert.equal(answer.state, "ready", answer.error);
  assert.equal(answer.decision.suggestions.length, 2);
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(store.get(p.id).project), before);
  acceptStructureSuggestion(p, ctx, answer.decision.suggestions[0]);
  assert.equal(p.assets[0].kind, "character");
  assert.equal(p.storyPlans[p.episodeId].brief, "A traveler finds a garden.");
  assert.throws(() =>
    acceptStructureSuggestion(p, ctx, answer.decision.suggestions[1]),
  );
});
test("Editor context includes current trims, active take intent and changed prompt writing", () => {
  const p = fixture(),
    d = p.drafts[0];
  d.storyBeatId = "c0";
  d.scenes[0].text = "Latest edited writing";
  p.clips = [
    {
      id: "placed",
      sourceDraftId: d.id,
      storyBeatId: "c0",
      start: 12,
      duration: 3,
      in: 4,
      activeTake: "t2",
      takes: [{ id: "t2", jobId: "j2" }],
    },
  ];
  const context = editorPlanningContext(p, [
    {
      id: "j2",
      projectId: p.id,
      snapshot: { draft: { scenes: [{ text: "Submitted version" }] } },
    },
  ]);
  assert.equal(context.clips[0].start, 12);
  assert.equal(context.clips[0].sourceIn, 4);
  assert.equal(context.clips[0].writing[0].text, "Latest edited writing");
  assert.equal(context.clips[0].submittedWriting[0].text, "Submitted version");
  const signature = editorPlanningSignature(p);
  p.clips[0].duration = 2;
  assert.notEqual(editorPlanningSignature(p), signature);
  assert.equal(
    applyStructureJob(p, {
      id: "old",
      state: "ready",
      episodeId: p.episodeId,
      result: {
        editorSignature: signature,
        proposal: {},
        originalPlan: p.storyPlans[p.episodeId],
      },
    }).conflict,
    true,
  );
});
test("hierarchy cells share one baseline and collapses retain timing; dragging updates edited slots", () => {
  const p = fixture(),
    layout = structureStoryboard(p);
  assert.deepEqual(
    layout.cells.map((n) => n.id),
    ["c0", "c1"],
  );
  assert.equal(layout.groups[0].first, 0);
  assert.equal(layout.groups[0].last, 1);
  const collapsed = structureStoryboard(p, { g: true });
  assert.deepEqual(
    collapsed.cells.map((n) => n.id),
    ["g"],
  );
  assert.equal(collapsed.ranges.get("g").end, 20);
  moveStructureTime(p, "c1", 0);
  assert.equal(
    [...p.clips].sort((a, b) => a.start - b.start)[0].storyBeatId ||
      [...p.clips].sort((a, b) => a.start - b.start)[0].structureNodeId,
    "c1",
  );
  assert.equal(
    p.storyPlans[p.episodeId].beats.find((n) => n.id === "c1").start,
    0,
  );
});
test("suggestion validation refuses fabricated reference IDs and writing replacement fields", () => {
  const ctx = structureAssistantContext(fixture());
  assert.throws(() =>
    validateStructureSuggestions(
      {
        suggestions: [
          {
            kind: "character",
            assetId: "invented",
            message: "Use this person",
          },
        ],
      },
      ctx,
    ),
  );
  const p = fixture(),
    before = p.storyPlans[p.episodeId].beats[0].description;
  acceptStructureSuggestion(p, structureAssistantContext(p, "g"), {
    kind: "connection",
    message: "Carry the garden motif forward.",
  });
  assert.equal(p.storyPlans[p.episodeId].beats[0].description, before);
  assert.equal(p.storyPlans[p.episodeId].connectionNotes.length, 1);
});

test("a saved suggestion batch supports independent accept/dismiss, survives reload and preserves writing", async () => {
  const { saveStructureReview, resolveStructureSuggestion, structureReviewKey } = await import('../shared/structure-context.mjs');
  const { upgradeProject } = await import('../shared/studio.mjs');
  const seed = fixture(), plan = seed.storyPlans[seed.episodeId];
  const p = upgradeProject(seed);
  p.storyPlans[p.episodeId] = plan;
  const original = p.storyPlans[p.episodeId].brief;
  const ctx = structureAssistantContext(p);
  const decision = validateStructureSuggestions({ suggestions: [
    { kind: 'character', name: 'Mira', message: 'A careful gardener.', description: 'Silver hair and a green coat.' },
    { kind: 'location', name: 'Glasshouse', message: 'A garden under glass.' },
    { kind: 'connection', message: 'Carry the seed into the final scene.' },
  ] }, ctx);
  assert.equal(saveStructureReview(p, ctx, { id: 'r', executionMode: 'live', decision }), true);
  const accepted = resolveStructureSuggestion(p, null, '0');
  assert.ok(accepted.assetId);
  const reloaded = upgradeProject(JSON.parse(JSON.stringify(p)));
  const review = reloaded.structureAssistantReviews[structureReviewKey(reloaded)];
  assert.equal(review.fingerprint, JSON.stringify(structureAssistantContext(reloaded)));
  assert.deepEqual(review.items.map(i => i.status), ['accepted', 'pending', 'pending']);
  resolveStructureSuggestion(reloaded, null, '1');
  resolveStructureSuggestion(reloaded, null, '2', true);
  assert.deepEqual(review.items.map(i => i.status), ['accepted', 'accepted', 'dismissed']);
  assert.equal(reloaded.assets.length, 2);
  resolveStructureSuggestion(reloaded, null, '0');
  assert.equal(reloaded.assets.length, 2, 'double-click cannot create duplicate characters');
  assert.equal(reloaded.storyPlans[reloaded.episodeId].brief, original);
  assert.equal(reloaded.storyPlans[reloaded.episodeId].connectionNotes?.length || 0, 0);
});

test("late Assistant batches and choices cannot overwrite intervening story edits", async () => {
  const { saveStructureReview, resolveStructureSuggestion } = await import('../shared/structure-context.mjs');
  const p = fixture(), ctx = structureAssistantContext(p);
  const answer = {id:'r', executionMode:'test', decision:validateStructureSuggestions({ suggestions:[{kind:'character',name:'Mira',message:'A gardener.'}]},ctx)};
  saveStructureReview(p, ctx, answer);
  p.storyPlans[p.episodeId].brief = 'A completely different story.';
  assert.equal(saveStructureReview(p, ctx, answer), false);
  assert.throws(() => resolveStructureSuggestion(p,null,'0'), /story changed/);
  assert.equal(p.assets.length,0);
});

test("failed requests need explicit retry, retries deduplicate and successful calls cannot be retried", async t => {
  const store = openStore(':memory:'); t.after(() => store.db.close());
  const p = fixture(); store.save(p,0);
  let calls = 0;
  const svc = createComposerAssistant({store,data:'/unused',models:async()=>models,mode:async()=>'live',key:async()=>'fake-test-key',transport:async()=>{
    calls++;
    if(calls === 1) throw Error('Temporary provider failure');
    return {ok:true,json:async()=>({usage:{prompt_tokens:100,completion_tokens:50},choices:[{finish_reason:'stop',message:{content:JSON.stringify({suggestions:[{kind:'character',name:'Mira',message:'A gardener.'}]})}}]})};
  }});
  svc.configure({enabled:true});
  const args={projectId:p.id,workspace:'structure',fingerprint:JSON.stringify(structureAssistantContext(p)),sessionId:'retry-test'};
  const failed=await svc.decide(args);
  assert.equal(failed.state,'failed');
  assert.equal((await svc.decide(args)).id,failed.id);
  assert.equal(calls,1,'failure is never silently charged again');
  const retried=await svc.decide({...args,retryOf:failed.id});
  assert.equal(retried.state,'ready',retried.error);
  assert.equal((await svc.decide({...args,retryOf:failed.id})).id,retried.id);
  assert.equal(calls,2);
  await assert.rejects(svc.decide({...args,retryOf:retried.id}),/cannot be retried/);
  assert.equal(calls,2);
});
