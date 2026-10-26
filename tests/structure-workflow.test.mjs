import test from "node:test";
import assert from "node:assert/strict";
import { newProject } from "../server/domain.mjs";
import { requestStory } from "../server/authoring.mjs";
import { storyPlan, validateStorySetup } from "../shared/authoring.mjs";
import {
  applyStructureJob,
  suppressUndoneStructureJobs,
  undevelopedStructureGroups,
  structureVersionList,
  restoreStructureVersion,
  replaceStructureReference,
} from "../shared/structure-workflow.mjs";
function fixture() {
  const p = newProject("Structure workflow QA");
  p.assets = [
    { id: "hero", kind: "character", name: "Mira", description: "A traveler" },
    { id: "other", kind: "character", name: "Alex", description: "A traveler" },
    { id: "place", kind: "location", name: "Garden", description: "A garden" },
    {
      id: "new-place",
      kind: "location",
      name: "Courtyard",
      description: "A courtyard",
    },
  ];
  p.storyPlans = {
    [p.episodeId]: {
      title: "A quiet journey",
      brief: "A traveler finds a garden.",
      synopsis: "",
      setup: {
        castIds: ["hero"],
        heroIds: ["hero"],
        language: "English",
        dialogueStyle: "silent",
      },
      beats: [0, 1].map((i) => ({
        id: `group${i}`,
        nodeType: "group",
        kind: "scene",
        parentId: "",
        title: `Section ${i + 1}`,
        start: i * 20,
        duration: 20,
        end: (i + 1) * 20,
        description: "@[Mira] enters.",
        characterIds: ["hero"],
        locationId: "place",
        assetIds: [],
        dialogue: [],
        childNodeType: "clip",
      })),
    },
  };
  return p;
}
async function job(p, id, expandId, action = "children") {
  const plan = structuredClone(storyPlan(p));
  delete plan.history;
  return {
    id,
    episodeId: p.episodeId,
    state: "ready",
    action,
    autoApply: true,
    result: await requestStory(
      { plan, assets: p.assets, episodeId: p.episodeId, expandId, action },
      { mode: "demo" },
      null,
    ),
  };
}
test("independent results merge out of order, preserve manual writing and apply once", async () => {
  const p = fixture(),
    a = await job(p, "a", "group0"),
    b = await job(p, "b", "group1");
  storyPlan(p).beats[0].title = "Manual name";
  assert.equal(applyStructureJob(p, b).applied, true);
  assert.equal(applyStructureJob(p, a).applied, true);
  assert.equal(storyPlan(p).beats[0].title, "Manual name");
  assert.equal(
    storyPlan(p).beats.filter((n) => n.nodeType === "clip").length,
    4,
  );
  const before = JSON.stringify(p);
  assert.equal(applyStructureJob(p, a).skipped, true);
  assert.equal(JSON.stringify(p), before);
  assert.equal(structureVersionList(p).length, 2);
});
test("conflicting same-field edits keep the response without overwriting author text", async () => {
  const p = fixture();
  storyPlan(p).beats[0].nodeType = "clip";
  storyPlan(p).beats[0].kind = "generation";
  const j = await job(p, "edit", "group0", "enhance");
  storyPlan(p).beats[0].description = "My newer writing";
  assert.equal(applyStructureJob(p, j).conflict, true);
  assert.equal(storyPlan(p).beats[0].description, "My newer writing");
  assert.equal(p.storyJobReceipts.edit.state, "conflict");
  assert.ok(j.result.proposal);
});
test("Undo persists suppression across reload; bulk only chooses empty leaf groups", async () => {
  const p = fixture(),
    before = structuredClone(p),
    j = await job(p, "undo", "group0");
  applyStructureJob(p, j);
  suppressUndoneStructureJobs(p, before);
  const reloaded = JSON.parse(JSON.stringify(before));
  assert.equal(applyStructureJob(reloaded, j).skipped, true);
  assert.equal(reloaded.storyJobReceipts.undo.state, "undone");
  assert.deepEqual(undevelopedStructureGroups(storyPlan(p)), ["group1"]);
  assert.deepEqual(undevelopedStructureGroups(storyPlan(p), ["group0"]), []);
});
test("restoring a linked version requires confirmation and leaves media and prompt timing intact", async () => {
  const p = fixture();
  await applyStructureJob(p, await job(p, "versions", "group0"));
  const child = storyPlan(p).beats.find((n) => n.parentId === "group0");
  p.clips = [
    {
      id: "video",
      storyBeatId: child.id,
      start: 4,
      duration: 5,
      takes: [{ snapshot: { text: "original" } }],
    },
  ];
  p.drafts = [
    { id: "draft", storyBeatId: child.id, start: 4, name: "Editable prompt" },
  ];
  const media = JSON.stringify(p.clips),
    drafts = JSON.stringify(p.drafts),
    id = structureVersionList(p)[0].id;
  const result = restoreStructureVersion(p, id);
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.impact.clips.length, 1);
  assert.equal(
    restoreStructureVersion(p, id, { confirmed: true }).restored,
    true,
  );
  assert.equal(JSON.stringify(p.clips), media);
  assert.equal(JSON.stringify(p.drafts), drafts);
  assert.equal(structureVersionList(p).length, 2);
});
test("replacing references updates linked editable content but preserves dialogue and old snapshots", () => {
  const p = fixture();
  storyPlan(p).beats[0].dialogue = [{ speaker: "hero", text: "Mira is here." }];
  p.drafts = [
    {
      id: "d",
      storyBeatId: "group0",
      referenceIds: ["hero"],
      referenceOptions: { hero: { variantId: "coat" } },
      scenes: [
        {
          text: "@[Mira] enters.",
          characterIds: ["hero"],
          dialogue: [{ speaker: "hero", text: "Mira is here." }],
        },
      ],
    },
  ];
  p.clips = [
    {
      id: "c",
      storyBeatId: "group0",
      takes: [{ snapshot: { referenceIds: ["hero"] } }],
    },
  ];
  const old = JSON.stringify(p.clips);
  replaceStructureReference(p, "hero", "other", { scopeIds: ["group0"] });
  assert.deepEqual(storyPlan(p).beats[0].characterIds, ["other"]);
  assert.deepEqual(storyPlan(p).beats[1].characterIds, ["hero"]);
  assert.equal(p.drafts[0].scenes[0].text, "@[Alex] enters.");
  assert.deepEqual(p.drafts[0].scenes[0].dialogue, [
    { speaker: "other", text: "Mira is here." },
  ]);
  assert.equal(JSON.stringify(p.clips), old);
  assert.throws(() => replaceStructureReference(p, "hero", "place"));
});
test("setup keeps skippable steps, planning mix and non-character references", () => {
  const p = fixture(),
    v = validateStorySetup(
      {
        step: 3,
        durationSkipped: true,
        creativeMix: {
          look: ["realistic", "documentary"],
          cameraAngles: ["low-angle", "invalid"],
        },
        directionBrief: "Quiet and natural",
        assetIds: ["place"],
        referenceIds: ["place"],
      },
      p.assets,
    );
  assert.equal(v.step, 3);
  assert.equal(v.durationSkipped, true);
  assert.equal(v.directionBrief, "Quiet and natural");
  assert.deepEqual(v.creativeMix.look, ["realistic", "documentary"]);
  assert.deepEqual(v.creativeMix.cameraAngles, ["low-angle"]);
  assert.deepEqual(v.assetIds, ["place"]);
});
test("new references from independent jobs have distinct identities and resolve in their own sections", async () => {
  const p = fixture(),
    a = await job(p, "asset-a", null, "assets"),
    b = await job(p, "asset-b", null, "assets");
  b.result.proposal.assets[0].id = a.result.proposal.assets[0].id;
  assert.equal(applyStructureJob(p, a).applied, true);
  assert.equal(applyStructureJob(p, b).applied, true);
  assert.equal(new Set(p.assets.map((a) => a.id)).size, p.assets.length);
});
test("bulk Test API persists every result across restart and deduplicates repeated submissions", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    { spawn } = await import("node:child_process"),
    { setTimeout: delay } = await import("node:timers/promises");
  const dir = await mkdtemp(join(tmpdir(), "splece-structure-flow-")),
    base = "http://127.0.0.1:14337";
  let child,
    cookie = "";
  async function stop() {
    if (child?.exitCode === null) {
      const done = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await done;
    }
  }
  async function start() {
    child = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        PORT: "14337",
        STUDIO_DATA_DIR: dir,
        NODE_ENV: "production",
      },
      stdio: "ignore",
    });
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(base + "/api/session");
        if (r.ok) {
          cookie = r.headers.get("set-cookie").split(";")[0];
          return;
        }
      } catch {}
      await delay(60);
    }
    throw Error("Isolated server did not start");
  }
  t.after(async () => {
    await stop();
    await rm(dir, { recursive: true, force: true });
  });
  await start();
  async function api(path, body, method) {
    const r = await fetch(base + "/api" + path, {
      method: method || (body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    assert.ok(r.ok, JSON.stringify(j));
    return j;
  }
  let { project: p, revision } = await api("/projects", {
    name: "Structure durable Test",
  });
  const sample = fixture();
  p.assets = sample.assets;
  p.storyPlans = { [p.episodeId]: storyPlan(sample) };
  revision = (await api("/projects/" + p.id, { project: p, revision }, "PUT"))
    .revision;
  const path = "/projects/" + p.id + "/story-jobs",
    body = {
      revision,
      bulk: true,
      scopeIds: [],
      autoApply: true,
      requestId: "batch-one",
      action: "children",
    };
  const created = await api(path, body);
  assert.equal(created.ids.length, 2);
  await api(path, body);
  let jobs;
  for (let i = 0; i < 80; i++) {
    jobs = await api(path);
    if (jobs.every((j) => j.state === "ready")) break;
    assert.ok(
      !jobs.some((j) => j.state === "failed"),
      JSON.stringify(jobs.map((j) => j.error)),
    );
    await delay(50);
  }
  assert.equal(jobs.length, 2);
  assert.ok(jobs.every((j) => j.state === "ready" && j.autoApply));
  assert.ok(
    jobs.every(
      (j) =>
        j.result.model === "local-story-fixture" && j.result.usage === null,
    ),
  );
  assert.ok(jobs.every((j) => !j.input && !j.config));
  await stop();
  await start();
  const restored = await api(path);
  assert.equal(restored.length, 2);
  for (const j of restored) assert.equal(applyStructureJob(p, j).applied, true);
  assert.equal(
    storyPlan(p).beats.filter((b) => b.nodeType === "clip").length,
    4,
  );
  await api(path + "/" + restored[0].id + "/recover", {});
  assert.equal((await api(path)).length, 2);
});
