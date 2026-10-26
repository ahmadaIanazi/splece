import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { openStore } from "../server/store.mjs";
import { createPreviewCache } from "../server/preview-cache.mjs";
import { createDerivativeCache } from "../server/derivative-cache.mjs";
import {
  MemoryLRU,
  nextPreviewClip,
  planPreviewSlots,
} from "../shared/preview-window.mjs";

async function fixture(t, options = {}) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "splece-proxy-cache-"));
  const store = openStore(path.join(data, "studio.sqlite"));
  let clock = Date.now(),
    renders = 0;
  const render = async (source, out) => {
    renders++;
    await fs.writeFile(out, Buffer.alloc(64, 1));
    return { playback: { version: 2 } };
  };
  const cache = createPreviewCache({
    store,
    data,
    render,
    now: () => clock,
    ...options,
  });
  t.after(async () => {
    cache.stop();
    await cache.prune();
    store.db.close();
    await fs.rm(data, { recursive: true, force: true });
  });
  async function media(id) {
    const file = path.join(data, id + ".mp4");
    await fs.writeFile(file, "original-" + id);
    const m = {
      id,
      projectId: "p",
      kind: "video",
      path: file,
      original: file,
      url: "/api/media/" + id,
    };
    store.putMedia(m);
    return m;
  }
  return {
    data,
    store,
    cache,
    media,
    advance: (n) => (clock += n),
    get renders() {
      return renders;
    },
  };
}
test("preview cache deduplicates, reuses across restart and regenerates missing copies without changing originals", async (t) => {
  const f = await fixture(t),
    m = await f.media("a");
  const results = await Promise.all(
    Array.from({ length: 8 }, () => f.cache.ensure(m)),
  );
  assert.equal(f.renders, 1);
  assert.ok(results.every((r) => r.path === results[0].path));
  assert.equal(await fs.readFile(m.original, "utf8"), "original-a");
  assert.equal(f.store.media(m.id).path, m.original);
  const second = createPreviewCache({
    store: f.store,
    data: f.data,
    render: async () => {
      throw Error("Should reuse");
    },
  });
  assert.equal((await second.status(m)).state, "ready");
  second.stop();
  await fs.rm(results[0].path);
  await f.cache.ensure(m);
  assert.equal(f.renders, 2);
  assert.equal(
    (await f.cache.status({ ...m, kind: "image" })).state,
    "original",
  );
});
test("disk eviction protects active/next media, expires abandoned leases, and only removes disposable copies", async (t) => {
  const f = await fixture(t, { budgetBytes: 64 }),
    a = await f.media("a"),
    b = await f.media("b");
  const ca = await f.cache.ensure(a);
  f.advance(40000);
  await f.cache.pin("viewer", [a]);
  const cb = await f.cache.ensure(b);
  await f.cache.pin("viewer", [a]);
  await f.cache.prune();
  await fs.access(ca.path);
  await fs.access(cb.path); // fresh copy has grace period
  f.advance(15000);
  await f.cache.pin("viewer", [a]);
  f.advance(16000);
  await f.cache.prune();
  await fs.access(ca.path);
  await assert.rejects(fs.access(cb.path));
  assert.equal(await fs.readFile(b.original, "utf8"), "original-b");
  f.advance(40000);
  await f.cache.ensure(b);
  await f.cache.prune();
  await assert.rejects(fs.access(ca.path));
  await fs.access(b.original);
});
test("failed proxy leaves original available and suppresses an immediate failure retry loop", async (t) => {
  let count = 0;
  const f = await fixture(t, {
      render: async () => {
        count++;
        throw Error("decoder unavailable");
      },
    }),
    m = await f.media("a");
  await assert.rejects(f.cache.ensure(m));
  assert.equal((await f.cache.status(m)).state, "failed");
  assert.equal(count, 1);
  assert.equal(await fs.readFile(m.original, "utf8"), "original-a");
});
test("derivative cleanup protects canonical files even if they live inside a cache directory", async (t) => {
  const f = await fixture(t),
    root = path.join(f.data, "audio-cache");
  await fs.mkdir(root);
  let at = Date.now();
  const c = createDerivativeCache({
    store: f.store,
    data: f.data,
    budgetBytes: 1,
    now: () => at,
  });
  t.after(() => c.stop());
  const source = path.join(root, "source.m4a"),
    wave = path.join(root, "wave.json");
  await fs.writeFile(source, "original");
  await fs.writeFile(wave, "rebuild");
  f.store.putMedia({
    id: "protected",
    projectId: "p",
    path: source,
    original: source,
    kind: "audio",
  });
  await c.remember(source);
  await c.remember(wave);
  at += 40000;
  await c.prune();
  assert.equal(await fs.readFile(source, "utf8"), "original");
  await assert.rejects(fs.access(wave));
});
test("preview window preloads only near a cut, reuses the warmed element, and releases offscreen slots", () => {
  const a = {
    clip: { id: "a", start: 0, duration: 5, activeTake: "ma" },
    take: { id: "ma", url: "/a" },
  };
  const b = {
    clip: { id: "b", start: 5, duration: 5, activeTake: "mb" },
    take: { id: "mb", url: "/b" },
  };
  assert.equal(nextPreviewClip([a.clip, b.clip], a.clip, 0, true, true), null);
  assert.equal(
    nextPreviewClip([a.clip, b.clip], a.clip, 3, true, true),
    b.clip,
  );
  assert.equal(nextPreviewClip([a.clip, b.clip], a.clip, 3, false, true), null);
  const warm = planPreviewSlots([null, null], a, b);
  assert.equal(warm.slots[1], b);
  const cut = planPreviewSlots(warm.slots, b, null);
  assert.equal(cut.active, 1);
  assert.equal(cut.slots[0], null);
  assert.deepEqual(planPreviewSlots(cut.slots, null, null).slots, [null, null]);
});
test("UI cache honors byte/count budgets and LRU reads without retaining oversized values", () => {
  const c = new MemoryLRU(2, 10);
  c.set("a", 1, 4);
  c.set("b", 2, 4);
  c.get("a");
  c.set("c", 3, 4);
  assert.equal(c.get("b"), undefined);
  assert.equal(c.bytes, 8);
  c.set("large", 4, 11);
  assert.equal(c.get("large"), undefined);
  c.clear();
  assert.equal(c.bytes, 0);
  assert.equal(c.items.size, 0);
});
