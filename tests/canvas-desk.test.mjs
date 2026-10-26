import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDesk,
  mergeSetupDecision,
  deskSetupPatch,
  setupAssistantContext,
  deskPrompt,
  deskRecipe,
  validateSetupFacts,
} from "../shared/director-desk.mjs";
import {
  validateVector,
  normalizeGraph,
  reconcileGraph,
} from "../shared/scene-graph.mjs";
import { materialPaint } from "../shared/scene-paint.mjs";
import { frameScene } from "../shared/scene-projection.mjs";
const ideas = [
  { label: "Cosmic deadpan property advert", aspect: "9:16", duration: 17 },
  { label: "Neon architectural poem", aspect: "1:1", duration: 40 },
];
const context = {
  text: "A zombie property ad on the moon.",
  format: "auto",
  lookText: "",
};
test("open-ended formats survive planning and do not create decision request loops", () => {
  const p = {
    episodeId: "e",
    storyPlans: {
      e: { setup: { concept: context.text, directorDesk: normalizeDesk() } },
    },
  };
  const before = setupAssistantContext(p);
  const decision = validateSetupFacts(
    { facts: [], formatIdeas: ideas },
    context,
  );
  const d = mergeSetupDecision(
    p.storyPlans.e.setup.directorDesk,
    decision,
    context,
  );
  Object.assign(p.storyPlans.e.setup, deskSetupPatch(d, p.storyPlans.e.setup));
  assert.equal(d.formatLabel, ideas[0].label);
  assert.equal(d.aspect, "9:16");
  assert.equal(p.storyPlans.e.setup.targetDuration, 17);
  assert.deepEqual(setupAssistantContext(p), before);
  assert.match(
    deskPrompt(p.storyPlans.e.setup),
    /Cosmic deadpan property advert/,
  );
});
test("late AI results cannot replace manual format, length, light, camera or aspect", () => {
  const d = normalizeDesk({
    formatLabel: "My strange film",
    formatManual: true,
    aspect: "1:1",
    aspectManual: true,
    suggestedDuration: 23,
    durationManual: true,
    angle: 85,
    orbit: 70,
    light: "golden",
    manualControls: ["angle", "orbit", "light"],
  });
  const next = mergeSetupDecision(
    d,
    {
      facts: [],
      formatIdeas: ideas,
      direction: { angle: 5, orbit: 20, light: "neon" },
    },
    context,
  );
  assert.equal(next.formatLabel, "My strange film");
  assert.equal(next.aspect, "1:1");
  assert.equal(next.suggestedDuration, 23);
  assert.equal(next.angle, 85);
  assert.equal(next.orbit, 70);
  assert.equal(next.light, "golden");
  assert.equal(
    deskSetupPatch(next, { targetDuration: 23 }).targetDuration,
    undefined,
  );
  const released = mergeSetupDecision(
    {
      ...next,
      formatManual: false,
      aspectManual: false,
      durationManual: false,
    },
    { facts: [], formatIdeas: ideas },
    context,
  );
  assert.equal(released.formatLabel, ideas[0].label);
  assert.equal(released.suggestedDuration, 17);
});
test("reference bindings persist locally but do not leak into shared recipes", () => {
  const d = normalizeDesk({
    referenceBindings: { $scene: "asset1", woman: "asset2" },
    referenceMediaIds: { $scene: "media1" },
    referenceDesigns: { woman: "g-abc123" },
  });
  assert.equal(
    normalizeDesk(JSON.parse(JSON.stringify(d))).referenceBindings.woman,
    "asset2",
  );
  const card = deskRecipe({ directorDesk: d });
  assert.deepEqual(card.directorDesk.referenceBindings, {});
  assert.deepEqual(card.directorDesk.referenceMediaIds, {});
  assert.deepEqual(card.directorDesk.referenceDesigns, {});
  assert.equal(
    normalizeDesk({ referenceMediaIds: { bad: "https://evil.invalid/x" } })
      .referenceMediaIds.bad,
    undefined,
  );
});
test("provider numeric strings are accepted only as finite bounded numeric attributes", () => {
  assert.equal(
    validateVector({
      shapes: [
        { tag: "circle", cx: "-12", cy: "-90", r: "20", opacity: "0.4" },
      ],
    }).shapes[0].r,
    20,
  );
  for (const r of ["NaN", "Infinity", "2px", "url(x)", "1e99", "-2"])
    assert.throws(() => validateVector({ shapes: [{ tag: "circle", r }] }));
  assert.throws(() =>
    validateVector({ shapes: [{ tag: "circle", r: 20, onload: "alert(1)" }] }),
  );
});
test("material shadows and highlights remain related to each object, and manual palette wins", () => {
  const colors = ["#26233f", "#c2b6d5", "#acc9c1", "#d486c6"];
  const paint = materialPaint(colors, { bodyColor: "#d4a9b6", locks: [] });
  assert.equal(paint.body, "#d4a9b6");
  assert.notEqual(paint.secondary, colors[1]);
  assert.notEqual(paint.paper, "#ffffff");
  assert.notEqual(paint.ink, "#000000");
  assert.equal(
    materialPaint(colors, { bodyColor: "#d4a9b6", locks: [] }, true).body,
    colors[2],
  );
  assert.equal(
    materialPaint(colors, { bodyColor: "#d4a9b6", locks: ["bodyColor"] }, true)
      .body,
    "#d4a9b6",
  );
});
test("automatic ensemble framing fits portrait and landscape without mutating identities", () => {
  const d = normalizeDesk();
  const graph = reconcileGraph(normalizeGraph(), [
    { id: "a", kind: "person", x: -2, scale: 1 },
    { id: "b", kind: "person", x: 2, scale: 1 },
    { id: "c", kind: "animal", x: 0, y: 1, scale: 0.3 },
    { id: "setting", role: "environment", kind: "coast", scale: 1.5, z: -3 },
  ]);
  const before = JSON.stringify(graph);
  for (const height of [450, 800, 1422])
    for (const orbit of [20, 50, 80]) {
      const results = frameScene(graph.nodes, { ...d, orbit }, 800, height);
      for (const { node, p } of results) {
        assert.ok(Number.isFinite(p.scale));
        if (node.role === "environment") continue;
        assert.ok(p.x - 75 * p.scale >= 0);
        assert.ok(p.x + 75 * p.scale <= 800);
        assert.ok(p.y - 180 * p.scale >= 0);
        assert.ok(p.y <= height);
      }
    }
  assert.equal(JSON.stringify(graph), before);
});
test("lighting-only wording cannot cause silent model redesigns or placement drift", () => {
  const original = "Two zombies in tuxedos at a kiosk.";
  const entities = [
    {
      id: "zombie",
      kind: "zombie",
      role: "subject",
      design: "Zombie in a ragged tuxedo",
      x: 1,
      z: 0.4,
    },
  ];
  let d = mergeSetupDecision(
    normalizeDesk(),
    { facts: [], entities, entitiesProvided: true },
    { text: original },
  );
  const key = d.sceneGraph.nodes[0].assetKey;
  const changed = original + " Add golden morning light.";
  const suggested = [
    { ...entities[0], design: "Zombie waving with a hat", x: -3, z: 2 },
  ];
  d = mergeSetupDecision(
    d,
    {
      facts: [],
      entities: suggested,
      entitiesProvided: true,
      geometryChanges: [],
      direction: { light: "golden" },
    },
    { text: changed },
  );
  assert.equal(d.sceneGraph.nodes[0].assetKey, key);
  assert.equal(d.sceneGraph.nodes[0].x, 1);
  assert.equal(d.light, "golden");
  const nextText = changed + " Give the zombie a tall hat.";
  d = mergeSetupDecision(
    d,
    {
      facts: [],
      entities: suggested,
      entitiesProvided: true,
      geometryChanges: [
        { id: "zombie", evidence: "Give the zombie a tall hat" },
      ],
    },
    { text: nextText },
  );
  assert.notEqual(d.sceneGraph.nodes[0].assetKey, key);
  assert.equal(deskRecipe({ directorDesk: d }).directorDesk.sceneText, "");
});
test("empty decorative paths do not discard valid geometry but unsafe properties still fail", () => {
  assert.equal(
    validateVector({
      shapes: [
        { tag: "path", fill: "accent" },
        { tag: "circle", r: 10 },
      ],
    }).shapes.length,
    1,
  );
  assert.throws(() =>
    validateVector({
      shapes: [
        { tag: "path", onload: "x" },
        { tag: "circle", r: 10 },
      ],
    }),
  );
  assert.throws(() => validateVector({ shapes: [{ tag: "path" }] }));
});
test("a country vibe is not a language or an asserted audience", () => {
  const text = "A hostel ad in Bali with a Saudi Arabian vibe and children.";
  const r = validateSetupFacts(
    {
      facts: [
        {
          field: "language",
          value: "Saudi Arabian",
          evidence: "Saudi Arabian",
        },
        {
          field: "audience",
          value: "Saudi Arabian",
          evidence: "Saudi Arabian",
        },
        { field: "region", value: "Bali", evidence: "Bali" },
      ],
    },
    { text },
  );
  assert.deepEqual(
    r.facts.map((f) => f.field),
    ["region"],
  );
});
