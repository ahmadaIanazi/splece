import test from "node:test";
import assert from "node:assert/strict";
import {
  timelineFrameSources,
  captureTimelineFrame,
} from "../shared/timeline-frames.mjs";
import { newProject, newDraft, compilePrompt } from "../server/domain.mjs";
test("Timeline captures use active takes and visible trim, never assets", () => {
  const sources = timelineFrameSources({
    assets: [{ media: { id: "asset" } }],
    clips: [
      {
        id: "c",
        start: 5,
        in: 3,
        duration: 5,
        activeTake: "t",
        takes: [{ id: "t", duration: 20 }, { id: "old" }],
      },
      { id: "pending", duration: 5, takes: [] },
    ],
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].min, 3);
  assert.equal(captureTimelineFrame(sources[0], 0).time, 3);
  assert.equal(captureTimelineFrame(sources[0], 100).time, 8 - 1 / 24);
  assert.equal(captureTimelineFrame(sources[0], 5).takeId, "t");
});
test("Wan captures both boundaries as distinct role-labeled images; dedicated models retain frames", () => {
  const p = newProject("Frames"),
    d = newDraft();
  d.frameOverrides = {
    start: {
      mode: "manual",
      frame: { takeId: "a", time: 2, timelineCapture: true },
    },
    end: {
      mode: "manual",
      frame: { takeId: "b", time: 4, timelineCapture: true },
    },
  };
  const wan = {
    id: "wan-3-0-reference-to-video",
    referenceMode: "flat",
    frames: false,
    promptLimit: 20000,
  };
  const c = compilePrompt(p, d, wan);
  assert.equal(c.boundaries.start, null);
  assert.equal(c.boundaries.end, null);
  assert.equal(c.continuityReference.takeId, "a");
  assert.equal(c.continuityEndReference.takeId, "b");
  assert.deepEqual(
    c.references.map((r) => r.boundaryKey),
    ["start", "end"],
  );
  assert.match(c.text, /@Image1 shows the desired opening state/);
  assert.match(c.text, /@Image2 shows the desired closing state/);
  const dedicated = compilePrompt(p, d, {
    id: "frames",
    frames: true,
    endFrame: true,
  });
  assert.equal(dedicated.boundaries.start.takeId, "a");
  assert.equal(dedicated.boundaries.end.takeId, "b");
  const unsupported = compilePrompt(p, d, { id: "text", frames: false });
  assert.equal(unsupported.boundaries.start.takeId, "a");
  d.frameOverrides.end = { mode: "none" };
  assert.equal(compilePrompt(p, d, wan).continuityEndReference, undefined);
});
