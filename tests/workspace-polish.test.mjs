import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { takeWheelGesture, numberNewClips } from "../shared/editor-polish.mjs";
import {
  normalizeWritingVariation,
  addWritingVariation,
} from "../shared/writing-variation.mjs";
import { requestSmart } from "../server/smart.mjs";
import { newProject, compilePrompt } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { initializeProjectConcept } from "../shared/project-start.mjs";
import { projectLifecycle } from "../server/project-lifecycle.mjs";
import { openStore } from "../server/store.mjs";
import {
  resolveProjectDefaults,
  markSettingsOverrides,
} from "../shared/settings-defaults.mjs";

test("Take gestures consume momentum once, accumulate small deltas and reset after a pause", () => {
  let state = null,
    changes = [];
  for (let i = 0; i < 40; i++) {
    const r = takeWheelGesture(state, { clipId: "c", deltaY: 5, at: i * 20 });
    state = r.state;
    if (r.direction) changes.push(r.direction);
  }
  assert.deepEqual(changes, [-1]);
  const next = takeWheelGesture(state, { clipId: "c", deltaY: -50, at: 1200 });
  assert.equal(next.direction, 1);
  assert.equal(
    takeWheelGesture(null, { clipId: "c", deltaY: 10, deltaX: 80, at: 1 })
      .direction,
    0,
  );
});
test("Only newly added untitled clips receive unique sequential names", () => {
  const before = {
      drafts: [
        { id: "a", name: "Untitled clip" },
        { id: "b", name: "Clip #4" },
      ],
    },
    after = structuredClone(before);
  after.drafts.push(
    { id: "c", name: "Untitled clip" },
    { id: "d", name: "New clip 4" },
    { id: "e", name: "Opening" },
  );
  numberNewClips(before, after);
  assert.deepEqual(
    after.drafts.map((d) => d.name),
    ["Untitled clip", "Clip #4", "Clip #5", "Clip #6", "Opening"],
  );
});
function writingInput() {
  const p = upgradeProject(newProject("Writing")),
    d = p.drafts[0];
  d.scenes[0].text =
    '@[Mira] walks slowly. She says "Hello."\nNegative: No extra people.';
  d.scenes[0].dialogue = [{ id: "line", speaker: "mira", text: "Hello." }];
  d.referenceIds = ["mira"];
  d.automation = { background: false };
  d.contextNotes = "Static background";
  return {
    p,
    d,
    input: {
      operation: "canvas-writing",
      style: "faithful",
      draft: structuredClone(d),
      library: [],
      compiled: compilePrompt(p, d),
      limit: 20000,
    },
  };
}
test("Writing enhancement only changes authored prose; mentions, dialogue and negatives are protected", () => {
  const { input } = writingInput(),
    scene = input.draft.scenes[0];
  const proposed = {
    scenes: [
      {
        id: scene.id,
        text: scene.text.replace("walks slowly", "takes a slow step"),
      },
    ],
  };
  assert.equal(
    normalizeWritingVariation(proposed, input).kind,
    "writing-variation",
  );
  assert.throws(
    () =>
      normalizeWritingVariation(
        {
          scenes: [
            {
              ...proposed.scenes[0],
              text: scene.text.replace("@[Mira]", "A stranger"),
            },
          ],
        },
        input,
      ),
    /mention/,
  );
  assert.throws(
    () =>
      normalizeWritingVariation(
        { scenes: [{ id: scene.id, text: "@[Mira] runs away." }] },
        input,
      ),
    /dialogue|Negative/,
  );
  assert.throws(
    () => normalizeWritingVariation({ scenes: [] }, input),
    /incomplete/,
  );
});
test("Completed writing jobs produce one editable variation and never overwrite newer original edits or injections", () => {
  const { p, d, input } = writingInput();
  const result = normalizeWritingVariation(
    {
      scenes: input.draft.scenes.map((s) => ({
        id: s.id,
        text: s.text.replace("walks slowly", "takes a slow step"),
      })),
    },
    input,
  );
  d.scenes[0].text = "New writing during the request";
  d.start = 9;
  const job = { id: "job", draftId: d.id, state: "ready", input, result };
  const variation = addWritingVariation(p, job);
  assert.equal(d.scenes[0].text, "New writing during the request");
  assert.equal(variation.start, 9);
  assert.deepEqual(variation.automation, input.draft.automation);
  assert.deepEqual(variation.referenceIds, input.draft.referenceIds);
  assert.deepEqual(
    variation.scenes[0].dialogue,
    input.draft.scenes[0].dialogue,
  );
  assert.equal(variation.contextNotes, "Static background");
  assert.equal(variation.smartAccepted, undefined);
  assert.equal(addWritingVariation(p, job).id, variation.id);
  assert.equal(p.drafts.length, 2);
});
test("Writing Test mode never calls a provider; live mock sends no automatic injections", async () => {
  const { input } = writingInput();
  let calls = 0;
  const demo = await requestSmart(input, { mode: "demo" }, "fake", () => {
    calls++;
    throw Error("network");
  });
  assert.equal(calls, 0);
  assert.equal(demo.proposal.kind, "writing-variation");
  let sent;
  await requestSmart(
    input,
    { mode: "deepseek", provider: "deepseek", model: "mock" },
    "fake",
    async (_, options) => {
      sent = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  scenes: input.draft.scenes.map(({ id, text }) => ({
                    id,
                    text,
                  })),
                }),
              },
            },
          ],
        }),
      );
    },
  );
  const payload = JSON.parse(sent.messages[1].content);
  assert.equal(payload.compiled, undefined);
  assert.equal(payload.automation, undefined);
  assert.equal(payload.scenes.length, 1);
  assert.match(
    sent.messages[0].content,
    /same authored line happen concurrently/,
  );
  assert.deepEqual(payload.scenes[0].actionLines, [
    input.draft.scenes[0].text.split("\n")[0],
  ]);
});
test("Project formats seed editable groups and preserve concept and adopted cast", () => {
  const p = upgradeProject(newProject("Concept"));
  p.assets = [{ id: "hero", kind: "character" }];
  initializeProjectConcept(p, { format: "music", concept: "Our @[Mira] idea" });
  const plan = p.storyPlans[p.episodeId];
  assert.equal(plan.setup.format, "Music video");
  assert.deepEqual(plan.groupLabels, ["Song section", "Moment"]);
  assert.deepEqual(plan.setup.castIds, ["hero"]);
  assert.equal(plan.brief, "Our @[Mira] idea");
  assert.equal(plan.beats.length, 0);
});
test("Global defaults propagate while project overrides remain explicit", () => {
  const global = {
    audioDefaults: { volume: 0.5, mute: false },
    concurrency: 3,
  };
  const s = {
    inherit: ["audio", "video"],
    audioDefaults: { volume: 1, mute: false },
    concurrency: 1,
  };
  const updated = resolveProjectDefaults(s, global);
  assert.equal(updated.audioDefaults.volume, 0.5);
  const after = structuredClone(updated);
  after.audioDefaults.volume = 0.8;
  markSettingsOverrides(updated, after);
  assert.deepEqual(after.inherit, ["video"]);
  assert.equal(
    resolveProjectDefaults(after, {
      audioDefaults: { volume: 0.2, mute: true },
      concurrency: 2,
    }).audioDefaults.volume,
    0.8,
  );
});
test("Project hide, removal and guarded file deletion keep other projects and shared files safe", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "splece-lifecycle-"));
  const store = openStore(":memory:");
  let syncs = 0;
  const life = projectLifecycle(store, {
    sync: async () => {
      syncs++;
    },
  });
  async function make(name) {
    const p = upgradeProject(newProject(name));
    p.folder = path.join(root, p.id);
    await fs.mkdir(p.folder);
    await fs.writeFile(path.join(p.folder, "project.json"), JSON.stringify(p));
    await fs.writeFile(path.join(p.folder, "media.txt"), "test");
    store.save(p, 0);
    return p;
  }
  try {
    const p = await make("Keep"),
      q = await make("Delete");
    life.hide(p.id, true);
    assert.equal(life.list().find((x) => x.id === p.id).hidden, true);
    life.hide(p.id, false);
    await life.remove(p.id);
    assert.equal(store.get(p.id), null);
    assert.equal(
      await fs.readFile(path.join(p.folder, "media.txt"), "utf8"),
      "test",
    );
    await assert.rejects(
      life.remove(q.id, { files: true, confirmName: "wrong" }),
      /exact project name/,
    );
    store.putJob({ id: "running", projectId: q.id, state: "running" });
    await assert.rejects(
      life.remove(q.id, { files: true, confirmName: q.name }),
      /active jobs/,
    );
    store.putJob({ id: "running", projectId: q.id, state: "failed" });
    await life.remove(q.id, { files: true, confirmName: q.name });
    await assert.rejects(fs.access(q.folder));
    assert.ok(syncs >= 2);
    assert.equal(
      await fs.readFile(path.join(p.folder, "media.txt"), "utf8"),
      "test",
    );
  } finally {
    store.db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
