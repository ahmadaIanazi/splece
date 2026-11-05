import test from "node:test";
import assert from "node:assert/strict";
import { newProject, compilePrompt, models } from "../server/domain.mjs";
import {
  resolveReferences,
  upgradeProject,
  validatePreparation,
} from "../shared/studio.mjs";
import {
  selectableLooks,
  selectedLook,
  chooseLook,
  isManualLook,
  lookMedia,
} from "../shared/look-selection.mjs";
import {
  assistantContext,
  assistantFingerprint,
  validateAssistantDecision,
  applyAssistantDecision,
  markAssistantManualEdits,
} from "../shared/composer-assistant.mjs";
import { decisionRequest } from "../server/composer-assistant.mjs";
import { exportPrompt, importPrompt } from "../shared/authoring.mjs";
import { normalizeSmartProposal } from "../shared/smart.mjs";
import { referenceBindings } from "../shared/references.mjs";
import { replaceAssetDescription } from "../shared/asset-intelligence.mjs";
const media = (id) => ({
  id,
  url: `/media/${id}.png`,
  thumbnail: `/media/${id}.png`,
  kind: "image",
});
function fixture() {
  const p = upgradeProject(newProject("Look QA")),
    d = p.drafts[0];
  p.assets = [
    {
      id: "noora",
      kind: "character",
      name: "Noora",
      description: "A woman wearing a purple abaya",
      media: media("main"),
      mediaList: [
        media("main"),
        media("clinic"),
        media("party"),
        media("upload"),
      ],
      variants: [
        {
          id: "clinic",
          name: "Visiting",
          description: "A woman in a grey hoodie",
          keywords: ["hospital", "medical"],
          visualBrief: { clothing: "grey hoodie" },
          media: media("clinic"),
        },
        {
          id: "party",
          name: "Celebration",
          description: "A woman wearing a white dress",
          keywords: ["wedding", "bride"],
          media: media("party"),
        },
      ],
    },
  ];
  d.referenceIds = ["noora"];
  d.scenes[0].text = "";
  d.scenes[0].dialogue = [];
  return { p, d, a: p.assets[0] };
}
for (const text of [
  "Noora visits the hospital.",
  "Noora visits a clinic.",
  "نورا تزور المستشفى.",
  "نورا تزور الْمُسْتَشْفَى.",
  "Noora تزور المستشفى wearing a hoodie.",
]) {
  test(`analyzed keywords match across languages: ${text}`, () => {
    const { p, d, a } = fixture();
    d.scenes[0].text = text;
    assert.equal(selectedLook(a, d, p.assets)?.id, "clinic");
    assert.deepEqual(
      resolveReferences(p, d)[0].selectedMediaList.map((m) => m.id),
      ["clinic"],
    );
  });
}
test("Arabic analyzed keywords match English writing", () => {
  const { p, d, a } = fixture();
  a.variants[0].keywords = ["مستشفى"];
  d.scenes[0].text = "Noora visits a hospital.";
  assert.equal(selectedLook(a, d, p.assets)?.id, "clinic");
});
test("visual brief and normalized Arabic color words match", () => {
  const { d, a } = fixture();
  a.variants[0].description = "";
  a.variants[0].keywords = [];
  a.variants[0].visualBrief = { clothing: "معطف أخضر" };
  d.scenes[0].text = "Noora wears a green coat.";
  assert.equal(selectedLook(a, d)?.id, "clinic");
});
for (const text of [
  "Noora does not visit the hospital.",
  "نورا ليست في المستشفى.",
  "Noora smiles.",
  "A woman.",
  "hospital wedding",
]) {
  test(`negated, generic or ambiguous cues abstain: ${text}`, () => {
    const { p, d, a } = fixture();
    d.scenes[0].text = text;
    assert.equal(selectedLook(a, d, p.assets), null);
    assert.deepEqual(
      resolveReferences(p, d)[0].selectedMediaList.map((m) => m.id),
      ["main"],
    );
  });
}
test("opening wardrobe wins over later scenes, later changes and spoken lines", () => {
  const { d, a } = fixture();
  d.scenes[0].text = "Noora visits the hospital, then attends a wedding.";
  d.scenes.push({ ...d.scenes[0], id: "later", text: "Noora at a wedding." });
  d.scenes[0].dialogue = [
    { id: "speech", text: "I love weddings", speaker: "noora" },
  ];
  assert.equal(selectedLook(a, d)?.id, "clinic");
});
test("attributed action-only scene supports look matching", () => {
  const { d, a } = fixture();
  d.scenes[0].sequence = [
    {
      id: "action",
      kind: "action",
      speaker: "noora",
      text: "Walks into the hospital.",
    },
  ];
  assert.equal(selectedLook(a, d)?.id, "clinic");
});
test("another character wardrobe is not used for this character", () => {
  const { d, a, p } = fixture();
  p.assets.push({ id: "sarah", kind: "character", name: "Sarah" });
  d.scenes[0].text = "Noora smiles. Sarah wears a white wedding dress.";
  assert.equal(selectedLook(a, d, p.assets), null);
});
test("all uploaded looks can be manually selected, exported and restored", () => {
  const { p, d, a } = fixture();
  chooseLook(d, a.id, "look:upload");
  assert.equal(selectableLooks(a).length, 4);
  assert.deepEqual(
    resolveReferences(p, d)[0].selectedMediaList.map((m) => m.id),
    ["upload"],
  );
  const restored = importPrompt(
    exportPrompt(p, d, compilePrompt(p, d), models),
    p,
    models,
  );
  assert.equal(restored.referenceOptions.noora.variantId, "look:upload");
  assert.equal(restored.referenceOptions.noora.lookLocked, true);
});
test("manual main and alternate looks beat writing, stale assistant ownership and AI decisions", () => {
  for (const id of ["none", "party", "look:upload"]) {
    const { p, d, a } = fixture();
    d.scenes[0].text = "Noora visits the hospital.";
    chooseLook(d, a.id, id);
    d.assistant.appearances.noora = "following";
    assert.equal(isManualLook(d, a.id), true);
    assert.equal(
      resolveReferences(p, d)[0].selectedMedia.id,
      id === "none" ? "main" : id === "look:upload" ? "upload" : id,
    );
    const ctx = assistantContext(p, d, d.scenes[0].id, models[0]);
    const decision = validateAssistantDecision(
      {
        camera: [],
        issues: [],
        appearances: [
          { assetId: a.id, variantId: "clinic", evidence: "hospital" },
        ],
      },
      ctx,
    );
    assert.equal(decision.appearances.length, 0);
  }
});
test("returning to Auto clears ownership through ordinary save tracking", () => {
  const { p, d, a } = fixture();
  chooseLook(d, a.id, "party");
  const before = structuredClone(p);
  chooseLook(d, a.id, "auto");
  markAssistantManualEdits(before, p);
  assert.equal(isManualLook(d, a.id), false);
  d.scenes[0].text = "Noora visits the hospital.";
  assert.equal(selectedLook(a, d)?.id, "clinic");
});
test("a late assistant result cannot replace a fresh manual choice", () => {
  const { p, d, a } = fixture();
  d.scenes[0].text = "Noora visits the hospital.";
  const context = assistantContext(p, d, d.scenes[0].id, models[0]);
  chooseLook(d, a.id, "party");
  const decision = {
    camera: [],
    issues: [],
    appearances: [{ assetId: a.id, variantId: "clinic", evidence: "hospital" }],
  };
  assert.equal(
    applyAssistantDecision(p, d.id, context, decision, "late"),
    false,
  );
  assert.equal(d.referenceOptions.noora.variantId, "party");
});
test("main never sends the gallery; selected look can send only its own grouped views", () => {
  const { p, d, a } = fixture();
  a.variants[0].mediaList = [
    media("clinic-side"),
    media("party"),
    media("main"),
  ];
  chooseLook(d, a.id, "clinic");
  const refs = resolveReferences(p, d);
  assert.deepEqual(
    refs[0].selectedMediaList.map((m) => m.id),
    ["clinic", "clinic-side"],
  );
  const bindings = referenceBindings(refs, { referenceMode: "flat" });
  assert.deepEqual(
    bindings.flatMap((b) => b.media).map((m) => m.id),
    ["clinic", "clinic-side"],
  );
  chooseLook(d, a.id, "none");
  assert.deepEqual(
    lookMedia(a, null).map((m) => m.id),
    ["main"],
  );
});
test("compiled selected outfit does not include main-look clothing", () => {
  const { p, d, a } = fixture();
  chooseLook(d, a.id, "clinic");
  d.scenes[0].text = "Noora smiles.";
  const compiled = compilePrompt(p, d);
  assert.match(compiled.text, /grey hoodie/);
  assert.doesNotMatch(compiled.text, /purple abaya/);
});
test("a removed pinned look blocks preparation instead of using another image", () => {
  const { p, d, a } = fixture();
  chooseLook(d, a.id, "deleted");
  const compiled = compilePrompt(p, d);
  assert.equal(compiled.references[0].selectedMedia, null);
  assert.ok(
    validatePreparation(p, d, compiled, models[0]).errors.some(
      (e) => e.code === "look-unavailable",
    ),
  );
});
test("assistant gets analyzed metadata and bilingual rules; metadata changes invalidate receipts", () => {
  const { p, d, a } = fixture();
  const ctx = assistantContext(p, d, d.scenes[0].id, models[0]);
  assert.deepEqual(
    ctx.candidates[0].variants.find((v) => v.id === "clinic").keywords,
    ["hospital", "medical"],
  );
  assert.ok(ctx.candidates[0].variants.some((v) => v.id === "look:upload"));
  assert.match(
    decisionRequest(ctx).messages[0].content,
    /Arabic, English and mixed-language/,
  );
  a.variants[0].keywords = ["school"];
  assert.notEqual(
    assistantFingerprint(ctx),
    assistantFingerprint(assistantContext(p, d, d.scenes[0].id, models[0])),
  );
});

for (const text of [
  "Noora is not in the hospital, but at a wedding.",
  "نورا ليست في المستشفى، بل في حفل زفاف.",
]) {
  test(`positive alternative survives negation: ${text}`, () => {
    const { d, a } = fixture();
    d.scenes[0].text = text;
    assert.equal(selectedLook(a, d)?.id, "party");
  });
}
test("Smart review rejects a different look when manually locked", () => {
  const { p, d, a } = fixture();
  chooseLook(d, a.id, "party");
  d.scenes[0].text = "Noora smiles.";
  const model = { ...models[0], referenceMode: "flat", maxReferences: 7 };
  const compiled = compilePrompt(p, d, model);
  assert.throws(
    () =>
      normalizeSmartProposal(
        {
          prompt: compiled.text,
          decisions: [
            {
              assetId: a.id,
              variantId: "clinic",
              details: "hoodie",
              reason: "scene",
            },
          ],
        },
        {
          draft: d,
          compiled,
          library: p.assets,
          videoCapabilities: model,
          limit: 20000,
        },
      ),
    /pinned appearance/,
  );
});
test("Smart review main fallback has one image even with alternate gallery looks", () => {
  const { p, d, a } = fixture();
  d.scenes[0].text = "Noora smiles.";
  const model = { ...models[0], referenceMode: "flat", maxReferences: 7 };
  const compiled = compilePrompt(p, d, model);
  const result = normalizeSmartProposal(
    {
      prompt: compiled.text,
      decisions: [
        {
          assetId: a.id,
          variantId: null,
          details: "Main look",
          reason: "opening",
        },
      ],
    },
    {
      draft: d,
      compiled,
      library: p.assets,
      videoCapabilities: model,
      limit: 20000,
    },
  );
  assert.equal(result.decisions[0].variantId, null);
});
test("main-look analysis stores scoped keywords separately from merged library search tags", () => {
  const { a, d } = fixture();
  const next = replaceAssetDescription(
    a,
    { description: "Neutral clothing", keywords: ["museum"], visualBrief: {} },
    "main",
  );
  assert.deepEqual(
    selectableLooks(next).find((v) => v.id === "none").keywords,
    ["museum"],
  );
  const promoted = {
    ...next,
    variants: [
      ...next.variants,
      {
        id: "duplicate",
        name: "Alternate",
        description: "Neutral clothing",
        media: media("extra"),
      },
    ],
  };
  d.scenes[0].text = "Noora visits the museum.";
  assert.equal(selectedLook(promoted, d), null);
});
