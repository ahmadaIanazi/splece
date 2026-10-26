import test from "node:test";
import assert from "node:assert/strict";
import {
  compatibleVideoModels,
  fitVideoSettings,
  preferredVideoModel,
} from "../shared/video-selection.mjs";
import { applyVoicePreset, voicePresets } from "../shared/voice-presets.mjs";
import { beatDraft } from "../shared/authoring.mjs";
import { newProject, newDraft, compilePrompt } from "../server/domain.mjs";
const models = [
  {
    id: "wan-text-to-video",
    referenceMode: "none",
    maxReferences: 0,
    durations: [5, 10, 15],
    resolutions: ["480p", "720p"],
    aspects: ["16:9"],
    audio: true,
    audioConfigurable: true,
  },
  {
    id: "wan-reference-to-video",
    referenceMode: "flat",
    maxReferences: 30,
    durations: [5, 10, 15],
    resolutions: ["480p", "720p"],
    aspects: ["16:9"],
    audio: true,
    audioConfigurable: true,
  },
  {
    id: "image",
    referenceMode: "single",
    frames: true,
    endFrame: true,
    maxReferences: 1,
  },
  {
    id: "kling",
    referenceMode: "elements",
    frames: true,
    endFrame: true,
    maxReferences: 20,
  },
];
const image = (id) => ({
  id,
  kind: "character",
  selectedMediaList: [{ id: id + "img" }],
});
test("attached character images select reference models without discarding references", () => {
  const input = { references: [image("a"), image("b")], boundaries: {} };
  assert.deepEqual(
    compatibleVideoModels(models, input).map((m) => m.id),
    ["wan-reference-to-video", "kling"],
  );
  assert.equal(
    preferredVideoModel(
      compatibleVideoModels(models, input),
      "wan-text-to-video",
    ).id,
    "wan-reference-to-video",
  );
  assert.equal(input.references.length, 2);
});
test("frames with characters require combined reference and frame support", () => {
  assert.deepEqual(
    compatibleVideoModels(models, {
      references: [image("a")],
      boundaries: { start: {}, end: {} },
    }).map((m) => m.id),
    ["kling"],
  );
  assert.deepEqual(
    compatibleVideoModels(models, { references: [], boundaries: {} }).map(
      (m) => m.id,
    ),
    ["wan-text-to-video"],
  );
});
test("single image, scene counts, element views and unavailable models are enforced", () => {
  assert.ok(
    compatibleVideoModels(models, {
      references: [image("a")],
      boundaries: {},
    }).some((m) => m.id === "image"),
  );
  const tooMany = {
    references: [
      {
        ...image("a"),
        selectedMediaList: Array.from({ length: 5 }, (_, i) => ({ id: i })),
      },
    ],
    boundaries: {},
  };
  assert.deepEqual(
    compatibleVideoModels(models, tooMany).map((m) => m.id),
    ["wan-reference-to-video"],
  );
  assert.deepEqual(
    compatibleVideoModels([{ ...models[0], supported: false }], {}),
    [],
  );
});
test("story duration is transferred and unsupported durations fit nearest provider option", () => {
  const p = newProject("Timing");
  const beat = {
    id: "b",
    kind: "generation",
    title: "Arrival",
    start: 35,
    duration: 15,
    description: "Arrives",
    characterIds: [],
    assetIds: [],
    dialogue: [],
  };
  const d = beatDraft(p, beat, newDraft());
  assert.equal(d.settings.duration, 15);
  assert.equal(d.start, 35);
  assert.equal(fitVideoSettings(d.settings, models[0]).duration, 15);
  assert.equal(
    fitVideoSettings(
      { ...d.settings, duration: 20, resolution: "1080p", audio: true },
      models[0],
    ).duration,
    15,
  );
  assert.equal(
    fitVideoSettings(
      { ...d.settings, resolution: "1080p", audio: true },
      models[0],
    ).resolution,
    "480p",
  );
  assert.equal(
    fitVideoSettings({ ...d.settings, audio: true }, models[0]).audio,
    true,
  );
});
test("voice presets preserve custom language accent pitch and direction for all genders", () => {
  const v = {
    language: "Arabic",
    accent: "Najdi",
    pitch: "Low",
    description: "My exact direction",
  };
  for (const preset of voicePresets) {
    const next = applyVoicePreset(v, preset.id);
    for (const k of Object.keys(v)) assert.equal(next[k], v[k]);
    assert.equal(next.preset, preset.id);
  }
  assert.ok(voicePresets.some((p) => p.id === "moan"));
  assert.ok(voicePresets.some((p) => p.id === "pop"));
  const p = newProject("Voices"),
    d = p.drafts[0];
  p.assets = [
    {
      id: "a",
      kind: "character",
      name: "A",
      gender: "other",
      description: "Performer",
      voice: applyVoicePreset(v, "robot"),
    },
  ];
  d.referenceIds = ["a"];
  d.scenes[0].dialogue = [{ speaker: "a", text: "Hello", delivery: "Auto" }];
  const text = compilePrompt(p, d, { audio: true }).text;
  assert.match(text, /character, other/);
  assert.match(text, /Synthetic metallic/);
  assert.doesNotMatch(text, /preset: robot/);
});

test("favorite reference model selects its text sibling for an empty new draft", () => {
  const eligible = compatibleVideoModels(
    [{ ...models[0], id: "other-text-to-video" }, ...models],
    { references: [], boundaries: {} },
  );
  assert.equal(
    preferredVideoModel(eligible, "demo-cinema", "wan-reference-to-video").id,
    "wan-text-to-video",
  );
});

test("Automatic continuity cannot force reference drafts away from Wan; pinned frames remain requirements", () => {
  const references = [image("character")];
  const auto = {
    references,
    boundaries: { start: { mode: "auto", takeId: "t" } },
  };
  assert.ok(
    compatibleVideoModels(models, auto).some(
      (m) => m.id === "wan-reference-to-video",
    ),
  );
  assert.ok(
    !compatibleVideoModels(models, {
      ...auto,
      boundaries: { start: { mode: "pinned", takeId: "t" } },
    }).some((m) => m.id === "wan-reference-to-video"),
  );
  const p = newProject("Continuity");
  const d = newDraft();
  d.start = 10;
  p.clips = [
    {
      id: "previous",
      start: 0,
      duration: 10,
      in: 0,
      activeTake: "take",
      takes: [{ id: "take" }],
    },
  ];
  const wan = {
    id: "wan-3-0-reference-to-video",
    referenceMode: "flat",
    frames: false,
    promptLimit: 20000,
  };
  const compiled = compilePrompt(p, d, wan);
  assert.equal(compiled.boundaries.start, null);
  assert.deepEqual(compiled.omittedAutomaticFrames, []);
  assert.equal(compiled.continuityReference.takeId, "take");
  assert.equal(compiled.references.at(-1).kind, "continuity");
  assert.match(compiled.text, /previous clip's final visible moment/);
  d.frameOverrides = { start: { mode: "none" } };
  assert.equal(compilePrompt(p, d, wan).continuityReference, undefined);
  d.frameOverrides = {
    start: { mode: "pinned", frame: { takeId: "take", time: 9 } },
  };
  assert.equal(compilePrompt(p, d, wan).boundaries.start.mode, "pinned");
});
