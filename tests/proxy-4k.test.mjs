import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { openStore } from "../server/store.mjs";
import { createPreviewCache } from "../server/preview-cache.mjs";
import { run, probe } from "../server/media.mjs";
const hash = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
test("synthetic 4K landscape and portrait retain audio/timing/aspect with reusable 720p proxies and untouched masters", async (t) => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "splece-4k-"));
  const store = openStore(path.join(data, "studio.sqlite"));
  const cache = createPreviewCache({ store, data });
  t.after(async () => {
    cache.stop();
    await cache.prune();
    store.db.close();
    await fs.rm(data, { recursive: true, force: true });
  });
  for (const [name, size, width, height] of [
    ["landscape", "3840x2160", 1280, 720],
    ["portrait", "2160x3840", 720, 1280],
  ]) {
    const source = path.join(data, name + ".mp4");
    await run([
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${size}:rate=24`,
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=330:sample_rate=48000",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      source,
    ]);
    const originalHash = await hash(source),
      m = { id: name, kind: "video", path: source, original: source };
    const proxy = await cache.ensure(m),
      info = await probe(proxy.path);
    assert.equal(info.width, width);
    assert.equal(info.height, height);
    assert.equal(info.fps, 24);
    assert.equal(info.audio, true);
    assert.ok(Math.abs(info.duration - 2) < 0.1);
    assert.equal(await hash(source), originalHash);
    assert.notEqual(proxy.path, source);
    assert.ok((await fs.stat(proxy.path)).size < (await fs.stat(source)).size);
    const before = (await fs.stat(proxy.path)).mtimeMs;
    assert.equal((await cache.ensure(m)).path, proxy.path);
    assert.equal((await fs.stat(proxy.path)).mtimeMs, before);
    const decoded = await run(["-i", proxy.path, "-an", "-f", "null", "-"]);
    assert.match(decoded, /frame=\s*48/);
  }
});
