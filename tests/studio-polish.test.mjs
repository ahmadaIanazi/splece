import test from "node:test";
import assert from "node:assert/strict";
import { newProject, compilePrompt } from "../server/domain.mjs";
import { upgradeProject, reuseGeneration } from "../shared/studio.mjs";
import {
  assignFace,
  faceChoice,
  targetedSegments,
  clearLineFace,
} from "../shared/face-assignment.mjs";
import { normalizeWritingVariation } from "../shared/writing-variation.mjs";
import {
  insertPlannedNode,
  reconcilePlannedTimeline,
  removePlannedClip,
} from "../shared/planned-timeline.mjs";
import { smartSignature } from "../shared/smart.mjs";
import { validateDefaults } from "../shared/settings-defaults.mjs";
const setup = () => {
  const p = upgradeProject(newProject("Polish"));
  const d = p.drafts[0];
  d.scenes[0].text = "@[Alex] takes off his coat.\n@[Alex] walks forward.";
  p.assets = [
    { id: "a", kind: "character", name: "Alex", description: "Wears a coat" },
  ];
  d.referenceIds = ["a"];
  return { p, d };
};
test("character face is reused across lines; specific overrides remain independent and resettable", () => {
  const { p, d } = setup();
  d.scenes[0].dialogue = [
    { speaker: "a", text: "Hello" },
    { speaker: "a", text: "Again" },
  ];
  p.clips = [
    {
      id: "c",
      draftId: d.id,
      targetId: d.id,
      start: 0,
      in: 0,
      duration: 4,
      activeTake: "v",
      takes: [{ id: "v" }],
    },
  ];
  d.targetId = "c";
  const c = p.clips[0];
  assignFace(
    p,
    c,
    0,
    { point: [0.2, 0.3], time: 0.5, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.4 } },
    "character",
  );
  assert.equal(faceChoice(p, c, 1).scope, "character");
  const audio = {
    soundtrack: {
      lineTimings: [
        { start: 0, duration: 1 },
        { start: 2, duration: 1 },
      ],
    },
  };
  assert.equal(targetedSegments(p, c, audio)[1].face.time, 0.5);
  assert.equal(targetedSegments(p, c, audio)[1].face.reusable, true);
  assignFace(p, c, 1, { point: [0.8, 0.3], time: 2.5 });
  assert.equal(faceChoice(p, c, 1).scope, "line");
  assert.equal(faceChoice(p, c, 0).point[0], 0.2);
  clearLineFace(p, c, 1);
  assert.equal(faceChoice(p, c, 1).scope, "character");
  c.in = 1;
  assert.equal(faceChoice(p, c, 1), null);
});
test("optimizer repairs mention syntax and safely retains only actions with unrecoverable references", () => {
  const { d } = setup();
  const input = { operation: "optimize-writing", draft: d };
  let r = normalizeWritingVariation(
    {
      scenes: [
        {
          id: d.scenes[0].id,
          text: "@Alex carefully takes off his coat.\n@[Alex] walks forward slowly.",
        },
      ],
    },
    input,
  );
  assert.match(r.scenes[0].text, /@\[Alex\] carefully/);
  r = normalizeWritingVariation(
    {
      scenes: [
        {
          id: d.scenes[0].id,
          text: "@Image1 takes off his coat.\n@[Alex] walks forward slowly.",
        },
      ],
    },
    input,
  );
  assert.equal(r.scenes[0].text.split("\n")[0], "@[Alex] takes off his coat.");
  assert.match(r.scenes[0].text, /slowly/);
  assert.ok(r.changes.length);
});
test("deleting an unfilled planned clip survives timeline reconciliation", () => {
  const { p } = setup();
  const node = insertPlannedNode(p, "clip", 0);
  reconcilePlannedTimeline(p);
  const slot = p.clips.find((c) => c.storyBeatId === node.id);
  assert.ok(slot);
  assert.ok(removePlannedClip(p, slot.id));
  reconcilePlannedTimeline(p);
  assert.ok(!p.clips.some((c) => c.storyBeatId === node.id));
  assert.ok(!p.storyPlans[p.episodeId].beats.some((b) => b.id === node.id));
});
test("project look references, realism and clothing continuity compile without becoming cast or changing dialogue", () => {
  const { p, d } = setup();
  p.assets.push({
    id: "look",
    kind: "style",
    name: "Evening palette",
    description: "Amber and blue",
    media: { id: "image", kind: "image", url: "/image" },
  });
  const model = {
    id: "wan-3-0-reference-to-video",
    referenceMode: "flat",
    frames: false,
    endFrame: false,
  };
  p.settings.creativeDirection = {
    realism: "physical",
    lighting: "golden",
    customPalette: ["#123456", "#abcdef"],
  };
  p.settings.visualReferences = [{ assetId: "look", role: "palette" }];
  let compiled = compilePrompt(p, d, model);
  assert.match(compiled.text, /real-world gravity/);
  assert.match(compiled.text, /#123456/);
  assert.match(compiled.text, /controls palette only/);
  assert.equal(compiled.references.length, 2);
  assert.equal(compiled.injectionVersion, 2);
  const signature = smartSignature(p, d);
  p.settings.creativeDirection.lighting = "neon";
  assert.notEqual(smartSignature(p, d), signature);
  d.useProjectVisuals = false;
  assert.equal(compilePrompt(p, d, model).references.length, 1);
  d.useProjectVisuals = true;
  d.frameOverrides = {
    start: {
      mode: "pinned",
      frame: {
        takeId: "video",
        time: 1,
        timelineCapture: true,
        mode: "manual",
      },
    },
  };
  compiled = compilePrompt(p, d, model);
  assert.match(compiled.text, /Removed clothing stays removed|removed coat/);
  assert.equal(
    validateDefaults({
      creativeDirection: { realism: "physical", unknown: "bad" },
    }).creativeDirection.realism,
    "physical",
  );
});

test("historical reuse freezes project visual roles and creative text after settings change", () => {
  const { p, d } = setup();
  p.assets.push({
    id: "look",
    kind: "style",
    name: "Warm key",
    media: { id: "light-image", kind: "image", url: "/light" },
  });
  p.settings.visualReferences = [{ assetId: "look", role: "lighting" }];
  p.settings.creativeDirection = { realism: "physical" };
  const model = { id: "wan-3-0-reference-to-video", referenceMode: "flat" };
  const compiled = compilePrompt(p, d, model);
  const snapshot = {
    draft: structuredClone(d),
    compiled,
    template: structuredClone(p.settings),
  };
  p.settings.visualReferences = [];
  p.settings.creativeDirection = { realism: "stylized" };
  const copy = reuseGeneration(p, snapshot);
  const reused = compilePrompt(p, copy, model);
  assert.equal(copy.useProjectVisuals, false);
  assert.equal(
    reused.references.find((r) => r.name === "Warm key").role,
    "lighting",
  );
  assert.match(reused.text, /real-world gravity/);
  assert.match(reused.text, /controls lighting only/);
});

test('dialogue with generated audio off is visible in preflight', async () => {
  const {validatePreparation}=await import('../shared/studio.mjs');
  const {p,d}=setup();
  d.scenes[0].dialogue=[{speaker:'a',text:'Hello'}];
  d.settings.audio=false;
  const m={audio:true,audioConfigurable:true,promptLimit:20000,maxReferences:8};
  const result=validatePreparation(p,d,compilePrompt(p,d),m);
  assert.ok(result.warnings.some(w=>w.code==='audio-off'));
  d.settings.audio=true;
  assert.ok(!validatePreparation(p,d,compilePrompt(p,d),m).warnings.some(w=>w.code==='audio-off'));
});
