import test from "node:test";
import assert from "node:assert/strict";
import {
  composerEvents,
  saveComposerEvents,
  moveComposerEvent,
  composerSequenceText,
  hasComposerWriting,
} from "../shared/composer-sequence.mjs";
import { newProject, compilePrompt, models } from "../server/domain.mjs";
import { exportPrompt, importPrompt } from "../shared/authoring.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import {
  protectedContent,
  assertProtectedPrompt,
} from "../shared/prompt-protection.mjs";
import { KieAdapter } from "../server/providers.mjs";
import { dialogueScript } from "../shared/soundtrack-dialogue.mjs";
const cast = [
  {
    id: "noura",
    kind: "character",
    name: "Ms. Noura",
    description: "Teacher",
    variants: [],
  },
  {
    id: "noor",
    kind: "character",
    name: "Noor",
    description: "A friendly star",
    variants: [],
  },
];
const line = {
  id: "hello",
  kind: "speak",
  speaker: "noura",
  text: "مرحباً يا أصدقائي! أنا المعلمة نورة.",
  delivery: "Softly",
  direction: "Warmly",
  relation: "next",
};
function fixture() {
  const project = upgradeProject(newProject("Composer sequence"));
  project.assets = structuredClone(cast);
  const draft = project.drafts[0];
  draft.referenceIds = cast.map((a) => a.id);
  draft.scenes[0].text = "A pastel playroom.";
  saveComposerEvents(draft.scenes[0], [
    line,
    {
      id: "wave",
      kind: "action",
      speaker: "noor",
      text: "Waves both arms",
      relation: "together",
    },
    {
      id: "reply",
      kind: "speak",
      speaker: "noor",
      text: "هيا نلعب!",
      delivery: "Auto",
      relation: "pause",
      pause: 2,
    },
    {
      id: "joy",
      kind: "emote",
      speaker: "noura",
      text: "Beams with delight",
      relation: "next",
    },
  ]);
  return { project, draft, scene: draft.scenes[0] };
}
test("legacy scenes remain unmodified on read; editing keeps exact Arabic and delivery", () => {
  const scene = {
    id: "legacy",
    text: "Keep my opening action.",
    dialogue: [
      {
        speaker: "noura",
        text: line.text,
        delivery: "Softly",
        direction: "Warmly",
      },
    ],
  };
  const before = structuredClone(scene),
    events = composerEvents(scene);
  assert.deepEqual(scene, before);
  saveComposerEvents(scene, events);
  assert.equal(scene.text, before.text);
  assert.equal(scene.dialogue[0].text, line.text);
  assert.equal(scene.dialogue[0].direction, "Warmly");
  assert.equal(composerEvents(scene)[0].id, events[0].id);
});
test("mixed events survive storage and only speech enters the voice script", () => {
  const { project, draft, scene } = fixture();
  const saved = upgradeProject(JSON.parse(JSON.stringify(project)));
  assert.equal(saved.drafts[0].scenes[0].sequence.length, 4);
  assert.deepEqual(
    scene.dialogue.map((l) => l.text),
    [line.text, "هيا نلعب!"],
  );
  assert.deepEqual(
    dialogueScript(saved, { draftId: draft.id, duration: 10 }).map(
      (l) => l.text,
    ),
    [line.text, "هيا نلعب!"],
  );
});
test("in-field character changes and asset mentions survive exchange and prompt compilation", () => {
  const { project, draft, scene } = fixture();
  project.assets.push({ id: "ball", name: "Red ball", kind: "prop", description: "A red ball", variants: [] });
  draft.referenceIds.push("ball");
  const events = composerEvents(scene);
  events[1].speaker = "noura";
  events[1].text = "Looks at @[Noor] and picks up @[Red ball].";
  events[1].relation = "together";
  saveComposerEvents(scene, events);
  const restored = importPrompt(exportPrompt(project, draft, compilePrompt(project, draft), models), project, models);
  const action = composerEvents(restored.scenes[0]).find(event => event.id === "wave");
  assert.equal(action.speaker, "noura");
  assert.equal(action.text, events[1].text);
  assert.equal(action.relation, "together");
  const compiled = compilePrompt(project, restored, models[0]);
  assert.match(compiled.text, /Ms\. Noura does: Looks at @\[Noor\] and picks up @\[Red ball\]/);
  assert.ok(compiled.references.some(asset => asset.id === "ball"));
  assert.ok(!restored.scenes[0].dialogue.some(line => line.text.includes("picks up")));
});
test("reordering changes outgoing order and dialogue order without altering text", () => {
  const { scene } = fixture();
  assert.equal(moveComposerEvent(scene, "reply", "hello"), true);
  const events = composerEvents(scene);
  assert.deepEqual(
    events.map((e) => e.id),
    ["reply", "hello", "wave", "joy"],
  );
  assert.equal(events[0].relation, "next");
  assert.deepEqual(
    scene.dialogue.map((l) => l.text),
    ["هيا نلعب!", line.text],
  );
  assert.equal(moveComposerEvent(scene, "missing", "hello"), false);
  assert.equal(moveComposerEvent(scene, "hello", "hello"), false);
});
test("Together drag groups the moved event with its target; removal normalizes first event", () => {
  const { scene } = fixture();
  moveComposerEvent(scene, "joy", "hello", true);
  assert.equal(composerEvents(scene)[1].relation, "together");
  assert.equal(composerEvents(scene)[1].id, "joy");
  saveComposerEvents(scene, composerEvents(scene).slice(1));
  assert.equal(composerEvents(scene)[0].relation, "next");
  assert.equal(
    scene.dialogue.some((l) => l.id === "hello"),
    false,
  );
});
test("changing event type updates the canonical speech list with no duplicate words", () => {
  const { scene } = fixture();
  const events = composerEvents(scene);
  events[1].kind = "speak";
  saveComposerEvents(scene, events);
  assert.equal(scene.dialogue.filter((l) => l.id === "wave").length, 1);
  const changed = composerEvents(scene);
  changed[0].kind = "emote";
  saveComposerEvents(scene, changed);
  assert.equal(
    scene.dialogue.some((l) => l.id === "hello"),
    false,
  );
  assert.equal(composerEvents(scene)[0].text, line.text);
});
test("external dialogue edits and appended lines are reflected without orphaning sequence actions", () => {
  const { scene } = fixture();
  scene.dialogue[0].text = "Updated exact line.";
  scene.dialogue.push({ id: "extra", speaker: "noor", text: "Another line." });
  const events = composerEvents(scene);
  assert.equal(events[0].text, "Updated exact line.");
  assert.equal(events.at(-1).id, "extra");
  assert.equal(events.find((e) => e.id === "wave").text, "Waves both arms");
});
test("compiler retains event order, actor identity, simultaneous actions and pauses", () => {
  const { project, draft } = fixture();
  const result = compilePrompt(project, draft, models[0]);
  assert.match(result.text, /Together with moment 1/);
  assert.match(result.text, /After a 2s pause, moment 2/);
  assert.ok(result.text.includes(line.text));
  assert.ok(result.text.includes("Noor does: Waves both arms"));
  assert.ok(
    result.sceneControls.some((line) => line.includes("Ms. Noura, Noor")),
  );
  const parts = protectedContent(draft, result.text);
  assertProtectedPrompt(result.text, parts);
  assert.throws(
    () =>
      assertProtectedPrompt(
        result.text.replaceAll("After a 2s pause", "After a 5s pause"),
        parts,
      ),
    /controls/,
  );
});
test("dialogue injection off removes speech but retains actions and actor cast", () => {
  const { project, draft } = fixture();
  draft.automation.dialogue = false;
  const result = compilePrompt(project, draft, models[0]);
  assert.equal(result.text.includes(line.text), false);
  assert.ok(result.text.includes("Waves both arms"));
  assert.ok(result.sceneControls.some((line) => line.includes("Noor")));
});
test("dialogue-only and action-only shots are valid writing without fabricated scene prose", () => {
  const { scene } = fixture();
  scene.text = "";
  assert.equal(hasComposerWriting(scene), true);
  saveComposerEvents(
    scene,
    composerEvents(scene).filter((e) => e.kind === "action"),
  );
  assert.equal(hasComposerWriting(scene), true);
  saveComposerEvents(scene, []);
  assert.equal(hasComposerWriting(scene), false);
});
test("JSON exchange round-trips sequence and exact speech; bad links fail visibly", () => {
  const { project, draft } = fixture();
  const exported = exportPrompt(
    project,
    draft,
    compilePrompt(project, draft),
    models,
  );
  const result = importPrompt(exported, project, models);
  assert.equal(result.scenes[0].sequence.length, 4);
  assert.equal(
    composerSequenceText(result.scenes[0], cast),
    composerSequenceText(draft.scenes[0], cast),
  );
  const invalid = structuredClone(exported);
  invalid.composer.scenes[0].sequence[0].id = "not-a-line";
  assert.throws(
    () => importPrompt(invalid, project, models),
    /existing dialogue/,
  );
});

test("native shot payload preserves sequence once and respects inherited dialogue suppression", () => {
  const { project, draft, scene } = fixture();
  draft.nativeMultiShot = true;
  scene.duration = 5;
  scene.text = "";
  saveComposerEvents(scene, [
    { ...line, text: "Hello", delivery: "Auto", direction: "" },
  ]);
  const sequence = composerSequenceText(scene, cast);
  const snapshot = {
    draft,
    template: project.settings,
    compiled: {
      text: "",
      sections: [],
      references: cast,
      sceneControls: [`Scene 1 action control: ${sequence}`],
    },
  };
  const adapter = new KieAdapter();
  assert.equal(
    adapter.payload(snapshot).input.multi_prompt[0].prompt.split("Hello")
      .length - 1,
    1,
  );
  snapshot.compiled.sceneControls = [];
  project.settings.automation.dialogue = false;
  assert.equal(
    adapter.payload(snapshot).input.multi_prompt[0].prompt.includes("Hello"),
    false,
  );
});
test("duplicate dialogue IDs are rejected rather than silently merging authored words", () => {
  const { project, draft } = fixture();
  const exported = exportPrompt(
    project,
    draft,
    compilePrompt(project, draft),
    models,
  );
  exported.composer.scenes[0].dialogue[1].id =
    exported.composer.scenes[0].dialogue[0].id;
  assert.throws(
    () => importPrompt(exported, project, models),
    /Dialogue IDs must be unique/,
  );
});

test("isolated API saves and generates a dialogue-only sequence in Test mode", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawn } = await import("node:child_process");
  const { setTimeout: delay } = await import("node:timers/promises");
  const dir = await mkdtemp(join(tmpdir(), "composer-sequence-"));
  const base = "http://127.0.0.1:14339";
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      PORT: "14339",
      STUDIO_DATA_DIR: dir,
      NODE_ENV: "production",
    },
    stdio: "ignore",
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const done = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await done;
    }
    await rm(dir, { recursive: true, force: true });
  });
  let cookie = "";
  for (let n = 0; n < 100; n++) {
    try {
      const response = await fetch(base + "/api/session");
      if (response.ok) {
        cookie = response.headers.get("set-cookie").split(";")[0];
        break;
      }
    } catch {}
    await delay(60);
  }
  assert.ok(cookie);
  const api = async (route, body, method) => {
    const response = await fetch(base + "/api" + route, {
      method: method || (body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  };
  let { project, revision } = await api("/projects", {
    name: "Dialogue-only Test",
  });
  project.assets = structuredClone(cast);
  const draft = project.drafts[0];
  draft.referenceIds = cast.map((a) => a.id);
  draft.scenes[0].text = "";
  saveComposerEvents(draft.scenes[0], [
    line,
    {
      id: "wave",
      kind: "action",
      speaker: "noor",
      text: "Waves",
      relation: "together",
    },
  ]);
  revision = (
    await api("/projects/" + project.id, { project, revision }, "PUT")
  ).revision;
  const saved = await api("/projects/" + project.id);
  assert.deepEqual(
    saved.project.drafts[0].scenes[0].sequence,
    draft.scenes[0].sequence,
  );
  const video = await api("/projects/" + project.id + "/jobs", {
    draftId: draft.id,
    revision,
    requestId: "dialogue-only",
    mode: "demo",
  });
  assert.equal(video.snapshot.executionMode, "test");
  assert.equal(video.snapshot.draft.scenes[0].text, "");
  assert.ok(video.snapshot.compiled.text.includes(line.text));
  assert.match(video.snapshot.compiled.text, /Together with moment 1/);
});
