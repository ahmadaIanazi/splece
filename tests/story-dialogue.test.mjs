import test from "node:test";
import assert from "node:assert/strict";
import {
  suppliedSpokenLines,
  joinSuppliedDialogue,
  assertSuppliedDialogue,
} from "../shared/story-dialogue.mjs";
const original = "مرحباً! أنا نورة، وصديقي صوص.";
test("explicit supplied lines retain multilingual spelling and punctuation", () => {
  assert.deepEqual(
    suppliedSpokenLines("Her exact introduction is: " + original),
    [original],
  );
  assert.deepEqual(
    suppliedSpokenLines(
      'نورة تقول بالضبط: "قهوتك، على كيفك." Keep the camera still.',
    ),
    ["قهوتك، على كيفك."],
  );
  assert.deepEqual(
    suppliedSpokenLines("She says exactly: “Gracias, qué bonito.”"),
    ["Gracias, qué bonito."],
  );
  assert.deepEqual(
    suppliedSpokenLines(
      'The sign literally says "hello". A film titled "Moon".',
    ),
    [],
  );
});
test("split original lines rejoin only on exact text and the same speaker", () => {
  const p = {
    beats: [
      {
        start: 0,
        dialogue: [
          { speaker: "noora", text: "مرحباً! أنا نورة،", delivery: "warm" },
        ],
      },
      { start: 5, dialogue: [] },
      { start: 10, dialogue: [{ speaker: "noora", text: "وصديقي صوص." }] },
    ],
  };
  assert.equal(joinSuppliedDialogue(p, [original]).length, 1);
  assert.equal(p.beats[0].dialogue[0].text, original);
  assert.deepEqual(p.beats[2].dialogue, []);
  assert.equal(p.beats.length, 3);
  assertSuppliedDialogue(p, [original]);
  for (const entries of [
    [
      { speaker: "a", text: "مرحباً! أنا نورة،" },
      { speaker: "b", text: "وصديقي صوص." },
    ],
    [
      { speaker: "a", text: "مرحباً! أنا المعلمة نورة،" },
      { speaker: "a", text: "وصديقي صوص." },
    ],
  ]) {
    const q = {
        beats: entries.map((line, start) => ({ start, dialogue: [line] })),
      },
      before = structuredClone(q);
    assert.equal(joinSuppliedDialogue(q, [original]).length, 0);
    assert.deepEqual(q, before);
    assert.throws(
      () => assertSuppliedDialogue(q, [original]),
      /supplied spoken line/,
    );
  }
});
