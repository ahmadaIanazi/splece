import test from "node:test";
import assert from "node:assert/strict";
import {
  insertComposerReference,
  supportedComposerDuration,
} from "../shared/composer-writing.mjs";
import { newProject, compilePrompt } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";

test("canvas insertion persists reference identity and replaces only the selected prose", () => {
  const draft = {
    referenceIds: ["first"],
    scenes: [
      {
        id: "a",
        text: "She walks through the city.",
        characterIds: ["first"],
        dialogue: [{ id: "line", text: "Keep every word." }],
      },
    ],
  };
  const dialogue = structuredClone(draft.scenes[0].dialogue);
  const character = { id: "second", name: "Nasser", kind: "character" };
  assert.equal(
    insertComposerReference(draft, "a", character, { start: 0, end: 3 }),
    true,
  );
  assert.equal(draft.scenes[0].text, "@[Nasser] walks through the city.");
  assert.deepEqual(draft.referenceIds, ["first", "second"]);
  assert.deepEqual(draft.scenes[0].characterIds, ["first", "second"]);
  assert.deepEqual(draft.scenes[0].dialogue, dialogue);
  insertComposerReference(draft, "a", character);
  assert.equal(draft.referenceIds.filter((id) => id === "second").length, 1);
  assert.equal(insertComposerReference(draft, "missing", character), false);
  assert.equal(
    insertComposerReference(draft, "a", { id: "video", kind: "footage" }),
    false,
  );
});

test("canvas location binding survives storage and reaches the existing compiler with exact dialogue", () => {
  const p = upgradeProject(newProject("Canvas contract"));
  const d = p.drafts[0];
  p.assets = [
    {
      id: "roof",
      name: "Rooftop",
      kind: "location",
      description: "Dusk over the city.",
      variants: [],
    },
    {
      id: "hero",
      name: "Nasser",
      kind: "character",
      description: "Adult explorer.",
      variants: [],
    },
  ];
  d.scenes[0].text = "An explorer lands safely.";
  d.scenes[0].dialogue = [
    {
      id: "line",
      speaker: "hero",
      delivery: "Softly",
      text: "أنا هنا. Keep this exact.",
    },
  ];
  d.referenceIds = ["hero"];
  insertComposerReference(d, d.scenes[0].id, p.assets[0]);
  const saved = JSON.parse(JSON.stringify(p)),
    result = compilePrompt(saved, saved.drafts[0]);
  assert.equal(saved.drafts[0].scenes[0].locationId, "roof");
  assert.ok(result.text.includes("أنا هنا. Keep this exact."));
  assert.ok(result.text.includes("Rooftop"));
  assert.deepEqual(saved.drafts[0].referenceIds, ["hero", "roof"]);
});

test("duration ruler snaps to provider stops including non-five-second models", () => {
  assert.equal(supportedComposerDuration(7.8, [4, 8]), 8);
  assert.equal(supportedComposerDuration(1, [5, 10]), 5);
  assert.equal(supportedComposerDuration(16, [5, 10, 15]), 15);
  assert.equal(supportedComposerDuration(6, []), null);
  assert.equal(supportedComposerDuration(NaN, [5, 10]), null);
});

test("submission bookkeeping preserves a current AI review, but real context changes still invalidate it", async () => {
  const { smartSignature } = await import("../shared/smart.mjs");
  const { reserveGenerationSlot } =
    await import("../shared/generation-slots.mjs");
  const p = upgradeProject(newProject("Reviewed reservation"));
  const d = p.drafts[0];
  d.storyBeatId = "beat";
  p.clips = [
    {
      id: "slot",
      storyBeatId: "beat",
      start: 0,
      in: 0,
      duration: 5,
      takes: [],
      activeTake: null,
      plannedReservation: true,
    },
  ];
  d.smartAccepted = {
    prompt: "Reviewed text",
    sourceSignature: smartSignature(p, d),
  };
  reserveGenerationSlot(p, d.id);
  assert.equal(d.smartAccepted.sourceSignature, smartSignature(p, d));
  const receipt = d.smartAccepted.sourceSignature;
  d.scenes[0].text = "Changed after review";
  reserveGenerationSlot(p, d.id);
  assert.equal(d.smartAccepted.sourceSignature, receipt);
  assert.notEqual(d.smartAccepted.sourceSignature, smartSignature(p, d));

  const free = upgradeProject(newProject("New slot shifts context")),
    fd = free.drafts[0];
  fd.smartAccepted = {
    prompt: "Reviewed text",
    sourceSignature: smartSignature(free, fd),
  };
  const original = fd.smartAccepted.sourceSignature;
  reserveGenerationSlot(free, fd.id, [], () => "new-slot");
  assert.equal(fd.smartAccepted.sourceSignature, original);
  assert.notEqual(original, smartSignature(free, fd));
});

test("model picker explains reference incompatibility and preserves supported settings", async () => {
  const { modelFit, modelTitle } =
    await import("../shared/composer-presentation.mjs");
  const text = {
    id: "wan-text-to-video",
    name: "Wan · wan-text-to-video",
    referenceMode: "none",
    maxReferences: 0,
    durations: [5, 10],
    resolutions: ["480p"],
    aspects: ["16:9"],
  };
  assert.equal(modelTitle(text), "Wan");
  const compiled = { references: [{ selectedMedia: { id: "image" } }] };
  assert.equal(
    modelFit(text, compiled, {
      duration: 10,
      resolution: "480p",
      aspect: "16:9",
    }).compatible,
    false,
  );
  const refs = { ...text, referenceMode: "flat", maxReferences: 3 };
  const fit = modelFit(refs, compiled, {
    duration: 10,
    resolution: "1080p",
    aspect: "16:9",
    audio: false,
  });
  assert.equal(fit.compatible, true);
  assert.deepEqual(fit.adjustments, ["resolution: 480p"]);
  assert.equal(
    modelFit(
      { ...refs, supported: false, unavailableReason: "Offline" },
      compiled,
      {},
    ).reason,
    "Offline",
  );
});
test("generation confirmation rejects quick clicks, cancellations and missing holds", async () => {
  const { completedHold, GENERATION_HOLD_MS } =
    await import("../shared/composer-presentation.mjs");
  assert.equal(completedHold(null, 2000), false);
  assert.equal(completedHold(100, 200), false);
  assert.equal(completedHold(100, 100 + GENERATION_HOLD_MS, true), false);
  assert.equal(completedHold(100, 100 + GENERATION_HOLD_MS), true);
});
