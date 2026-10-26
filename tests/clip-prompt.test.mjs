import test from "node:test";
import assert from "node:assert/strict";
import { openClipPrompt } from "../shared/clip-prompt.mjs";
const setup = () => ({
  p: {
    episodeId: "e",
    activeDraftId: "other",
    assets: [],
    drafts: [
      {
        id: "d",
        targetId: "c",
        closed: true,
        name: "Original",
        notes: "Unsaved creative changes",
      },
    ],
    clips: [
      {
        id: "c",
        start: 5,
        activeTake: "t",
        takes: [
          { id: "t", jobId: "j" },
          { id: "t2", jobId: "j2" },
        ],
      },
    ],
  },
  jobs: [
    {
      id: "j",
      snapshot: {
        draft: { id: "d", notes: "Original prompt", settings: { duration: 5 } },
      },
    },
    {
      id: "j2",
      snapshot: {
        draft: { id: "d", notes: "Second prompt", settings: { duration: 10 } },
      },
    },
  ],
});
test("Click reopens a closed prompt without losing edits or duplicating tabs", () => {
  const { p, jobs } = setup();
  const d = openClipPrompt(p, "c", jobs);
  assert.equal(d.closed, false);
  assert.equal(p.activeDraftId, "d");
  assert.equal(d.notes, "Unsaved creative changes");
  assert.equal(d.start, 5);
  openClipPrompt(p, "c", jobs);
  assert.equal(p.drafts.length, 1);
});
test("Take switching restores the corresponding snapshot and preserves each working tab", () => {
  const { p, jobs } = setup();
  openClipPrompt(p, "c", jobs);
  p.clips[0].activeTake = "t2";
  const second = openClipPrompt(p, "c", jobs, () => "new");
  assert.equal(second.notes, "Second prompt");
  assert.equal(second.settings.duration, 10);
  second.notes = "Edited second";
  second.closed = true;
  p.clips[0].activeTake = "t";
  assert.equal(openClipPrompt(p, "c", jobs).notes, "Unsaved creative changes");
  p.clips[0].activeTake = "t2";
  assert.equal(openClipPrompt(p, "c", jobs).notes, "Edited second");
  assert.equal(p.drafts.length, 2);
  assert.equal(jobs[1].snapshot.draft.notes, "Second prompt");
});
test("Imported footage does not open an unrelated draft; pending clips reopen linked drafts", () => {
  const { p, jobs } = setup();
  p.clips[0].takes = [{ id: "t" }];
  assert.equal(openClipPrompt(p, "c", jobs), null);
  assert.equal(p.activeDraftId, "other");
  p.clips[0].takes = [];
  p.drafts[0].episodeId = "e";
  assert.equal(openClipPrompt(p, "c", jobs).id, "d");
});
