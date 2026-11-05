import test from "node:test";
import assert from "node:assert/strict";
import { characterVoice } from "../shared/soundtrack-dialogue.mjs";
test("project voice override wins, then explicit character default, then fallback", () => {
  const asset = {
    id: "noora",
    gender: "female",
    voice: { providerVoice: "Aria" },
  };
  assert.equal(characterVoice({}, asset), "Aria");
  assert.equal(
    characterVoice(
      { production: { voiceAssignments: { noora: "Sarah" } } },
      asset,
    ),
    "Sarah",
  );
  assert.equal(
    characterVoice(
      { production: { voiceAssignments: { noora: "invalid" } } },
      asset,
    ),
    "Aria",
  );
});
