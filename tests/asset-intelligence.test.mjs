import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createAssetIntelligence,
  assetAnalysisCost,
} from "../server/asset-intelligence.mjs";
import {
  variationPresets,
  applyAssetUnderstanding,
  imageBatchInputs,
  replaceAssetDescription,
} from "../shared/asset-intelligence.mjs";
import {
  imageAssetPrompt,
  normalizeImageInput,
  applyGeneratedImage,
} from "../shared/asset-generation.mjs";
import { openStore } from "../server/store.mjs";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { credentials } from "../server/connections.mjs";
import { activeStudioJobs } from "../server/launcher.mjs";
const result = {
  name: "New name",
  description: "A blue coat and short dark hair.",
  keywords: ["blue", "coat"],
  variations: [
    {
      name: "Evening",
      prompt: "Formal evening outfit, keep facial identity.",
      keywords: ["evening"],
    },
  ],
};
async function setup(t, options = {}) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "splece-understand-")),
    store = openStore(path.join(data, "db.sqlite")),
    p = upgradeProject(newProject("Asset Test"));
  store.save(p, 0);
  const original = path.join(data, "image.jpg");
  await fs.writeFile(original, "test");
  store.putMedia({
    id: "photo",
    kind: "image",
    projectId: p.id,
    original,
    duration: 5,
    path: original,
  });
  const service = createAssetIntelligence({
    store,
    data,
    mode: async () => "test",
    transport: async () => {
      throw Error("Unexpected network");
    },
    ...options,
  });
  t.after(async () => {
    store.db.close();
    await fs.rm(data, { recursive: true, force: true });
  });
  return {
    data,
    store,
    p,
    original,
    service,
    input: {
      assetId: "a",
      mediaId: "photo",
      kind: "character",
      name: "Mira",
      description: "",
    },
  };
}
test("Understanding fills blanks only and keeps voice/personality/manual tags", () => {
  const a = {
    id: "a",
    name: "Mira",
    description: "My prose",
    voice: { id: "voice" },
    personality: "Quiet",
    libraryTags: ["mine"],
  };
  const next = applyAssetUnderstanding(a, result);
  assert.equal(next.name, "Mira");
  assert.equal(next.description, "My prose");
  assert.deepEqual(next.voice, a.voice);
  assert.equal(next.personality, "Quiet");
  assert.deepEqual(next.libraryTags, ["mine", "blue", "coat"]);
  assert.deepEqual(a.libraryTags, ["mine"]);
  assert.equal(
    applyAssetUnderstanding({ id: "a" }, result).description,
    result.description,
  );
});
test("Four quick variants use distinct type-aware directions without changing authored text", () => {
  for (const kind of ["character", "location", "prop"]) {
    const inputs = imageBatchInputs({
      kind,
      count: 4,
      description: "Exact authored words",
    });
    assert.equal(new Set(inputs.map((i) => i.variationPrompt)).size, 4);
    assert.ok(inputs.every((i) => i.description === "Exact authored words"));
  }
  assert.throws(
    () => imageBatchInputs({ kind: "character", count: 4, presetIds: ["bad"] }),
    /supported/,
  );
  assert.throws(
    () => imageBatchInputs({ kind: "character", count: 8 }),
    /one or four/,
  );
  const input = normalizeImageInput({
    ...imageBatchInputs({
      kind: "character",
      assetId: "a",
      count: 4,
      mode: "vary",
      modelId: "venice-firered",
      sourceMediaId: "photo",
      description: "My prose",
    })[1],
  });
  const built = imageAssetPrompt(input, upgradeProject(newProject("test")));
  assert.match(built.prompt, /same person/);
  assert.match(built.prompt, /Practical work clothing/);
  assert.match(built.prompt, /My prose/);
  const applied = applyGeneratedImage(
    { id: "a" },
    { id: "j", state: "ready", input, media: { id: "m" } },
    { variant: true },
  );
  assert.equal(applied.variants[0].name, "At work");
});
test("Test analysis is honest, cached, no transport, ownership checked", async (t) => {
  const { p, service, store, input } = await setup(t);
  const q = await service.quote(p.id, input);
  assert.equal(q.estimate.amount, 0);
  assert.equal(activeStudioJobs(store.db), 0);
  const j = await service.analyze(p.id, q.id);
  assert.equal(j.state, "ready");
  assert.match(j.result.description, /simulated/);
  assert.equal(j.result.variations.length, 4);
  assert.equal((await service.quote(p.id, input)).id, j.id);
  assert.equal((await service.quote(p.id, input)).cached, true);
  assert.equal(assetAnalysisCost(j).amount, 0);
  await assert.rejects(
    service.quote(p.id, { ...input, mediaId: "foreign" }),
    /this project/,
  );
});
test("Live mocked request uses one low-detail image call, bounded JSON and caches concurrent duplicates", async (t) => {
  let calls = [];
  const { p, service, data, input } = await setup(t, {
    mode: async () => "live",
    render: async (args) => fs.writeFile(args.at(-1), "small-image"),
    transport: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      return Response.json({
        model: "deepseek-flash",
        usage: { prompt_tokens: 800, completion_tokens: 200 },
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(result) },
          },
        ],
      });
    },
  });
  await credentials(data, "deepseek").saveKey("test-key");
  const q = await service.quote(p.id, input),
    other = await service.quote(p.id, input);
  assert.ok(q.estimate.amount > 0);
  await Promise.all([
    service.analyze(p.id, q.id),
    service.analyze(p.id, q.id),
    service.analyze(p.id, other.id),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages[1].content[1].image_url.detail, "low");
  assert.equal(calls[0].max_tokens, 2000);
  assert.equal(calls[0].thinking.type, "disabled");
  const j = service.list(p.id).find((j) => j.state === "ready");
  assert.equal(j.result.name, result.name);
  assert.equal(j.billing.provider, "deepseek");
});
test("Mode/image changes block submission and failed calls are never silently retried", async (t) => {
  let mode = "test";
  const { p, service, original, input } = await setup(t, {
    mode: async () => mode,
  });
  const q = await service.quote(p.id, input);
  mode = "live";
  await assert.rejects(service.analyze(p.id, q.id), /Mode changed/);
  mode = "test";
  await fs.writeFile(original, "changed");
  await assert.rejects(service.analyze(p.id, q.id), /Image changed/);
});
test("Truncated output preserves receipt and surfaces failure without applying or retrying", async (t) => {
  let n = 0;
  const { p, service, data, input } = await setup(t, {
    mode: async () => "live",
    render: async (args) => fs.writeFile(args.at(-1), "small"),
    transport: async () => {
      n++;
      return Response.json({
        usage: { prompt_tokens: 500, completion_tokens: 1000 },
        choices: [{ finish_reason: "length", message: { content: "{}" } }],
      });
    },
  });
  await credentials(data, "deepseek").saveKey("test-key");
  const q = await service.quote(p.id, input),
    j = await service.analyze(p.id, q.id);
  assert.equal(j.state, "failed");
  assert.ok(j.billing);
  await service.analyze(p.id, q.id);
  assert.equal(n, 1);
});
test("Visual briefs use strict text-only tools, keep source prose and store usage", async (t) => {
  let payload;
  const { p, service, data, store } = await setup(t, {
    mode: async () => "live",
    transport: async (url, options) => {
      assert.match(url, /beta\/chat\/completions/);
      payload = JSON.parse(options.body);
      return Response.json({
        usage: { prompt_tokens: 300, completion_tokens: 100 },
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  function: {
                    name: "visual_brief",
                    arguments: JSON.stringify({
                      age: "32",
                      features: "Brown eyes, rounded face",
                      silhouette: "Average height",
                      wardrobe: "Sage abaya and cream hijab",
                    }),
                  },
                },
              ],
            },
          },
        ],
      });
    },
  });
  await credentials(data, "deepseek").saveKey("test-key");
  const before = store.get(p.id).project;
  const j = await service.brief(p.id, {
    assetId: "fictional",
    kind: "character",
    description: "My exact idea",
    visualBrief: {},
    hasReference: false,
  });
  assert.equal(j.state, "ready");
  assert.equal(j.result.age, "32");
  assert.equal(payload.tools[0].function.strict, true);
  assert.ok(payload.messages[1].content.includes("My exact idea"));
  assert.deepEqual(store.get(p.id).project, before);
  assert.ok(j.billing);
  assert.equal(assetAnalysisCost(j).title, "Visual details");
});
test("Visual brief Test mode never calls providers and malformed fields never apply", async (t) => {
  const { p, service } = await setup(t);
  const j = await service.brief(p.id, {
    assetId: "a",
    kind: "prop",
    description: "Brass telescope",
    visualBrief: { materials: "Brass" },
  });
  assert.equal(j.state, "ready");
  assert.equal(j.result.materials, "Brass");
  assert.equal(assetAnalysisCost(j).amount, 0);
  await assert.rejects(
    service.brief(p.id, {
      assetId: "a",
      kind: "character",
      description: "x",
      visualBrief: { age: 42 },
    }),
    /visual detail/,
  );
});

test("Replacing description uses the image details, clears stale visual overrides and preserves voice", () => {
  const asset = {
    id: "a",
    name: "Noora",
    kind: "character",
    description: "Old red coat",
    variant: "Old hat",
    visualBrief: { wardrobe: "Red coat" },
    voice: { preset: "mine" },
    delivery: "Warm",
    media: { id: "photo" },
    variants: [{ id: "v", media: { id: "other" }, description: "Other look" }],
  };
  const next = replaceAssetDescription(
    asset,
    {
      ...result,
      visualBrief: { wardrobe: "Blue coat", features: "Short dark hair" },
    },
    "photo",
  );
  assert.equal(next.description, result.description);
  assert.equal(next.variant, "");
  assert.equal(next.visualBrief.wardrobe, "Blue coat");
  assert.deepEqual(next.voice, asset.voice);
  assert.equal(next.delivery, "Warm");
  assert.equal(next.name, "Noora");
  assert.deepEqual(next.variants, asset.variants);
  assert.equal(asset.description, "Old red coat");
});
test("Updating an alternate uploaded image makes a scoped look without overwriting main identity", () => {
  const asset = {
    id: "a",
    kind: "character",
    description: "Main reference",
    media: { id: "main" },
    mediaList: [{ id: "other", name: "Blue coat" }],
  };
  const next = replaceAssetDescription(asset, result, "other");
  assert.equal(next.description, "Main reference");
  assert.equal(next.variants[0].description, result.description);
  assert.equal(next.variants[0].media.id, "other");
  assert.throws(
    () => replaceAssetDescription(asset, result, "missing"),
    /no longer attached/,
  );
});
