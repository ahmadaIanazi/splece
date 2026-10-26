import test from "node:test";
import assert from "node:assert/strict";
import { activeDetachedGenerations } from "../shared/job-progress.mjs";
const job = (id, state, targetId, episodeId = "episode") => ({
  id,
  state,
  kind: "generation",
  createdAt: 1,
  snapshot: { targetId, draft: { episodeId } },
});
test("Deleting a clip does not resurrect failed or successful historical attempts", () => {
  const jobs = [
    job("old-failure", "failed", "deleted"),
    job("old-success", "ready", "deleted"),
    job("replacement", "running", "replacement"),
  ];
  const project = { episodeId: "episode", clips: [{ id: "replacement" }] };
  assert.deepEqual(activeDetachedGenerations(jobs, project), []);
  project.clips = [];
  assert.deepEqual(
    activeDetachedGenerations(jobs, project).map((j) => j.id),
    ["replacement"],
  );
  assert.equal(jobs.length, 3); // history retained, no cancellation or resubmission
});
test("Only active detached generation jobs in the current episode appear", () => {
  const jobs = [
    "failed",
    "ready",
    "cancelled",
    "interrupted",
    "submission_uncertain",
    "download_failed",
  ].map((s) => job(s, s, "removed"));
  jobs.push(
    job("saving", "downloading", "removed"),
    job("other", "running", "removed", "other"),
  );
  assert.deepEqual(
    activeDetachedGenerations(jobs, { episodeId: "episode", clips: [] }).map(
      (j) => j.id,
    ),
    ["saving"],
  );
  assert.deepEqual(activeDetachedGenerations(jobs, null), []);
});
