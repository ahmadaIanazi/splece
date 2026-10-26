import test from "node:test";
import assert from "node:assert/strict";
import { newProject } from "../server/domain.mjs";
import { requestStory } from "../server/authoring.mjs";
import { storyPlan, beatDraft } from "../shared/authoring.mjs";
import { applyStructureJob } from "../shared/structure-workflow.mjs";
import {
  planningColumns,
  planningMessages,
  recordPlanningMessage,
} from "../shared/planning-conversation.mjs";
async function chat(p, message, focus) {
  const plan = structuredClone(storyPlan(p));
  delete plan.history;
  return {
    id: crypto.randomUUID(),
    episodeId: p.episodeId,
    state: "ready",
    action: "conversation",
    result: await requestStory(
      {
        plan,
        assets: p.assets,
        episodeId: p.episodeId,
        action: "conversation",
        planningMessage: message,
        planningFocusId: focus,
      },
      { mode: "demo" },
      null,
      () => {
        throw Error("Test mode must never call a provider");
      },
    ),
  };
}
test("conversation prepares first scene clips and draft references; persists reply once", async () => {
  const p = newProject("Conversation QA");
  p.assets = [];
  recordPlanningMessage(p, {
    id: "m1",
    role: "user",
    text: "A traveler discovers a floating garden.",
  });
  const j = await chat(p, "A traveler discovers a floating garden.");
  assert.ok(j.result.planning.reply);
  assert.equal(applyStructureJob(p, j).applied, true);
  const columns = planningColumns(storyPlan(p));
  assert.equal(columns.length, 3);
  assert.equal(columns[0].clips.length, 2);
  assert.equal(columns[1].clips.length, 0);
  assert.equal(p.assets.length, 1);
  assert.equal(p.assets[0].referenceStatus, "draft");
  assert.equal(storyPlan(p).setup.planningVersion, 2);
  assert.equal(planningMessages(p).length, 2);
  assert.equal(applyStructureJob(p, j).skipped, true);
  assert.equal(planningMessages(p).length, 2);
  const restored = JSON.parse(JSON.stringify(p));
  assert.equal(planningMessages(restored)[1].text, j.result.planning.reply);
});
test("follow-up preserves original concept, IDs, dialogue and other scenes", async () => {
  const p = newProject("Followup");
  p.assets = [];
  applyStructureJob(p, await chat(p, "A quiet garden."));
  const before = structuredClone(storyPlan(p));
  const clip = before.beats.find((n) => n.nodeType === "clip");
  const j = await chat(p, "Make this moment warmer.", clip.id);
  assert.equal(applyStructureJob(p, j).applied, true);
  const after = storyPlan(p);
  assert.equal(after.setup.concept, before.setup.concept);
  assert.deepEqual(
    after.beats.map((n) => n.id),
    before.beats.map((n) => n.id),
  );
  for (const n of before.beats) {
    const next = after.beats.find((b) => b.id === n.id);
    assert.deepEqual(next.dialogue, n.dialogue);
    if (n.id !== clip.id) assert.deepEqual(next, n);
  }
  assert.match(after.beats.find((n) => n.id === clip.id).description, /warmer/);
  assert.equal(p.assets.length, 1);
});
test("concurrent user edits are not overwritten by conversation", async () => {
  const p = newProject("Conflict");
  p.assets = [];
  applyStructureJob(p, await chat(p, "A quiet garden."));
  const clip = storyPlan(p).beats.find((n) => n.nodeType === "clip"),
    j = await chat(p, "Make it rainy.", clip.id);
  clip.description = "My newer writing";
  assert.equal(applyStructureJob(p, j).conflict, true);
  assert.equal(clip.description, "My newer writing");
  assert.equal(planningMessages(p).length, 1);
});

test("conversation updates inherited clip writing but preserves manual prompts and takes", async () => {
  const p = newProject("Linked writing");
  p.assets = [];
  applyStructureJob(p, await chat(p, "A garden."));
  const clip = storyPlan(p).beats.find((n) => n.nodeType === "clip");
  const d = beatDraft(p, clip, p.drafts[0]);
  p.drafts.push(d);
  const manual = structuredClone(d);
  manual.id = "manual";
  manual.scenes[0].text = "My own words";
  p.drafts.push(manual);
  const savedMedia = JSON.stringify(p.clips);
  const j = await chat(p, "Make it moonlit.", clip.id);
  assert.equal(applyStructureJob(p, j).applied, true);
  assert.match(d.scenes[0].text, /moonlit/);
  assert.equal(manual.scenes[0].text, "My own words");
  assert.equal(JSON.stringify(p.clips), savedMedia);
});

test("conversation API preserves reply, deduplicates submission and survives restart in Test mode", async (t) => {
  const { spawn } = await import("node:child_process"),
    { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { setTimeout: delay } = await import("node:timers/promises");
  const dir = await mkdtemp(tmpdir() + "/splece-conversation-");
  let child, cookie;
  const base = "http://127.0.0.1:14339";
  async function stop() {
    if (child?.exitCode === null) {
      const done = new Promise((r) => child.once("exit", r));
      child.kill();
      await done;
    }
  }
  async function start() {
    child = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        PORT: "14339",
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
      await delay(50);
    }
    throw Error("Test server unavailable");
  }
  t.after(async () => {
    await stop();
    await rm(dir, { recursive: true, force: true });
  });
  await start();
  async function api(path, body) {
    const r = await fetch(base + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const v = await r.json();
    assert.ok(r.ok, JSON.stringify(v));
    return v;
  }
  const { project: p, revision } = await api("/projects", {
      name: "Conversation restart QA",
    }),
    path = "/projects/" + p.id + "/story-jobs";
  const body = {
    action: "conversation",
    planningMessage: "A traveler discovers a garden.",
    planningMessageId: "message1",
    revision,
    requestId: "turn1",
    autoApply: true,
  };
  const job = await api(path, body);
  assert.equal((await api(path, body)).id, job.id);
  let list;
  for (let i = 0; i < 100; i++) {
    list = await api(path);
    if (list[0]?.state === "ready") break;
    assert.notEqual(list[0]?.state, "failed", list[0]?.error);
    await delay(50);
  }
  assert.equal(list.length, 1);
  assert.match(list[0].result.planning.reply, /Offline sample plan updated/);
  assert.equal(list[0].result.usage, null);
  await stop();
  await start();
  const restored = await api(path);
  assert.deepEqual(restored[0].result.planning, list[0].result.planning);
  assert.equal(applyStructureJob(p, restored[0]).applied, true);
  assert.match(planningMessages(p)[0].text, /Offline sample plan updated/);
});
