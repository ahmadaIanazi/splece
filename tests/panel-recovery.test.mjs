import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildStudioInterface } from "../scripts/build-interface.mjs";
import { isInterfaceLoadError } from "../shared/panel-recovery.mjs";

test("interface load failures offer reload; rendering bugs remain retryable", () => {
  for (const message of [
    "Failed to fetch dynamically imported module: http://localhost/assets/old.js",
    "error loading dynamically imported module",
    "Importing a module script failed.",
    "Loading chunk 12 failed.",
    "Unable to preload CSS for /assets/old.css",
  ])
    assert.equal(isInterfaceLoadError(new TypeError(message)), true, message);
  assert.equal(
    isInterfaceLoadError(new Error("Cannot read properties of undefined")),
    false,
  );
  assert.equal(isInterfaceLoadError(null), false);
});

test("command-line builds preserve open-tab chunks and publish HTML only after success", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "panel-build-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "dist/assets"), { recursive: true });
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/entry.js"), "version 1");
  await fs.writeFile(path.join(root, "dist/index.html"), "old index");
  await fs.writeFile(path.join(root, "dist/assets/old.js"), "old lazy module");
  const read = (file) => fs.readFile(path.join(root, "dist", file), "utf8");
  await buildStudioInterface(root, async (outDir) => {
    assert.notEqual(outDir, path.join(root, "dist"));
    assert.equal(await read("index.html"), "old index");
    assert.equal(await read("assets/old.js"), "old lazy module");
    await fs.mkdir(path.join(outDir, "assets"));
    await fs.writeFile(path.join(outDir, "assets/new.js"), "new lazy module");
    await fs.writeFile(path.join(outDir, "index.html"), "new index");
  });
  assert.equal(await read("index.html"), "new index");
  assert.equal(await read("assets/new.js"), "new lazy module");
  assert.equal(await read("assets/old.js"), "old lazy module");
  await fs.writeFile(path.join(root, "src/entry.js"), "version 2");
  await assert.rejects(
    buildStudioInterface(root, async (outDir) => {
      await fs.writeFile(path.join(outDir, "index.html"), "incomplete index");
      throw Error("build failed");
    }),
    /build failed/,
  );
  assert.equal(await read("index.html"), "new index");
  assert.equal(await read("assets/old.js"), "old lazy module");
});
