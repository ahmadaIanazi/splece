import test from "node:test";
import assert from "node:assert/strict";
import { newProject, models, compilePrompt } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { smartSignature } from "../shared/smart.mjs";
import { optimizedSubmissionDraft } from "../shared/submission-optimization.mjs";
function fixture() {
  const p = upgradeProject(newProject("Submission Test")),
    d = p.drafts[0],
    model = models[0];
  d.scenes[0].text = "The traveler raises a hand.\nNegative: No text.";
  d.scenes[0].dialogue = [{ speaker: "", text: "Keep this exact sentence." }];
  const job = {
    id: "opt-job",
    projectId: p.id,
    draftId: d.id,
    state: "ready",
    sourceSignature: smartSignature(p, d),
    input: {
      operation: "optimize-writing",
      submissionOnly: true,
      draft: structuredClone(d),
      videoCapabilities: model,
    },
    config: { mode: "demo" },
    result: {
      scenes: [
        {
          id: d.scenes[0].id,
          text: "The traveler slowly raises a hand.\nNegative: No text.",
        },
      ],
    },
  };
  return { p, d, model, job };
}
test("Submission optimization adapts only a copied draft, preserving original, dialogue, controls and negatives", () => {
  const { p, d, model, job } = fixture(),
    original = structuredClone(d);
  const copy = optimizedSubmissionDraft(p, d, job, model, "test");
  assert.deepEqual(d, original);
  assert.match(copy.scenes[0].text, /slowly/);
  assert.deepEqual(copy.scenes[0].dialogue, original.scenes[0].dialogue);
  assert.equal(copy.scenes[0].camera, original.scenes[0].camera);
  assert.match(compilePrompt(p, copy, model).text, /Keep this exact sentence/);
  assert.equal(copy.optimizationReceipt.jobId, job.id);
});
test("Submission optimizer refuses failed, foreign, stale, changed-model and changed-mode results", () => {
  for (const mutate of [
    (f) => (f.job.state = "failed"),
    (f) => (f.job.projectId = "foreign"),
    (f) => (f.d.scenes[0].text += " New action."),
    (f) => (f.model = { ...f.model, id: "other" }),
    (f) => (f.job.config.mode = "deepseek"),
    (f) => (f.job.result.scenes[0].text = "A different scene."),
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() =>
      optimizedSubmissionDraft(f.p, f.d, f.job, f.model, "test"),
    );
  }
});

test("Test API runs optimization before video, reuses the receipt, and leaves the original on disk", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawn } = await import("node:child_process");
  const { setTimeout: delay } = await import("node:timers/promises");
  const dir = await mkdtemp(join(tmpdir(), "splece-submit-opt-"));
  const base = "http://127.0.0.1:14336";
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      PORT: "14336",
      STUDIO_DATA_DIR: dir,
      NODE_ENV: "production",
    },
    stdio: "ignore",
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const done = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await done;
    }
    await rm(dir, { recursive: true, force: true });
  });
  let cookie = "";
  for (let n = 0; n < 100; n++) {
    try {
      const r = await fetch(base + "/api/session");
      if (r.ok) {
        cookie = r.headers.get("set-cookie").split(";")[0];
        break;
      }
    } catch {}
    await delay(60);
  }
  assert.ok(cookie);
  const api = async (route, body, method) => {
    const r = await fetch(base + "/api" + route, {
      method: method || (body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    assert.ok(r.ok, JSON.stringify(j));
    return j;
  };
  let { project: p, revision } = await api("/projects", {
    name: "Optimizer flow Test",
  });
  const d = p.drafts[0];
  d.scenes[0].text = "The traveler  looks up.";
  d.optimizeOnGenerate = true;
  revision = (await api("/projects/" + p.id, { project: p, revision }, "PUT"))
    .revision;
  const body = {
    draftId: d.id,
    revision,
    operation: "optimize-writing",
    submissionOnly: true,
    executionMode: "test",
  };
  const created = await api("/projects/" + p.id + "/smart-jobs", {
    ...body,
    requestId: "one",
  });
  let job;
  for (let n = 0; n < 60; n++) {
    job = (await api("/projects/" + p.id + "/smart-jobs")).find(
      (j) => j.id === created.id,
    );
    if (job.state === "ready") break;
    assert.notEqual(job.state, "failed", job.error);
    await delay(50);
  }
  assert.equal(job.state, "ready");
  assert.equal(job.result.model, "local-writing-fixture");
  assert.equal(job.result.usage, null);
  const cached = await api("/projects/" + p.id + "/smart-jobs", {
    ...body,
    requestId: "two",
  });
  assert.equal(cached.id, created.id);
  const video = await api("/projects/" + p.id + "/jobs", {
    draftId: d.id,
    revision,
    requestId: "video-one",
    optimizerJobId: created.id,
    mode: "demo",
  });
  assert.equal(video.snapshot.executionMode, "test");
  assert.equal(video.snapshot.optimizerJobId, created.id);
  assert.equal(video.snapshot.draft.scenes[0].text, "The traveler looks up.");
  assert.equal(
    video.snapshot.authoredDraft.scenes[0].text,
    "The traveler  looks up.",
  );
  const saved = await api("/projects/" + p.id);
  assert.equal(
    saved.project.drafts[0].scenes[0].text,
    "The traveler  looks up.",
  );
  assert.equal(saved.project.drafts.length, p.drafts.length);
});
