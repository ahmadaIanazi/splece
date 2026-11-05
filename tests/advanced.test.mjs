import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { newProject, compilePrompt, models } from "../server/domain.mjs";
import {
  upgradeProject,
  reuseGeneration,
  effectiveAutomation,
  resolveReferences,
  resolveBoundary,
  validatePreparation,
  switchEpisode,
  audioGain,
  exportSize,
  visibleClips,
  editAsset,
  restoreDraftsWithoutOverwrite,
} from "../shared/studio.mjs";
import { providerTransport } from "../server/security.mjs";
import { VeniceAdapter, KieAdapter } from "../server/providers.mjs";
import {
  createPortableStore,
  resolveProjectPath,
} from "../server/portable.mjs";
import { openStore } from "../server/store.mjs";
const project = () => upgradeProject(newProject("QA"));
test("A09/A14 inherited automations respect per-draft overrides", () => {
  const p = project(),
    d = p.drafts[0];
  d.automation = {};
  p.settings.automation.characters = false;
  assert.equal(effectiveAutomation(p, d).characters, false);
  d.automation.characters = true;
  assert.equal(effectiveAutomation(p, d).characters, true);
  delete d.automation.characters;
  assert.equal(effectiveAutomation(p, d).characters, false);
});
test("A13/A18 timings, character casting, location and custom delivery compile without rewriting", () => {
  const p = project(),
    d = p.drafts[0];
  p.assets = [
    { id: "m", name: "Mira", kind: "character", description: "Traveler" },
    { id: "l", name: "Forest", kind: "location", description: "Misty" },
  ];
  d.referenceIds = ["m", "l"];
  Object.assign(d.scenes[0], {
    text: "Keep this EXACT!",
    duration: 7,
    characterIds: ["m"],
    locationId: "l",
    dialogue: [
      {
        speaker: "m",
        delivery: "Whispering",
        direction: "breathlessly",
        text: "Wait—please.",
      },
    ],
  });
  const r = compilePrompt(p, d);
  assert.match(r.text, /Keep this EXACT!/);
  assert.match(r.text, /Mira \(Whispering; breathlessly\): “Wait—please.”/);
  assert.match(r.text, /Location: Forest/);
  assert.ok(
    validatePreparation(p, d, r, models[0]).errors.some(
      (e) => e.code === "scene-timing",
    ),
  );
  assert.equal(d.scenes[0].duration, 7);
});
test("A17 manual and pinned boundary selections survive neighboring timeline changes", () => {
  const p = project(),
    d = p.drafts[0];
  d.frameOverrides.start = {
    mode: "pinned",
    frame: { takeId: "frozen", time: 2 },
  };
  p.clips = [{ id: "before", start: 0, duration: 5, in: 0, activeTake: "new" }];
  d.start = 5;
  assert.equal(compilePrompt(p, d).boundaries.start.takeId, "frozen");
  d.frameOverrides.start = { mode: "none" };
  assert.equal(compilePrompt(p, d).boundaries.start, null);
});
test("A21 structured variants are selected transparently and historical copies remain immutable", () => {
  const p = project(),
    d = p.drafts[0];
  p.assets = [
    {
      id: "hero",
      name: "Mira",
      kind: "character",
      version: 1,
      description: "Curly hair",
      variants: [
        {
          id: "winter",
          name: "Winter coat",
          description: "Wool coat",
          tags: { clothing: "winter" },
          media: { id: "image" },
        },
        {
          id: "summer",
          name: "Summer",
          description: "Linen",
          tags: { clothing: "summer" },
        },
      ],
    },
  ];
  d.referenceIds = ["hero"];
  d.scenes[0].text = "Mira walks through winter snow.";
  let r = resolveReferences(p, d);
  assert.equal(r[0].selectedVariant.id, "winter");
  assert.match(r[0].selectionOrigin, /analyzed look match/);
  d.referenceOptions.hero = { variantId: "summer", role: "identity" };
  assert.equal(resolveReferences(p, d)[0].selectedVariant.id, "summer");
  editAsset(p, { ...p.assets[0], description: "Later identity" });
  assert.equal(p.assets[0].version, 2);
  assert.equal(p.assets[0].history[0].description, "Curly hair");
  assert.equal(r[0].description, "Wool coat"); // resolved look remains unchanged after editing the character
});
test("A22 prepared manual text is protected and prompt limit errors never truncate writing", () => {
  const p = project(),
    d = p.drafts[0];
  d.scenes[0].text = "x".repeat(6000);
  d.sectionOverrides.Scenes = "My reviewed short version";
  let r = compilePrompt(p, d);
  assert.match(r.text, /My reviewed short version/);
  assert.equal(d.scenes[0].text.length, 6000);
  delete d.sectionOverrides.Scenes;
  r = compilePrompt(p, d);
  assert.ok(
    validatePreparation(p, d, r, models[1]).errors.some(
      (e) => e.code === "prompt-limit",
    ),
  );
  assert.equal(d.scenes[0].text.length, 6000);
});
test("A16 required unsupported references block preparation and optional ones remain in draft", () => {
  const p = project(),
    d = p.drafts[0];
  p.assets = [
    {
      id: "place",
      name: "Forest",
      kind: "location",
      description: "Trees",
      media: { id: "img" },
    },
  ];
  d.referenceIds = ["place"];
  d.referenceOptions.place = { role: "location", required: true };
  let v = validatePreparation(p, d, compilePrompt(p, d), models[1]);
  assert.ok(v.errors.some((e) => e.code === "unsupported-reference"));
  d.referenceOptions.place.required = false;
  v = validatePreparation(p, d, compilePrompt(p, d), models[1]);
  assert.ok(v.warnings.some((e) => e.code === "unsupported-reference"));
  assert.deepEqual(d.referenceIds, ["place"]);
});
test("A01 independent episodes restore clips, audio and fixed-time remarks", () => {
  const p = project(),
    first = p.episodeId;
  p.clips = [{ id: "clip" }];
  p.audioClips = [{ id: "music" }];
  p.remarks = [{ start: 2, end: 4, text: "Hook" }];
  switchEpisode(p, null, "Episode 02");
  assert.deepEqual(p.clips, []);
  p.clips = [{ id: "second" }];
  switchEpisode(p, first);
  assert.equal(p.clips[0].id, "clip");
  assert.equal(p.audioClips[0].id, "music");
  assert.equal(p.remarks[0].start, 2);
});
test("A12 conflict recovery keeps local and remote drafts as separate copies", () => {
  const remote = project(),
    local = structuredClone(remote);
  remote.drafts[0].scenes[0].text = "Remote writing";
  local.drafts[0].scenes[0].text = "Local writing";
  const merged = restoreDraftsWithoutOverwrite(remote, local);
  assert.equal(merged.drafts.length, 2);
  assert.equal(merged.drafts[0].scenes[0].text, "Remote writing");
  assert.equal(merged.drafts[1].scenes[0].text, "Local writing");
  assert.notEqual(merged.drafts[0].id, merged.drafts[1].id);
});
test("A33 audio fade envelope and portrait/square export dimensions agree", () => {
  const c = { start: 2, duration: 8, volume: 0.8, fadeIn: 2, fadeOut: 2 };
  assert.equal(audioGain(c, 2), 0);
  assert.equal(audioGain(c, 3), 0.4);
  assert.equal(audioGain(c, 6), 0.8);
  assert.equal(audioGain(c, 9), 0.4);
  assert.equal(audioGain({ ...c, mute: true }, 6), 0);
  assert.deepEqual(
    exportSize({ aspect: "9:16", resolution: "1080p" }),
    [1080, 1920],
  );
  assert.deepEqual(
    exportSize({ aspect: "1:1", resolution: "720p" }),
    [720, 720],
  );
});
test("A35 timeline virtualization only renders nearby clips for a long episode", () => {
  const clips = Array.from({ length: 10000 }, (_, i) => ({
    id: String(i),
    start: i * 5,
    duration: 5,
  }));
  const visible = visibleClips(clips, 60000, 1200, 60);
  assert.ok(visible.length < 10);
  assert.ok(visible.every((c) => c.start > 900));
});
test("A34 demo network guard blocks submission and preparation before any fetch", async () => {
  let calls = 0;
  const transport = providerTransport({
    demo: true,
    fetcher: async () => {
      calls++;
    },
  });
  await assert.rejects(
    () => transport("https://api.venice.ai/api/v1/video/queue"),
    (e) => e.code === "DEMO_NETWORK_BLOCKED",
  );
  await assert.rejects(
    () => transport("https://api.kie.ai/api/v1/jobs/createTask"),
    (e) => e.code === "DEMO_NETWORK_BLOCKED",
  );
  assert.equal(calls, 0);
});
test("A26 Venice adapter preserves queue ID and download URL without copying credentials into records", async () => {
  const adapter = new VeniceAdapter({
    key: "test-only-secret",
    transport: async () =>
      new Response(
        JSON.stringify({
          queue_id: "accepted",
          model: "wan",
          download_url: "https://private-share.venice.ai/result",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  });
  const p = project(),
    snapshot = { draft: p.drafts[0], compiled: compilePrompt(p, p.drafts[0]) };
  const result = await adapter.submit(snapshot);
  assert.equal(result.providerJobId, "accepted");
  assert.ok(result.downloadUrl);
  assert.ok(!JSON.stringify(result).includes("test-only-secret"));
});
test("A27 accepted-but-lost provider responses are uncertain, never automatically resubmitted", async () => {
  let calls = 0;
  const adapter = new VeniceAdapter({
    transport: async () => {
      calls++;
      throw new Error("Connection lost");
    },
  });
  const p = project();
  await assert.rejects(
    () =>
      adapter.submit({
        draft: p.drafts[0],
        compiled: compilePrompt(p, p.drafts[0]),
      }),
    (e) => e.stage === "submission_uncertain",
  );
  assert.equal(calls, 1);
});
test("A28 Kie checks body-level errors even when HTTP status is 200", async () => {
  const adapter = new KieAdapter({
    transport: async () =>
      new Response(JSON.stringify({ code: 429, msg: "Rate limited" }), {
        status: 200,
      }),
  });
  const p = project();
  await assert.rejects(
    () =>
      adapter.submit({
        draft: p.drafts[0],
        compiled: compilePrompt(p, p.drafts[0]),
      }),
    (e) => e.status === 429,
  );
});
test("A29 Venice retrieve handles binary video and JSON completion", async () => {
  const binary = new VeniceAdapter({
    transport: async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "video/mp4" },
      }),
  });
  assert.deepEqual(
    (await binary.poll({ model: "m", providerJobId: "id" })).bytes,
    new Uint8Array([1, 2, 3]),
  );
  const json = new VeniceAdapter({
    transport: async () =>
      new Response(JSON.stringify({ status: "COMPLETED" }), {
        headers: { "Content-Type": "application/json" },
      }),
  });
  assert.equal(
    (
      await json.poll({
        model: "m",
        providerJobId: "id",
        downloadUrl: "saved-url",
      })
    ).downloadUrl,
    "saved-url",
  );
});
test("A12 failed disk transaction never advances acknowledged revision", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frame-failure-"));
  const store = openStore(path.join(dir, "test.sqlite"));
  try {
    const p = project();
    store.save(p, 0);
    store.db.exec(
      "CREATE TRIGGER fail_save BEFORE INSERT ON projects BEGIN SELECT RAISE(FAIL, 'simulated disk full'); END;",
    );
    assert.throws(
      () => store.save({ ...p, name: "Changed" }, 1),
      /simulated disk full/,
    );
    assert.equal(store.get(p.id).revision, 1);
    assert.equal(store.get(p.id).project.name, "QA");
  } finally {
    store.db.close();
    await fs.rm(dir, { recursive: true });
  }
});
test("A01/A11 portable copy restores media and full revision history without changing original project", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frame-portable-"));
  const store = openStore(path.join(dir, "test.sqlite"));
  try {
    const p = project();
    p.folder = path.join(dir, "original");
    await fs.mkdir(path.join(p.folder, "media"), { recursive: true });
    await fs.writeFile(path.join(p.folder, "media", "sample.mp4"), "fixture");
    await fs.writeFile(path.join(p.folder, "media", "sample.jpg"), "fixture");
    store.save(p, 0);
    p.drafts[0].scenes[0].text = "Saved revision";
    store.save(p, 1);
    store.putMedia({
      id: "media-id",
      projectId: p.id,
      path: path.join(p.folder, "media", "sample.mp4"),
      poster: path.join(p.folder, "media", "sample.jpg"),
      url: "/api/media/media-id",
      thumbnail: "/api/media/media-id/thumbnail",
    });
    const portable = createPortableStore(store);
    await portable.checkpoint(p.id);
    const alias = path.join(dir, "original-alias");
    await fs.symlink(p.folder, alias);
    const reopened = await portable.open(alias);
    assert.equal(
      reopened.project.id,
      p.id,
      "Folder aliases reopen the same project",
    );
    const copy = path.join(dir, "copy");
    await fs.cp(p.folder, copy, { recursive: true });
    const opened = await portable.open(copy);
    assert.notEqual(opened.project.id, p.id);
    assert.equal(opened.project.drafts[0].scenes[0].text, "Saved revision");
    assert.equal(store.media("media-id").projectId, p.id);
    assert.ok(
      store.db
        .prepare("SELECT COUNT(*) n FROM history WHERE projectId=?")
        .get(opened.project.id).n >= 3,
    );
    const bundle = JSON.parse(
      await fs.readFile(path.join(copy, ".frame", "project.bundle.json")),
    );
    assert.equal(bundle.media[0].path, "media/sample.mp4");
    assert.throws(() => resolveProjectPath(copy, "../escape.mp4"));
  } finally {
    store.db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("A20/A32 reuse preserves exact compiled wording, casting and defaults after library/template drift", () => {
  const p = project(),
    d = p.drafts[0];
  p.assets = [
    {
      id: "hero",
      name: "Mira",
      kind: "character",
      description: "Original face",
      version: 1,
      variants: [],
    },
  ];
  d.referenceIds = ["hero"];
  d.scenes[0].characterIds = ["hero"];
  d.scenes[0].text = "Exact shot";
  const snapshot = structuredClone({
    draft: d,
    compiled: compilePrompt(p, d),
    template: p.settings,
  });
  p.settings.systemPrompt = "Changed global";
  p.settings.templates.characters = "Changed";
  p.assets[0].description = "New face";
  const reused = reuseGeneration(p, snapshot);
  assert.equal(compilePrompt(p, reused).text, snapshot.compiled.text);
  assert.equal(reused.scenes[0].characterIds[0], reused.referenceIds[0]);
  assert.notEqual(reused.referenceIds[0], "hero");
  assert.equal(
    p.assets.find((a) => a.id === reused.referenceIds[0]).description,
    "Original face",
  );
});

test("A23 Venice quote contains only pricing fields, never prompt or reference data", async () => {
  let body;
  const adapter = new VeniceAdapter({
    key: "fake",
    transport: async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({ quote: 1.2 }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const p = project(),
    d = p.drafts[0];
  const quote = await adapter.quote({
    draft: d,
    compiled: { text: "Private draft" },
    inputs: { start: "private-image" },
  });
  assert.equal(quote.quote, 1.2);
  assert.equal(body.prompt, undefined);
  assert.equal(body.image_url, undefined);
});
test("A32 retired models and changed capabilities block new submission without modifying saved inputs", () => {
  const p = project(),
    d = p.drafts[0],
    original = structuredClone(d);
  assert.ok(
    validatePreparation(p, d, compilePrompt(p, d), null).errors.some(
      (e) => e.code === "model-unavailable",
    ),
  );
  assert.ok(
    validatePreparation(p, d, compilePrompt(p, d), {
      ...models[0],
      durations: [2],
    }).errors.some((e) => e.code === "settings-changed"),
  );
  assert.deepEqual(d, original);
});

test("A16 multi-view variants count every image against provider limits", () => {
  const p = project(),
    d = p.drafts[0];
  p.assets = [
    {
      id: "hero",
      kind: "character",
      name: "Hero",
      variants: [
        {
          id: "v",
          name: "Coat",
          media: { id: "front" },
          mediaList: [{ id: "back" }, { id: "side" }],
        },
      ],
    },
  ];
  d.referenceIds = ["hero"];
  d.referenceOptions.hero = { variantId: "v" };
  const compiled = compilePrompt(p, d);
  assert.equal(compiled.references[0].selectedMediaList.length, 3);
  assert.ok(
    validatePreparation(p, d, compiled, {
      ...models[0],
      maxReferences: 2,
    }).errors.some((e) => e.code === "references"),
  );
});
test("A13 native Kie preparation preserves global direction and refuses silent truncation", () => {
  const p = project(),
    d = p.drafts[0];
  d.nativeMultiShot = true;
  d.settings.duration = 5;
  d.scenes[0].duration = 5;
  d.scenes[0].text = "Turn toward the light.";
  const adapter = new KieAdapter();
  const snapshot = { draft: d, compiled: compilePrompt(p, d) };
  const payload = adapter.payload(snapshot);
  assert.match(payload.input.multi_prompt[0].prompt, /Turn toward the light/);
  assert.match(
    payload.input.multi_prompt[0].prompt,
    /Maintain visual identity/,
  );
  d.scenes[0].text = "x".repeat(501);
  assert.throws(
    () => adapter.payload({ ...snapshot, draft: d }),
    /No text was truncated/,
  );
});
