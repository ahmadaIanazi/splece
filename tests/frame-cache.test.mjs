import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFrameCache } from "../server/frame-cache.mjs";
test("Concurrent thumbnail requests share an atomic completed image and failed captures retry", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "frame-cache-"));
  const out = path.join(folder, "frame.jpg");
  let release,
    started,
    renders = 0;
  const gate = new Promise((r) => (release = r)),
    begin = new Promise((r) => (started = r));
  const cache = createFrameCache(async (source, partial) => {
    renders++;
    await fs.writeFile(partial, Buffer.from([255, 216]));
    started();
    await gate;
    await fs.appendFile(partial, Buffer.from([10, 20, 255, 217]));
  });
  try {
    const a = cache("source", out, 1);
    await begin;
    const b = cache("source", out, 1);
    assert.equal(a, b);
    await assert.rejects(fs.stat(out), { code: "ENOENT" });
    release();
    await Promise.all([a, b]);
    assert.equal(renders, 1);
    assert.equal((await fs.readFile(out)).length, 6);
    await cache("source", out, 1);
    assert.equal(renders, 1);
    const bad = path.join(folder, "retry.jpg");
    let attempts = 0;
    const retry = createFrameCache(async (s, partial) => {
      attempts++;
      await fs.writeFile(
        partial,
        Buffer.from(
          attempts === 1 ? [255, 216] : [255, 216, 255, 217, 255, 217],
        ),
      );
    });
    await assert.rejects(retry("source", bad, 0), /complete image/);
    await assert.rejects(fs.stat(bad), { code: "ENOENT" });
    await retry("source", bad, 0);
    assert.equal(attempts, 2);
    assert.equal(
      (await fs.readdir(folder)).some((name) => name.includes("partial")),
      false,
    );
  } finally {
    release();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
