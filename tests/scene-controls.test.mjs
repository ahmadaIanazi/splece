import test from "node:test";
import assert from "node:assert/strict";
import { newProject, compilePrompt } from "../server/domain.mjs";
import {
  protectedContent,
  assertProtectedPrompt,
} from "../shared/prompt-protection.mjs";
import { sceneControls } from "../shared/scene-controls.mjs";
function fixture() {
  const p = newProject("Control QA"),
    d = p.drafts[0];
  p.assets = [
    {
      id: "hero",
      name: "Ahmad",
      kind: "character",
      description: "A traveler",
      media: { id: "one" },
      mediaList: [{ id: "two" }],
      voice: { preset: "robot", accent: "Khaleeji", language: "Arabic" },
    },
    {
      id: "other",
      name: "Other character",
      kind: "character",
      description: "Not in this shot",
    },
    { id: "room", name: "Room", kind: "location", description: "A quiet room" },
  ];
  d.referenceIds = ["hero", "room"];
  d.scenes[0].text = "Ahmad opens his eyes and gasps.";
  d.scenes[0].characterIds = ["hero"];
  d.scenes[0].dialogue = [];
  d.notes =
    "Spoken language: Arabic. Region: Saudi Arabia - Eastern. Default accent: Khaliji";
  d.contextNotes = "Later, Other character enters.";
  return { p, d };
}
test("Silent scene omits generated accent metadata and inactive voice presets, retains nonverbal audio and one identity across images", () => {
  const { p, d } = fixture();
  const c = compilePrompt(p, d, { audio: true });
  assert.match(c.text, /Exactly 1 distinct character.*Ahmad/);
  assert.match(c.text, /No dialogue/);
  assert.match(c.text, /nonverbal sounds are allowed/);
  assert.doesNotMatch(
    c.text,
    /Spoken language:|voice identity:|Khaleeji|Later, Other character/,
  );
  assert.match(c.planningContext.notes, /Other character/);
  assert.match(d.notes, /Khaliji/);
});
test("Two-scene cast and speech are scoped per scene without rewriting dialogue", () => {
  const { p, d } = fixture();
  d.referenceIds.push("other");
  d.scenes.push({
    ...structuredClone(d.scenes[0]),
    id: "second",
    characterIds: ["other"],
    text: "Other character enters.",
    dialogue: [{ speaker: "other", text: "Hello.", delivery: "Softly" }],
  });
  const c = compilePrompt(p, d);
  assert.match(
    c.text,
    /Scene 1 cast control: Exactly 1 distinct character in this scene: Ahmad/,
  );
  assert.match(
    c.text,
    /Scene 2 cast control: Exactly 1 distinct character in this scene: Other character/,
  );
  assert.match(c.text, /Scene 1 speech control: No dialogue/);
  assert.match(c.text, /Scene 2 speech control: Speak only/);
  assert.match(c.text, /“Hello.”/);
});
test("Inline authored dialogue is not silenced and missing cast does not fabricate a zero count", () => {
  const { p, d } = fixture();
  d.scenes[0].text = 'Ahmad says: "Where am I?"';
  const c = compilePrompt(p, d);
  assert.doesNotMatch(c.text, /No dialogue\./);
  assert.match(c.text, /only the exact authored dialogue/);
  assert.doesNotMatch(sceneControls(d, []).join("\n"), /Exactly 0/);
});
test("Enhancement cannot remove cast and speech controls; original negatives remain last", () => {
  const { p, d } = fixture();
  d.notes += "\nNegative: No text overlays.";
  const c = compilePrompt(p, d);
  const protectedParts = protectedContent(d, c.text);
  assert.doesNotThrow(() => assertProtectedPrompt(c.text, protectedParts));
  assert.throws(
    () =>
      assertProtectedPrompt(
        c.text.replace("No dialogue.", "Speech allowed."),
        protectedParts,
      ),
    /cast, camera or speech/,
  );
  assert.ok(c.text.endsWith("Negative: No text overlays."));
});
