import test from "node:test";
import assert from "node:assert/strict";
import { generationArtwork } from "../shared/generation-artwork.mjs";
import { jobProgress } from "../shared/job-progress.mjs";

test("artwork prioritizes submitted frames and the selected character appearance", () => {
  const job = {
    snapshot: {
      compiled: {
        boundaries: {
          start: { mediaId: "first frame" },
          end: { takeId: "take", time: 2.5 },
        },
        references: [
          {
            name: "Noora",
            kind: "character",
            media: { id: "base" },
            selectedMedia: { id: "selected" },
          },
          { name: "Sound", kind: "audio", media: { id: "audio" } },
        ],
      },
    },
  };
  assert.deepEqual(generationArtwork(job), [
    { src: "/api/media/first%20frame/original", label: "Start frame" },
    { src: "/api/media/take/frame?time=2.5", label: "End frame" },
    { src: "/api/media/selected/original", label: "Noora" },
  ]);
});
test("artwork deduplicates, limits work, and handles missing or unusable images", () => {
  assert.deepEqual(generationArtwork({}), []);
  const references = [
    { kind: "prop", media: { thumbnail: "javascript:bad" } },
    { kind: "character", media: { id: "repeat" } },
    ...Array.from({ length: 8 }, (_, i) => ({
      kind: "location",
      media: { id: i ? `image-${i}` : "repeat" },
    })),
  ];
  const result = generationArtwork({ snapshot: { compiled: { references } } });
  assert.equal(result.length, 5);
  assert.equal(new Set(result.map((x) => x.src)).size, 5);
  assert.ok(result.every((x) => x.src.startsWith("/api/media/")));
});
test("surface progress never fabricates a percentage for waiting, stale, or failed jobs", () => {
  const job = { state: "running", createdAt: 1000, lastPolledAt: 1000 };
  assert.equal(jobProgress(job, 2000).percent, null);
  const timed = {
    ...job,
    timing: { averageMs: 10000, elapsedMs: 5000, observedAt: 1000 },
  };
  assert.equal(jobProgress(timed, 1000).percent, 50);
  assert.equal(jobProgress(timed, 120000).percent, null);
  assert.equal(jobProgress({ ...timed, state: "failed" }, 2000).terminal, true);
  assert.equal(jobProgress({ ...timed, state: "failed" }, 2000).percent, null);
  assert.equal(jobProgress({ ...timed, state: "ready" }, 2000).percent, 100);
});
