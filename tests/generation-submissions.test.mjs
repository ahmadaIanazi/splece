import test from "node:test";
import assert from "node:assert/strict";
import {
  createSubmissionJournal,
  submitGenerationIntents,
} from "../shared/generation-submissions.mjs";

const key = "frame-submissions-project";
const intent = (requestId) => ({
  requestId,
  draftId: "clip-to-regenerate",
  revision: 7,
  mode: "venice",
  quoteId: "1080p-quote",
  batchId: "batch",
});
function storageFixture() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
const quotaError = () => {
  throw new DOMException("Storage full", "QuotaExceededError");
};

test("Full browser storage does not block regeneration or change submission settings", async () => {
  const storage = storageFixture();
  storage.values.set("frame-undo-project", "existing undo history");
  storage.values.set("frame-journal-other", "unsaved work");
  storage.setItem = quotaError;
  const journal = createSubmissionJournal(() => storage);
  const requests = [intent("first"), intent("second")];
  const submitted = [],
    accepted = [];
  const result = await submitGenerationIntents({
    projectId: "project",
    intents: requests,
    journal,
    submit: async (request) => {
      submitted.push(structuredClone(request));
      return { id: request.requestId, state: "queued" };
    },
    onAccepted: (job) => accepted.push(job),
  });
  assert.deepEqual(submitted, requests);
  assert.deepEqual(
    accepted.map((job) => job.id),
    ["first", "second"],
  );
  assert.equal(result.browserBackup, false);
  assert.deepEqual(journal.read("project"), []);
  assert.equal(storage.values.has(key), false);
  assert.equal(
    storage.values.get("frame-undo-project"),
    "existing undo history",
  );
  assert.equal(storage.values.get("frame-journal-other"), "unsaved work");
});

test("A backup failure after server acceptance does not hide jobs or stop a batch", async () => {
  const storage = storageFixture();
  const journal = createSubmissionJournal(() => storage);
  const accepted = [];
  const result = await submitGenerationIntents({
    projectId: "project",
    intents: [intent("first"), intent("second")],
    journal,
    submit: async (request) => {
      storage.setItem = quotaError;
      storage.removeItem = quotaError;
      return { id: request.requestId };
    },
    onAccepted: (job) => accepted.push(job.id),
  });
  assert.deepEqual(accepted, ["first", "second"]);
  assert.equal(result.browserBackup, false);
  assert.deepEqual(journal.read("project"), []);
  // When storage is usable again, replace stale entries with the current state.
  storage.removeItem = (key) => storage.values.delete(key);
  assert.equal(journal.write("project", journal.read("project")), true);
  assert.equal(storage.values.has(key), false);
});

test("Unavailable storage still allows submission and in-session recovery", async () => {
  const journal = createSubmissionJournal(() => {
    throw new DOMException("Storage blocked", "SecurityError");
  });
  const accepted = [];
  const result = await submitGenerationIntents({
    projectId: "project",
    intents: [intent("first")],
    journal,
    submit: async () => ({ id: "job" }),
    onAccepted: (job) => accepted.push(job.id),
  });
  assert.deepEqual(accepted, ["job"]);
  assert.equal(result.browserBackup, false);
  assert.deepEqual(journal.read("project"), []);
});

test("A lost server response is surfaced without replaying or claiming acceptance", async () => {
  const storage = storageFixture();
  storage.setItem = quotaError;
  const journal = createSubmissionJournal(() => storage);
  const sent = [],
    accepted = [];
  const failure = new Error("Connection interrupted");
  await assert.rejects(
    submitGenerationIntents({
      projectId: "project",
      intents: [intent("first"), intent("uncertain"), intent("unsent")],
      journal,
      submit: async (request) => {
        sent.push(request.requestId);
        if (request.requestId === "uncertain") throw failure;
        return { id: request.requestId };
      },
      onAccepted: (job) => accepted.push(job.id),
    }),
    (error) => error === failure,
  );
  assert.deepEqual(sent, ["first", "uncertain"]);
  assert.deepEqual(accepted, ["first"]);
  assert.deepEqual(
    journal.read("project").map((item) => item.requestId),
    ["uncertain", "unsent"],
  );
});

test("Healthy storage preserves earlier pending receipts and removes empty journals", async () => {
  const storage = storageFixture();
  storage.values.set(key, JSON.stringify([intent("earlier")]));
  const journal = createSubmissionJournal(() => storage);
  const result = await submitGenerationIntents({
    projectId: "project",
    intents: [intent("new")],
    journal,
    submit: async () => {
      assert.deepEqual(
        JSON.parse(storage.getItem(key)).map((item) => item.requestId),
        ["earlier", "new"],
      );
      return { id: "job" };
    },
    onAccepted: () => {},
  });
  assert.equal(result.browserBackup, true);
  assert.deepEqual(createSubmissionJournal(() => storage).read("project"), [
    intent("earlier"),
  ]);
  journal.write("project", []);
  assert.equal(storage.values.has(key), false);
});

test("Malformed browser journals cannot crash generation recovery", () => {
  const storage = storageFixture();
  const journal = createSubmissionJournal(() => storage);
  for (const invalid of [
    "{broken",
    "null",
    "{}",
    "123",
    '[null, {}, {"requestId": 1}]',
  ]) {
    storage.values.set(key, invalid);
    assert.deepEqual(journal.read("project"), []);
  }
  storage.values.set(key, JSON.stringify([null, intent("valid")]));
  assert.deepEqual(journal.read("project"), [intent("valid")]);
});

test("Memory fallback is isolated by project and returns to persistent storage", () => {
  const storage = storageFixture();
  const setItem = storage.setItem;
  storage.setItem = quotaError;
  const journal = createSubmissionJournal(() => storage);
  assert.equal(journal.write("project", [intent("pending")]), false);
  assert.deepEqual(journal.read("other"), []);
  storage.setItem = setItem;
  assert.equal(journal.write("project", journal.read("project")), true);
  assert.deepEqual(createSubmissionJournal(() => storage).read("project"), [
    intent("pending"),
  ]);
});
