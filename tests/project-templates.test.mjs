import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectTemplates } from "../shared/project-templates.mjs";
import { initializeProjectConcept } from "../shared/project-start.mjs";
import {
  newProject,
  validateProject,
  compilePrompt,
} from "../server/domain.mjs";
import { upgradeProject, timelineIssues } from "../shared/studio.mjs";
import {
  isStructureClip,
  validateStructureNodes,
} from "../shared/structure.mjs";
import { openClipPrompt } from "../shared/clip-prompt.mjs";
import { materializeProjectTemplate } from "../server/project-templates.mjs";
import { createPortableStore } from "../server/portable.mjs";
import { openStore } from "../server/store.mjs";
import { probe, renderEpisode } from "../server/media.mjs";

function base() {
  return upgradeProject(newProject("Template test"));
}
test("Legacy format and blank starts preserve prompting and do not create sample content", () => {
  for (const format of ["blank", "movie", "reel", "music", "podcast"]) {
    const p = base(),
      before = compilePrompt(p, p.drafts[0]).text;
    const settings = structuredClone(p.settings);
    initializeProjectConcept(p, { format, concept: "My exact idea" });
    assert.equal(p.storyPlans[p.episodeId].beats.length, 0);
    assert.equal(p.storyPlans[p.episodeId].creativeDirection, undefined);
    assert.equal(p.clips.length, 0);
    assert.deepEqual(p.settings, settings);
    assert.equal(compilePrompt(p, p.drafts[0]).text, before);
  }
});
test("Every template creates valid editable structure, respects Auto, and keeps supplied concept/references", () => {
  for (const template of projectTemplates) {
    const p = base();
    p.settings.inherit = ["prompting", "exports", "video"];
    p.assets = [{ id: "hero", kind: "character", name: "Someone" }];
    initializeProjectConcept(p, {
      templateId: template.id,
      concept: "My own @[Someone] idea",
      creativeDirection: {},
      aspect: "1:1",
    });
    const plan = p.storyPlans[p.episodeId];
    assert.equal(plan.brief, "My own @[Someone] idea");
    assert.deepEqual(plan.setup.castIds, ["hero"]);
    assert.equal(plan.creativeDirection, undefined);
    assert.equal(plan.beats.filter(isStructureClip).length, 4);
    assert.equal(plan.beats.filter((b) => !isStructureClip(b)).length, 2);
    validateStructureNodes(plan.beats);
    assert.equal(plan.setup.targetDuration, 20);
    assert.equal(p.settings.export.aspect, "1:1");
    assert.deepEqual(p.settings.inherit, ["prompting", "video"]);
    const q = base();
    initializeProjectConcept(q, { templateId: template.id });
    assert.notEqual(plan.beats[0].id, q.storyPlans[q.episodeId].beats[0].id);
    plan.beats[0].title = "Renamed";
    assert.notEqual(template.groups[0], "Renamed");
  }
  assert.throws(
    () => initializeProjectConcept(base(), { templateId: "../../secrets" }),
    /available/,
  );
  assert.throws(
    () => initializeProjectConcept(base(), { aspect: "garbage" }),
    /shape/,
  );
});
test("Templates without sample media create linked empty slots and reopening preserves prompt edits", async () => {
  const p = base();
  initializeProjectConcept(p, { templateId: "product" });
  await materializeProjectTemplate(
    p,
    { templateId: "product", includeSample: false },
    {
      putMedia() {
        throw Error("Unexpected media");
      },
    },
  );
  assert.equal(p.drafts.length, 4);
  assert.equal(p.clips.length, 4);
  assert.ok(p.clips.every((c) => c.takes.length === 0));
  assert.ok(timelineIssues(p.clips).every((issue) => issue.code === "pending"));
  p.drafts[0].scenes[0].text = "My new direction";
  assert.equal(
    openClipPrompt(p, p.clips[0].id, []).scenes[0].text,
    "My new direction",
  );
});
test("Bundled cuts play, export, reopen portably, and have no generation jobs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "splece-templates-"));
  const store = openStore(":memory:");
  try {
    for (const template of projectTemplates) {
      const p = base();
      p.folder = path.join(root, p.id);
      await fs.mkdir(path.join(p.folder, "media"), { recursive: true });
      initializeProjectConcept(p, { templateId: template.id });
      await materializeProjectTemplate(
        p,
        { templateId: template.id, includeSample: true },
        store,
      );
      validateProject(p);
      assert.deepEqual(timelineIssues(p.clips), []);
      assert.equal(store.jobs(p.id).length, 0);
      assert.equal(p.clips.length, 4);
      for (const c of p.clips) {
        const m = store.media(c.activeTake);
        assert.ok(m.path.startsWith(p.folder + path.sep));
        assert.equal((await probe(m.path)).duration, 5);
        assert.equal(openClipPrompt(p, c.id, []).storyBeatId, c.storyBeatId);
      }
      store.save(p, 0);
      const portable = createPortableStore(store);
      await portable.checkpoint(p.id);
      const bundle = JSON.parse(
        await fs.readFile(
          path.join(p.folder, ".frame/project.bundle.json"),
          "utf8",
        ),
      );
      assert.ok(bundle.media.every((m) => !path.isAbsolute(m.path)));
      assert.equal(
        bundle.project.storyPlans[p.episodeId].starterTemplate.id,
        template.id,
      );
      const reopened = await portable.open(p.folder);
      assert.equal(reopened.project.drafts.length, 4);
      assert.equal(reopened.project.clips[0].activeTake, p.clips[0].activeTake);
      if (template.id === "product") {
        await renderEpisode(
          p.clips,
          (c) => store.media(c.activeTake),
          path.join(root, "render"),
          path.join(root, "sample-export.mp4"),
          { aspect: "16:9", resolution: "480p", fps: 24 },
        );
        assert.ok(
          Math.abs(
            (await probe(path.join(root, "sample-export.mp4"))).duration - 20,
          ) <
            1 / 24,
        );
      }
    }
  } finally {
    store.db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
