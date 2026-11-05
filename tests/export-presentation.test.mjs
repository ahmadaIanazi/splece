import test from "node:test";
import assert from "node:assert/strict";
import {
  exportFileName,
  exportSummary,
  jobElapsed,
} from "../shared/export-presentation.mjs";
test("export names preserve Arabic and strip paths, controls and duplicate extensions", () => {
  assert.equal(exportFileName("مرحباً بالعالم.mp4"), "مرحباً بالعالم.mp4");
  assert.ok(!exportFileName("../bad\nname\\file").includes("/"));
  assert.equal(exportFileName("..."), "Project.mp4");
});
test("job duration uses processing timestamps, supports serialized dates and subsecond jobs", () => {
  assert.equal(
    jobElapsed({ createdAt: 0, startedAt: 1000, completedAt: 3500 }),
    "3s",
  );
  assert.equal(
    jobElapsed({
      createdAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:00:12Z",
    }),
    "12s",
  );
  assert.equal(
    jobElapsed({ createdAt: 100, completedAt: 200 }),
    "Less than 1s",
  );
});
test("export summary includes element/audio tails and distinguishes muted tracks", () => {
  assert.deepEqual(
    exportSummary({
      episodeId: "a",
      clips: [{ start: 0, duration: 5 }],
      elements: [
        { episodeId: "a", start: 4, duration: 4 },
        { episodeId: "b", start: 99, duration: 99 },
      ],
      audioClips: [
        { start: 0, duration: 10 },
        { start: 0, duration: 2, mute: true },
      ],
    }),
    { duration: 10, clips: 1, audio: 1, muted: 1, elements: 1 },
  );
});
