import test from "node:test";
import assert from "node:assert/strict";
import {
  inferScene,
  inferDirection,
  normalizeScene,
  validateSceneDecision,
  sceneForDesk,
  sceneKey,
} from "../shared/scene-sketch.mjs";
import {
  normalizeDesk,
  mergeSetupDecision,
  simulateSetupDecision,
  setupAssistantContext,
  deskPrompt,
  deskCreativeDefaults,
  deskRecipe,
} from "../shared/director-desk.mjs";
import {
  creativeDirectionText,
  effectiveCreativeDirection,
} from "../shared/creative-presets.mjs";
import { assistantFingerprint } from "../shared/composer-assistant.mjs";
import { createComposerAssistant } from "../server/composer-assistant.mjs";
import { openStore } from "../server/store.mjs";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";

test("one scene follows products, horror and landscapes without a default character or cultural clothing", () => {
  assert.equal(inferScene("", "movie").subject, "abstract");
  assert.equal(inferScene("A perfume ad in the rain", "ad").subject, "bottle");
  const horror = inferScene(
    "Zombies in an abandoned city at midnight",
    "movie",
  );
  assert.equal(horror.subject, "zombie");
  assert.equal(horror.setting, "city");
  assert.equal(horror.night, true);
  assert.equal(horror.atmosphere, "mist");
  assert.equal(inferScene("Arabic film in Saudi Arabia").covered, false);
  assert.equal(inferScene("A desert landscape", "movie").subject, "abstract");
  assert.equal(inferScene("A teacher in a hijab in a classroom").covered, true);
  assert.equal(
    inferScene("A teacher in a classroom with a bird").subject,
    "person",
  );
});
test("open-ended mixed treatments reach planning and the actual creative injection", () => {
  const style =
    "Van Gogh brushwork with pastel neon glitter and a glossy 3D sculpture";
  const context = { text: "A product study", format: "ad", lookText: style };
  const decision = simulateSetupDecision(context);
  assert.equal(decision.scene.medium, "paint");
  assert.equal(decision.scene.atmosphere, "glitter");
  const desk = mergeSetupDecision(
    normalizeDesk({ lookText: style }),
    decision,
    context,
  );
  const setup = { targetDuration: 30, directorDesk: desk };
  assert.ok(deskPrompt(setup).includes(style));
  assert.ok(creativeDirectionText(deskCreativeDefaults(setup)).includes(style));
  assert.equal(
    inferScene("A product", "ad", "Whiteboard sketch with a 3D object").medium,
    "chalk",
  );
  const p = { episodeId: "e", storyPlans: { e: { setup, beats: [] } } };
  assert.equal(
    effectiveCreativeDirection(p, { creativeDirection: { look: "clean" } })
      .styleIntent,
    undefined,
  );
});
test("manual controls, scene choices and the Off switch win over late decisions", () => {
  const context = {
    text: "Zombie city at night",
    format: "movie",
    lookText: "",
  };
  const result = simulateSetupDecision(context);
  const desk = normalizeDesk({
    light: "golden",
    softness: 91,
    manualControls: ["light", "softness"],
    scene: { subject: "car", setting: "studio" },
    manualScene: ["subject"],
  });
  const next = mergeSetupDecision(desk, result, context);
  assert.equal(next.light, "golden");
  assert.equal(next.softness, 91);
  assert.equal(next.scene.subject, "car");
  assert.equal(next.scene.setting, "city");
  const off = normalizeDesk({ ...desk, autoDirection: false });
  assert.deepEqual(mergeSetupDecision(off, result, context), off);
  assert.equal(
    sceneForDesk({ ...next, autoDirection: false }, "A perfume ad").subject,
    "car",
  );
  assert.deepEqual(
    sceneForDesk(
      {
        ...next,
        palette: "mono",
        customColors: [],
        manualControls: ["palette"],
      },
      context.text,
    ).colors,
    ["#51575c", "#aeb4b9", "#e6e6e3"],
  );
  const night = normalizeDesk({ scene: { night: true }, sun: 85 });
  assert.match(deskPrompt({ directorDesk: night }), /Light: daylight; night/);
  const nightPrompt = creativeDirectionText(
    deskCreativeDefaults({ directorDesk: night }),
  );
  assert.match(nightPrompt, /Time: night/);
  assert.doesNotMatch(nightPrompt, /Daylight position/);
});
test("decision output is bounded data, never arbitrary renderer code or remote media", () => {
  const context = { text: "A car in Saudi Arabia", format: "ad", lookText: "" };
  const value = validateSceneDecision(
    {
      scene: {
        subject: "<script>",
        setting: "remote-url",
        covered: true,
        colors: ["url(secret)", "#aabbcc"],
        count: 999,
        svg: "<script/>",
      },
      direction: {
        energy: 999,
        light: "bad",
        customColors: ["#112233", "#445566", "#778899"],
      },
      looks: [{ label: "Unusual", description: "A treatment" }],
    },
    context,
  );
  assert.equal(value.scene.subject, "abstract");
  assert.equal(value.scene.covered, false);
  assert.equal(value.scene.count, 5);
  assert.equal(value.direction.energy, 100);
  assert.equal(value.direction.light, undefined);
  assert.equal(value.scene.svg, undefined);
  assert.deepEqual(value.scene.colors, ["#aabbcc"]);
  assert.equal(normalizeScene(null).subject, "abstract");
});
test("applying a scene cannot loop paid requests and recipes exclude inferred private scene text", () => {
  const p = upgradeProject(newProject("Scene test"));
  p.storyPlans = {
    [p.episodeId]: {
      setup: {
        concept: "A private named character walks home",
        directorDesk: normalizeDesk({}),
      },
    },
  };
  const s = p.storyPlans[p.episodeId].setup,
    context = setupAssistantContext(p),
    before = assistantFingerprint(context);
  s.directorDesk = mergeSetupDecision(
    s.directorDesk,
    simulateSetupDecision(context),
    context,
  );
  assert.equal(assistantFingerprint(setupAssistantContext(p)), before);
  s.directorDesk.scene.label = "Private named character";
  assert.doesNotMatch(JSON.stringify(deskRecipe(s)), /Private named character/);
  s.directorDesk.lookText = "Hand drawn charcoal";
  assert.notEqual(assistantFingerprint(setupAssistantContext(p)), before);
  assert.equal(
    sceneForDesk(s.directorDesk, "A perfume bottle").subject,
    "person", // Keep the stage while the next incremental decision is pending.
  );
  assert.notEqual(sceneKey(context), sceneKey({ ...context, lookText: "ink" }));
});
test("Test-mode scene decisions cost zero, dedupe, and stay off when disabled per desk", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.db.close());
  const p = upgradeProject(newProject("Scene Test QA"));
  p.storyPlans = {
    [p.episodeId]: {
      setup: {
        concept: "A perfume ad in a rainy city",
        directorDesk: normalizeDesk({ format: "ad" }),
      },
    },
  };
  store.save(p, 0);
  let calls = 0;
  const service = createComposerAssistant({
    store,
    data: "/unused",
    models: async () => [],
    mode: async () => "test",
    transport: async () => {
      calls++;
      throw Error("No calls");
    },
  });
  service.configure({ enabled: true });
  const input = {
    projectId: p.id,
    workspace: "setup",
    fingerprint: assistantFingerprint(setupAssistantContext(p)),
    sessionId: "scene-test",
  };
  const r = await service.decide(input);
  assert.equal(r.state, "ready", r.error);
  assert.equal(r.amount, 0);
  assert.equal(r.decision.scene.subject, "bottle");
  assert.equal(calls, 0);
  assert.equal((await service.decide(input)).cached, true);
  const saved = store.get(p.id);
  saved.project.storyPlans[p.episodeId].setup.directorDesk.autoDirection =
    false;
  store.save(saved.project, saved.revision);
  assert.equal((await service.decide(input)).state, "off");
});
