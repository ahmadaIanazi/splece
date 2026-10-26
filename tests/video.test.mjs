import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  normalizeVideoCatalog,
  videoPayload,
  createVideoService,
  downloadVideo,
} from "../server/video.mjs";
import { createVeniceSettings } from "../server/smart.mjs";
import { VeniceAdapter } from "../server/providers.mjs";
import { openStore } from "../server/store.mjs";
import { newProject, id } from "../server/domain.mjs";
import { startWorker } from "../server/jobs.mjs";
import { run } from "../server/media.mjs";
const raw = JSON.parse(
  await fs.readFile(
    new URL("./fixtures/venice-video-catalog.json", import.meta.url),
    "utf8",
  ),
);
const catalog = normalizeVideoCatalog(raw, 123);
const model = catalog.find((m) => m.id === "wan-2.5-preview-text-to-video");
const settings = {
  model: model.id,
  duration: 5,
  resolution: "480p",
  aspect: "16:9",
};
test("Venice native discovery preserves constraints, sorts lowest settings, omits unsupported request fields", () => {
  assert.equal(catalog.length, 137);
  assert.equal(model.resolutions[0], "480p");
  assert.equal(model.promptLimit, 2500);
  const image = catalog.find((m) => m.id === "kling-2.6-pro-image-to-video");
  const payload = videoPayload(
    { ...settings, model: image.id, audio: false },
    image,
    "Original",
  );
  assert.equal(payload.prompt, "Original");
  assert.equal(payload.audio, false);
  assert.ok(!("aspect_ratio" in payload));
  assert.ok(!("resolution" in payload));
  assert.ok(!("audio" in videoPayload(settings, model)));
  assert.ok(catalog.some((m) => !m.supported));
  assert.throws(
    () => videoPayload({ ...settings, duration: 999 }, model),
    /duration/,
  );
});
test("Video demo never calls paid endpoints; saved key, quote and live mode survive service restart", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "video-service-"));
  let calls = [];
  try {
    await createVeniceSettings(dir).saveKey("fake-test-key");
    const args = {
      data: dir,
      store: {},
      fetcher: async () => new Response(JSON.stringify(raw)),
      transport: async (url, options) => {
        calls.push(url);
        assert.equal(options.headers.Authorization, "Bearer fake-test-key");
        const body = JSON.parse(options.body);
        assert.ok(!("prompt" in body));
        return new Response(JSON.stringify({ quote: 0.085 }));
      },
    };
    const service = createVideoService(args);
    assert.equal((await service.quote({ model: "demo-cinema" }, 3)).amount, 0);
    assert.equal(calls.length, 0);
    await service.refresh();
    assert.equal(calls.length, 0);
    await service.setMode("venice");
    const q = await service.quote(settings, 3);
    assert.equal(q.total, 0.255);
    assert.equal(calls.length, 1);
    assert.equal((await service.authorize(settings, q.id)).provider, "Venice");
    await assert.rejects(
      service.authorize({ ...settings, duration: 10 }, q.id),
      /Refresh/,
    );
    assert.equal((await createVideoService(args).status()).mode, "venice");
    await assert.rejects(
      createVideoService(args).authorize(settings, q.id),
      /Refresh/,
    );
    await service.setMode("demo");
    assert.equal((await service.status()).mode, "demo");
    assert.ok(
      !JSON.stringify(await service.status()).includes("fake-test-key"),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("Unreadable acceptance is uncertain and downloads never forward credentials or follow redirects", async () => {
  const a = new VeniceAdapter({
    transport: async () => new Response("broken json"),
  });
  await assert.rejects(
    a.submit({ requestPayload: { model: "test" } }),
    (e) => e.stage === "submission_uncertain",
  );
  await assert.rejects(
    downloadVideo("http://127.0.0.1/secret"),
    /Unrecognized/,
  );
  let opts;
  await downloadVideo(
    "https://private-share.venice.ai/v1/share/read/test",
    async (_url, o) => {
      opts = o;
      return new Response("video");
    },
  );
  assert.equal(opts.headers, undefined);
  assert.equal(opts.redirect, "error");
});
async function until(store, jobId, predicate) {
  for (let i = 0; i < 100; i++) {
    const j = store.job(jobId);
    if (predicate(j)) return j;
    await delay(100);
  }
  throw new Error("Job timeout: " + JSON.stringify(store.job(jobId)));
}
test("Live worker mock persists acceptance, resumes after restart, retries transfer only and saves verified MP4", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "video-worker-"));
  const store = openStore(path.join(dir, "studio.sqlite"));
  let worker;
  let submits = 0,
    polls = 0,
    downloads = 0;
  try {
    const fixture = path.join(dir, "fixture.mp4");
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
    const bytes = await fs.readFile(fixture),
      p = newProject("Live mock");
    p.folder = path.join(dir, "project");
    store.save(p, 0);
    const j = {
      id: id(),
      projectId: p.id,
      kind: "generation",
      state: "queued",
      createdAt: Date.now(),
      snapshot: {
        provider: "Venice",
        model: settings.model,
        draft: { settings },
        requestPayload: videoPayload(settings, model, "Test"),
        price: { amount: 0.085, unit: "USD" },
      },
    };
    store.putJob(j);
    const adapter = {
      submit: async () => {
        submits++;
        return {
          providerJobId: "remote-job-123",
          model: settings.model,
          downloadUrl: "https://private-share.venice.ai/v1/share/read/test",
        };
      },
      poll: async () => {
        polls++;
        return { state: "completed" };
      },
    };
    const args = {
      store,
      data: dir,
      checkpoint: async () => {},
      video: {
        adapter: async () => adapter,
        status: async () => ({ mode: "venice" }),
      },
      download: async () => {
        downloads++;
        if (downloads === 1) throw new Error("transfer interrupted");
        return new Response(bytes, {
          headers: { "content-type": "video/mp4" },
        });
      },
    };
    worker = startWorker(args);
    await until(store, j.id, (x) => x.state === "running");
    worker.stop();
    const accepted = store.job(j.id);
    assert.equal(accepted.providerJobId, "remote-job-123");
    assert.ok(accepted.downloadUrl);
    accepted.pollAt = 0;
    store.putJob(accepted);
    worker = startWorker(args);
    await until(store, j.id, (x) => x.state === "download_failed");
    assert.equal(submits, 1);
    const retry = store.job(j.id);
    retry.state = "download_pending";
    store.putJob(retry);
    const ready = await until(store, j.id, (x) => x.state === "ready");
    assert.equal(submits, 1);
    assert.equal(polls, 1);
    assert.equal(downloads, 2);
    assert.equal(ready.actualCharge, null);
    assert.equal(ready.media.name, "Venice generation");
    assert.ok((await fs.stat(ready.media.path)).size > 0);
    worker.stop();
    const uncertain = {
      ...j,
      id: id(),
      state: "submitting",
      providerJobId: null,
    };
    store.putJob(uncertain);
    worker = startWorker(args);
    assert.equal(store.job(uncertain.id).state, "submission_uncertain");
    await delay(350);
    assert.equal(submits, 1);
  } finally {
    worker?.stop();
    store.db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('semantic prop, palette and lighting roles remain valid image references', () => {
  const m=catalog.find(m=>m.maxReferences>0);
  for(const role of ['prop','palette','lighting']) assert.ok(m.referenceRoles.includes(role));
});
