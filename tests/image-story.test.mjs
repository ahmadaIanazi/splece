import test from "node:test";
import assert from "node:assert/strict";
import { newProject, newDraft } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import {
  frameImageContext,
  imageBridgeWriting,
} from "../shared/image-story.mjs";
import { normalizeImageInput } from "../shared/asset-generation.mjs";
import { imagePayload } from "../server/asset-images.mjs";

function fixture() {
  const project = upgradeProject(newProject("A walk home"));
  const draft = newDraft("At the balcony");
  draft.scenes[0].text =
    "Mira reaches the balcony and places her coat over the rail.";
  draft.scenes[0].dialogue = [{ speaker: "mira", text: "We made it." }];
  draft.general = "Soft evening light, restrained colors.";
  draft.referenceIds = ["mira", "balcony"];
  draft.frameOverrides = {
    start: { mode: "manual", frame: { takeId: "opening-video", time: 3.75 } },
  };
  project.assets = [
    {
      id: "mira",
      name: "Mira",
      kind: "character",
      media: { id: "mira-base", kind: "image" },
      variants: [
        { id: "coat-off", media: { id: "mira-coat-off", kind: "image" } },
      ],
    },
    {
      id: "balcony",
      name: "Old balcony",
      kind: "location",
      media: { id: "balcony-image", kind: "image" },
    },
    {
      id: "unrelated",
      name: "Unrelated private person",
      kind: "character",
      media: { id: "private-image", kind: "image" },
    },
  ];
  project.drafts = [draft];
  return {
    project,
    draft,
    input: normalizeImageInput({
      assetId: `frame:${draft.id}:end`,
      draftId: draft.id,
      boundary: "end",
      kind: "frame",
      description: "She looks out across the rooftops.",
      mode: "vary",
      modelId: "fal-flux-edit",
      framing: "scene",
      ratio: "16:9",
    }),
  };
}

test("End-frame context orders the continuity frame before only the explicitly attached identities and place", () => {
  const { project, draft, input } = fixture();
  const before = structuredClone(project);
  const result = frameImageContext(input, project);
  assert.deepEqual(
    result.references.map((ref) => [ref.mediaId, ref.time]),
    [
      ["opening-video", 3.75],
      ["mira-base", 0],
      ["balcony-image", 0],
    ],
  );
  assert.match(
    result.references[0].role,
    /Opening composition.*wardrobe state/,
  );
  assert.match(
    result.references[1].role,
    /Facial identity.*continuity frame controls current clothing/,
  );
  assert.match(result.references[2].role, /Environment and spatial layout/);
  assert.ok(result.prompt.includes(draft.scenes[0].text));
  assert.ok(result.prompt.includes(input.description));
  assert.match(result.prompt, /one closing cinematic still/);
  assert.match(result.prompt, /Never restore clothing/);
  assert.doesNotMatch(result.prompt, /Unrelated private person|private-image/);
  assert.deepEqual(
    project,
    before,
    "Creating a frame prompt never edits author writing, dialogue, or asset choices",
  );
});

test("Selected appearance variants replace identity base images and preserve the frame's current clothing role", () => {
  const { project, draft, input } = fixture();
  draft.referenceOptions = { mira: { variantId: "coat-off" } };
  const result = frameImageContext(input, project);
  assert.ok(result.references.some((ref) => ref.mediaId === "mira-coat-off"));
  assert.ok(!result.references.some((ref) => ref.mediaId === "mira-base"));
  assert.match(result.prompt, /removed clothing/);
});

test("Variation source is first; the same source and timestamp are not submitted twice", () => {
  const { project, draft, input } = fixture();
  draft.frameOverrides.start.frame = { takeId: "balcony-image", time: 0 };
  const result = frameImageContext(
    { ...input, sourceMediaId: "balcony-image" },
    project,
  );
  assert.deepEqual(
    result.references.map((ref) => ref.mediaId),
    ["balcony-image", "mira-base"],
  );
  assert.match(result.references[0].role, /Composition and current appearance/);
});

test("Different timestamps from the same video remain distinct visual references", () => {
  const { project, input } = fixture();
  const result = frameImageContext(
    { ...input, sourceMediaId: "opening-video" },
    project,
  );
  assert.deepEqual(
    result.references.slice(0, 2).map((ref) => [ref.mediaId, ref.time]),
    [
      ["opening-video", 0],
      ["opening-video", 3.75],
    ],
  );
});

test("Opening-frame generation does not reuse its own existing start frame implicitly; removed anchors stay removed", () => {
  const { project, draft, input } = fixture();
  let result = frameImageContext({ ...input, boundary: "start" }, project);
  assert.match(result.prompt, /one opening cinematic still/);
  assert.ok(!result.references.some((ref) => ref.mediaId === "opening-video"));
  draft.frameOverrides.start.mode = "none";
  result = frameImageContext(input, project);
  assert.ok(!result.references.some((ref) => ref.mediaId === "opening-video"));
});

test("Missing drafts, too many references and oversized direction fail before provider submission", () => {
  const { project, draft, input } = fixture();
  assert.throws(
    () => frameImageContext({ ...input, draftId: "missing" }, project),
    /Save this clip/,
  );
  for (let index = 0; index < 2; index++) {
    const id = `extra-${index}`;
    project.assets.push({
      id,
      name: id,
      kind: "prop",
      media: { id, kind: "image" },
    });
    draft.referenceIds.push(id);
  }
  assert.throws(
    () => frameImageContext(input, project),
    /up to four frame references/,
  );
  draft.referenceIds = [];
  draft.general = "x".repeat(8100);
  assert.throws(() => frameImageContext(input, project), /context is too long/);
});

test("Frame normalization permits context-driven editing but keeps asset editing and model capability checks strict", () => {
  const { input } = fixture();
  assert.equal(input.kind, "frame");
  assert.equal(input.sourceMediaId, "");
  assert.equal(input.boundary, "end");
  assert.equal(input.framing, "scene");
  assert.throws(
    () => normalizeImageInput({ ...input, draftId: "" }),
    /draftId/,
  );
  assert.throws(
    () => normalizeImageInput({ ...input, modelId: "venice-grok" }),
    /compatible/,
  );
  assert.throws(
    () =>
      normalizeImageInput({ ...input, kind: "character", framing: "portrait" }),
    /image to vary/,
  );
  assert.throws(
    () => normalizeImageInput({ ...input, framing: "sheet" }),
    /supported/,
  );
});

test("fal frame edits transmit every source image in role order, as one output with the requested aspect", () => {
  const { input } = fixture();
  const payload = imagePayload(
    input,
    "Image 1 opening; image 2 identity; image 3 location",
    ["first", "identity", "place"],
  );
  assert.deepEqual(payload.image_urls, [
    "data:image/png;base64,first",
    "data:image/png;base64,identity",
    "data:image/png;base64,place",
  ]);
  assert.equal(payload.num_images, 1);
  assert.deepEqual(payload.image_size, { width: 1280, height: 720 });
  assert.equal(payload.output_format, "png");
  assert.equal(
    payload.prompt,
    "Image 1 opening; image 2 identity; image 3 location",
  );
  assert.equal(payload.image, undefined);
});

test("A one-reference Venice frame edit accepts the same array contract without serializing it as an array", () => {
  const { input } = fixture();
  const payload = imagePayload(
    { ...input, modelId: "venice-firered" },
    "Keep identity",
    ["identity"],
  );
  assert.equal(payload.image, "identity");
  assert.equal(payload.image_urls, undefined);
  assert.equal(payload.aspect_ratio, "16:9");
});

test("Photo bridge direction names both visual endpoints without inventing dialogue", () => {
  const prompt = imageBridgeWriting(
    { description: "An empty mountain path" },
    { description: "A lake at sunset" },
  );
  assert.match(prompt, /Opening image: An empty mountain path/);
  assert.match(prompt, /Closing image: A lake at sunset/);
  assert.match(prompt, /do not invent dialogue/);
  const fallback = imageBridgeWriting();
  assert.match(fallback, /attached start frame/);
  assert.match(fallback, /attached end frame/);
});
