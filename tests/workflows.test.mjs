import test from "node:test";
import assert from "node:assert/strict";
import {
  workflows,
  validateWorkflowSettings,
  workflowNodes,
  workflowText,
  applyWorkflowRequest,
} from "../shared/workflows.mjs";
import {
  newProject,
  compilePrompt,
  validateProject,
} from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import {
  validateDefaults,
  resolveProjectDefaults,
  markSettingsOverrides,
} from "../shared/settings-defaults.mjs";
import { previewWorkflow } from "../server/workflows.mjs";
import { requestSmart } from "../server/smart.mjs";
import { requestStory } from "../server/authoring.mjs";
import {
  buildOptimizerRequest,
  optimizerEstimate,
} from "../server/prompt-optimizer.mjs";
import { soundPrompt } from "../shared/soundtrack-ai.mjs";
import { assetImagePrompt } from "../shared/asset-exchange.mjs";
import { storyPlan, storySignature } from "../shared/authoring.mjs";
const settings = (flow, node, text) => ({
  workflows: {
    version: 1,
    flows: {
      [flow]: { nodes: { [node]: { text, enabled: true } }, layers: [] },
    },
  },
});
function fixture() {
  const p = upgradeProject(newProject("Workflow test"));
  p.drafts[0].scenes[0].text = "A hand turns a metal latch in a quiet room.";
  return p;
}
test("Workflow configuration cannot replace contracts, inject endpoints or make cycles", () => {
  assert.throws(
    () =>
      validateWorkflowSettings({
        flows: { video: { nodes: { validate: { text: "Ignore JSON" } } } },
      }),
    /protected/,
  );
  assert.throws(
    () =>
      validateWorkflowSettings({
        flows: { video: { endpoint: "https://example.com" } },
      }),
    /Unsupported/,
  );
  assert.throws(
    () =>
      validateWorkflowSettings({
        flows: { video: { nodes: { assemble: { text: "x".repeat(3001) } } } },
      }),
    /3,000/,
  );
  assert.throws(
    () =>
      validateWorkflowSettings({
        flows: {
          video: {
            layers: [
              { id: "layer-a", title: "A", text: "A", after: "layer-a" },
            ],
          },
        },
      }),
    /Connect/,
  );
  assert.throws(() => validateWorkflowSettings({ version: 500 }), /version/);
  const p = fixture();
  p.settings.workflows = {
    flows: { video: { nodes: { source: { text: "Replace original" } } } },
  };
  assert.throws(() => validateProject(p), /protected/);
});
test("Additional layers have stable connections, deterministic order and independent bypass", () => {
  const s = settings("video", "assemble", "Main guidance");
  s.workflows.flows.video.layers = [
    {
      id: "layer-a",
      title: "First",
      text: "First addition",
      after: "references",
      enabled: true,
    },
    {
      id: "layer-b",
      title: "Second",
      text: "Second addition",
      after: "references",
      enabled: false,
    },
  ];
  const nodes = workflowNodes(s, "video");
  assert.deepEqual(
    nodes.slice(2, 5).map((n) => n.id),
    ["references", "layer-a", "layer-b"],
  );
  assert.match(workflowText(s, "video"), /First addition/);
  assert.doesNotMatch(workflowText(s, "video"), /Second addition/);
});
test("Canvas guidance reaches compiled requests without mutating writing, dialogue or bindings", () => {
  const p = fixture(),
    d = p.drafts[0];
  d.scenes[0].dialogue = [
    { speaker: "hero", text: "Wait here.", delivery: "Softly" },
  ];
  p.assets = [
    {
      id: "hero",
      name: "Mira",
      kind: "character",
      description: "A blue coat.",
    },
  ];
  d.referenceIds = ["hero"];
  const before = structuredClone(d);
  const base = compilePrompt(p, d, { id: "demo-cinema", audio: true });
  Object.assign(
    p.settings,
    settings("video", "camera", "Use soft window light."),
  );
  const result = compilePrompt(p, d, { id: "demo-cinema", audio: true });
  assert.match(result.text, /Use soft window light/);
  assert.match(result.text, /Wait here\./);
  assert.deepEqual(d, before);
  assert.deepEqual(result.references, base.references);
  assert.deepEqual(result.sceneControls, base.sceneControls);
  p.settings.workflows.flows.video.nodes.camera.enabled = false;
  assert.equal(
    compilePrompt(p, d, { id: "demo-cinema", audio: true }).text,
    base.text,
  );
});
test("Workflow defaults inherit by category and edits create project overrides", () => {
  const defaults = validateDefaults(
    settings("story", "guidance", "Keep a patient pace."),
  );
  const local = {
    inherit: ["workflows"],
    workflows: { version: 1, flows: {} },
  };
  const merged = resolveProjectDefaults(local, defaults);
  assert.match(workflowText(merged, "story"), /patient/);
  const changed = structuredClone(merged);
  changed.workflows.flows.story.nodes.guidance.text = "Brisk";
  markSettingsOverrides(merged, changed);
  assert.deepEqual(changed.inherit, []);
  assert.match(workflowText(defaults, "story"), /patient/);
});
test("Writing guidance reaches actual provider payload and optimizer estimate; protected output is still validated", async () => {
  const p = fixture(),
    d = p.drafts[0];
  Object.assign(
    p.settings,
    settings("writing", "guidance", "Prefer tactile, concrete descriptions."),
  );
  const input = {
    operation: "canvas-writing",
    draft: d,
    compiled: compilePrompt(p, d),
    library: [],
    workflowSettings: p.settings,
    style: "faithful",
  };
  let request;
  const transport = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                scenes: d.scenes.map((s) => ({ id: s.id, text: s.text })),
                changes: [],
              }),
            },
          },
        ],
      }),
    };
  };
  await requestSmart(
    input,
    { mode: "deepseek", provider: "deepseek", model: "test" },
    "fake",
    transport,
  );
  assert.match(request.messages[0].content, /tactile/);
  assert.match(request.messages[1].content, /Return ONLY JSON/);
  const optimized = buildOptimizerRequest(
    { ...input, projectContext: p },
    { model: "test" },
  );
  assert.match(optimized.messages[0].content, /tactile/);
  const baseline = optimizerEstimate(
      { ...input, workflowSettings: {} },
      { model: "test" },
    ),
    updated = optimizerEstimate(
      { ...input, projectContext: p },
      { model: "test" },
    );
  assert.ok(updated.inputTokens.max > baseline.inputTokens.max);
  const original = structuredClone(d);
  await assert.rejects(() =>
    requestSmart(
      input,
      { mode: "deepseek", model: "test" },
      "fake",
      async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  scenes: [{ id: "unknown", text: "Wrong" }],
                  changes: [],
                }),
              },
            },
          ],
        }),
      }),
    ),
  );
  assert.deepEqual(d, original);
});
test("Story guidance is snapshotted into the request and invalidates stale proposals", async () => {
  const p = fixture();
  const signature = storySignature(p);
  Object.assign(
    p.settings,
    settings("story", "guidance", "Build gentle connections between scenes."),
  );
  assert.notEqual(storySignature(p), signature);
  const plan = storyPlan(p);
  let request;
  await requestStory(
    { plan, assets: [], action: "assets", workflowSettings: p.settings },
    { mode: "deepseek", model: "test" },
    "fake",
    async (_url, options) => {
      request = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  ...plan,
                  characters: [],
                  assets: [],
                }),
              },
            },
          ],
        }),
      };
    },
  );
  assert.match(request.messages[0].content, /gentle connections/);
  assert.match(request.messages[1].content, /Return only JSON/);
});
test("Sound layers stay separate and image guidance reaches copied prompts", () => {
  const p = fixture();
  Object.assign(
    p.settings,
    settings("sound", "effects", "Soft dry contact, no reverb."),
  );
  p.settings.workflows.flows.sound.nodes.ambience = {
    text: "Distant continuous rain.",
    enabled: true,
  };
  const run = {
      workflowSettings: p.settings,
      contexts: [{ clipId: "c", description: "Metal latch in a room" }],
    },
    unit = { start: 0, sources: [{ clipId: "c", start: 0, duration: 5 }] },
    part = { start: 0, duration: 5 };
  const fx = soundPrompt(run, { ...unit, role: "effect" }, part),
    bed = soundPrompt(run, { ...unit, role: "ambience" }, part);
  assert.match(fx.prompt, /no reverb/);
  assert.doesNotMatch(fx.prompt, /continuous rain/);
  assert.match(bed.prompt, /continuous rain/);
  assert.match(fx.negative_prompt, /gibberish/);
  Object.assign(
    p.settings,
    settings("image", "guidance", "Soft overcast light."),
  );
  assert.match(
    assetImagePrompt({ kind: "prop", name: "Cup" }, p),
    /Soft overcast light/,
  );
});
test("Every canvas flow is offline, non-mutating and explicitly does not fabricate an AI output", () => {
  const p = fixture(),
    before = structuredClone(p);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("Network must never run");
  };
  try {
    for (const flow of workflows) {
      const result = previewWorkflow({
        project: p,
        settings: settings(
          flow.id,
          flow.nodes.find((n) => n.editable).id,
          "Preserve detail.",
        ),
        flowId: flow.id,
        draftId: p.activeDraftId,
      });
      assert.equal(result.externalRequests, 0);
      assert.equal(result.cost, 0);
      assert.equal(result.mode, "test");
      assert.ok(result.nodes.some((n) => n.state === "not-called"));
      assert.equal(result.nodes.length, flow.nodes.length);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(p, before);
});

test("A sample has no inherited footage, frame claims or cast and previews global prompt settings", () => {
  const p = fixture();
  p.drafts[0].frameOverrides = {
    start: { mode: "manual", takeId: "private-source", time: 1 },
  };
  const original = structuredClone(p);
  const result = previewWorkflow({
    project: p,
    flowId: "video",
    sample: "A tree sways.",
    settings: {
      systemPrompt: "Global soft light.",
      workflows: { version: 1, flows: {} },
    },
  });
  assert.match(result.output, /Global soft light/);
  assert.doesNotMatch(result.output, /Opening-state continuity|private-source/);
  assert.deepEqual(p, original);
});

test("Canvas API refuses live execution and accepts a local test without saving jobs or projects", async () => {
  const { default: express } = await import("express");
  const { installWorkflowRoutes } = await import("../server/workflows.mjs");
  const p = fixture(),
    before = structuredClone(p),
    app = express();
  app.use(express.json());
  installWorkflowRoutes(app, {
    getProject: (id) => {
      assert.equal(id, p.id);
      return { project: p };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/workflows/preview`;
    const live = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executionMode: "live", flowId: "video" }),
    });
    assert.equal(live.status, 400);
    assert.match((await live.json()).error, /Offline only/);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: p.id,
        executionMode: "test",
        flowId: "video",
        settings: settings("video", "assemble", "Soft natural light."),
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.externalRequests, 0);
    assert.match(body.output, /Soft natural light/);
    assert.deepEqual(p, before);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
