import test from "node:test";
import assert from "node:assert/strict";
import {
  validateVector,
  normalizeGraph,
  reconcileGraph,
  fallbackEntities,
  patchSceneNode,
  mergeSketch,
  pendingSketches,
  desiredView,
  sceneAssetContext,
  vectorKey,
  simulateVector,
  withoutSketchGeometry,
} from "../shared/scene-graph.mjs";
import {
  normalizeDesk,
  mergeSetupDecision,
  simulateSetupDecision,
  setupAssistantContext,
  deskRecipe,
} from "../shared/director-desk.mjs";
import { assistantFingerprint } from "../shared/composer-assistant.mjs";
import { stageCamera, projectNode, dragOnStage } from "../shared/scene-projection.mjs";
import { createComposerAssistant } from "../server/composer-assistant.mjs";
import { sceneVectorRequest } from "../server/scene-sketch-request.mjs";
import { openStore } from "../server/store.mjs";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
const context = {
  text: "Three zombies in a city at midnight",
  format: "movie",
  lookText: "",
};
const desk = () =>
  mergeSetupDecision(normalizeDesk(), simulateSetupDecision(context), context);
function fixture(t, options = {}) {
  const store = openStore(":memory:");
  t.after(() => store.db.close());
  const p = upgradeProject(newProject("Living scene QA"));
  p.storyPlans = {
    [p.episodeId]: { setup: { concept: context.text, directorDesk: desk() } },
  };
  store.save(p, 0);
  const service = createComposerAssistant({
    store,
    data: "/unused",
    models: async () => [],
    mode: async () => "test",
    transport: () => {
      throw Error("Must not call provider");
    },
    ...options,
  });
  service.configure({ enabled: true });
  const task = pendingSketches(p.storyPlans[p.episodeId].setup.directorDesk)[0];
  const input = {
    projectId: p.id,
    workspace: "scene-asset",
    assetKey: task.assetKey,
    view: task.view,
    fingerprint: assistantFingerprint(
      sceneAssetContext(p, task.assetKey, task.view),
    ),
    sessionId: "scene-graph-test",
  };
  return { store, p, service, task, input };
}
test("palette, lighting and atmosphere keep identities, geometry and user placement", () => {
  let d = desk(),
    node = d.sceneGraph.nodes.find((n) => n.role === "subject");
  d.sceneGraph = patchSceneNode(d.sceneGraph, node.id, { x: 2.7, z: 1.1 });
  const task = pendingSketches(d)[0];
  d.sceneGraph = mergeSketch(
    d.sceneGraph,
    task,
    simulateVector({ kind: "city", role: "environment", view: "front" }),
    "test",
  );
  const changedContext = {
    ...context,
    text: context.text + " Golden light, red colors and rain.",
  };
  const result = simulateSetupDecision(changedContext);
  result.scene.colors = ["#112233", "#334455", "#ddeeff"];
  result.direction.light = "golden";
  result.scene.atmosphere = "rain";
  const next = mergeSetupDecision(d, result, changedContext);
  assert.deepEqual(next.sceneGraph.nodes, d.sceneGraph.nodes);
  assert.deepEqual(next.sceneGraph.assets, d.sceneGraph.assets);
  assert.equal(next.light, "golden");
  assert.equal(next.scene.atmosphere, "rain");
  assert.equal(next.sceneGraph.nodes.find((n) => n.id === node.id).x, 2.7);
});
test("only changed geometry gets new work; identical instances share drawings", () => {
  let d = desk();
  assert.equal(d.sceneGraph.nodes.length, 4);
  assert.equal(pendingSketches(d).length, 2);
  for (const task of pendingSketches(d))
    d.sceneGraph = mergeSketch(
      d.sceneGraph,
      task,
      simulateVector({ kind: "zombie", view: "front" }),
      "test",
    );
  assert.equal(pendingSketches(d).length, 0);
  const nodes = d.sceneGraph.nodes.map((n) =>
    n.id === "subject-2" ? { ...n, design: "Zombie with a tall hat" } : n,
  );
  d.sceneGraph = reconcileGraph(d.sceneGraph, nodes);
  assert.equal(pendingSketches(d).length, 1);
  assert.equal(
    pendingSketches(d, "live").length,
    3,
    "Test fixtures never satisfy Live drawings",
  );
});
test("individual manual properties win and explicit release restores AI control", () => {
  let d = desk();
  d.angle = 85;
  d.manualControls = ["angle"];
  const next = mergeSetupDecision(
    d,
    { ...simulateSetupDecision(context), direction: { angle: 15, lens: 80 } },
    context,
  );
  assert.equal(next.angle, 85);
  assert.equal(next.lens, 80);
  const node = d.sceneGraph.nodes[1];
  let graph = patchSceneNode(d.sceneGraph, node.id, { x: 2 });
  graph = reconcileGraph(
    graph,
    graph.nodes.map((n) => ({ ...n, x: -2, z: 2 })),
  );
  assert.equal(graph.nodes[1].x, 2);
  assert.equal(graph.nodes[1].z, 2);
  graph = patchSceneNode(graph, node.id, {}, true);
  assert.equal(
    reconcileGraph(
      graph,
      graph.nodes.map((n) => ({ ...n, x: -2 })),
    ).nodes[1].x,
    -2,
  );
  const manual = mergeSetupDecision(
    { ...d, scene: { ...d.scene, subject: "car" }, manualScene: ["subject"] },
    simulateSetupDecision(context),
    context,
  );
  assert.ok(
    manual.sceneGraph.nodes
      .filter((n) => n.role === "subject")
      .every((n) => n.kind === "car"),
  );
});
test("unsafe SVG code and oversized geometry cannot enter the saved graph", () => {
  for (const shapes of [
    [{ tag: "script", d: "M0 0" }],
    [{ tag: "path", d: "M0 0", onload: "bad" }],
    [{ tag: "path", d: "M0 0", fill: "url(https://private)" }],
    [{ tag: "image", href: "secret" }],
    [{ tag: "path", d: "M0 0<script>" }],
    [{ tag: "path", d: "M1e100 0" }],
    Array.from({ length: 65 }, () => ({ tag: "circle", r: 1 })),
  ])
    assert.throws(() => validateVector({ shapes }));
  const good = validateVector({
    shapes: [{ tag: "path", d: "M-40 0Q0-100 40 0Z", fill: "body" }],
  });
  assert.equal(good.shapes[0].fill, "body");
  assert.deepEqual(
    normalizeGraph({
      assets: { "g-abc:test:front": { shapes: [{ tag: "script" }] } },
    }).assets,
    {},
  );
});
test("camera projects shared world positions and requests only missing coarse views", () => {
  const d = desk(),
    node = d.sceneGraph.nodes[1];
  const initial = projectNode({ ...node, x: 2 }, stageCamera(d));
  const rotated = projectNode(
    { ...node, x: 2 },
    stageCamera({ ...d, orbit: 75 }),
  );
  assert.notEqual(initial.x, rotated.x);
  assert.ok(Number.isFinite(rotated.scale));
  assert.equal(desiredView({ ...d, angle: 85 }), "low");
  assert.equal(desiredView({ ...d, angle: 15 }), "high");
  assert.equal(desiredView({ ...d, orbit: 75 }), "side");
  assert.equal(desiredView({ ...d, orbit: 100 }), "back");
  const task = pendingSketches({ ...d, angle: 85 })[0];
  const graph = mergeSketch(
    d.sceneGraph,
    task,
    simulateVector({ kind: "zombie", view: "low" }),
    "test",
  );
  assert.ok(graph.assets[vectorKey(task.assetKey, "low", "test")]);
  const removed = reconcileGraph(graph, []);
  assert.deepEqual(
    mergeSketch(removed, task, simulateVector({}), "test"),
    removed,
  );
});
test("geometry changes never feed back into director request; recipes omit drawings and identities", () => {
  const p = {
    episodeId: "e",
    storyPlans: {
      e: { setup: { concept: context.text, directorDesk: desk() } },
    },
  };
  const before = assistantFingerprint(setupAssistantContext(p));
  const d = p.storyPlans.e.setup.directorDesk,
    task = pendingSketches(d)[0];
  d.sceneGraph = mergeSketch(d.sceneGraph, task, simulateVector({}), "test");
  assert.equal(assistantFingerprint(setupAssistantContext(p)), before);
  assert.equal(
    deskRecipe(p.storyPlans.e.setup).directorDesk.sceneGraph.nodes.length,
    0,
  );
});
test("separate asset calls use zero Test credits, persist receipts, reuse cached views and obey Off", async (t) => {
  const f = fixture(t);
  const r = await f.service.decide(f.input);
  assert.equal(r.state, "ready", r.error);
  assert.equal(r.amount, 0);
  assert.ok(r.decision.shapes.length);
  assert.equal((await f.service.decide(f.input)).id, r.id);
  const saved = f.store.get(f.p.id);
  saved.project.storyPlans[f.p.episodeId].setup.directorDesk.autoDirection =
    false;
  f.store.save(saved.project, saved.revision);
  assert.equal((await f.service.decide(f.input)).state, "off");
});
test("mock Live workers reserve budget, reuse existing geometry and reject malicious output", async (t) => {
  let calls = 0,
    body;
  const f = fixture(t, {
    mode: async () => "live",
    key: async () => "fake",
    transport: async (_url, request) => {
      calls++;
      body = JSON.parse(request.body);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  shapes: [{ tag: "image", href: "bad" }],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      };
    },
  });
  f.service.configure({ budget: 0 });
  assert.equal((await f.service.decide(f.input)).state, "budget");
  assert.equal(calls, 0);
  f.service.configure({ budget: 1 });
  const r = await f.service.decide(f.input);
  assert.equal(r.state, "failed");
  assert.equal(calls, 1);
  assert.match(body.messages[0].content, /ONE reusable/);
  assert.equal((await f.service.decide(f.input)).cached, true);
  assert.equal(calls, 1);
  assert.match(
    JSON.stringify(
      sceneVectorRequest(
        { design: "A lighthouse", view: "side" },
        simulateVector({}),
      ),
    ),
    /reference/,
  );
});
test("switching Off or changing an object before credential resolution prevents paid dispatch", async (t) => {
  let release, entered,
    calls = 0;
  const blocked = new Promise((r) => (release = r));
  const enteredKey = new Promise(r => { entered = r; });
  const f = fixture(t, {
    mode: async () => "live",
    key: async () => {
      entered();
      await blocked;
      return "fake";
    },
    transport: async () => {
      calls++;
      throw Error("unexpected");
    },
  });
  const pending = f.service.decide(f.input);
  await enteredKey;
  const saved = f.store.get(f.p.id);
  saved.project.storyPlans[f.p.episodeId].setup.directorDesk.autoDirection =
    false;
  f.store.save(saved.project, saved.revision);
  release();
  const r = await pending;
  assert.ok(["off","cancelled"].includes(r.state)); // disabled before or during credential resolution
  assert.equal(r.amount, 0);
  assert.equal(calls, 0);
});

test("object colors are independent parameters and sketch geometry stays out of story calls", () => {
  const d = desk(),
    node = d.sceneGraph.nodes[1];
  const changed = patchSceneNode(d.sceneGraph, node.id, {
    bodyColor: "#ff3344",
  });
  assert.equal(changed.nodes[1].assetKey, node.assetKey);
  assert.equal(changed.nodes[1].bodyColor, "#ff3344");
  const merged = reconcileGraph(
    changed,
    changed.nodes.map((n) => ({ ...n, bodyColor: "#112233" })),
  );
  assert.equal(merged.nodes[1].bodyColor, "#ff3344");
  const input = {
    plan: {
      setup: {
        directorDesk: {
          ...d,
          sceneGraph: mergeSketch(
            changed,
            pendingSketches(d)[0],
            simulateVector({}),
            "test",
          ),
        },
      },
    },
  };
  const clean = withoutSketchGeometry(input);
  assert.equal(clean.plan.setup.directorDesk.sceneGraph.assets, undefined);
  assert.ok(
    Object.keys(input.plan.setup.directorDesk.sceneGraph.assets).length,
  );
});

test('left/right helpers remain screen-relative after orbiting',()=>{
  const d={...desk(),orbit:85},n=d.sceneGraph.nodes[1],camera=stageCamera(d);
  const moved={...n,...dragOnStage(n,.2,0,d)};
  assert.ok(projectNode(moved,camera).x>projectNode(n,camera).x);
});
