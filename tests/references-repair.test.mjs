import { run } from "../server/media.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { newProject, newDraft, compilePrompt } from "../server/domain.mjs";
import { upgradeProject, validatePreparation } from "../shared/studio.mjs";
import { normalizeVideoCatalog, createVideoService } from "../server/video.mjs";
import { referenceBindings, referenceErrors } from "../shared/references.mjs";
import { createRepairDraft, takeSourceIn } from "../shared/repair.mjs";
import { normalizeSmartProposal } from "../shared/smart.mjs";
const raw = JSON.parse(
  await fs.readFile(
    new URL("./fixtures/venice-video-catalog.json", import.meta.url),
    "utf8",
  ),
);
const catalog = normalizeVideoCatalog(raw);
const kling = catalog.find((m) => m.id === "kling-o3-pro-reference-to-video");
function fixture() {
  const p = upgradeProject(newProject("QA")),
    d = p.drafts[0];
  d.scenes[0].text = "Mira enters the garden.";
  p.assets = [
    {
      id: "hero",
      kind: "character",
      name: "Mira",
      description: "Blue coat",
      media: { id: "front" },
      variants: [
        {
          id: "winter",
          name: "Winter",
          media: { id: "winter-front" },
          mediaList: [{ id: "side" }],
        },
      ],
    },
    {
      id: "garden",
      kind: "location",
      name: "Garden",
      media: { id: "garden-image" },
    },
  ];
  d.referenceIds = ["hero", "garden"];
  d.referenceOptions = { hero: { variantId: "winter" } };
  return { p, d };
}
test("Kling reference roles map selected character views and scenery independently", () => {
  const { p, d } = fixture();
  const compiled = compilePrompt(p, d, kling),
    b = referenceBindings(compiled.references, kling);
  assert.equal(kling.supported, true);
  assert.equal(kling.endFrame, true);
  assert.deepEqual(
    b.map((x) => [x.tag, x.field, x.media.map((m) => m.id)]),
    [
      ["@Element1", "elements", ["winter-front", "side"]],
      ["@Image1", "scene_image_urls", ["garden-image"]],
    ],
  );
  assert.match(compiled.text, /^@Element1 controls Mira only/);
  assert.equal(referenceErrors(compiled, kling).length, 0);
  compiled.references[0].selectedMediaList = Array.from(
    { length: 5 },
    (_, i) => ({ id: String(i) }),
  );
  assert.match(referenceErrors(compiled, kling).join(" "), /three additional/);
});
test("Flat reference families use stable numbered image roles and explicit limits", () => {
  for (const id of [
    "grok-imagine-reference-to-video-private",
    "wan-3-0-reference-to-video",
    "seedance-2-0-reference-to-video-basic",
  ]) {
    const model = catalog.find((m) => m.id === id),
      { p, d } = fixture(),
      compiled = compilePrompt(p, d, model);
    assert.equal(model.supported, true);
    assert.deepEqual(
      compiled.bindings.map((b) => b.tag),
      ["@Image1", "@Image2", "@Image3"],
    );
    assert.equal(model.frames, false);
  }
});
test("Venice preparation sends frozen start/end and original asset views, without empty optional inputs", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "reference-payload-"));
  try {
    await run([
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=400x400",
      "-frames:v",
      "1",
      path.join(dir, "image.png"),
    ]);
    await run([
      "-i",
      path.join(dir, "image.png"),
      "-frames:v",
      "1",
      path.join(dir, "frame.jpg"),
    ]);
    const { p, d } = fixture();
    p.folder = dir;
    d.settings = {
      model: kling.id,
      duration: kling.durations[0],
      aspect: kling.aspects[0],
      resolution: kling.resolutions[0],
    };
    const service = createVideoService({
      data: dir,
      store: {
        media: (id) => ({
          id,
          projectId: p.id,
          original: path.join(dir, "image.png"),
        }),
      },
    });
    const compiled = compilePrompt(p, d, kling);
    compiled.boundaries = {
      start: { file: "frame.jpg" },
      end: { file: "frame.jpg" },
    };
    const snapshot = { capabilities: kling, draft: d, compiled };
    await service.prepare(snapshot, p);
    assert.ok(snapshot.requestPayload.image_url.startsWith("data:image/jpeg"));
    assert.ok(snapshot.requestPayload.end_image_url);
    assert.equal(snapshot.requestPayload.elements.length, 1);
    assert.equal(
      snapshot.requestPayload.elements[0].reference_image_urls.length,
      1,
    );
    assert.equal(snapshot.requestPayload.scene_image_urls.length, 1);
    compiled.boundaries = { start: null, end: null };
    await service.prepare(snapshot, p);
    assert.ok(!("image_url" in snapshot.requestPayload));
    assert.ok(!("end_image_url" in snapshot.requestPayload));
    const grok = catalog.find(
      (m) => m.id === "grok-imagine-reference-to-video-private",
    );
    snapshot.capabilities = grok;
    snapshot.draft.settings = {
      model: grok.id,
      duration: grok.durations[0],
      aspect: grok.aspects[0],
      resolution: grok.resolutions[0],
    };
    snapshot.compiled = compilePrompt(p, d, grok);
    await service.prepare(snapshot, p);
    assert.equal(snapshot.requestPayload.reference_image_urls.length, 3);
    assert.ok(!("elements" in snapshot.requestPayload));
    const wan = catalog.find((m) => m.id === "wan-3-0-reference-to-video");
    snapshot.capabilities = wan;
    snapshot.draft.settings = {
      model: wan.id,
      duration: wan.durations[0],
      aspect: wan.aspects[0],
      resolution: wan.resolutions[0],
    };
    snapshot.compiled = compilePrompt(p, d, wan);
    await service.prepare(snapshot, p);
    assert.equal(snapshot.requestPayload.prompt, snapshot.compiled.text);
    assert.equal(snapshot.requestPayload.reference_image_urls.length, 3);
    assert.deepEqual(
      Buffer.from(
        snapshot.requestPayload.reference_image_urls[0].split(",")[1],
        "base64",
      ),
      await fs.readFile(path.join(dir, "image.png")),
    );
    assert.ok(!("image_url" in snapshot.requestPayload));
    assert.ok(!("end_image_url" in snapshot.requestPayload));
    // A real local frame becomes the first uploaded reference, never image_url.
    d.start = 10;
    p.clips = [
      {
        id: "prior",
        start: 0,
        duration: 10,
        in: 0,
        activeTake: "source-take",
        takes: [{ id: "source-take" }],
      },
    ];
    snapshot.compiled = compilePrompt(p, d, wan);
    const continuity = snapshot.compiled.references[0];
    assert.equal(continuity.kind, "continuity");
    await fs.mkdir(path.join(dir, "references"), { recursive: true });
    await fs.copyFile(
      path.join(dir, "frame.jpg"),
      path.join(dir, "references", "continuity.jpg"),
    );
    continuity.selectedMediaList[0].frameFile = "references/continuity.jpg";
    await service.prepare(snapshot, p);
    assert.equal(snapshot.requestPayload.reference_image_urls.length, 4);
    assert.match(
      snapshot.requestPayload.prompt,
      /@Image1 shows the previous clip/,
    );
    assert.match(
      snapshot.requestPayload.prompt,
      /Separately labeled character images control the identity/,
    );
    assert.deepEqual(
      Buffer.from(
        snapshot.requestPayload.reference_image_urls[0].split(",")[1],
        "base64",
      ),
      await fs.readFile(path.join(dir, "frame.jpg")),
    );
    assert.ok(!("image_url" in snapshot.requestPayload));
    assert.ok(!("end_image_url" in snapshot.requestPayload));
    continuity.selectedMediaList[0].frameFile = "../outside.jpg";
    await assert.rejects(
      service.prepare(snapshot, p),
      /Invalid continuity reference path/,
    );
    continuity.selectedMediaList[0].frameFile = "references/continuity.jpg";
    // Both frame targets travel as ordinary ordered image references with assets.
    d.frameOverrides = {
      end: {
        mode: "manual",
        frame: { takeId: "closing-take", time: 2, timelineCapture: true },
      },
    };
    snapshot.compiled = compilePrompt(p, d, wan);
    const openingRef = snapshot.compiled.references[0];
    const closingRef = snapshot.compiled.references.at(-1);
    openingRef.selectedMediaList[0].frameFile = "references/continuity.jpg";
    await fs.copyFile(
      path.join(dir, "image.png"),
      path.join(dir, "references", "closing.png"),
    );
    closingRef.selectedMediaList[0].frameFile = "references/closing.png";
    await service.prepare(snapshot, p);
    assert.equal(snapshot.requestPayload.reference_image_urls.length, 5);
    assert.match(
      snapshot.requestPayload.prompt,
      /@Image1[^\n]+OPENING FRAME TARGET[^\n]+0 seconds/,
    );
    assert.match(
      snapshot.requestPayload.prompt,
      /@Image5[^\n]+CLOSING FRAME TARGET[^\n]+final moment/,
    );
    assert.deepEqual(
      Buffer.from(
        snapshot.requestPayload.reference_image_urls[4].split(",")[1],
        "base64",
      ),
      await fs.readFile(path.join(dir, "image.png")),
    );
    assert.ok(!("image_url" in snapshot.requestPayload));
    assert.ok(!("end_image_url" in snapshot.requestPayload));
    snapshot.capabilities = { ...wan, promptLimit: 1 };
    await assert.rejects(
      service.prepare(snapshot, p),
      /exceeds this model limit/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("Auto choices and absent continuity or dialogue never add placeholder instructions", () => {
  const { p, d } = fixture();
  d.referenceIds = [];
  d.scenes[0].camera = "Auto";
  d.scenes[0].movement = "Auto";
  d.scenes[0].transition = "Auto";
  const text = compilePrompt(p, d).text;
  assert.doesNotMatch(
    text,
    /Camera:|Transition:|No preceding|No following|Start frame|End frame|Preserve the exact words/,
  );
  d.scenes[0].movement = "Tracking";
  assert.match(compilePrompt(p, d).text, /Camera: Tracking/);
  assert.doesNotMatch(compilePrompt(p, d).text, /Auto/);
});
test("Enhancer must preserve reference role lines, quoted dialogue and original Negative block", () => {
  const { p, d } = fixture();
  d.general = "@Image1 controls the woman only (long dark hair, white shirt).";
  d.scenes[0].text = 'She says: "I cannot do this."';
  d.notes = "Negative: No extra people.\nNo blurred hands.";
  const model = catalog.find((m) => m.id === "wan-3-0-reference-to-video"),
    compiled = compilePrompt(p, d, model);
  assert.ok(
    compiled.text.startsWith(
      "@Image1 controls the woman only (long dark hair, white shirt).",
    ),
  );
  assert.ok(compiled.text.endsWith(d.notes));
  const input = { draft: d, compiled, library: p.assets, limit: 20000 };
  const value = {
    prompt: compiled.text,
    decisions: [
      {
        assetId: "hero",
        variantId: "winter",
        details: "Blue coat",
        reason: "Pinned",
      },
      { assetId: "garden", details: "Garden", reason: "Location" },
    ],
  };
  assert.ok(normalizeSmartProposal(value, input));
  for (const prompt of [
    compiled.text.replace("I cannot do this.", "Different words"),
    compiled.text.replace("No extra people.", "Extra people"),
    compiled.text.replace("@Image1 controls", "@Image1 changes"),
  ])
    assert.throws(() => normalizeSmartProposal({ ...value, prompt }, input));
});
test("Repair splits only the selected interval, pins trimmed source frames, retains references and original takes", () => {
  const { p, d } = fixture();
  p.clips = [
    {
      id: "clip",
      start: 10,
      in: 2,
      duration: 20,
      activeTake: "take",
      takes: [{ id: "take", duration: 30 }],
      intent: "original",
    },
  ];
  p.remarks = [{ id: "remark", start: 12, end: 15, text: "Hook" }];
  const before = JSON.stringify(p.remarks);
  const repair = createRepairDraft(p, "clip", 15, 20, d, newDraft);
  assert.deepEqual(
    p.clips.map((c) => [c.start, c.duration, c.in]),
    [
      [10, 5, 2],
      [15, 5, 7],
      [20, 10, 12],
    ],
  );
  assert.equal(repair.settings.duration, 5);
  assert.equal(repair.targetId, p.clips[1].id);
  assert.deepEqual(repair.referenceIds, d.referenceIds);
  assert.equal(repair.frameOverrides.start.frame.time, 7 - 1 / 24);
  assert.equal(repair.frameOverrides.end.frame.time, 12);
  assert.equal(takeSourceIn(p.clips[1], p.clips[1].takes[0]), 7);
  assert.equal(takeSourceIn(p.clips[1], { id: "new", sourceIn: 0 }), 0);
  assert.equal(JSON.stringify(p.remarks), before);
  repair.settings.duration = 10;
  assert.ok(
    validatePreparation(p, repair, compilePrompt(p, repair), null).errors.some(
      (e) => e.code === "repair-duration",
    ),
  );
  assert.throws(
    () => createRepairDraft(p, p.clips[1].id, 12, 30, d, newDraft),
    /inside one clip/,
  );
});
