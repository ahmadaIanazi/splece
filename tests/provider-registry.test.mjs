import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { setTimeout as delay } from "node:timers/promises";
import {
  FalAdapter,
  falModel,
  falEndpoints,
  falPayload,
  falQueueURL,
} from "../server/adapters/fal.mjs";
import {
  createProviderRegistry,
  installConnectionRoutes,
} from "../server/provider-registry.mjs";
import { credentials } from "../server/connections.mjs";
import {
  createVeniceSettings,
  createDeepSeekSettings,
} from "../server/smart.mjs";
import {
  createVideoService,
  videoPayload,
  downloadVideo,
} from "../server/video.mjs";
import { isLiveJob } from "../shared/providers.mjs";
import { saveStudioMode } from "../server/mode.mjs";
import { newProject, compilePrompt, id } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { run } from "../server/media.mjs";
import { openStore } from "../server/store.mjs";
import { startWorker } from "../server/jobs.mjs";
const raw = JSON.parse(
  await fs.readFile(
    new URL("./fixtures/fal-wan3-catalog.json", import.meta.url),
    "utf8",
  ),
);
const models = raw.models.map((m) =>
  falModel(m.endpoint_id, m.metadata, m.openapi),
);
const json = (v) => new Response(JSON.stringify(v));
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splece-provider-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const settings = (m) => ({
  model: m.id,
  resolution: "480p",
  duration: 5,
  aspect: "16:9",
  audio: true,
});

test("Provider credentials reuse legacy files and never appear in connection responses", async (t) => {
  const data = await temp(t),
    registry = createProviderRegistry({ data });
  await createVeniceSettings(data).saveKey("fake-venice");
  await createDeepSeekSettings(data).saveKey("fake-deepseek");
  assert.equal(await registry.credentials("venice").key(), "fake-venice");
  assert.equal(await registry.credentials("deepseek").key(), "fake-deepseek");
  await registry.credentials("fal").saveKey("fake-fal");
  assert.equal(await createDeepSeekSettings(data).key(), "fake-deepseek");
  assert.equal((await registry.connections()).length, 6);
  assert.ok(!JSON.stringify(await registry.connections()).includes("fake-"));
  await assert.rejects(
    registry.credentials("fal").saveKey("Bearer invalid"),
    /Paste/,
  );
  assert.throws(() => credentials(data, "../outside"), /Unknown/);
});

test("fal discovery verifies authentication, persists schema and preserves catalog after failure", async (t) => {
  const data = await temp(t);
  let fail = false,
    calls = [];
  const registry = createProviderRegistry({
    data,
    transport: async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.Authorization, "Key fake-fal");
      if (fail) return new Response("", { status: 401 });
      return json(url.includes("/pricing") ? { prices: [] } : raw);
    },
  });
  await registry.credentials("fal").saveKey("fake-fal");
  assert.equal((await registry.discoverFal()).testOk, true);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("/pricing"));
  const restarted = createProviderRegistry({ data });
  assert.equal((await restarted.catalog("fal")).models.length, 3);
  assert.equal(
    (await restarted.connections()).find((p) => p.id === "fal").verified,
    true,
  );
  fail = true;
  const failure = await registry.discoverFal();
  assert.equal(failure.testOk, false);
  assert.equal(failure.models.length, 3);
  assert.ok(!("keyHash" in failure));
  assert.equal(
    (await registry.connections()).find((p) => p.id === "fal").verified,
    false,
  );
  await registry.credentials("fal").saveKey("replacement");
  assert.equal(
    (await restarted.connections()).find((p) => p.id === "fal").verified,
    false,
  );
});

test("fal capabilities use actual schemas and reject new required inputs rather than guessing", () => {
  for (const model of models) {
    assert.equal(model.supported, true);
    assert.equal(model.promptLimit, 20000);
    assert.deepEqual(model.durationRange, { min: 2, max: 30, step: 1 });
    assert.equal(model.resolutions[0], "480p");
    assert.ok(model.schema);
  }
  const changed = structuredClone(raw.models[0]);
  const input = Object.values(changed.openapi.components.schemas).find(
    (s) => s.properties?.prompt && s.properties?.resolution,
  );
  input.properties.duration.anyOf[0].maximum = 10;
  input.properties.prompt.maxLength = 1200;
  input.properties.resolution.enum = ["720p"];
  let model = falModel(changed.endpoint_id, changed.metadata, changed.openapi);
  assert.deepEqual(model.durations, [5, 10]);
  assert.equal(model.promptLimit, 1200);
  assert.deepEqual(model.resolutions, ["720p"]);
  input.required.push("new_required_control");
  model = falModel(changed.endpoint_id, changed.metadata, changed.openapi);
  assert.equal(model.supported, false);
});

test("fal Test prepares ordered local images and exact frame inputs without any external request", async (t) => {
  const data = await temp(t);
  let calls = 0;
  const p = upgradeProject(newProject("Synthetic references"));
  p.folder = data;
  const d = p.drafts[0];
  d.scenes[0].text = "Mira walks through the garden. No dialogue.";
  const image = path.join(data, "image.png");
  await run([
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=400x400",
    "-frames:v",
    "1",
    image,
  ]);
  p.assets = [
    {
      id: "hero",
      kind: "character",
      name: "Mira",
      description: "Blue coat",
      media: { id: "hero-image" },
    },
    {
      id: "garden",
      kind: "location",
      name: "Garden",
      media: { id: "garden-image" },
    },
  ];
  d.referenceIds = ["hero", "garden"];
  const service = createVideoService({
    data,
    store: { media: (id) => ({ id, projectId: p.id, original: image }) },
    fetcher: async () => {
      calls++;
      throw Error("Network forbidden");
    },
    transport: async () => {
      calls++;
      throw Error("Network forbidden");
    },
  });
  const refs = models.find((m) => m.referenceMode === "flat");
  d.settings = settings(refs);
  const snapshot = {
    draft: d,
    capabilities: refs,
    executionMode: "test",
    compiled: compilePrompt(p, d, refs),
  };
  await service.prepare(snapshot, p);
  assert.match(snapshot.requestPayload.prompt, /Image 1 controls Mira only/);
  assert.match(snapshot.requestPayload.prompt, /Image 2/);
  assert.equal(snapshot.requestPayload.reference_image_urls.length, 2);
  assert.ok(
    snapshot.requestPayload.reference_image_urls.every((s) =>
      s.startsWith("data:image/png;base64,"),
    ),
  );
  assert.equal(snapshot.requestPayload.enable_prompt_expansion, false);
  assert.ok(!("start_image_url" in snapshot.requestPayload));
  assert.equal(isLiveJob({ snapshot }), false);
  const q = await service.quote(d.settings);
  assert.equal(q.amount, 0);
  assert.equal(
    (await service.authorize(d.settings)).provider,
    "Local simulator",
  );
  const frames = models.find((m) => m.frames);
  d.settings = settings(frames);
  d.referenceIds = [];
  snapshot.capabilities = frames;
  snapshot.compiled = compilePrompt(p, d, frames);
  snapshot.compiled.boundaries = {
    start: { file: "image.png" },
    end: { file: "image.png" },
  };
  await service.prepare(snapshot, p);
  assert.ok(snapshot.requestPayload.start_image_url);
  assert.ok(snapshot.requestPayload.end_image_url);
  assert.ok(!("reference_image_urls" in snapshot.requestPayload));
  assert.throws(
    () =>
      falPayload(
        {
          ...videoPayload(d.settings, frames, "x"),
          image_url: "data:x",
          reference_image_urls: ["data:y"],
        },
        frames,
      ),
    /cannot be combined/,
  );
  assert.equal(calls, 0);
  const a = new FalAdapter({
    transport: async () => {
      calls++;
    },
  });
  await assert.rejects(a.submit({ capabilities: refs }), /Offline mode blocks/);
  assert.equal(calls, 0);
});

test("fal estimates carry historical basis; malformed acceptance never causes automatic resubmission", async () => {
  const m = models[0],
    snapshot = {
      capabilities: m,
      requestPayload: falPayload(videoPayload(settings(m), m, "x"), m),
    };
  const a = new FalAdapter({
    allowSubmit: async () => true,
    transport: async (url) =>
      url.includes("/estimate")
        ? json({ total_cost: 0.18, currency: "USD" })
        : json({
            request_id: "request-1234",
            status_url: "https://evil.example/requests/abc",
          }),
  });
  const quote = await a.quote(snapshot);
  assert.equal(quote.basis, "historical");
  assert.match(quote.note, /not a settings-specific/);
  await assert.rejects(
    a.submit(snapshot),
    (e) => e.stage === "submission_uncertain",
  );
  assert.throws(
    () =>
      falQueueURL("https://queue.fal.run.evil.example/a/b/requests/abcdefghi"),
    /Unrecognized/,
  );
  await assert.rejects(
    downloadVideo(
      "https://api.fal.ai/private",
      () => {
        throw Error("Must not fetch");
      },
      "fal",
    ),
    /Unrecognized/,
  );
  let options;
  await downloadVideo(
    "https://v3.fal.media/files/test.mp4",
    async (u, o) => {
      options = o;
      return new Response("video");
    },
    "fal",
  );
  assert.equal(options.headers, undefined);
  assert.equal(options.redirect, "error");
});

test("Onboarding can be skipped or completed and persisted without changing Test mode or using credentials", async (t) => {
  const data = await temp(t);
  await saveStudioMode(data, "test");
  let calls = 0;
  const registry = createProviderRegistry({
      data,
      transport: async () => {
        calls++;
        throw Error("Forbidden");
      },
    }),
    app = express();
  app.use(express.json());
  installConnectionRoutes(app, registry, data);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, body) => {
    const r = await fetch(
      base + url,
      body
        ? {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {},
    );
    return r.json();
  };
  assert.equal((await request("/api/connections")).onboarding.completed, false);
  await request("/api/onboarding", { skipped: true });
  assert.equal((await request("/api/connections")).onboarding.skipped, true);
  await request("/api/onboarding", { skipped: false });
  assert.equal((await request("/api/connections")).onboarding.completed, true);
  assert.equal(calls, 0);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(data, "studio-mode.json"), "utf8"))
      .mode,
    "test",
  );
});

test("fal accepted jobs resume after worker restart using their saved URLs, never submit twice", async (t) => {
  const data = await temp(t),
    store = openStore(path.join(data, "studio.sqlite"));
  let worker;
  let submits = 0;
  let polls = 0;
  t.after(() => {
    worker?.stop();
    store.db.close();
  });
  const fixture = path.join(data, "fixture.mp4");
  await run([
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=24",
    "-t",
    "5",
    "-c:v",
    "libx264",
    fixture,
  ]);
  const bytes = await fs.readFile(fixture);
  const p = newProject("Mock fal");
  p.folder = path.join(data, "project");
  store.save(p, 0);
  const model = models[0];
  const j = {
    id: id(),
    projectId: p.id,
    kind: "generation",
    state: "queued",
    createdAt: Date.now(),
    snapshot: {
      provider: "fal.ai",
      providerId: "fal",
      executionMode: "live",
      capabilities: model,
      draft: { settings: settings(model) },
      requestPayload: falPayload(
        videoPayload(settings(model), model, "x"),
        model,
      ),
      price: { amount: 0.18, unit: "USD" },
    },
  };
  store.putJob(j);
  const url = "https://queue.fal.run/alibaba/wan-3.0/requests/request-1234";
  const adapter = new FalAdapter({
    allowSubmit: async () => true,
    transport: async (u, o) => {
      if (o.method === "POST") {
        submits++;
        return json({
          request_id: "request-1234",
          status_url: url + "/status",
          response_url: url,
        });
      }
      if (u.endsWith("/status")) {
        polls++;
        return json({ status: "COMPLETED" });
      }
      assert.equal(u, url);
      return json({
        video: { url: "https://v3.fal.media/files/test.mp4" },
        actual_prompt: "x",
      });
    },
  });
  const args = {
    store,
    data,
    checkpoint: async () => {},
    video: {
      adapter: async (provider) => {
        assert.equal(provider, "fal");
        return adapter;
      },
      status: async () => ({ mode: "venice" }),
    },
    download: async (url, unused, provider) => {
      assert.equal(provider, "fal");
      return new Response(bytes, { headers: { "content-type": "video/mp4" } });
    },
  };
  async function until(predicate) {
    for (let n = 0; n < 100; n++) {
      const v = store.job(j.id);
      if (predicate(v)) return v;
      await delay(60);
    }
    throw Error("Timed out");
  }
  worker = startWorker(args);
  await until((j) => j.state === "running");
  worker.stop();
  const saved = store.job(j.id);
  assert.equal(saved.providerUrls.status, url + "/status");
  saved.pollAt = 0;
  store.putJob(saved);
  worker = startWorker(args);
  const ready = await until((j) => j.state === "ready");
  assert.equal(submits, 1);
  assert.equal(polls, 1);
  assert.equal(ready.media.name, "fal.ai generation");
  assert.equal(ready.actualPrompt, "x");
  assert.ok((await fs.stat(ready.media.path)).size > 0);
});

test("fal reference role lines survive enhancement and repeated compilation without duplication", async () => {
  const { protectedContent, assertProtectedPrompt } =
    await import("../shared/prompt-protection.mjs");
  const { bindReferencePrompt } = await import("../shared/references.mjs");
  const p = upgradeProject(newProject("Roles")),
    d = p.drafts[0],
    model = models.find((m) => m.referenceMode === "flat");
  p.assets = [
    { id: "hero", kind: "character", name: "Mira", media: { id: "image" } },
  ];
  d.referenceIds = ["hero"];
  d.scenes[0].text = "Mira walks. No dialogue.";
  d.settings = settings(model);
  const compiled = compilePrompt(p, d, model),
    parts = protectedContent(d, compiled.text);
  assert.equal(parts.roles.length, 1);
  assert.match(parts.roles[0], /^Image 1/);
  assert.throws(
    () =>
      assertProtectedPrompt(compiled.text.replace(parts.roles[0], ""), parts),
    /Reference role/,
  );
  assert.equal(bindReferencePrompt(compiled, model).text, compiled.text);
});
