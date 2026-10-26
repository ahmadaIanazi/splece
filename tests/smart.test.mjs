import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVeniceSettings, requestSmart } from "../server/smart.mjs";
import {
  smartSignature,
  applySmartResult,
  normalizeSmartProposal,
  importedAsset,
} from "../shared/smart.mjs";
import { newProject, compilePrompt } from "../server/domain.mjs";
import {
  upgradeProject,
  validatePreparation,
  reuseGeneration,
} from "../shared/studio.mjs";
const fixture = () => {
  const p = upgradeProject(newProject("Smart QA")),
    d = p.drafts[0];
  d.scenes[0].text = "A traveler approaches a winter cabin.";
  p.assets = [
    {
      id: "hero",
      kind: "character",
      name: "Mira",
      description: "Curly hair",
      variants: [
        {
          id: "winter",
          name: "Winter coat",
          description: "Wool coat",
          tags: { clothing: "winter" },
        },
      ],
    },
  ];
  d.referenceIds = ["hero"];
  return {
    p,
    d,
    input: {
      draft: d,
      compiled: compilePrompt(p, d),
      library: p.assets,
      limit: 10000,
    },
  };
};
test("Venice key and mode persist independently of project history; status never reveals key", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frame-key-"));
  try {
    const s = createVeniceSettings(dir);
    await s.saveKey("fake-test-key");
    await s.saveConfig({
      mode: "venice",
      model: "test-model",
      guide: "test guide",
    });
    const reopened = createVeniceSettings(dir);
    assert.equal(await reopened.key(), "fake-test-key");
    const status = await reopened.status();
    assert.equal(status.hasKey, true);
    assert.equal(status.mode, "venice");
    assert.ok(!JSON.stringify(status).includes("fake-test-key"));
    assert.equal(
      (await fs.stat(path.join(dir, "credentials.json"))).mode & 0o777,
      0o600,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("Smart demo is zero-call even with a stored key", async () => {
  const { input } = fixture();
  let calls = 0;
  const r = await requestSmart(input, { mode: "demo" }, "fake", async () => {
    calls++;
    throw Error("network");
  });
  assert.equal(calls, 0);
  assert.equal(r.proposal.prompt, input.compiled.text);
});
test("Venice smart editor sends assembled context and validates structured decisions", async () => {
  const { input } = fixture();
  let sent;
  const r = await requestSmart(
    input,
    {
      mode: "venice",
      model: "venice-uncensored-1-2",
      guide: "Preserve creative intent",
    },
    "fake",
    async (url, options) => {
      assert.ok(url.endsWith("/chat/completions"));
      sent = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          id: "response",
          model: "test",
          usage: { total_tokens: 90 },
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  prompt:
                    "Mira wears a wool coat and approaches the cabin.\n" +
                    input.compiled.sceneControls.join("\n"),
                  decisions: [
                    {
                      assetId: "hero",
                      variantId: "winter",
                      details: "Curly hair; wool coat",
                      reason: "Winter setting",
                    },
                  ],
                  changes: ["Concrete wardrobe"],
                  warnings: [],
                }),
              },
            },
          ],
        }),
      );
    },
  );
  assert.equal(sent.model, "venice-uncensored-1-2");
  assert.ok(sent.messages[1].content.includes("winter"));
  assert.equal(r.proposal.decisions[0].variantId, "winter");
  assert.equal(r.usage.total_tokens, 90);
  assert.ok(!JSON.stringify(r).includes("fake"));
});
test("Unknown asset IDs, omitted references and changed dialogue are rejected", () => {
  const { input } = fixture();
  assert.throws(
    () =>
      normalizeSmartProposal(
        {
          prompt: "Shot\n" + input.compiled.sceneControls.join("\n"),
          decisions: [],
        },
        input,
      ),
    /omitted/,
  );
  assert.throws(
    () =>
      normalizeSmartProposal(
        {
          prompt: "Shot\n" + input.compiled.sceneControls.join("\n"),
          decisions: [{ assetId: "invented", details: "x", reason: "x" }],
        },
        input,
      ),
    /unknown/,
  );
  input.draft.scenes[0].dialogue = [
    { speaker: "hero", text: "Do not change these words." },
  ];
  assert.throws(
    () =>
      normalizeSmartProposal(
        {
          prompt: "Altered\n" + input.compiled.sceneControls.join("\n"),
          decisions: [{ assetId: "hero", details: "x", reason: "x" }],
        },
        input,
      ),
    /dialogue/,
  );
});
test("Applying smart output preserves source writing, injects chosen variant and detects stale edits", () => {
  const { p, d } = fixture();
  const original = d.scenes[0].text;
  const result = {
    prompt: "Mira in a wool coat.",
    sourceSignature: smartSignature(p, d),
    decisions: [
      {
        assetId: "hero",
        variantId: "winter",
        details: "Coat",
        reason: "Winter",
      },
    ],
  };
  applySmartResult(p, d, result);
  assert.equal(d.scenes[0].text, original);
  assert.ok(compilePrompt(p, d).text.includes(result.prompt));
  assert.match(compilePrompt(p, d).text, /No dialogue/);
  assert.equal(compilePrompt(p, d).references[0].selectedVariant.id, "winter");
  d.scenes[0].text += " More action.";
  assert.equal(compilePrompt(p, d).smartStale, true);
  assert.throws(() => applySmartResult(p, d, result), /changed/);
});
test("Historical smart prompt reuse keeps exact reviewed text", () => {
  const { p, d } = fixture();
  applySmartResult(p, d, {
    prompt: "Exact reviewed prompt.",
    sourceSignature: smartSignature(p, d),
    decisions: [{ assetId: "hero", variantId: "winter" }],
  });
  const snapshot = structuredClone({
    draft: d,
    compiled: compilePrompt(p, d),
    template: p.settings,
  });
  const reused = reuseGeneration(p, snapshot);
  assert.equal(compilePrompt(p, reused).text, snapshot.compiled.text);
  assert.equal(compilePrompt(p, reused).smartStale, false);
});
test("Character uploads retain the selected semantic type instead of becoming footage", () => {
  assert.equal(
    importedAsset({ id: "media", name: "Mira.png" }, "character").kind,
    "character",
  );
  assert.equal(
    importedAsset({ id: "video", name: "scene.mp4" }).kind,
    "footage",
  );
});

test("Review edits are saved separately and do not invalidate the source signature", () => {
  const { p, d } = fixture();
  const signature = smartSignature(p, d);
  d.smartReviews = { job: "My carefully edited proposal" };
  assert.equal(smartSignature(p, d), signature);
  assert.equal(
    JSON.parse(JSON.stringify(d)).smartReviews.job,
    "My carefully edited proposal",
  );
});

test("DeepSeek settings preserve custom instructions and keep Venice credentials independent", async () => {
  const { createDeepSeekSettings } = await import("../server/smart.mjs");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "deepseek-"));
  try {
    const venice = createVeniceSettings(dir);
    await venice.saveKey("fake-video-key");
    await venice.saveConfig({ mode: "venice", guide: "My custom guide" });
    const text = createDeepSeekSettings(dir);
    assert.equal((await text.config()).mode, "demo");
    assert.equal((await text.config()).guide, "My custom guide");
    await text.saveKey("fake-text-key");
    await text.saveConfig({ mode: "deepseek", model: "deepseek-flash" });
    const reopened = createDeepSeekSettings(dir);
    assert.equal(await reopened.key(), "fake-text-key");
    assert.equal((await reopened.status()).mode, "deepseek");
    assert.equal(await venice.key(), "fake-video-key");
    assert.ok(
      !JSON.stringify(await reopened.status()).includes("fake-text-key"),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("DeepSeek enhancement uses native JSON contract, preserves context and never retries paid errors", async () => {
  const { input } = fixture();
  const demo = await requestSmart(input, { mode: "demo" }, null);
  let calls = 0;
  const config = {
    mode: "deepseek",
    provider: "deepseek",
    model: "deepseek-flash",
    guide: "Preserve intent",
  };
  const result = await requestSmart(
    input,
    config,
    "fake-text-key",
    async (url, options) => {
      calls++;
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer fake-text-key");
      const body = JSON.parse(options.body);
      assert.equal(body.max_tokens, 6000);
      assert.equal(body.response_format.type, "json_object");
      assert.equal(body.thinking.type, "disabled");
      assert.equal(body.venice_parameters, undefined);
      assert.equal(body.max_completion_tokens, undefined);
      assert.ok(body.messages[1].content.includes("winter"));
      return Response.json({
        model: "deepseek-flash",
        usage: { total_tokens: 50 },
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(demo.proposal) },
          },
        ],
      });
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.usage.total_tokens, 50);
  assert.ok(!JSON.stringify(result).includes("fake-text-key"));
  await assert.rejects(
    requestSmart(input, config, "fake", async () => {
      calls++;
      return new Response("", { status: 429 });
    }),
    /DeepSeek returned 429/,
  );
  assert.equal(calls, 2);
});
test("DeepSeek discovers authenticated text models without inference", async () => {
  const { discoverDeepSeekModels } = await import("../server/smart.mjs");
  const result = await discoverDeepSeekModels("fake", async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/models");
    assert.equal(options.headers.Authorization, "Bearer fake");
    assert.equal(options.body, undefined);
    return Response.json({
      data: [
        { id: "deepseek-flash", name: "Flash", output_modalities: ["text"] },
        { id: "image-only", output_modalities: ["image"] },
      ],
    });
  });
  assert.deepEqual(
    result.models.map((m) => m.id),
    ["deepseek-flash"],
  );
  await assert.rejects(discoverDeepSeekModels(null), /Save your DeepSeek/);
});

test("Wan opening frame stays Image1 through smart preparation, acceptance and submission compilation", async () => {
  const { p, d, input } = fixture();
  const model = {
    id: "wan-3-0-reference-to-video",
    name: "Wan 3.0 Reference",
    referenceMode: "flat",
    frames: false,
    continuityAsReference: true,
    maxReferences: 10,
    promptLimit: 20000,
  };
  p.assets[0].media = { id: "portrait", kind: "image" };
  d.settings.model = model.id;
  d.frameOverrides = {
    start: {
      mode: "manual",
      frame: { takeId: "prior", time: 4, timelineCapture: true },
    },
    end: { mode: "none" },
  };
  d.automation.frames = true;
  input.videoCapabilities = model;
  input.compiled = compilePrompt(p, d, model);
  assert.equal(input.compiled.references[0].boundaryKey, "start");
  assert.match(input.compiled.text, /^@Image1[^\n]+OPENING FRAME TARGET/);
  const result = await requestSmart(input, { mode: "demo" }, null, () => {
    throw Error("No paid calls allowed");
  });
  assert.deepEqual(
    result.proposal.decisions.map((d) => d.assetId),
    ["hero"],
  );
  assert.deepEqual(
    result.proposal.referenceOrder,
    input.compiled.references.map((r) => r.id),
  );
  applySmartResult(p, d, {
    ...result.proposal,
    originalPrompt: input.compiled.text,
    sourceSignature: smartSignature(p, d),
  });
  const accepted = compilePrompt(p, d, model);
  assert.equal(accepted.references[0].boundaryKey, "start");
  assert.equal(accepted.bindings[1].name, "Mira");
  assert.match(accepted.text, /^@Image1[^\n]+OPENING FRAME TARGET/);
  assert.match(accepted.text, /@Image2 controls Mira/);
});

test("Writing-only enhancement requires no character decisions and keeps references pinned", () => {
  const { input } = fixture();
  input.operation = "writing";
  const result = normalizeSmartProposal(
    { prompt: input.compiled.text, decisions: [{ assetId: "hallucinated" }] },
    input,
  );
  assert.deepEqual(
    result.decisions.map((d) => d.assetId),
    ["hero"],
  );
  input.draft.referenceIds = [];
  input.library = [];
  input.compiled.references = [];
  assert.deepEqual(
    normalizeSmartProposal({ prompt: input.compiled.text }, input).decisions,
    [],
  );
});

test("Identical repeated asset choices are reconciled, conflicting appearances remain review errors", () => {
  const { input } = fixture();
  const decision = {
    assetId: "hero",
    variantId: "winter",
    details: "Wool coat",
    reason: "Winter",
  };
  const value = {
    prompt: input.compiled.text,
    decisions: [decision, { ...decision, assetId: "Mira" }],
  };
  assert.equal(normalizeSmartProposal(value, input).decisions.length, 1);
  value.decisions[1].variantId = null;
  assert.throws(
    () => normalizeSmartProposal(value, input),
    /conflicting appearances/,
  );
});

test("No movement is explicit, protected camera direction", () => {
  const { p, d, input } = fixture();
  d.scenes[0].movement = "No movement";
  d.automation.camera = true;
  input.compiled = compilePrompt(p, d);
  assert.match(input.compiled.text, /Scene 1 camera control: Locked camera/);
  const changed = input.compiled.text
    .split("\n")
    .filter((l) => !l.startsWith("Scene 1 camera control:"))
    .join("\n");
  assert.throws(
    () => normalizeSmartProposal({ prompt: changed }, input),
    /camera/,
  );
});

test("Previously reviewed Wan prompts keep their legacy image numbering", async () => {
  const { bindReferencePrompt } = await import("../shared/references.mjs");
  const { p, d } = fixture();
  p.assets[0].media = { id: "portrait", kind: "image" };
  const model = {
    id: "wan-3-0-reference-to-video",
    referenceMode: "flat",
    continuityAsReference: true,
    frames: false,
  };
  d.frameOverrides = {
    start: {
      mode: "manual",
      frame: { takeId: "prior", time: 2, timelineCapture: true },
    },
    end: { mode: "none" },
  };
  d.automation.frames = true;
  const current = compilePrompt(p, d, model);
  const legacy = bindReferencePrompt(
    {
      references: [current.references[1], current.references[0]],
      text: current.text
        .split("\n")
        .filter((l) => !l.startsWith("@Image"))
        .join("\n"),
    },
    model,
  );
  d.smartAccepted = {
    prompt: legacy.text,
    sourceSignature: smartSignature(p, d),
    decisions: [{ assetId: "hero", variantId: null }],
  };
  const compiled = compilePrompt(p, d, model);
  assert.equal(compiled.references[0].id, "hero");
  assert.match(compiled.text, /^@Image1 controls Mira/);
  assert.match(compiled.text, /@Image2[^\n]+OPENING FRAME TARGET/);
});
