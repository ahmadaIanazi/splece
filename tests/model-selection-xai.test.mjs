import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compilePrompt, newProject, newDraft } from "../server/domain.mjs";
import {
  compatibleVideoModels,
  selectedVideoModel,
} from "../shared/video-selection.mjs";
import {
  referenceCapabilities,
  referenceBindings,
  referenceErrors,
} from "../shared/references.mjs";
import { validatePreparation, upgradeProject } from "../shared/studio.mjs";
import {
  normalizeVideoCatalog,
  downloadVideo,
  createVideoService,
} from "../server/video.mjs";
import { falModel, falEndpoints } from "../server/adapters/fal.mjs";
import {
  XaiAdapter,
  xaiVideoModels,
  xaiVideoPayload,
} from "../server/adapters/xai.mjs";
import { createProviderRegistry } from "../server/provider-registry.mjs";
import { routingCatalog } from "../server/ai-routing.mjs";
import { imagePayload, createImageService } from "../server/asset-images.mjs";
import { normalizeImageInput } from "../shared/asset-generation.mjs";
import { openStore } from "../server/store.mjs";
import { credentials, writeJSON } from "../server/connections.mjs";
import { saveStudioMode } from "../server/mode.mjs";
const wan = {
  id: "wan-3-0-reference-to-video",
  supported: true,
  ...referenceCapabilities("wan-3-0-reference-to-video", "reference-to-video"),
};
const seedance = {
  id: "seedance-2-0-image-to-video-basic",
  supported: true,
  ...referenceCapabilities(
    "seedance-2-0-image-to-video-basic",
    "image-to-video",
  ),
};
const candidates = [
  seedance,
  wan,
  falModel(falEndpoints[2]),
  ...xaiVideoModels,
];
const ids = (p) => compatibleVideoModels(candidates, p).map((m) => m.id);
function draftWithImage() {
  const p = upgradeProject(newProject("Timeline photo")),
    d = newDraft();
  p.drafts = [d];
  d.start = 5;
  d.scenes[0].text = "The woman waves. مرحباً";
  p.clips = [
    {
      id: "photo",
      start: 0,
      duration: 5,
      activeTake: "photo-take",
      takes: [{ id: "photo-take", kind: "image", duration: 5 }],
    },
  ];
  d.frameOverrides = {
    start: {
      mode: "manual",
      frame: { takeId: "photo-take", time: 0, timelineCapture: true },
    },
  };
  return { p, d };
}
test("timeline image offers Wan Reference regardless of current model, without losing the frame", () => {
  const { p, d } = draftWithImage();
  const fromImage = compilePrompt(p, d, seedance),
    fromWan = compilePrompt(p, d, wan);
  assert.deepEqual(ids(fromImage), ids(fromWan));
  for (const m of [wan, candidates[2], xaiVideoModels[2]])
    assert.ok(ids(fromImage).includes(m.id));
  assert.ok(ids(fromWan).includes(seedance.id));
  assert.equal(fromImage.boundaries.start.takeId, "photo-take");
  assert.equal(
    fromWan.references[0].selectedMedia.frameSource.takeId,
    "photo-take",
  );
  assert.equal(fromWan.boundaries.start, null);
  assert.equal(d.frameOverrides.start.frame.takeId, "photo-take");
});
test("automatic previous image is eligible for Wan and does not depend on the current text model", () => {
  const { p, d } = draftWithImage();
  delete d.frameOverrides;
  const text = compilePrompt(p, d, {
    id: "text",
    referenceMode: "none",
    frames: false,
  });
  assert.ok(ids(text).includes(wan.id));
});
test("exact pinned frames cannot be silently converted or dropped by bypass", () => {
  const { p, d } = draftWithImage();
  d.frameOverrides.start.mode = "pinned";
  const compiled = compilePrompt(p, d, wan);
  assert.ok(!ids(compiled).includes(wan.id));
  assert.equal(compiled.boundaries.start.mode, "pinned");
  assert.match(referenceErrors(compiled, wan).join(" "), /cannot accept/);
  assert.ok(
    validatePreparation(p, d, compiled, wan).errors.some(
      (e) => e.code === "frame",
    ),
  );
});
test("candidate limits count converted frames together with character references", () => {
  const { p, d } = draftWithImage();
  const compiled = compilePrompt(p, d, seedance);
  compiled.modelInputs.references = Array.from({ length: 14 }, (_, i) => ({
    kind: "character",
    selectedMedia: { id: String(i) },
  }));
  assert.ok(!ids(compiled).includes(xaiVideoModels[2].id));
  assert.ok(ids(compiled).includes(wan.id));
});
test("manual model wins over routing/default and incompatibility until automatic choice is restored", () => {
  const settings = { model: wan.id };
  assert.equal(
    selectedVideoModel(candidates, [seedance], settings, seedance.id, wan.id)
      .id,
    wan.id,
  );
  assert.equal(
    selectedVideoModel(candidates, [seedance], settings, seedance.id, null).id,
    seedance.id,
  );
  assert.equal(
    selectedVideoModel(candidates, [seedance], settings, seedance.id, "missing")
      .id,
    seedance.id,
  );
});
test("Venice discovery recognizes reference-to-video type while rejecting unmapped workflows", () => {
  const raw = {
    data: [wan.id, "unknown-reference-to-video"].map((id) => ({
      id,
      model_spec: {
        constraints: {
          model_type: "reference-to-video",
          durations: ["5s"],
          resolutions: ["720p"],
        },
      },
    })),
  };
  const models = normalizeVideoCatalog(raw);
  assert.equal(models[0].supported, true);
  assert.equal(models[1].supported, false);
});
const payload = {
  prompt: "A scene",
  duration: "5s",
  resolution: "720p",
  aspect_ratio: "16:9",
  audio: true,
};
test("Grok payloads preserve typed reference order and distinguish exact frames", () => {
  const refs = xaiVideoPayload(
    {
      ...payload,
      reference_image_urls: [
        "data:image/png;base64,YQ==",
        "data:image/png;base64,Yg==",
      ],
    },
    xaiVideoModels[2],
  );
  assert.deepEqual(
    refs.reference_images.map((x) => x.url),
    ["data:image/png;base64,YQ==", "data:image/png;base64,Yg=="],
  );
  assert.equal(refs.duration, 5);
  assert.equal(refs.generate_audio, true);
  const framed = xaiVideoPayload(
    { ...payload, image_url: "first", end_image_url: "last" },
    xaiVideoModels[1],
  );
  assert.deepEqual(framed.image, { url: "first" });
  assert.deepEqual(framed.last_frame, { url: "last" });
  assert.ok(!("aspect_ratio" in framed));
  assert.throws(
    () =>
      xaiVideoPayload({ ...payload, image_url: "first" }, xaiVideoModels[2]),
    /reference|frame/,
  );
  assert.throws(
    () =>
      xaiVideoPayload(
        { ...payload, reference_image_urls: Array(15).fill("x") },
        xaiVideoModels[2],
      ),
    /14/,
  );
  assert.throws(
    () =>
      xaiVideoPayload(
        { ...payload, resolution: "1080p", image_url: "x", end_image_url: "y" },
        xaiVideoModels[1],
      ),
    /resolution/,
  );
  const bindings = referenceBindings(
    [
      {
        id: "a",
        kind: "character",
        selectedMediaList: [{ id: "a" }, { id: "b" }],
      },
    ],
    xaiVideoModels[2],
  );
  assert.deepEqual(
    bindings.map((b) => b.tag),
    ["<IMAGE_0>", "<IMAGE_1>"],
  );
});
test("Grok submit retains request ID, polls without resubmit and gates Offline", async () => {
  const calls = [];
  let state = "pending";
  const adapter = new XaiAdapter({
    key: "fake",
    allowSubmit: async () => true,
    transport: async (url, options) => {
      calls.push({ url, options });
      return Response.json(
        options.method === "POST"
          ? { request_id: "request-1234" }
          : {
              status: state,
              ...(state === "done"
                ? { video: { url: "https://vidgen.x.ai/test.mp4" } }
                : {}),
            },
      );
    },
  });
  const job = await adapter.submit({
    requestPayload: { model: "grok-imagine-video-1.5" },
  });
  assert.equal(job.providerJobId, "request-1234");
  assert.equal((await adapter.poll(job)).state, "processing");
  state = "done";
  assert.equal((await adapter.poll(job)).state, "completed");
  assert.equal(calls.filter((c) => c.options.method === "POST").length, 1);
  const offline = new XaiAdapter({
    transport: () => {
      throw Error("network leak");
    },
  });
  await assert.rejects(offline.submit({}), /Offline/);
  await assert.rejects(adapter.poll({ providerJobId: "../bad" }), /Invalid/);
  const q = await adapter.quote({
    requestPayload: payload,
    capabilities: xaiVideoModels[2],
  });
  assert.equal(q.quote, 0.84);
});
test("Grok ambiguous acceptance cannot automatically retry; explicit rejection remains rejected", async () => {
  for (const reply of [
    () => {
      throw Error("lost");
    },
    () => new Response("", { status: 503 }),
    () => Response.json({}),
  ]) {
    const a = new XaiAdapter({
      allowSubmit: async () => true,
      transport: async () => reply(),
    });
    await assert.rejects(
      a.submit({ requestPayload: {} }),
      (e) => e.stage === "submission_uncertain",
    );
  }
  const a = new XaiAdapter({
    allowSubmit: async () => true,
    transport: async () => new Response("", { status: 422 }),
  });
  await assert.rejects(
    a.submit({ requestPayload: {} }),
    (e) => e.stage === "submission",
  );
});
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splece-model-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test("Grok verification saves only supported models, preserves a working key on failure, exposes routing", async (t) => {
  const data = await temp(t);
  let fail = false;
  const calls = [];
  const registry = createProviderRegistry({
    data,
    transport: async (url) => {
      calls.push(url);
      return fail
        ? new Response("", { status: 401 })
        : Response.json({
            data: [
              { id: "grok-imagine-video-1.5" },
              { id: "grok-imagine-image-2.0" },
              { id: "unknown" },
            ],
          });
    },
  });
  assert.equal((await registry.discoverXai("fake-good")).testOk, true);
  const catalog = await routingCatalog(data);
  assert.equal(
    catalog.models.video.filter((m) => m.provider === "xai").length,
    3,
  );
  assert.equal(
    catalog.models.image.filter((m) => m.provider === "xai").length,
    2,
  );
  fail = true;
  assert.equal((await registry.discoverXai("fake-bad")).testOk, false);
  assert.equal(await registry.credentials("xai").key(), "fake-good");
  assert.ok((await registry.connections()).find((c) => c.id === "xai").ready);
  assert.ok(calls.every((url) => url === "https://api.x.ai/v1/models"));
  assert.ok(
    !JSON.stringify(await registry.connections()).includes("fake-good"),
  );
});
test("Grok downloads restrict HTTPS hosts and never forward the key or follow redirects", async () => {
  const calls = [];
  await downloadVideo(
    "https://vidgen.x.ai/test.mp4",
    async (url, options) => {
      calls.push(options);
      return new Response("video");
    },
    "xai",
  );
  assert.equal(calls[0].redirect, "error");
  assert.ok(!calls[0].headers);
  for (const url of [
    "https://vidgen.x.ai.evil.com/a",
    "http://vidgen.x.ai/a",
    "https://evil.com/a",
    "https://user:pass@vidgen.x.ai/a",
  ])
    await assert.rejects(
      downloadVideo(
        url,
        () => {
          throw Error("network leak");
        },
        "xai",
      ),
      /Unrecognized/,
    );
});
const imageInput = {
  assetId: "asset",
  kind: "character",
  name: "Noora",
  description: "A teacher in a mauve hijab.",
  mode: "create",
  modelId: "xai-imagine-create",
  ratio: "1:1",
};
test("Grok image create/edit use fixed quality, supported shape and ordered data inputs", () => {
  const input = normalizeImageInput(imageInput);
  const create = imagePayload(input, "Prompt", []);
  assert.equal(create.quality, "low");
  assert.equal(create.response_format, "b64_json");
  assert.equal(create.resolution, "1k");
  const edit = { ...input, mode: "vary", modelId: "xai-imagine-edit" };
  assert.equal(
    imagePayload(edit, "Prompt", ["a"]).image.url,
    "data:image/png;base64,a",
  );
  assert.deepEqual(
    imagePayload(edit, "Prompt", ["a", "b"]).images.map((x) => x.url),
    ["data:image/png;base64,a", "data:image/png;base64,b"],
  );
  assert.throws(() => imagePayload(edit, "Prompt", Array(6).fill("a")), /1–5/);
});
test("Grok image quote includes input charges and Offline image jobs never contact the provider", async (t) => {
  const data = await temp(t),
    store = openStore(path.join(data, "db.sqlite"));
  t.after(() => store.db.close());
  const p = upgradeProject(newProject("Grok images"));
  p.folder = path.join(data, "project");
  store.save(p, 0);
  await credentials(data, "xai").saveKey("fake");
  await writeJSON(path.join(data, "xai-connection.json"), {
    imageModelIds: ["grok-imagine-image-2.0"],
  });
  await saveStudioMode(data, "live");
  const service = createImageService({
    data,
    store,
    transport: () => {
      throw Error("network leak");
    },
  });
  t.after(() => service.stop());
  const q = await service.quote(p.id, imageInput);
  assert.equal(q.price.amount, 0.04);
  await saveStudioMode(data, "test");
  const offline = await service.quote(p.id, imageInput);
  assert.equal(offline.price.amount, 0);
  await assert.rejects(service.submit(p.id, q.id), /Mode or estimate changed/);
  await service.submit(p.id, offline.id);
  for (let i = 0; i < 200; i++) {
    const j = service.list(p.id)[0];
    if (j.state === "ready") {
      assert.equal(j.executionMode, "test");
      return;
    }
    if (j.state === "failed") assert.fail(j.error);
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail("Offline sample timed out");
});

test("Grok mocked image response becomes a real local image asset, without a second submission", async (t) => {
  const data = await temp(t),
    store = openStore(path.join(data, "db.sqlite"));
  t.after(() => store.db.close());
  const p = upgradeProject(newProject("Grok mock image"));
  p.folder = path.join(data, "project");
  store.save(p, 0);
  const { run } = await import("../server/media.mjs");
  const fixture = path.join(data, "sample.png");
  await run([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x64",
    "-frames:v",
    "1",
    fixture,
  ]);
  const encoded = (await fs.readFile(fixture)).toString("base64");
  const calls = [];
  await credentials(data, "xai").saveKey("fake");
  await writeJSON(path.join(data, "xai-connection.json"), {
    imageModelIds: ["grok-imagine-image-2.0"],
  });
  await saveStudioMode(data, "live");
  const service = createImageService({
    data,
    store,
    transport: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return Response.json({ data: [{ b64_json: encoded }] });
    },
  });
  t.after(() => service.stop());
  const q = await service.quote(p.id, imageInput);
  await service.submit(p.id, q.id);
  await service.submit(p.id, q.id);
  for (let i = 0; i < 200; i++) {
    const j = service.list(p.id)[0];
    if (j.state === "ready") {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://api.x.ai/v1/images/generations");
      assert.equal(store.media(j.id).kind, "image");
      assert.ok((await fs.stat(j.media.original)).size > 0);
      const m = xaiVideoModels[2],
        d = newDraft();
      d.settings = {
        model: m.id,
        duration: 5,
        resolution: "480p",
        aspect: "16:9",
        audio: true,
      };
      d.scenes[0].text = "The blue painting begins to move.";
      p.assets = [
        { id: "asset", name: "Blue painting", kind: "style", media: j.media },
      ];
      d.referenceIds = ["asset"];
      d.referenceOptions = { asset: { role: "style" } };
      const snapshot = {
        draft: d,
        compiled: compilePrompt(p, d, m),
        capabilities: m,
      };
      await createVideoService({ data, store }).prepare(snapshot, p);
      assert.equal(snapshot.requestPayload.reference_images.length, 1);
      assert.match(snapshot.requestPayload.prompt, /<IMAGE_0>/);
      assert.match(
        snapshot.requestPayload.reference_images[0].url,
        /^data:image\/png;base64,/,
      );
      return;
    }
    if (j.state === "failed") assert.fail(j.error);
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail("Mock image job timed out");
});
