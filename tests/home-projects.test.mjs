import test from "node:test";
import assert from "node:assert/strict";
import {
  homeProjectSummary,
  homeProjectView,
  homeDuration,
} from "../shared/home-projects.mjs";
import { projectLifecycle } from "../server/project-lifecycle.mjs";
import { openStore } from "../server/store.mjs";

function project() {
  return {
    id: "test",
    name: "The edit",
    episodeId: "e",
    settings: { export: { aspect: "9:16" } },
    clips: [
      {
        id: "second",
        episodeId: "e",
        start: 8,
        duration: 4,
        takes: [{ id: "later" }],
        activeTake: "later",
      },
      {
        id: "first",
        episodeId: "e",
        start: 0,
        duration: 3,
        in: 2,
        takes: [
          { id: "old", duration: 100 },
          {
            id: "selected",
            duration: 10,
            url: "https://provider.invalid/private-token",
            path: "/private/file",
          },
        ],
        activeTake: "selected",
      },
      { id: "pending", episodeId: "e", start: 3, duration: 5, takes: [] },
      {
        id: "other",
        episodeId: "elsewhere",
        start: 0,
        duration: 300,
        takes: [{ id: "other-take" }],
        activeTake: "other-take",
      },
    ],
  };
}
test("Home shows the current edit and selected take without changing project data or disclosing provider paths", () => {
  const p = project(),
    before = structuredClone(p),
    summary = homeProjectSummary(p);
  assert.equal(summary.duration, 12);
  assert.equal(summary.aspect, "9:16");
  assert.equal(summary.pending, 1);
  assert.equal(summary.cover.url, "/api/media/selected");
  assert.equal(summary.cover.start, 2);
  assert.equal(summary.cover.duration, 3);
  assert.equal(JSON.stringify(summary).includes("private"), false);
  assert.deepEqual(p, before);
});
test("Home handles blank projects, missing active takes, and invalid timeline numbers honestly", () => {
  const p = project();
  p.clips = [];
  assert.deepEqual(homeProjectSummary(p), {
    duration: 0,
    aspect: "9:16",
    hasFootage: false,
    pending: 0,
    cover: null,
  });
  p.clips = [
    {
      start: 0,
      duration: 7,
      takes: [{ id: "unselected" }],
      activeTake: "missing",
    },
    { start: NaN, duration: 20, takes: [] },
  ];
  const summary = homeProjectSummary(p);
  assert.equal(summary.cover, null);
  assert.equal(summary.pending, 1);
  assert.equal(summary.duration, 7);
  assert.equal(homeDuration(65.2), "1:05");
});
test("Continue never duplicates a grid item; search and hidden views include all matching results", () => {
  const rows = [
    { id: "a", name: "Wave", updated: "2026-10-21" },
    { id: "b", name: "Arc", updated: "2026-10-23" },
    { id: "c", name: "Hidden wave", hidden: true, updated: "2026-10-24" },
  ];
  const before = structuredClone(rows);
  let view = homeProjectView(rows, { currentId: "a" });
  assert.equal(view.resume.id, "a");
  assert.deepEqual(
    view.projects.map((p) => p.id),
    ["b"],
  );
  assert.equal(view.hiddenCount, 1);
  view = homeProjectView(rows, { currentId: "c" });
  assert.equal(view.resume.id, "b");
  view = homeProjectView(rows, { query: "wave" });
  assert.equal(view.resume, null);
  assert.deepEqual(
    view.projects.map((p) => p.id),
    ["a"],
  );
  view = homeProjectView(rows, { hidden: true });
  assert.equal(view.resume, null);
  assert.deepEqual(
    view.projects.map((p) => p.id),
    ["c"],
  );
  assert.deepEqual(rows, before);
});
test("Home summary cache refreshes after edits; listing never writes project revisions", () => {
  const store = openStore(":memory:");
  try {
    const p = project();
    const revision = store.save(p, 0);
    const lifecycle = projectLifecycle(store);
    const before = store.get(p.id);
    assert.equal(lifecycle.list()[0].summary.cover.url, "/api/media/selected");
    assert.deepEqual(store.get(p.id), before);
    p.clips[1].activeTake = "old";
    store.save(p, revision);
    assert.equal(lifecycle.list()[0].summary.cover.url, "/api/media/old");
    lifecycle.hide(p.id, true);
    assert.equal(lifecycle.list()[0].hidden, true);
  } finally {
    store.db.close();
  }
});
