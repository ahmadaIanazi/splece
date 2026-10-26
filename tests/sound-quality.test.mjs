import test from "node:test";
import assert from "node:assert/strict";
import { saveLocalDraft } from "../shared/local-draft.mjs";
import {
  soundPrompt,
  soundParts,
  soundEstimate,
} from "../shared/soundtrack-ai.mjs";
import { AMBIENCE_MODEL, ambienceInput } from "../shared/sound-design.mjs";
import { mixState, setMixGain, setMixMute } from "../shared/sound-mix.mjs";
import { FalSoundtrackAdapter } from "../server/adapters/fal-soundtrack.mjs";
test("full browser storage cannot throw out of asset editing", () => {
  assert.equal(
    saveLocalDraft(
      {
        setItem() {
          throw Error("QuotaExceededError");
        },
      },
      "asset",
      { name: "Alex" },
    ),
    false,
  );
  assert.equal(
    saveLocalDraft(
      {
        removeItem() {
          throw Error("SecurityError");
        },
      },
      "asset",
      null,
    ),
    false,
  );
});
test("effects exclude story dialogue and identity; ambience is a separate environmental caption", () => {
  const source = { clipId: "c", start: 0, duration: 8 },
    part = { start: 0, duration: 8 };
  const run = {
    contexts: [
      {
        clipId: "c",
        description:
          'Alex walks on the rooftop. She says: "Welcome to the moon." Her accent is French.',
        scenes: [{ text: "He strikes a match and opens the metal lantern." }],
      },
    ],
  };
  const effect = soundPrompt(
      run,
      { role: "effect", start: 0, sources: [source] },
      part,
    ),
    bed = soundPrompt(
      run,
      { role: "ambience", start: 0, sources: [source] },
      part,
    );
  assert.match(effect.prompt, /Footfalls/);
  assert.match(effect.prompt, /match scrape/);
  assert.doesNotMatch(effect.prompt, /Alex|French|Welcome|moon/);
  assert.match(effect.negative_prompt, /gibberish/);
  assert.match(bed.prompt, /outdoor air/);
  assert.doesNotMatch(bed.prompt, /match scrape|Alex|Welcome/);
  assert.notEqual(effect.prompt, bed.prompt);
});
test("ambience uses 22s overlapping windows and exact text-only schema", () => {
  const u = { role: "ambience", model: AMBIENCE_MODEL, start: 0, duration: 45 };
  const parts = soundParts(u);
  assert.deepEqual(
    parts.map((p) => [p.start, p.duration]),
    [
      [0, 22],
      [21, 22],
      [42, 3],
    ],
  );
  const body = ambienceInput("Quiet room tone", parts[0]);
  assert.deepEqual(Object.keys(body).sort(), [
    "duration_seconds",
    "loop",
    "output_format",
    "prompt_influence",
    "text",
  ]);
  assert.equal(body.duration_seconds, 22);
  assert.equal(body.loop, true);
  assert.equal(soundEstimate({ units: [u] }).amount, 0.094);
});
test("sound mixer preserves relative clip levels and isolates original audio", () => {
  const p = {
    clips: [{ activeTake: "m", volume: 0.8 }],
    audioClips: [
      { volume: 0.6, soundtrack: { role: "effect" } },
      { volume: 0.3, soundtrack: { role: "effect" } },
      { volume: 0.5, soundtrack: { role: "ambience" } },
    ],
  };
  setMixGain(p, "effect", 0.3);
  assert.equal(p.audioClips[0].volume, 0.3);
  assert.equal(p.audioClips[1].volume, 0.15);
  assert.equal(p.audioClips[2].volume, 0.5);
  setMixMute(p, "original", true);
  assert.equal(p.clips[0].mute, true);
  assert.equal(mixState(p, "effect").muted, false);
});
test("Test mode prevents ambience and lip-sync submission before transport", async () => {
  const adapter = new FalSoundtrackAdapter({
    key: "test",
    allowSubmit: async () => false,
    transport: () => {
      throw Error("network called");
    },
  });
  await assert.rejects(
    adapter.submitSound({}, AMBIENCE_MODEL),
    /Offline mode blocks/,
  );
  await assert.rejects(
    adapter.submitSound({}, "fal-ai/sync-lipsync/v2"),
    /Offline mode blocks/,
  );
});

import { attachProjectReference } from "../shared/authoring.mjs";
import { newProject, compilePrompt, models } from "../server/domain.mjs";
import { upgradeProject, validatePreparation } from "../shared/studio.mjs";
test("cast can be attached before a story plan exists, without duplicated identities", () => {
  const p = upgradeProject(newProject("Blank"));
  delete p.storyPlans;
  const a = { id: "alex", kind: "character", name: "Alex" };
  attachProjectReference(p, a);
  attachProjectReference(p, a);
  assert.deepEqual(p.storyPlans[p.episodeId].setup.castIds, ["alex"]);
  assert.equal(p.assets.filter((v) => v.id === "alex").length, 1);
  assert.equal(p.storyPlans[p.episodeId].beats.length, 0);
});
test("a pending boundary blocks generation until its chosen footage exists", () => {
  const p = upgradeProject(newProject("Continuity")),
    d = p.drafts[0];
  d.start = 5;
  d.frameOverrides = { start: { mode: "waiting", clipId: "previous" } };
  p.clips = [
    {
      id: "previous",
      start: 0,
      in: 0,
      duration: 5,
      takes: [],
      activeTake: null,
    },
  ];
  let c = compilePrompt(p, d, models[0]);
  assert.ok(
    validatePreparation(p, d, c, models[0]).errors.some(
      (e) => e.code === "frame-pending",
    ),
  );
  p.clips[0].takes = [{ id: "video", duration: 5 }];
  p.clips[0].activeTake = "video";
  c = compilePrompt(p, d, models[0]);
  assert.ok(
    !validatePreparation(p, d, c, models[0]).errors.some(
      (e) => e.code === "frame-pending",
    ),
  );
});

test("lip-sync prices reported per minute normalize to the quoted seconds", async()=>{
 const adapter=new FalSoundtrackAdapter({key:"FAKE",allowSubmit:async()=>false,transport:async()=>new Response(JSON.stringify({prices:[{endpoint_id:"fal-ai/sync-lipsync/v2",unit_price:3,unit:"minutes",currency:"USD"}]}),{status:200})});
 assert.equal((await adapter.pricing("fal-ai/sync-lipsync/v2")).rate*5,0.25);
});
