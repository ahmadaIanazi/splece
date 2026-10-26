import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { newProject, compilePrompt } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import {
  resolvePromptProfile,
  optimizerInstructions,
} from "../shared/model-prompting.mjs";
import {
  buildOptimizerRequest,
  optimizerEstimate,
} from "../server/prompt-optimizer.mjs";
import { requestSmart, installSmartRoutes } from "../server/smart.mjs";
import { addWritingVariation } from "../shared/writing-variation.mjs";
import { openStore } from "../server/store.mjs";
import { saveStudioMode } from "../server/mode.mjs";
const fixture = (id = "wan-3-0-reference-to-video", mode = "flat") => {
  const p = upgradeProject(newProject("Optimizer"));
  const d = p.drafts[0];
  d.settings.model = id;
  d.settings.audio = true;
  d.scenes[0].text =
    "@[Mira] lifts the cup while steam rises.\n@[Mira] sets it down.\nNegative: No lettering.";
  d.scenes[0].dialogue = [
    { speaker: "hero", text: "Stay here.", delivery: "Softly" },
  ];
  p.assets = [
    {
      id: "hero",
      kind: "character",
      name: "Mira",
      description: "Blue coat",
      voice: { language: "Arabic" },
    },
  ];
  d.referenceIds = ["hero"];
  const model = {
    id,
    name: id,
    type: mode === "none" ? "text-to-video" : "image-to-video",
    referenceMode: mode,
    supported: true,
    promptLimit: 20000,
    audio: true,
  };
  const input = {
    operation: "optimize-writing",
    draft: d,
    compiled: compilePrompt(p, d, model),
    videoCapabilities: model,
    limit: model.promptLimit,
  };
  return { p, d, model, input };
};

test("profiles resolve exact model/version/workflow, with safe unknown fallback", () => {
  for (const [id, expected] of [
    ["wan-3-0-prime-pro-text-to-video", "wan"],
    ["fal:alibaba/wan-3.0/image-to-video", "wan"],
    ["seedance-2-5-reference-to-video-basic", "seedance"],
    ["kling-o3-standard-reference-to-video", "kling"],
    ["runway-gen4-5", "runway45"],
    ["runway-gen4-turbo", "runway4"],
    ["veo3.1-full-text-to-video", "veo31"],
    ["ltx-2-5-pro-text-to-video", "ltx"],
    ["minimax-h3-max-image-to-video", "minimax-h3"],
    ["grok-imagine-image-to-video-private", "grok"],
  ])
    assert.equal(resolvePromptProfile({ id }).id, expected);
  assert.equal(
    resolvePromptProfile({ id: "runway-new-unverified" }).id,
    "workflow",
  );
  const unknown = resolvePromptProfile({
    id: "unknown",
    type: "image-to-video",
    referenceMode: "flat",
  });
  assert.equal(unknown.mode, "references");
  assert.match(unknown.scope, /unverified/);
  const m = {
    id: "veo3.1-full-image-to-video",
    type: "image-to-video",
    audio: false,
    endFrame: false,
    promptLimit: 1000,
  };
  const guide = optimizerInstructions(resolvePromptProfile(m), m);
  assert.match(guide, /no native generated audio/);
  assert.match(guide, /1000 characters/);
  assert.equal(m.endFrame, false);
});

test("optimizer sends the selected profile and actual locked context, with no fake visual inspection or style selector", () => {
  const { input } = fixture();
  const r = buildOptimizerRequest(input, {
    model: "deepseek-flash",
    outputLimit: 900,
  });
  assert.equal(r.max_tokens, 900);
  assert.equal(r.thinking.type, "disabled");
  assert.match(r.messages[0].content, /wan@2026-10-23.1/);
  assert.match(r.messages[0].content, /same concurrent actions/);
  assert.doesNotMatch(
    r.messages[0].content,
    /Editing style:|Faithful:|Cinematic:|Concise:/,
  );
  const payload = JSON.parse(r.messages[1].content);
  assert.equal(payload.scenes[0].dialogue[0].text, "Stay here.");
  assert.equal(payload.references[0].id, "hero");
  assert.equal(payload.scenes[0].text, input.draft.scenes[0].text);
  assert.ok(payload.lockedSections.some((s) => s.label === "Scene controls"));
  assert.ok(!("library" in payload));
});

test("optimization transport uses that exact request; output preserves locked fields and repairs mentions/timing and rejects changed negatives", async () => {
  const { input } = fixture();
  const config = {
    mode: "deepseek",
    provider: "deepseek",
    model: "deepseek-flash",
    guide: "",
  };
  let sent;
  const transport = (text) => async (_, options) => {
    sent = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        model: "mock-result",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                scenes: [{ id: input.draft.scenes[0].id, text }],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 40 },
      }),
    };
  };
  const text = input.draft.scenes[0].text.replace(
    "lifts the cup",
    "slowly lifts the cup",
  );
  const r = await requestSmart(input, config, "mock-key", transport(text));
  assert.deepEqual(sent, buildOptimizerRequest(input, config));
  assert.equal(r.proposal.kind, "writing-variation");
  assert.equal(r.proposal.scenes[0].text, text);
  const repaired = await requestSmart(input, config, "mock-key",
    transport(text.replace("@[Mira]", "@[Other]")));
  assert.equal(repaired.proposal.scenes[0].text, input.draft.scenes[0].text);
  assert.ok(repaired.proposal.changes.some(c => c.includes("asset mention")));
  const structured = await requestSmart(input, config, "mock-key",
    transport(text.replace("\n@[Mira]", " @[Mira]")));
  assert.equal(structured.proposal.scenes[0].text, input.draft.scenes[0].text);
  await assert.rejects(
    () =>
      requestSmart(
        input,
        config,
        "mock-key",
        transport(text.replace("No lettering.", "No blur.")),
      ),
    /Negative/,
  );
});

test("estimates count complete serialized context, price unknown models honestly, and Test blocks transport", async () => {
  const { input } = fixture();
  const config = {
    mode: "deepseek",
    model: "deepseek-flash",
    outputLimit: 700,
  };
  const e = optimizerEstimate(
    input,
    config,
    Date.parse("2026-10-23T10:00:00Z"),
  );
  assert.equal(e.outputBudget, 700);
  assert.equal(e.outputTokens.max, 700);
  assert.ok(e.cost.max > e.cost.min);
  assert.equal(
    optimizerEstimate(input, { ...config, model: "unpriced" }).cost,
    null,
  );
  const multilingual = structuredClone(input);
  multilingual.draft.scenes[0].text += "مرحبا".repeat(100);
  assert.ok(
    optimizerEstimate(multilingual, config).inputTokens.max > e.inputTokens.max,
  );
  const testEstimate = optimizerEstimate(input, { ...config, mode: "demo" });
  assert.equal(testEstimate.cost.max, 0);
  const r = await requestSmart(input, { ...config, mode: "demo" }, "", () => {
    throw Error("Network forbidden");
  });
  assert.equal(r.usage, null);
});

test("optimization result is idempotent and can retain newer active edits without losing the new variation", () => {
  const { p, d, input } = fixture();
  input.optimization = resolvePromptProfile(input.videoCapabilities);
  const job = {
    id: "optimization-one",
    draftId: d.id,
    state: "ready",
    input,
    result: {
      kind: "writing-variation",
      model: "text-model",
      scenes: [
        {
          id: d.scenes[0].id,
          text: d.scenes[0].text.replace("lifts", "gently lifts"),
        },
      ],
    },
  };
  const original = d.scenes[0].text;
  const active = p.activeDraftId;
  const copy = addWritingVariation(p, job, { activate: false });
  assert.equal(p.activeDraftId, active);
  assert.equal(d.scenes[0].text, original);
  assert.equal(copy.name.endsWith("Optimized"), true);
  assert.equal(copy.optimizationReceipt.profile.id, "wan");
  assert.deepEqual(copy.scenes[0].dialogue, d.scenes[0].dialogue);
  assert.equal(addWritingVariation(p, job).id, copy.id);
});

test("isolated API estimates without inference, honors saved text-model overrides, persists results, and rejects overlength", async (t) => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "splece-optimizer-"));
  const store = openStore(path.join(data, "studio.sqlite"));
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  const { p, d, model } = fixture("demo-cinema", "none");
  const saved = { revision: store.save(p, 0) };
  await saveStudioMode(data, "test");
  await fs.writeFile(
    path.join(data, "deepseek-text-models.json"),
    JSON.stringify({
      models: [
        { id: "deepseek-v4-pro", name: "DeepSeek Pro", maxOutputTokens: 500 },
      ],
    }),
  );
  installSmartRoutes(app, {
    store,
    data,
    getProject: (id) => {
      const result = store.get(id);
      if (!result) throw Error("Missing");
      return result;
    },
    video: { models: async () => ({ models: [model] }) },
  });
  app.use((e, _req, res, _next) => res.status(400).json({ error: e.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    store.db.close();
    await fs.rm(data, { recursive: true, force: true });
  });
  const call = async (route, body) => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api${route}`,
      {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    return { status: r.status, value: await r.json() };
  };
  const estimate = await call(`/projects/${p.id}/smart-estimate`, {
    draftId: d.id,
    textModel: "deepseek-v4-pro",
  });
  assert.equal(estimate.status, 200);
  assert.equal(estimate.value.cost.max, 0);
  assert.equal(estimate.value.textModel, "deepseek-v4-pro");
  assert.equal(estimate.value.outputBudget, 500);
  assert.equal(
    store.db.prepare("SELECT count(*) as n FROM smart_jobs").get().n,
    0,
  );
  assert.equal(
    (
      await call(`/projects/${p.id}/smart-estimate`, {
        draftId: d.id,
        textModel: "invented",
      })
    ).status,
    400,
  );
  const submit = await call(`/projects/${p.id}/smart-jobs`, {
    draftId: d.id,
    revision: saved.revision,
    requestId: "optimize-one",
    operation: "optimize-writing",
    textModel: "deepseek-v4-pro",
  });
  assert.equal(submit.status, 201);
  let job;
  for (let i = 0; i < 30; i++) {
    job = (
      await call(`/projects/${p.id}/smart-jobs?operation=optimize-writing`)
    ).value.find((j) => j.id === submit.value.id);
    if (["ready", "failed"].includes(job?.state)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(job.state, "ready", job.error);
  assert.equal(job.input.optimization.textModel, "deepseek-v4-pro");
  assert.equal(job.input.projectContext, undefined);
  assert.equal(job.config, undefined);
  assert.equal(
    store.get(p.id).project.drafts[0].scenes[0].text,
    d.scenes[0].text,
  );
  model.promptLimit = 10;
  const second = await call(`/projects/${p.id}/smart-jobs`, {
    draftId: d.id,
    revision: saved.revision,
    requestId: "too-long",
    operation: "optimize-writing",
  });
  for (let i = 0; i < 30; i++) {
    job = (
      await call(`/projects/${p.id}/smart-jobs?operation=optimize-writing`)
    ).value.find((j) => j.id === second.value.id);
    if (job?.state === "failed") break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(job.state, "failed");
  assert.match(job.error, /locked injections exceeds/);
  await saveStudioMode(data, "live");
  const stale = await call(`/projects/${p.id}/smart-jobs`, {
    draftId: d.id,
    revision: saved.revision,
    requestId: "stale-test-estimate",
    operation: "optimize-writing",
    executionMode: "test",
  });
  assert.equal(stale.status, 400);
  assert.match(stale.value.error, /mode changed/);
  assert.equal(
    store.db.prepare("SELECT count(*) as n FROM smart_jobs").get().n,
    2,
  );
});
