import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { newProject, compilePrompt, models } from "../server/domain.mjs";
import {
  upgradeProject,
  validatePreparation,
  reuseGeneration,
} from "../shared/studio.mjs";
import { smartSignature, normalizeSmartProposal } from "../shared/smart.mjs";
import {
  protectedContent,
  assertProtectedPrompt,
} from "../shared/prompt-protection.mjs";
import { exportPrompt, importPrompt } from "../shared/authoring.mjs";
import { portablePaths } from "../server/portable.mjs";
import { createVideoService } from "../server/video.mjs";
import { falModel } from "../server/adapters/fal.mjs";
const fixture = () => {
  const p = upgradeProject(newProject("Creative compiler"));
  const d = p.drafts[0];
  d.scenes[0].text =
    "A hand lifts a cup; steam curls upward.\nThe cup settles.\nNegative: No lettering.";
  p.storyPlans ??= {};
  p.storyPlans[p.episodeId] ??= { beats: [], setup: {} };
  return { p, d, plan: p.storyPlans[p.episodeId] };
};
const creative = (c) =>
  c.sections.find((s) => s.label === "Creative direction");

test("absent, unknown and planning-only choices preserve legacy compiler bytes", async () => {
  // Load this compiler with only the new hook disabled as a pre-hook comparison.
  const url = new URL("../server/domain.mjs", import.meta.url);
  const source = (await readFile(url, "utf8"))
    .replace(
      /const creative = projectCreativeSection\([^;]+;/,
      "const creative = null;",
    )
    .replace(
      /from "(\.[^"]+)"/g,
      (_, rel) => `from "${new URL(rel, url).href}"`,
    );
  const legacy = await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
  const { p, d, plan } = fixture();
  for (const direction of [
    undefined,
    {},
    { look: "invented", lighting: "auto" },
    { pacing: "energetic" },
  ]) {
    plan.creativeDirection = direction;
    assert.deepEqual(
      compilePrompt(p, d, models[0]),
      legacy.compilePrompt(p, d, models[0]),
    );
  }
});

test("camera fallbacks are per shot and respect local custom optics, framing and still defaults", () => {
  const { p, d, plan } = fixture();
  plan.creativeDirection = {
    lens: "portrait",
    movement: "orbit",
    lighting: "golden",
    pacing: "energetic",
  };
  d.scenes.push({
    ...structuredClone(d.scenes[0]),
    id: "auto",
    camera: "Auto",
    movement: "Auto",
  });
  d.scenes.push({
    ...structuredClone(d.scenes[0]),
    id: "custom",
    cameraDirection: "85mm lens. Track left.",
  });
  d.scenes.push({
    ...structuredClone(d.scenes[0]),
    id: "framed",
    camera: "Wide shot",
    movement: "Auto",
  });
  const before = structuredClone({ p, d });
  const c = compilePrompt(p, d),
    section = creative(c).text;
  assert.match(section, /Scene 1 camera intent: Lens:/);
  assert.doesNotMatch(
    section.split("\n").find((l) => l.startsWith("Scene 1")),
    /orbit/,
  );
  assert.match(section, /Scene 2 camera intent: Lens:.*Camera:.*orbit/);
  assert.doesNotMatch(section, /Scene [34] camera intent/);
  assert.match(c.text, /Scene 1 camera control: Locked camera/);
  assert.match(c.text, /Scene 3 camera control: 85mm lens. Track left./);
  assert.doesNotMatch(section, /brisk|rhythm|cuts/);
  assert.deepEqual({ p, d }, before);
  d.automation.camera = false;
  assert.doesNotMatch(
    creative(compilePrompt(p, d)).text,
    /Lens:|Camera:|camera intent/,
  );
  d.automation.specs = false;
  assert.equal(creative(compilePrompt(p, d)), undefined);
});

test("workflow adaptation uses capabilities and creates no reference or boundary inputs", () => {
  const { p, d, plan } = fixture();
  const base = compilePrompt(p, d);
  plan.creativeDirection = { look: "analog", palette: "earth" };
  for (const [metadata, label] of [
    [{ type: "text-to-video", referenceMode: "none" }, "text-to-video"],
    [
      { type: "image-to-video", referenceMode: "single" },
      "first-frame animation",
    ],
    [
      { type: "image-to-video", referenceMode: "flat" },
      "reference-guided video",
    ],
    [
      { type: "image-to-video", referenceMode: "elements" },
      "reference-guided video",
    ],
  ]) {
    const c = compilePrompt(p, d, { ...models[0], ...metadata });
    assert.ok(creative(c).text.includes(label));
    assert.deepEqual(c.references, base.references);
    assert.deepEqual(c.boundaries, base.boundaries);
    assert.doesNotMatch(c.text, /thumbnail|attached palette|uploaded lighting/);
  }
});

test("manual creative injections survive JSON, portable copies and historical reuse after reset", () => {
  const { p, d, plan } = fixture();
  plan.creativeDirection = { palette: "dusk" };
  d.sectionOverrides = {
    "Creative direction": "Palette: Keep the chosen indigo treatment.",
  };
  const c = compilePrompt(p, d);
  const imported = importPrompt(exportPrompt(p, d, c, models), p, models);
  delete plan.creativeDirection;
  assert.equal(creative(compilePrompt(p, imported)).text, creative(c).text);
  const portable = portablePaths(p, "/tmp/creative-project");
  assert.deepEqual(portable.drafts[0].sectionOverrides, d.sectionOverrides);
  const copy = reuseGeneration(p, {
    draft: structuredClone(d),
    compiled: c,
    template: p.settings,
  });
  assert.equal(compilePrompt(p, copy).text, c.text);
  delete copy.sectionOverrides["Creative direction"];
  assert.equal(creative(compilePrompt(p, copy)), undefined);
  // An older take without choices stays unstyled even after project styling is added.
  d.sectionOverrides = {};
  const unstyled = compilePrompt(p, d);
  plan.creativeDirection = { lighting: "neon" };
  const oldCopy = reuseGeneration(p, {
    draft: structuredClone(d),
    compiled: unstyled,
    template: p.settings,
  });
  assert.equal(compilePrompt(p, oldCopy).text, unstyled.text);
});

test("Smart protects creative text and signs the draft episode, including reset", () => {
  const { p, d, plan } = fixture();
  plan.creativeDirection = { lighting: "window" };
  p.storyPlans.other = {
    beats: [],
    setup: {},
    creativeDirection: { palette: "dusk" },
  };
  p.episodeId = "other";
  const signature = smartSignature(p, d),
    c = compilePrompt(p, d);
  const protectedParts = protectedContent(d, c.text);
  assert.ok(protectedParts.creative);
  assertProtectedPrompt(c.text, protectedParts);
  const modelCompiled = compilePrompt(
    p,
    d,
    falModel("alibaba/wan-3.0/text-to-video"),
  );
  assert.throws(
    () =>
      assertProtectedPrompt(
        modelCompiled.text.replace(
          "Soft directional daylight",
          "Harsh spotlight",
        ),
        protectedContent(d, modelCompiled.text),
      ),
    /creative direction/,
  );
  assert.throws(
    () =>
      assertProtectedPrompt(
        c.text.replace("Soft directional daylight", "Harsh spotlight"),
        protectedParts,
      ),
    /creative direction/,
  );
  assert.throws(
    () =>
      normalizeSmartProposal(
        { prompt: c.text.replace(protectedParts.creative, ""), decisions: [] },
        { draft: d, compiled: c, library: [], limit: 20000 },
      ),
    /creative direction/,
  );
  plan.creativeDirection = { lighting: "neon" };
  assert.notEqual(smartSignature(p, d), signature);
  d.smartAccepted = {
    prompt: c.text,
    decisions: [],
    sourceSignature: signature,
  };
  assert.equal(compilePrompt(p, d).smartStale, true);
  delete plan.creativeDirection;
  assert.notEqual(smartSignature(p, d), signature);
});

test("creative additions preserve speech, action, negative and reference contracts and block overlength", () => {
  const { p, d, plan } = fixture();
  p.assets = [
    {
      id: "hero",
      name: "Mira",
      kind: "character",
      description: "Blue coat",
      voice: { language: "Arabic", accent: "Khaliji" },
      media: { id: "hero-image" },
    },
  ];
  d.referenceIds = ["hero"];
  d.settings.audio = true;
  d.scenes[0].characterIds = ["hero"];
  d.scenes[0].dialogue = [
    { speaker: "hero", text: "Wait for me.", delivery: "Softly" },
  ];
  const model = falModel("alibaba/wan-3.0/reference-to-video");
  const original = compilePrompt(p, d, model);
  plan.creativeDirection = { lighting: "studio", pacing: "energetic" };
  const c = compilePrompt(p, d, model);
  assertProtectedPrompt(c.text, protectedContent(d, original.text));
  assert.deepEqual(c.references, original.references);
  assert.deepEqual(c.boundaries, original.boundaries);
  assert.ok(c.text.endsWith("Negative: No lettering."));
  const validation = validatePreparation(p, d, c, {
    ...model,
    promptLimit: original.text.length,
  });
  assert.ok(validation.errors.some((e) => e.code === "prompt-limit"));
  assert.equal(d.scenes[0].dialogue[0].text, "Wait for me.");
});

test("Test payload includes only creative text and never makes a network call", async () => {
  const { p, d, plan } = fixture();
  plan.creativeDirection = { lighting: "golden", palette: "dusk" };
  const model = falModel("alibaba/wan-3.0/text-to-video");
  d.settings = {
    model: model.id,
    duration: 5,
    resolution: "480p",
    aspect: "16:9",
    audio: false,
  };
  const c = compilePrompt(p, d, model);
  const service = createVideoService({
    data: "/tmp/creative-no-network",
    store: {
      media: () => {
        throw Error("Unexpected media");
      },
    },
    fetcher: () => {
      throw Error("Network forbidden");
    },
    transport: () => {
      throw Error("Network forbidden");
    },
  });
  const snapshot = {
    draft: structuredClone(d),
    compiled: c,
    capabilities: model,
    executionMode: "test",
  };
  await service.prepare(snapshot, p);
  assert.equal(snapshot.requestPayload.prompt, c.text);
  assert.equal(snapshot.requestPayload.enable_prompt_expansion, false);
  assert.deepEqual(
    Object.keys(snapshot.requestPayload).sort(),
    [
      "prompt",
      "resolution",
      "aspect_ratio",
      "duration",
      "audio",
      "enable_prompt_expansion",
    ].sort(),
  );
});

test("story validation and apply retain project choices/provenance, not model replacements", async () => {
  const { storyPlan, storyContext, storySignature, validateStory, applyStory } =
    await import("../shared/authoring.mjs");
  const { p, d } = fixture();
  const plan = storyPlan(p);
  Object.assign(plan, {
    title: "Original",
    creativeDirection: { palette: "earth", pacing: "energetic" },
    starterTemplate: { id: "original-template", version: 1, name: "Original" },
  });
  const proposal = {
    ...structuredClone(plan),
    characters: [],
    assets: [],
    creativeDirection: { palette: "mono" },
    starterTemplate: { id: "invented", version: 999 },
  };
  const omitted = structuredClone(proposal);
  delete omitted.creativeDirection;
  delete omitted.starterTemplate;
  assert.deepEqual(
    validateStory(omitted, p).creativeDirection,
    plan.creativeDirection,
  );
  assert.deepEqual(
    validateStory(omitted, p).starterTemplate,
    plan.starterTemplate,
  );
  const valid = validateStory(proposal, p);
  assert.deepEqual(valid.creativeDirection, plan.creativeDirection);
  assert.deepEqual(valid.starterTemplate, plan.starterTemplate);
  assert.match(
    storyContext(p, d).creativeContext.editorialPacing,
    /between clips only/,
  );
  const expected = structuredClone(plan);
  applyStory(p, proposal, storySignature(p));
  assert.deepEqual(storyPlan(p).creativeDirection, expected.creativeDirection);
  assert.deepEqual(storyPlan(p).starterTemplate, expected.starterTemplate);
  assert.deepEqual(
    storyPlan(p).history.at(-1).creativeDirection,
    expected.creativeDirection,
  );
  assert.doesNotMatch(
    compilePrompt(p, d).text,
    /brisk editorial|between clips only/,
  );
});

test("story planner receives pacing as protected editorial context", async () => {
  const { requestStory } = await import("../server/authoring.mjs");
  const { p, plan } = fixture();
  Object.assign(plan, {
    title: "Plan",
    creativeDirection: { pacing: "calm" },
    starterTemplate: { id: "source", version: 1, name: "Source" },
  });
  let sent;
  const input = { plan, assets: [], episodeId: p.episodeId, action: "assets" };
  const result = await requestStory(
    input,
    { mode: "deepseek", model: "mock", guide: "" },
    "mock-key",
    async (_, options) => {
      sent = JSON.parse(options.body);
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
  const context = sent.messages.find((m) =>
    m.content.startsWith("Project creative context"),
  );
  assert.match(context.content, /Allow moments to breathe/);
  assert.match(context.content, /never add cuts within a generation/);
  assert.deepEqual(result.proposal.starterTemplate, plan.starterTemplate);
  assert.deepEqual(result.proposal.creativeDirection, plan.creativeDirection);
});
test('Approved asset visual details reach the video compiler without rewriting story or dialogue',()=>{
 const {p,d}=fixture(); const a={id:'visual-cast',kind:'character',name:'Noora',description:'Original biography',visualBrief:{age:'29',features:'Adult facial proportions',wardrobe:'Cream hijab'},media:null};p.assets.push(a);d.referenceIds=[a.id];d.scenes[0].characterIds=[a.id];d.scenes[0].dialogue=[{speaker:a.id,text:'أهلًا، أنا نورة!',delivery:'Warmly'}];
 const before=structuredClone(d);const c=compilePrompt(p,d,models[0]);const section=c.sections.find(s=>s.label==='Characters & references');assert.match(section.text,/Age \/ life stage: 29/);assert.match(section.text,/Original biography/);assert.deepEqual(d,before);
});
