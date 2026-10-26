import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { createSoundtrackPlan } from "../shared/soundtrack.mjs";

let ui, directory;
before(async () => {
  await fs.mkdir(path.resolve("tmp"), { recursive: true });
  directory = await fs.mkdtemp(path.resolve("tmp/sound-ui-"));
  const outfile = path.join(directory, "components.mjs");
  await build({
    stdin: {
      contents:
        'export {SoundtrackPanel,SoundtrackTimeline} from "./src/soundtrack.jsx";export {SoundInspector} from "./src/sound-inspector.jsx";',
      resolveDir: process.cwd(),
    },
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    external: ["react", "react-dom", "react-dom/*"],
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  ui = await import(pathToFileURL(outfile));
});
after(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});
function fixture() {
  const project = upgradeProject(newProject("Sound UI"));
  project.clips = [
    {
      id: "clip",
      start: 0,
      in: 0,
      duration: 5,
      activeTake: "media",
      takes: [{ id: "media", duration: 5 }],
    },
  ];
  return project;
}
function sound(runs = [], focus = null) {
  return {
    runs,
    focus,
    setFocus() {},
    estimate() {
      throw Error("SSR must not make requests");
    },
    lip: { jobs: [] },
  };
}
function panel(project, controller, extra = {}) {
  return renderToStaticMarkup(
    React.createElement(ui.SoundtrackPanel, {
      project,
      sound: controller,
      selectedIds: [],
      testMode: true,
      update() {},
      embedded: true,
      ...extra,
    }),
  );
}

test("Sound opens with three choices, one generation action and no duplicated results or technical request payload", () => {
  const project = fixture(),
    run = createSoundtrackPlan(project, { roles: ["effect"] }, () => "unit");
  run.id = "run";
  run.state = "ready";
  run.units.forEach((u) => {
    u.state = "ready";
    u.delivered = true;
  });
  const html = panel(project, sound([run]));
  assert.match(html, /aria-label="Sound layer"/);
  for (const title of ["Effects", "Ambience", "Dialogue"])
    assert.match(html, new RegExp(`<strong>${title}</strong>`));
  assert.equal((html.match(/>Generate<\/button>/g) || []).length, 1);
  assert.doesNotMatch(
    html,
    /Latest sound|Sound queue|Sound sections|Prepared request|<pre/,
  );
  assert.match(html, /Offline · no credits/);
  assert.match(html, /<details class="soundtrack-more"><summary>/);
});
test("Selecting a failed timeline section exposes only that section recovery and keeps completed sections out of the composer", () => {
  const project = fixture(),
    run = createSoundtrackPlan(project, { roles: ["effect"] }, () => "unit");
  run.id = "run";
  run.state = "failed";
  run.units[0].state = "failed";
  run.units[0].parts = [
    { index: 0, start: 0, duration: 2, state: "ready" },
    {
      index: 1,
      start: 2,
      duration: 3,
      state: "failed",
      error: "Temporary issue",
    },
  ];
  const html = panel(
    project,
    sound([run], { role: "effect", runId: "run", unitId: "unit", index: 1 }),
  );
  assert.match(html, /Selected section/);
  assert.match(html, /Temporary issue/);
  assert.match(html, /Checking this section/);
  assert.doesNotMatch(html, /Ready · kept/);
});
test("Failed sound remains discoverable after a newer different-layer generation completes", () => {
  const project = fixture();
  const failed = createSoundtrackPlan(
    project,
    { roles: ["effect"] },
    () => "old",
  );
  failed.id = "old-run";
  failed.state = "failed";
  failed.units[0].state = "failed";
  failed.units[0].error = "Retry needed";
  const ready = createSoundtrackPlan(
    project,
    { roles: ["ambience"] },
    () => "new",
  );
  ready.id = "new-run";
  ready.state = "ready";
  ready.units[0].state = "ready";
  const html = renderToStaticMarkup(
    React.createElement(ui.SoundtrackTimeline, {
      project,
      runs: [ready, failed],
      zoom: 40,
      viewport: { left: 0, width: 800 },
      expanded: true,
    }),
  );
  assert.match(html, /effect failed/);
  assert.match(html, /Needs attention/);
});
test("Sound inspector supports imported audio with isolated preview, positioning, fades, mute, duplicate and delete", () => {
  const project = fixture();
  project.audioClips = [
    {
      id: "audio",
      mediaId: "sound",
      name: "Ocean",
      start: 1,
      in: 2,
      duration: 4,
      sourceDuration: 8,
      volume: 0.6,
      mute: false,
      lane: 0,
      fadeIn: 0.3,
      fadeOut: 0.4,
    },
  ];
  const html = renderToStaticMarkup(
    React.createElement(ui.SoundInspector, {
      project,
      audioId: "audio",
      update() {},
    }),
  );
  for (const label of [
    "Preview selected sound",
    "Volume",
    "Fade in",
    "Fade out",
    "Timeline start",
    "Source start",
    "Duration",
    "Delete sound",
    "Duplicate sound",
  ])
    assert.ok(html.includes(`aria-label="${label}"`), label);
  assert.match(html, /src="\/api\/media\/sound\/audio"/);
  assert.doesNotMatch(html, /Regenerate this section/);
});

test("Offline creation does not require a connection; Online exposes the correct guide and retains the spend guard", () => {
  const project = fixture();
  const offline = panel(project, sound(), { providerReady: false });
  assert.doesNotMatch(offline, /Connect sound generation/);
  const online = panel(project, sound(), {
    testMode: false,
    providerReady: false,
  });
  assert.match(online, /Connect sound generation/);
  assert.match(online, /Connect fal.ai for soundtrack/);
  assert.match(online, /Hold to generate/);
});
