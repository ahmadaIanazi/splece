import {
  protectedContent,
  assertProtectedPrompt,
} from "../shared/prompt-protection.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveStudioMode } from "../server/mode.mjs";
import { createDeepSeekSettings, requestSmart } from "../server/smart.mjs";
import { createVideoService } from "../server/video.mjs";
import { requestStory } from "../server/authoring.mjs";
import { newProject, compilePrompt } from "../server/domain.mjs";
import {
  validateStory,
  applyStory,
  storySignature,
  beatDraft,
} from "../shared/authoring.mjs";
import { resolveReferences } from "../shared/studio.mjs";
import { referenceCapabilities } from "../shared/references.mjs";
const noNetwork = () => {
  throw Error("Test must never call the provider");
};
const section = (patch = {}) => ({
  id: "chapter",
  kind: "chapter",
  parentId: "",
  act: "Act 1",
  title: "Arrival",
  start: 0,
  duration: 20,
  end: 20,
  description: "Mira arrives",
  characterIds: [],
  locationId: "",
  dialogue: [],
  camera: "Auto",
  movement: "Auto",
  transition: "Auto",
  ...patch,
});
test("One persisted Test switch overrides saved live text/video modes without losing configuration", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-mode-"));
  try {
    const settings = createDeepSeekSettings(dir);
    await settings.saveKey("fake-key");
    await settings.saveConfig({ mode: "deepseek", model: "deepseek-flash" });
    await fs.writeFile(
      path.join(dir, "video-settings.json"),
      JSON.stringify({ mode: "venice" }),
    );
    await saveStudioMode(dir, "test");
    assert.equal((await settings.config()).mode, "demo");
    assert.equal(
      (
        await createVideoService({
          data: dir,
          store: {},
          fetcher: noNetwork,
          transport: noNetwork,
        }).status()
      ).mode,
      "demo",
    );
    assert.equal(
      (await createDeepSeekSettings(dir).config()).model,
      "deepseek-flash",
    );
    await saveStudioMode(dir, "live");
    assert.equal((await settings.config()).mode, "deepseek");
    assert.equal(
      (await createVideoService({ data: dir, store: {} }).status()).mode,
      "venice",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("Story foundation, scoped hierarchy expansion and cast development work without inference", async () => {
  const p = newProject("Tree");
  const plan = {
    title: "Film",
    brief: "A journey",
    synopsis: "",
    beats: [],
    setup: {
      format: "Short film",
      targetDuration: 60,
      castCount: 2,
      castIds: [],
      heroIds: [],
      concept: "A traveler finds home",
      personalityBrief: "Quiet, observant adults",
      complete: true,
    },
  };
  const input = {
    plan,
    assets: p.assets,
    episodeId: p.episodeId,
    action: "characters",
  };
  const cast = await requestStory(input, { mode: "demo" }, null, noNetwork);
  assert.equal(cast.proposal.characters.length, 2);
  assert.equal(cast.proposal.beats.length, 0);
  p.storyPlans = { [p.episodeId]: plan };
  applyStory(p, cast.proposal, storySignature(p));
  const base = p.storyPlans[p.episodeId];
  const outline = await requestStory(
    { ...input, assets: p.assets, plan: base, action: "outline" },
    { mode: "demo" },
    null,
    noNetwork,
  );
  assert.equal(outline.proposal.beats.length, 3);
  assert.equal(outline.proposal.beats.at(-1).end, 60);
  const chapter = outline.proposal.beats[0];
  const expanded = await requestStory(
    {
      ...input,
      assets: p.assets,
      plan: outline.proposal,
      action: "children",
      expandId: chapter.id,
    },
    { mode: "demo" },
    null,
    noNetwork,
  );
  assert.equal(
    expanded.proposal.beats.filter((b) => b.parentId === chapter.id).length,
    2,
  );
  const scene = expanded.proposal.beats.find((b) => b.parentId === chapter.id);
  const prompts = await requestStory(
    {
      ...input,
      assets: p.assets,
      plan: expanded.proposal,
      action: "children",
      expandId: scene.id,
    },
    { mode: "demo" },
    null,
    noNetwork,
  );
  assert.equal(
    prompts.proposal.beats.filter((b) => b.parentId === scene.id).length,
    2,
  );
  assert.deepEqual(
    prompts.proposal.beats.find((b) => b.id === chapter.id),
    chapter,
  );
});
test("Story JSON rejects invalid parentage and mismatched end times; supports end-only ranges", () => {
  const p = newProject("Validate"),
    plan = {
      title: "Film",
      beats: [
        section(),
        section({
          id: "scene",
          kind: "scene",
          parentId: "chapter",
          duration: 5,
          end: 5,
        }),
      ],
    };
  assert.equal(validateStory(plan, p).beats[1].parentId, "chapter");
  assert.throws(
    () => validateStory({ ...plan, beats: [section({ end: 25 })] }, p),
    /end must equal/,
  );
  assert.doesNotThrow(() =>
    validateStory(
      {
        ...plan,
        beats: [
          section(),
          section({
            id: "bad",
            kind: "scene",
            parentId: "chapter",
            start: 19,
            duration: 5,
            end: 24,
          }),
        ],
      },
      p,
    ),
  );
  assert.throws(
    () =>
      validateStory({ ...plan, beats: [section({ parentId: "chapter" })] }, p),
    /ancestor/,
  );
  const onlyEnd = section();
  delete onlyEnd.duration;
  assert.equal(
    validateStory({ ...plan, beats: [onlyEnd] }, p).beats[0].duration,
    20,
  );
});
test("Default-first multi-view character references and pose-grid roles survive prompt compilation", () => {
  const p = newProject("Views"),
    d = p.drafts[0],
    a = {
      id: "hero",
      kind: "character",
      name: "Mira",
      description: "Traveler",
      media: { id: "front" },
      mediaList: [{ id: "grid" }, { id: "front" }, { id: "side" }],
      contactSheets: ["grid"],
      variants: [],
    };
  p.assets = [a];
  d.referenceIds = ["hero"];
  const model = {
    id: "wan-3-0-reference-to-video",
    ...referenceCapabilities("wan-3-0-reference-to-video", "image-to-video"),
  };
  const compiled = compilePrompt(p, d, model);
  assert.deepEqual(
    compiled.bindings.map((b) => b.media[0].id),
    ["front", "grid", "side"],
  );
  assert.match(
    compiled.text,
    /@Image2 controls Mira only.*multiple views of the same character/,
  );
  a.variants = [
    {
      id: "coat",
      name: "Coat",
      description: "Winter",
      media: { id: "winter" },
      mediaList: [],
    },
  ];
  d.referenceOptions = { hero: { variantId: "coat" } };
  assert.deepEqual(
    resolveReferences(p, d)[0].selectedMediaList.map((m) => m.id),
    ["winter"],
  );
});
test("Only speaking characters inject saved voice profiles and silent requests omit them", () => {
  const p = newProject("Voices"),
    d = p.drafts[0];
  p.assets = [
    {
      id: "hero",
      kind: "character",
      name: "Mira",
      description: "Traveler",
      voice: { tone: "warm", accent: "Saudi", language: "Arabic" },
    },
    {
      id: "other",
      kind: "character",
      name: "Other",
      description: "Observer",
      voice: { tone: "raspy" },
    },
  ];
  d.referenceIds = ["hero", "other"];
  d.scenes[0].dialogue = [
    { speaker: "hero", text: "Hello", delivery: "Softly" },
  ];
  d.settings.audio = true;
  const compiled = compilePrompt(p, d, { audio: true });
  assert.match(compiled.text, /accent: Saudi/);
  assert.doesNotMatch(compiled.text, /raspy/);
  d.settings.audio = false;
  assert.doesNotMatch(
    compilePrompt(p, d, { audio: true }).text,
    /voice identity/,
  );
});

test("Smart review rejects changes to a saved speaker voice", () => {
  const p = newProject("Voice protection"),
    d = p.drafts[0];
  const original =
    "Mira — voice identity: accent: Saudi; tone: warm. Keep this delivery consistent across this character's lines.";
  const protection = protectedContent(d, original);
  assert.doesNotThrow(() => assertProtectedPrompt(original, protection));
  assert.throws(
    () => assertProtectedPrompt("Mira speaks in a different voice", protection),
    /saved character voice/,
  );
});
