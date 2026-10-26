import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStore } from "../server/store.mjs";
import { startWorker } from "../server/jobs.mjs";
const fixture = (id, state = "ready") => ({
  id,
  projectId: "p",
  state,
  kind: "generation",
  snapshot: {
    draft: { name: "Shot", scenes: [{ text: "A quiet garden" }] },
    compiled: { text: "A quiet garden", references: [{ id: "garden" }] },
    requestPayload: {
      reference_image_urls: ["data:image/jpeg;base64," + "A".repeat(2_000_000)],
    },
  },
});
test("Job polling excludes upload bytes without changing full submission receipts", () => {
  const store = openStore(":memory:");
  try {
    const j = fixture("one");
    store.putJob(j);
    assert.deepEqual(store.job("one"), j);
    const view = store.jobViews("p")[0];
    assert.equal(view.snapshot.requestPayload, undefined);
    assert.equal(view.snapshot.requestPayloadStored, true);
    assert.deepEqual(view.snapshot.compiled, j.snapshot.compiled);
    assert.ok(JSON.stringify(view).length < 1000);
    assert.equal(store.jobViews(undefined, true).length, 0);
    store.putJob({ ...j, state: "running" });
    assert.equal(store.jobViews(undefined, true)[0].state, "running");
    store.putJob({ ...j, state: "ready" });
    assert.equal(store.jobViews(undefined, true).length, 0);
    store.db.prepare("DELETE FROM jobs WHERE id=?").run(j.id);
    assert.equal(store.jobViews().length, 0);
  } finally {
    store.db.close();
  }
});
test("Existing receipts are indexed once on upgrade and remain exact on reopen", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splece-polling-"));
  const file = path.join(dir, "studio.sqlite");
  const original = fixture("legacy");
  try {
    const db = new DatabaseSync(file);
    db.exec(
      "CREATE TABLE jobs(id TEXT PRIMARY KEY,projectId TEXT,body TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO jobs VALUES(?,?,?)").run(
      original.id,
      "p",
      JSON.stringify(original),
    );
    db.close();
    let store = openStore(file);
    assert.deepEqual(store.job(original.id), original);
    assert.equal(store.jobViews("p").length, 1);
    store.db.close();
    store = openStore(file);
    assert.equal(store.jobViews("p").length, 1);
    assert.deepEqual(store.job(original.id), original);
    store.db.close();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("An idle worker never reloads completed full receipts on its timer", async () => {
  const store = openStore(":memory:");
  store.putJob(fixture("finished"));
  const worker = startWorker({
    store,
    data: os.tmpdir(),
    checkpoint: async () => {},
    video: {},
  });
  let fullReads = 0,
    projectReads = 0;
  store.allJobs = () => {
    fullReads++;
    throw Error("Historical scan");
  };
  store.job = () => {
    fullReads++;
    throw Error("Full receipt loaded");
  };
  store.get = () => {
    projectReads++;
    throw Error("Idle project read");
  };
  try {
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(fullReads, 0);
    assert.equal(projectReads, 0);
  } finally {
    worker.stop();
    store.db.close();
  }
});
