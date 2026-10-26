import test from "node:test";
import assert from "node:assert/strict";
import {
  saveAssetEdit,
  assetImageDraftSignature,
} from "../shared/asset-edit.mjs";
import { assetUnderstandingInstructions } from "../server/asset-intelligence.mjs";

test("autosave patches only edited fields, retaining concurrently attached media and history", () => {
  const before = {
    id: "a",
    kind: "character",
    name: "Noora",
    description: "Old description",
    version: 1,
    history: [],
  };
  const project = { assets: [{ ...before, media: { id: "new-image" } }] };
  assert.equal(
    saveAssetEdit(project, before, {
      ...before,
      description: "Blue coat, brown eyes",
    }),
    true,
  );
  assert.equal(project.assets[0].description, "Blue coat, brown eyes");
  assert.equal(project.assets[0].media.id, "new-image");
  assert.equal(project.assets[0].history[0].description, "Old description");
  assert.equal(
    saveAssetEdit(project, before, {
      ...before,
      description: "Blue coat, brown eyes",
    }),
    false,
  );
  assert.equal(project.assets[0].history.length, 1);
});
test("blank placeholders are not created; uploading a reference is saved with a usable name", () => {
  const project = { assets: [] },
    before = { id: "new", kind: "character", name: "", description: "" };
  assert.equal(saveAssetEdit(project, null, before), false);
  assert.equal(
    saveAssetEdit(project, before, { ...before, media: { id: "uploaded" } }),
    true,
  );
  assert.equal(project.assets[0].media.id, "uploaded");
  assert.equal(project.assets[0].name, "New character");
});
test("image generation recovery is invalidated by changed descriptions or references, not unrelated voice settings", () => {
  const asset = {
    description: "Old",
    media: { id: "1" },
    visualBrief: { age: "Adult" },
  };
  assert.notEqual(
    assetImageDraftSignature(asset),
    assetImageDraftSignature({ ...asset, description: "New" }),
  );
  assert.notEqual(
    assetImageDraftSignature(asset),
    assetImageDraftSignature({ ...asset, media: { id: "2" } }),
  );
  assert.equal(
    assetImageDraftSignature(asset),
    assetImageDraftSignature({ ...asset, voice: { pitch: "low" } }),
  );
});
test("image description instructions make the image authoritative and cover detailed fictional character templates", () => {
  assert.match(assetUnderstandingInstructions, /image is the source of truth/);
  assert.match(assetUnderstandingInstructions, /NOT evidence/);
  assert.match(assetUnderstandingInstructions, /face shape, eyes/);
  assert.match(assetUnderstandingInstructions, /Never identify real people/);
});
