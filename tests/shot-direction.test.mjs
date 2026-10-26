import test from "node:test";
import assert from "node:assert/strict";
import { newProject, compilePrompt, models } from "../server/domain.mjs";
import { shotDefaults, actionLines } from "../shared/shot-direction.mjs";
import {
  normalizeWritingVariation,
  addWritingVariation,
} from "../shared/writing-variation.mjs";
import { exportPrompt, importPrompt } from "../shared/authoring.mjs";
import {
  protectedContent,
  assertProtectedPrompt,
} from "../shared/prompt-protection.mjs";
import { upgradeProject } from "../shared/studio.mjs";

test("new shots default to a still camera without migrating explicit Auto or authored directions", () => {
  const p = upgradeProject(newProject("Timing")),
    d = p.drafts[0],
    s = d.scenes[0];
  assert.equal(s.movement, shotDefaults.movement);
  s.text = "The dancer turns while the audience watches.";
  assert.match(compilePrompt(p, d).text, /camera control: Locked camera/);
  s.movement = "Auto";
  s.camera = "Auto";
  s.transition = "Auto";
  assert.doesNotMatch(compilePrompt(p, d).text, /camera control:|Camera: Auto/);
  s.camera = "Wide shot";
  s.movement = "Tracking";
  assert.match(compilePrompt(p, d).text, /Camera: Wide shot. Tracking/);
});
test("action lines are concurrent within a line and sequential between lines/shots, without rewriting authored prose", () => {
  const p = newProject("Timing"),
    d = p.drafts[0],
    s = d.scenes[0];
  s.text = "@[Mira] waves; @[Sam] raises the light.";
  assert.match(
    compilePrompt(p, d).text,
    /single authored line happen simultaneously/,
  );
  s.text += "\nThey walk to the door.\n\nNegative: No smoke.";
  const before = structuredClone(d),
    c = compilePrompt(p, d);
  assert.match(c.text, /There are 2 authored action lines/);
  assert.match(c.text, /new line happens after the previous/);
  assert.equal(actionLines(s.text).length, 2);
  assert.deepEqual(d, before);
  d.scenes.push({ ...structuredClone(s), id: "second", text: "They leave." });
  assert.match(
    compilePrompt(p, d).text,
    /Scene 2 action control: This shot follows/,
  );
  const protectedParts = protectedContent(d, compilePrompt(p, d).text);
  assert.throws(() =>
    assertProtectedPrompt(
      compilePrompt(p, d).text.replace(
        "single authored line happen simultaneously",
        "single authored line happen separately",
      ),
      protectedParts,
    ),
  );
});
test("custom camera direction overrides still presets, is protected, and survives prompt JSON round trip", () => {
  const p = upgradeProject(newProject("Custom camera")),
    d = p.drafts[0];
  d.scenes[0].text = "The car turns.";
  d.scenes[0].cameraDirection = "Low angle, 85mm lens. Track the car slowly.";
  const c = compilePrompt(p, d);
  assert.match(c.text, /Camera: Low angle, 85mm lens/);
  assert.doesNotMatch(c.text, /camera control: Locked camera/);
  const imported = importPrompt(exportPrompt(p, d, c, models), p, models);
  assert.equal(imported.scenes[0].cameraDirection, d.scenes[0].cameraDirection);
  assert.throws(() =>
    assertProtectedPrompt(
      c.text.replaceAll("Track the car slowly.", "Pan to a crowd."),
      protectedContent(d, c.text),
    ),
  );
});
test("writing variations preserve simultaneous grouping, ordered references and original drafts", () => {
  const p = newProject("Writing"),
    d = p.drafts[0];
  d.scenes[0].text = "@[Mira] waves and @[Sam] nods.\n@[Sam] opens the door.";
  const input = { draft: structuredClone(d) },
    shot = d.scenes[0];
  const proposal = (text) => ({ scenes: [{ id: shot.id, text }] });
  assert.throws(
    () =>
      normalizeWritingVariation(
        proposal("@[Mira] waves.\n@[Sam] nods.\n@[Sam] opens the door."),
        input,
      ),
    /action-line timing/,
  );
  assert.throws(
    () =>
      normalizeWritingVariation(
        proposal("@[Sam] opens the door.\n@[Mira] waves and @[Sam] nods."),
        input,
      ),
    /action-line timing/,
  );
  const result = normalizeWritingVariation(
    proposal(shot.text.replace("waves and", "waves gently and")),
    input,
  );
  const variation = addWritingVariation(p, {
    id: "test-writing",
    draftId: d.id,
    state: "ready",
    input,
    result,
  });
  assert.equal(d.scenes[0].text, input.draft.scenes[0].text);
  assert.equal(variation.scenes[0].movement, "No movement");
  assert.equal(actionLines(variation.scenes[0].text).length, 2);
});
