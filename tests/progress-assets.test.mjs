import test from "node:test";
import assert from "node:assert/strict";
import {
  providerTiming,
  jobProgress,
  jobsForStory,
} from "../shared/job-progress.mjs";
import {
  assetImagePrompt,
  assetMetadataPrompt,
  parseAssetMetadata,
  applyAssetMetadata,
} from "../shared/asset-exchange.mjs";
import { VeniceAdapter } from "../server/providers.mjs";
import { openStore } from "../server/store.mjs";
import { startWorker } from "../server/jobs.mjs";
import { newProject } from "../server/domain.mjs";
const asset = {
  id: "a",
  kind: "character",
  name: "Test hero",
  description: "A careful explorer",
  gender: "male",
  media: { id: "original" },
  voice: { accent: "Khaleeji" },
  variants: [
    {
      id: "v",
      name: "Day",
      description: "Old",
      media: { id: "costume" },
      tags: { pose: "standing" },
    },
  ],
};
const project = {
  episodeId: "ep",
  storyPlans: {
    ep: {
      title: "Journey",
      brief: "Find the water source",
      beats: [
        {
          characterIds: ["a"],
          title: "Arrival",
          description: "Enters the oasis",
        },
      ],
    },
  },
};
test("Provider times are milliseconds; estimated progress cannot claim completion; stale and failed states stay clear", () => {
  const timing = providerTiming(
    { average_execution_time: 145000, execution_duration: 53000 },
    1000,
  );
  assert.equal(timing.averageMs, 145000);
  assert.equal(
    providerTiming({ average_execution_time: -1, execution_duration: 2 }),
    null,
  );
  const j = { state: "running", createdAt: 0, lastPolledAt: 1000, timing };
  assert.equal(jobProgress(j, 1000).percent, 37);
  assert.match(jobProgress(j, 1000).detail, /92s/);
  assert.equal(
    jobProgress({ ...j, timing: { ...timing, elapsedMs: 200000 } }, 1000)
      .percent,
    95,
  );
  assert.match(jobProgress(j, 100000).label, /delayed/);
  assert.equal(jobProgress({ ...j, state: "unreachable" }, 2000).percent, null);
  assert.equal(
    jobProgress({ ...j, state: "failed", updatedAt: 5000 }, 999999)
      .elapsedSeconds,
    5,
  );
  assert.equal(jobProgress({ ...j, state: "ready" }, 2000).percent, 100);
  assert.equal(jobProgress({ ...j, timing: null }, 2000).percent, null);
});
test("Story job matching isolates episode and generation", () => {
  assert.equal(
    jobsForStory(
      [
        {
          kind: "generation",
          snapshot: { draft: { storyBeatId: "b", episodeId: "ep" } },
        },
        {
          kind: "generation",
          snapshot: { draft: { storyBeatId: "b", episodeId: "other" } },
        },
      ],
      "b",
      "ep",
    ).length,
    1,
  );
});
test("Asset copy prompts carry story context and type-specific image direction without file paths", () => {
  assert.match(assetImagePrompt(asset, project), /ONE person/);
  assert.match(assetImagePrompt(asset, project), /Find the water source/);
  assert.match(assetMetadataPrompt(asset, project), /Khaleeji/);
  assert.doesNotMatch(assetMetadataPrompt(asset, project), /"media"/);
  assert.match(
    assetImagePrompt({ ...asset, kind: "location" }, project),
    /establishing reference/,
  );
});
test("Validated profile round trip preserves identity, images, variant attachments and omitted voice details", () => {
  const patch = parseAssetMetadata(
    "```json\n" +
      JSON.stringify({
        schemaVersion: 1,
        kind: "character",
        description: "Updated explorer",
        voice: { tone: "Warm", description: "Measured delivery" },
        variants: [
          { name: "Day", description: "Blue coat", tags: { clothing: "coat" } },
          { name: "Night", description: "Dark coat" },
        ],
      }) +
      "\n```",
    asset,
  );
  const result = applyAssetMetadata(asset, patch, () => "new");
  assert.equal(result.id, "a");
  assert.equal(result.media.id, "original");
  assert.equal(result.variants[0].media.id, "costume");
  assert.equal(result.variants[0].tags.pose, "standing");
  assert.equal(result.variants[1].id, "new");
  assert.equal(result.voice.accent, "Khaleeji");
  assert.equal(result.voice.description, "Measured delivery");
  assert.equal(asset.description, "A careful explorer");
});
test("Malformed and unsafe AI profile fields cannot overwrite IDs or media", () => {
  for (const invalid of [
    { id: "overwrite" },
    { media: { id: "bad" } },
    { voice: { unknown: "x" } },
    { gender: "invalid" },
    { variants: [{ name: "", description: "x" }] },
    {
      variants: [
        { name: "A", description: "x" },
        { name: "a", description: "x" },
      ],
    },
    { description: 42 },
  ])
    assert.throws(() =>
      parseAssetMetadata(
        JSON.stringify({ schemaVersion: 1, kind: "character", ...invalid }),
        asset,
      ),
    );
  assert.throws(() => parseAssetMetadata("{broken", asset));
  assert.throws(() =>
    parseAssetMetadata('{"schemaVersion":1,"kind":"prop"}', asset),
  );
});
test("Worker persists real-shaped provider timing and resumes polling without re-submitting (mock only)", async () => {
  const store = openStore(":memory:");
  const p = newProject("Timing test");
  store.save(p, 0);
  const j = {
    id: "timing",
    projectId: p.id,
    kind: "generation",
    state: "running",
    createdAt: Date.now(),
    providerJobId: "already-accepted",
    snapshot: { provider: "Venice" },
  };
  store.putJob(j);
  let submissions = 0;
  const args = {
    store,
    data: "/tmp",
    checkpoint: async () => {},
    video: {
      adapter: async () => ({
        submit: async () => {
          submissions++;
        },
        poll: async () => ({
          state: "processing",
          raw: { average_execution_time: 145000, execution_duration: 53000 },
        }),
      }),
    },
  };
  let worker = startWorker(args);
  try {
    await new Promise((r) => setTimeout(r, 400));
    worker.stop();
    const saved = store.job(j.id);
    assert.equal(saved.timing.averageMs, 145000);
    assert.equal(saved.timing.elapsedMs, 53000);
    assert.ok(saved.lastPolledAt);
    worker = startWorker(args);
    assert.equal(store.job(j.id).providerJobId, "already-accepted");
    assert.equal(submissions, 0);
  } finally {
    worker.stop();
    store.db.close();
  }
});
test("Venice 402 error is actionable and never retried by adapter", async () => {
  let calls = 0;
  const adapter = new VeniceAdapter({
    key: "fake",
    transport: async () => {
      calls++;
      return new Response("{}", { status: 402 });
    },
  });
  await assert.rejects(
    adapter.submit({ requestPayload: { model: "test" } }),
    /credits or billing/,
  );
  assert.equal(calls, 1);
});

test('Location exchange omits unrelated story and character fields, requests empty values and avoids duplicate descriptions',()=>{
  const location={...asset,kind:'location',name:'Street',description:'A dusty avenue.',delivery:'Softly',variants:[]};
  const contextProject={episodeId:'e',storyPlans:{e:{title:'Film',brief:'A journey',synopsis:'UNRELATED_FULL_PLOT',setup:{concept:'UNRELATED_CONCEPT',castIds:['unrelated']},beats:[]}}};
  const prompt=assetMetadataPrompt(location,contextProject);
  assert.doesNotMatch(prompt,/UNRELATED_FULL_PLOT|UNRELATED_CONCEPT|"delivery"|"voice"|"clothing"|"pose"|"expression"/);
  assert.equal(prompt.split('A dusty avenue.').length-1,1);
  const template=JSON.parse(prompt.split('JSON TEMPLATE\n')[1]);
  assert.equal(template.description,''); assert.deepEqual(template.variants,[]);
  assert.match(prompt,/not applicable text MUST be ""/);
  assert.match(prompt,/40–80 words/);
  assert.doesNotThrow(()=>parseAssetMetadata(JSON.stringify(template),location));
});
test('Unspecified character gender remains empty rather than being invented',()=>{
  const prompt=assetMetadataPrompt({...asset,gender:undefined},project);
  const template=JSON.parse(prompt.split('JSON TEMPLATE\n')[1]);
  assert.equal(template.gender,'');
  assert.equal(parseAssetMetadata(JSON.stringify(template),asset).gender,'');
});
