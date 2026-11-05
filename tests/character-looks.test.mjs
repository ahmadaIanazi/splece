import test from "node:test";
import assert from "node:assert/strict";
import {
  characterLooks,
  lookDetails,
  editCharacterLook,
  promoteCharacterLook,
  removeCharacterLook,
  characterIdentityText,
} from "../shared/character-looks.mjs";
import { importedAsset } from "../shared/smart.mjs";
import {
  libraryAssetKind,
  matchesLibraryItem,
} from "../shared/library-organization.mjs";
import { applyAssetUnderstanding } from "../shared/asset-intelligence.mjs";
const a = { id: "a", kind: "image" },
  b = { id: "b", kind: "image" };
const character = {
  id: "c",
  kind: "character",
  name: "Noora",
  media: a,
  mediaList: [a, b],
  description: "Mauve abaya",
  visualBrief: { age: "Late 20s" },
  voice: { language: "Arabic" },
  characterProfile: { role: "Teacher", age: "Late 20s" },
  variants: [],
};
test("new uploads have their own empty descriptions; edits stay with their look", () => {
  assert.equal(lookDetails(character, "b").description, "");
  const updated = editCharacterLook(character, "b", {
    description: "Green cardigan",
    tags: { setting: "Reading a book" },
  });
  assert.equal(updated.description, "Mauve abaya");
  assert.equal(lookDetails(updated, "b").description, "Green cardigan");
  assert.deepEqual(updated.voice, character.voice);
});
test("promote and remove references preserve each look and global identity", () => {
  let updated = editCharacterLook(character, "b", {
    description: "Green cardigan",
    name: "Reading",
    tags: { setting: "Classroom" },
  });
  updated = promoteCharacterLook(updated, "b");
  assert.equal(updated.description, "Green cardigan");
  assert.equal(updated.lookTags.setting, "Classroom");
  assert.equal(lookDetails(updated, "a").description, "Mauve abaya");
  updated = removeCharacterLook(updated, "b");
  assert.equal(updated.media.id, "a");
  assert.equal(updated.description, "Mauve abaya");
  assert.deepEqual(updated.characterProfile, character.characterProfile);
  updated = removeCharacterLook(updated, "a");
  assert.equal(updated.media, null);
  assert.equal(updated.description, "");
  assert.equal(characterLooks(updated).length, 0);
});
test("generic and legacy still images appear in Images while semantic references keep their kind", () => {
  assert.equal(importedAsset(a, "footage", "x").kind, "image");
  assert.equal(importedAsset(a, "character", "x").kind, "character");
  assert.equal(libraryAssetKind({ kind: "footage", media: a }), "image");
  assert.equal(libraryAssetKind(character), "character");
  assert.equal(
    matchesLibraryItem(
      { kind: "image", name: "Image" },
      { tags: [] },
      { kind: "image" },
      [],
    ),
    true,
  );
});
test("background analysis fills missing prose and merges tags without overwriting user edits", () => {
  const result = {
    description: "Analyzed image",
    keywords: ["pastel"],
    name: "New title",
    variations: [],
  };
  const updated = applyAssetUnderstanding(
    {
      name: "My file",
      description: "My edited prose",
      libraryTags: ["favorite"],
    },
    result,
  );
  assert.equal(updated.name, "My file");
  assert.equal(updated.description, "My edited prose");
  assert.deepEqual(updated.libraryTags, ["favorite", "pastel"]);
  assert.match(characterIdentityText(character), /Role: Teacher/);
});

test('character generation carries identity without changing authored appearance prose', async () => {
  const {normalizeImageInput,imageAssetPrompt}=await import('../shared/asset-generation.mjs');
  const input=normalizeImageInput({assetId:'c',kind:'character',mode:'create',modelId:'venice-grok',description:'Mauve abaya',characterProfile:{age:'Late 20s',role:'Teacher'}});
  assert.equal(input.description,'Mauve abaya');
  assert.match(imageAssetPrompt(input,{settings:{},assets:[]}).prompt,/Age: Late 20s/);
  assert.throws(()=>normalizeImageInput({...input,characterProfile:{age:42}}),/character age/);
});

test('generic image assets insert into the timeline while characters attach as references', async () => {
 const {timelineDropPreview}=await import('../shared/timeline-drop.mjs');
 const project={clips:[]};
 assert.equal(timelineDropPreview(project,{asset:{kind:'image',media:{id:'i',kind:'image',duration:5}}},0).mode,'insert');
 assert.equal(timelineDropPreview(project,{asset:{kind:'character',media:{id:'i',kind:'image',duration:5}}},0).mode,'reference');
});
