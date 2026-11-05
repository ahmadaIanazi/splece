import { validateAudio } from "../server/audio.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID as id } from "node:crypto";
import {
  dialogueScript,
  dialogueInput,
  DIALOGUE_MODEL,
  DIALOGUE_RATE,
} from "../shared/soundtrack-dialogue.mjs";
import {
  createSoundtrackPlan,
  applySoundtrackResults,
  soundtrackDirtyClips,
  followSoundtrackEdits,
} from "../shared/soundtrack.mjs";
import {
  soundEstimate,
  soundParts,
  soundtrackCostRecords,
  SOUND_RATE,
} from "../shared/soundtrack-ai.mjs";
import { FalSoundtrackAdapter } from "../server/adapters/fal-soundtrack.mjs";
import {
  createSoundtrackService,
  renderTestSound,
} from "../server/soundtrack.mjs";
import { joinDialogue } from "../server/soundtrack-media.mjs";
import { probe } from "../server/media.mjs";
import { openStore } from "../server/store.mjs";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { saveStudioMode } from "../server/mode.mjs";
function fixture() {
  const p = upgradeProject(newProject("Dialogue fixture"));
  p.assets = [
    {
      id: "a",
      kind: "character",
      name: "Layla",
      gender: "female",
      voice: {
        language: "Arabic",
        accent: "Khaleeji",
        tone: "Warm",
        pace: "Unhurried",
      },
    },
    {
      id: "b",
      kind: "character",
      name: "Sam",
      gender: "male",
      voice: { language: "English", tone: "Calm" },
    },
  ];
  p.clips = [
    {
      id: "c",
      draftId: "d",
      start: 4,
      in: 0,
      duration: 6,
      activeTake: "m",
      takes: [{ id: "m", duration: 6 }],
    },
  ];
  p.drafts = [
    {
      id: "d",
      name: "Quiet room",
      scenes: [
        {
          duration: 3,
          text: "They talk.",
          dialogue: [
            { speaker: "a", text: "أين الماء؟", delivery: "whispers" },
            {
              speaker: "b",
              text: "It's here. Don't worry.",
              delivery: "softly",
            },
          ],
        },
      ],
    },
  ];
  return p;
}
function ready(p) {
  const r = createSoundtrackPlan(p, { roles: ["dialogue"] }, id);
  r.units.forEach((u) => {
    u.state = "ready";
    u.media = {
      id: u.id,
      name: "Dialogue",
      duration: u.duration,
      kind: "audio",
    };
  });
  return r;
}
test("dialogue preserves exact multilingual lines, maps speakers and applies identity as nonspoken direction", () => {
  const p = fixture(),
    lines = dialogueScript(p, p.clips[0]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].providerVoice, "Sarah");
  assert.equal(lines[1].providerVoice, "George");
  const request = dialogueInput(lines[0]);
  assert.ok(request.text.endsWith("أين الماء؟"));
  assert.ok(request.text.includes("[Khaleeji accent]"));
  assert.equal(request.language_code, "ar");
  assert.equal(request.apply_text_normalization, "off");
  assert.ok(!request.text.includes("They talk"));
  p.production.voiceAssignments = { a: "Lily" };
  assert.equal(dialogueScript(p, p.clips[0])[0].providerVoice, "Lily");
  p.drafts[0].scenes[0].dialogue[0].speaker = "missing";
  assert.throws(
    () => createSoundtrackPlan(p, { roles: ["dialogue"] }, id),
    /Assign a character/,
  );
});
test("script and voice edits dirty dialogue; moving picture follows sound without regeneration; deleted lines clear old track", () => {
  const p = fixture(),
    run = ready(p);
  applySoundtrackResults(p, run);
  assert.equal(soundtrackDirtyClips(p).size, 0);
  const moved = structuredClone(p);
  moved.clips[0].start = 9;
  followSoundtrackEdits(p, moved);
  assert.equal(moved.audioClips[0].start, 9);
  assert.equal(soundtrackDirtyClips(moved).size, 0);
  p.assets[0].voice.accent = "Najdi";
  assert.ok(soundtrackDirtyClips(p).has("c"));
  const updated = ready(p);
  applySoundtrackResults(p, updated);
  assert.equal(soundtrackDirtyClips(p).size, 0);
  p.drafts[0].scenes[0].dialogue[0].text = "Changed line";
  assert.ok(soundtrackDirtyClips(p).has("c"));
  p.drafts[0].scenes[0].dialogue = [];
  const clear = ready(p);
  assert.ok(clear.units[0].clearDialogue);
  applySoundtrackResults(p, clear);
  assert.equal(p.audioClips.length, 0);
});
test("dialogue estimates charge characters including direction, not duration; stale/overlong recordings stay in Assets", () => {
  const p = fixture(),
    run = ready(p),
    estimate = soundEstimate(run);
  const chars = dialogueScript(p, p.clips[0]).reduce(
    (n, l) => n + Array.from(dialogueInput(l).text).length,
    0,
  );
  assert.equal(estimate.layers.at(-1).characters, chars);
  assert.equal(estimate.requests, 2);
  assert.equal(
    estimate.amount,
    Math.round(chars * DIALOGUE_RATE.rate * 1e6) / 1e6,
  );
  run.executionMode = "live";
  run.estimate = estimate;
  run.units[0].parts = soundParts(run.units[0]);
  run.units[0].parts[0].providerJobId = "accepted-request";
  const costs = soundtrackCostRecords(run);
  assert.equal(costs[0].model, DIALOGUE_MODEL);
  assert.equal(costs[0].status, "estimated");
  run.units[0].needsTiming = true;
  run.units[0].outputDuration = 8;
  run.units[0].media.duration = 8;
  applySoundtrackResults(p, run);
  assert.equal(p.audioClips.length, 0);
  assert.equal(p.assets[2].media.duration, 8);
  assert.equal(p.production.audioPlans[0].cues[0].status, "needs-review");
});
test("fal speech uses the verified schema, character pricing, audio result and model-aware recovery URL", async () => {
  const calls = [];
  const adapter = new FalSoundtrackAdapter({
    key: "fake",
    allowSubmit: async () => true,
    transport: async (url, options) => {
      calls.push([url, options]);
      if (url.includes("pricing"))
        return Response.json({
          prices: [
            {
              endpoint_id: DIALOGUE_MODEL,
              currency: "USD",
              unit: "1000 characters",
              unit_price: 0.1,
            },
          ],
        });
      if (options.method === "POST")
        return Response.json({
          request_id: "speech-request-123",
          status_url:
            "https://queue.fal.run/fal-ai/elevenlabs/requests/speech-request-123/status",
          response_url:
            "https://queue.fal.run/fal-ai/elevenlabs/requests/speech-request-123",
        });
      if (url.endsWith("/status"))
        return Response.json({ status: "COMPLETED" });
      return Response.json({
        audio: { url: "https://v3.fal.media/speech.mp3" },
      });
    },
  });
  assert.equal((await adapter.pricing(DIALOGUE_MODEL)).rate, 0.0001);
  const input = dialogueInput(dialogueScript(fixture(), fixture().clips[0])[0]);
  const saved = await adapter.submitSound(input, DIALOGUE_MODEL);
  assert.ok(calls[1][0].endsWith(DIALOGUE_MODEL));
  assert.deepEqual(JSON.parse(calls[1][1].body), input);
  const result = await adapter.pollSound({
    providerJobId: saved.providerJobId,
    model: DIALOGUE_MODEL,
  });
  assert.equal(result.downloadUrl, "https://v3.fal.media/speech.mp3");
  assert.ok(calls[2][0].includes("/fal-ai/elevenlabs/requests/"));
});
async function sandbox(fn) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "splece-dialogue-")),
    store = openStore(path.join(folder, "db.sqlite"));
  const services = [];
  try {
    const p = fixture();
    p.folder = folder;
    const revision = store.save(p, 0);
    store.putMedia({
      id: "m",
      projectId: p.id,
      path: path.join(folder, "dummy.mp4"),
      duration: 6,
    });
    await saveStudioMode(folder, "test");
    await fn({
      folder,
      store,
      p,
      revision,
      track: (s) => {
        services.push(s);
        return s;
      },
    });
  } finally {
    services.forEach((s) => s.close());
    store.db.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
}
test("Test dialogue creates local playable audio and never constructs a provider or uploads visuals", () =>
  sandbox(async ({ folder, store, p, revision, track }) => {
    const blocked = () => {
      throw Error("Network must remain unused");
    };
    const service = track(
      createSoundtrackService({
        store,
        data: folder,
        adapterFactory: blocked,
        visual: blocked,
        downloadSpeech: blocked,
      }),
    );
    const quote = await service.estimate(p.id, { roles: ["dialogue"] });
    assert.equal(quote.cost, 0);
    const run = await service.submit(p.id, {
      revision,
      roles: ["dialogue"],
      requestId: "local-only",
    });
    await service.tick();
    const done = service.get(run.id);
    assert.equal(done.state, "ready");
    assert.equal(done.units[0].media.duration, 6);
    applySoundtrackResults(p, done);
    validateAudio(p.audioClips);
    store.save(p, revision);
    assert.equal(
      store.get(p.id).project.audioClips[0].soundtrack.role,
      "dialogue",
    );
    assert.ok((await probe(done.units[0].media.path)).audio);
    assert.ok(soundtrackCostRecords(done).every((c) => c.amount === 0));
  }));
test("mocked live dialogue persists each speaker job, resumes without resubmission and keeps full overlong words", () =>
  sandbox(async ({ folder, store, p, revision, track }) => {
    await saveStudioMode(folder, "live");
    const posted = [];
    let pending = true;
    const adapter = {
      pricing: async (model) =>
        model === DIALOGUE_MODEL ? DIALOGUE_RATE : SOUND_RATE,
      submitSound: async (input, model) => {
        posted.push({ input, model });
        return { providerJobId: `speech-request-${posted.length}` };
      },
      pollSound: async () =>
        pending
          ? { state: "processing" }
          : { state: "ready", downloadUrl: "https://v3.fal.media/mock" },
    };
    const args = {
      store,
      data: folder,
      adapterFactory: async () => adapter,
      visual: () => {
        throw Error("Dialogue must not upload video");
      },
      downloadSpeech: async (_, output) => {
        await renderTestSound({ role: "dialogue", duration: 4 }, output);
        return 4;
      },
    };
    let service = track(createSoundtrackService(args));
    const quote = await service.estimate(p.id, { roles: ["dialogue"] });
    const r = await service.submit(p.id, {
      revision,
      roles: ["dialogue"],
      requestId: "live-mock",
      executionMode: "live",
      quoteId: quote.quoteId,
    });
    await service.tick();
    assert.equal(posted.length, 1);
    service.close();
    pending = false;
    const saved = service.get(r.id);
    saved.units[0].parts[0].nextPollAt = 0;
    store.db
      .prepare("UPDATE soundtrack_runs SET body=? WHERE id=?")
      .run(JSON.stringify(saved), r.id);
    service = track(createSoundtrackService(args));
    await service.tick();
    const done = service.get(r.id);
    assert.equal(done.state, "ready");
    assert.equal(posted.length, 2);
    assert.ok(posted.every((p) => p.model === DIALOGUE_MODEL));
    assert.ok(posted[0].input.text.endsWith("أين الماء؟"));
    assert.ok(done.units[0].needsTiming);
    assert.ok(done.units[0].originalMedia.duration > 8);
    assert.ok(done.units[0].media.duration < done.units[0].originalMedia.duration);
    assert.ok(done.units[0].parts.every(p=>p.tempo<=1.2));
    assert.ok(
      Math.abs(
        (await probe(done.units[0].media.path)).duration -
          done.units[0].media.duration,
      ) < 0.02,
    );
    applySoundtrackResults(p, done);
    assert.equal(p.audioClips.length, 0);
    assert.ok(p.assets.some((a) => a.id === done.units[0].id));
    // A reviewed result may already be acknowledged. The replacement must still
    // reach the editor, and repeated recovery must not create duplicate takes.
    store.save(p, revision);
    done.units[0].delivered = true;
    store.db.prepare("UPDATE soundtrack_runs SET body=? WHERE id=?")
      .run(JSON.stringify(done), done.id);
    const fitted = await service.fitTiming(p.id, done.id, {unitId: done.units[0].id});
    assert.equal(fitted.units[0].delivered, undefined);
    assert.equal(fitted.units[0].needsTiming, false);
    assert.equal(fitted.units[0].media.duration, 6);
    assert.equal(fitted.cost, 0);
    assert.equal(posted.length, 2, "timing recovery must not call the provider");
    assert.equal((await service.fitTiming(p.id, done.id, {unitId: done.units[0].id})).id, fitted.id);
    applySoundtrackResults(p, fitted);
    assert.equal(p.audioClips.length, 1);
    assert.equal(p.audioClips[0].duration, 6);
  }));
test("joining speech keeps full recordings sequentially and pads short speech without cropping", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "speech-join-"));
  try {
    const files = [0, 1].map((i) => path.join(folder, `${i}.wav`));
    for (const f of files)
      await renderTestSound({ role: "dialogue", duration: 2 }, f);
    const parts = [
      { start: 0, audioDuration: 2 },
      { start: 1, audioDuration: 2 },
    ];
    const output = path.join(folder, "joined.wav");
    const duration = await joinDialogue(parts, files, output, 3);
    assert.equal(duration, 4.12);
    assert.equal(parts[1].actualStart, 2.12);
    assert.equal((await probe(output)).duration, 4.12);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("updating spoken lines regenerates dialogue without recharging unchanged effects and ambience", () => {
  const p = fixture();
  const run = createSoundtrackPlan(p, {}, id);
  run.units.forEach((u) => {
    u.state = "ready";
    u.media = { id: u.id, name: u.role, duration: u.duration, kind: "audio" };
  });
  applySoundtrackResults(p, run);
  p.drafts[0].scenes[0].dialogue[0].text = "A new line.";
  const changed = createSoundtrackPlan(p, { changedOnly: true }, id);
  assert.deepEqual(
    changed.units.map((u) => u.role),
    ["dialogue"],
  );
});

test("highlighted dialogue keeps whole lines by onset and never clears a recording just because the range contains no new lines", () => {
  const p = fixture();
  const script = dialogueScript(p, p.clips[0]);
  const start = p.clips[0].start + script[1].start;
  const r = createSoundtrackPlan(
    p,
    { roles: ["dialogue"], range: { from: start, to: 10 } },
    id,
  );
  assert.equal(r.units.length, 1);
  assert.equal(r.units[0].lines.length, 1);
  assert.equal(r.units[0].lines[0].text, script[1].text);
  assert.equal(r.units[0].lines[0].start, 0);
  applySoundtrackResults(p, ready(p));
  assert.throws(() =>
    createSoundtrackPlan(
      p,
      { roles: ["dialogue"], range: { from: 9.8, to: 10 } },
      id,
    ),
  );
  assert.equal(p.audioClips.length, 1);
});

test("talking scenes use non-looping cue-based Foley without sending faces to the video sound model",()=>{
 const p=fixture(),run=createSoundtrackPlan(p,{roles:["effect"]},id);
 assert.equal(run.units[0].model,"fal-ai/elevenlabs/sound-effects/v2");
 assert.ok(soundParts(run.units[0]).every(p=>p.model===run.units[0].model));
});
