import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SOUND_MODEL,
  SOUND_RATE,
  soundParts,
  soundEstimate,
  soundPrompt,
  soundtrackCostRecords,
} from "../shared/soundtrack-ai.mjs";
import { createSoundtrackPlan } from "../shared/soundtrack.mjs";
import {
  createSoundtrackService,
  renderTestSound,
} from "../server/soundtrack.mjs";
import { FalSoundtrackAdapter } from "../server/adapters/fal-soundtrack.mjs";
import {
  soundtrackVisual,
  joinSoundtrack,
} from "../server/soundtrack-media.mjs";
import { run as ffmpeg, probe } from "../server/media.mjs";
import { openStore } from "../server/store.mjs";
import { saveStudioMode } from "../server/mode.mjs";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { projectCostReport } from "../shared/costs.mjs";

function fixture() {
  const p = upgradeProject(newProject("Sound fixture"));
  p.clips = [
    {
      id: "c1",
      start: 0,
      in: 1,
      duration: 3,
      activeTake: "m1",
      takes: [{ id: "m1" }],
    },
    {
      id: "c2",
      start: 3,
      in: 0,
      duration: 3,
      activeTake: "m2",
      takes: [{ id: "m2" }],
    },
  ];
  p.drafts = [
    {
      id: "d1",
      targetId: "c1",
      name: "Wet street",
      scenes: [{ text: "Boots splash through a puddle." }],
    },
    {
      id: "d2",
      targetId: "c2",
      name: "Door",
      scenes: [{ text: "A rusty door closes." }],
    },
  ];
  return p;
}
async function sandbox(fn) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "splece-sound-live-"));
  const store = openStore(path.join(folder, "db.sqlite"));
  let service;
  try {
    const p = fixture();
    p.folder = folder;
    const revision = store.save(p, 0);
    for (const c of p.clips)
      store.putMedia({
        id: c.activeTake,
        projectId: p.id,
        path: path.join(folder, c.activeTake + ".mp4"),
        duration: 12,
      });
    await saveStudioMode(folder, "test");
    await fn({ folder, store, p, revision, setService: (s) => (service = s) });
  } finally {
    service?.close();
    store.db.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
}
const mockAdapter = (events, pending = false) => ({
  pricing: async () => {
    events.push("pricing");
    return { ...SOUND_RATE, basis: "provider" };
  },
  submitSound: async (input) => {
    events.push({ submit: input });
    return { providerJobId: "request-" + events.length };
  },
  pollSound: async (part) => {
    events.push({ poll: part.providerJobId });
    return pending
      ? { state: "processing" }
      : { state: "ready", downloadUrl: "https://fal.media/result.mp4" };
  },
  cancelSound: async (part) => events.push({ cancel: part.providerJobId }),
});
const fakeMedia = {
  visual: async () => "data:video/mp4;base64,TESTONLY",
  download: async (_url, file, duration) =>
    renderTestSound({ duration, role: "effect" }, file),
  join: joinSoundtrack,
};

test("MMAudio planning covers long beds, overlap and sub-second minimums; prompts use matching visual context only", () => {
  const u = { role: "ambience", duration: 61 };
  const parts = soundParts(u);
  assert.deepEqual(
    parts.map((p) => [p.start, p.duration, p.overlap]),
    [
      [0, 30, 0],
      [29, 30, 1],
      [58, 3, 1],
    ],
  );
  assert.equal(soundEstimate({ units: [u] }).amount, 0.063);
  assert.equal(
    soundParts({ role: "effect", duration: 0.2 })[0].modelDuration,
    1,
  );
  const p = fixture(),
    r = createSoundtrackPlan(p, {}, () => crypto.randomUUID());
  const effect = r.units[0],
    prompt = soundPrompt(r, effect, soundParts(effect)[0]);
  assert.match(prompt.prompt, /Water movement and splashes/);
  assert.match(prompt.prompt, /Hinge movement/);
  assert.match(prompt.negative_prompt, /dialogue/);
  const bed = r.units.at(-1);
  assert.doesNotMatch(soundPrompt(r, bed, soundParts(bed)[0]).prompt, /rusty door|Hinge|Boots/);
  assert.equal(soundEstimate(r).amount, 0.018);
});

test("Test estimate and generation never construct a live adapter, upload, or poll", async () =>
  sandbox(async ({ folder, store, p, revision, setService }) => {
    const service = createSoundtrackService({
      store,
      data: folder,
      adapterFactory: async () => {
        throw Error("NETWORK MUST NOT RUN");
      },
      visual: () => {
        throw Error("NO UPLOAD");
      },
    });
    setService(service);
    const estimate = await service.estimate(p.id, {});
    assert.equal(estimate.cost, 0);
    assert.equal(estimate.estimate.amount, 0.018);
    const r = await service.submit(p.id, { revision, executionMode: "test" });
    await service.tick();
    assert.equal(service.get(r.id).state, "ready");
    assert.ok(
      soundtrackCostRecords(service.get(r.id)).every(
        (c) => c.test && c.amount === 0,
      ),
    );
  }));

test("live adapter maps the documented API, validates prices and preserves uncertain submissions", async () => {
  const calls = [];
  const adapter = new FalSoundtrackAdapter({
    key: "FAKE",
    allowSubmit: async () => true,
    transport: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("pricing"))
        return Response.json({
          prices: [
            {
              endpoint_id: SOUND_MODEL,
              unit_price: 0.001,
              currency: "USD",
              unit: "seconds",
            },
          ],
        });
      if (options.method === "POST")
        return Response.json({
          request_id: "request-123",
          status_url: `https://queue.fal.run/${SOUND_MODEL}/requests/request-123/status`,
          response_url: `https://queue.fal.run/${SOUND_MODEL}/requests/request-123`,
        });
      if (url.endsWith("/status"))
        return Response.json({ status: "COMPLETED" });
      return Response.json({ video: { url: "https://fal.media/output.mp4" } });
    },
  });
  assert.equal((await adapter.pricing()).rate, 0.001);
  const job = await adapter.submitSound({
    video_url: "data:video/mp4;base64,TEST",
    prompt: "footsteps",
    duration: 3,
  });
  assert.equal(
    (await adapter.pollSound(job)).downloadUrl,
    "https://fal.media/output.mp4",
  );
  assert.equal(JSON.parse(calls[1].options.body).duration, 3);
  assert.equal(calls[1].options.headers.Authorization, "Key FAKE");
  const blocked = new FalSoundtrackAdapter({
    transport: () => {
      throw Error("unreachable");
    },
  });
  await assert.rejects(() => blocked.submitSound({}), /Offline mode/);
  const uncertain = new FalSoundtrackAdapter({
    allowSubmit: async () => true,
    transport: async () => {
      throw Error("connection lost");
    },
  });
  await assert.rejects(
    () =>
      uncertain.submitSound({
        video_url: "data:video/mp4;base64,VEVTVA==",
        prompt: "Footsteps",
      }),
    (e) => e.uncertain === true,
  );
});

test("live worker uses frozen successful-take writing, saves provider handles, resumes without duplicate spending, and bills estimates", async () =>
  sandbox(async ({ folder, store, p, revision, setService }) => {
    const events = [];
    let adapter = mockAdapter(events, true);
    p.clips[0].takes[0].jobId = "video-job";
    store.putJob({
      id: "video-job",
      projectId: p.id,
      kind: "generation",
      state: "ready",
      snapshot: {
        draft: {
          name: "Original take",
          scenes: [{ text: "Pebbles fall from the arch." }],
        },
      },
    });
    const rev = store.save(p, revision);
    const opts = {
      store,
      data: folder,
      adapterFactory: async () => adapter,
      ...fakeMedia,
    };
    let service = createSoundtrackService(opts);
    setService(service);
    await saveStudioMode(folder, "live"); // Isolated temporary settings + mock transport; never the user's mode/key.
    const quote = await service.estimate(p.id, {
      roles: ["effect"],
      clipIds: ["c1"],
    });
    const options = {
      revision: rev,
      roles: ["effect"],
      clipIds: ["c1"],
      executionMode: "live",
      quoteId: quote.quoteId,
      requestId: "same",
    };
    const results = await Promise.all([
      service.submit(p.id, options),
      service.submit(p.id, options),
    ]);
    assert.equal(results[0].id, results[1].id);
    await service.tick();
    const r = service.get(results[0].id);
    assert.ok(r.units[0].parts[0].providerJobId);
    assert.match(events.find((e) => e.submit).submit.prompt, /Pebble and stone contacts/);
    assert.doesNotMatch(
      events.find((e) => e.submit).submit.prompt,
      /Boots splash/,
    );
    service.close();
    r.units[0].parts[0].nextPollAt = 0;
    store.db
      .prepare("UPDATE soundtrack_runs SET body=? WHERE id=?")
      .run(JSON.stringify(r), r.id);
    adapter = mockAdapter(events);
    service = createSoundtrackService(opts);
    setService(service);
    await service.tick();
    const ready = service.get(r.id);
    assert.equal(ready.state, "ready");
    assert.equal(events.filter((e) => e.submit).length, 1);
    const costs = soundtrackCostRecords(ready);
    assert.equal(costs[0].status, "estimated");
    assert.equal(costs[0].amount, 0.003);
    assert.equal(projectCostReport(p, costs).total, 0.003);
    assert.ok(
      !JSON.stringify(service.listViews(p.id)).includes("Pebbles fall"),
    );
    await assert.rejects(
      () => service.submit(p.id, { ...options, requestId: "new" }),
      /fresh Online/,
    );
  }));

test("changed estimates, mode changes, and uncertain handles block new charges; recovery only retrieves", async () =>
  sandbox(async ({ folder, store, p, revision, setService }) => {
    const events = [];
    const adapter = mockAdapter(events);
    adapter.submitSound = async () => {
      events.push("submit");
      throw Object.assign(Error("Lost response"), { uncertain: true });
    };
    const service = createSoundtrackService({
      store,
      data: folder,
      adapterFactory: async () => adapter,
      ...fakeMedia,
    });
    setService(service);
    await saveStudioMode(folder, "live");
    const quote = await service.estimate(p.id, {
      roles: ["effect"],
      clipIds: ["c1"],
    });
    const options = {
      revision,
      executionMode: "live",
      quoteId: quote.quoteId,
      roles: ["effect"],
      clipIds: ["c1"],
    };
    await assert.rejects(
      () => service.submit(p.id, { ...options, direction: "Different" }),
      /fresh Online/,
    );
    await saveStudioMode(folder, "test");
    await assert.rejects(() => service.submit(p.id, options), /mode changed/);
    await saveStudioMode(folder, "live");
    const r = await service.submit(p.id, options);
    await service.tick();
    assert.equal(service.get(r.id).state, "failed");
    await assert.rejects(() => service.retry(p.id, r.id), /uncertain/);
    service.recover(p.id, r.id, {
      unitId: r.units[0].id,
      index: 0,
      requestId: "recovered-request",
    });
    await service.retry(p.id, r.id);
    await service.tick();
    assert.equal(service.get(r.id).state, "ready");
    assert.equal(events.filter((e) => e === "submit").length, 1);
  }));

test("visual windows stitch trimmed picture without source audio; overlapping output joins have exact duration", async () =>
  sandbox(async ({ folder, store, p }) => {
    for (const [i, c] of p.clips.entries())
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        `color=c=${i ? "blue" : "red"}:s=160x90:r=24:d=12`,
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=12",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        store.media(c.activeTake).path,
      ]);
    const plan = createSoundtrackPlan(p, { roles: ["ambience"] }, () =>
        crypto.randomUUID(),
      ),
      unit = plan.units[0];
    const part = { start: 2, duration: 3, modelDuration: 3 };
    const data = await soundtrackVisual(
      unit,
      part,
      path.join(folder, "visuals"),
      store,
    );
    assert.match(data, /^data:video\/mp4;base64,/);
    const info = await probe(path.join(folder, "visuals", "visual.mp4"));
    assert.equal(info.audio, false);
    assert.equal(info.duration, 3);
    // Two shorter mocked sections exercise the same overlap join used for 30-second provider windows.
    const parts = [
        { duration: 3, overlap: 0 },
        { duration: 3, overlap: 1 },
      ],
      files = [path.join(folder, "a.wav"), path.join(folder, "b.wav")];
    for (let i = 0; i < 2; i++)
      await renderTestSound({ role: "ambience", duration: 3 }, files[i]);
    const output = path.join(folder, "joined.wav");
    await joinSoundtrack(parts, files, output, 5);
    assert.ok((await fs.stat(output)).size < 1_000_000, "normalization must not leave a 192 kHz browser playback file");
    assert.equal((await probe(output)).duration, 5);
  }));

test("accepted jobs pause all provider IO in Test and retry downloads without repeating generation", async () =>
  sandbox(async ({ folder, store, p, revision, setService }) => {
    const events = [];
    let pending = true,
      failDownload = true;
    const adapter = mockAdapter(events);
    const poll = adapter.pollSound;
    adapter.pollSound = async (part) =>
      pending ? { state: "processing" } : poll(part);
    const service = createSoundtrackService({
      store,
      data: folder,
      adapterFactory: async () => {
        events.push("adapter");
        return adapter;
      },
      ...fakeMedia,
      download: async (...args) => {
        if (failDownload) throw Error("Transfer failed");
        return fakeMedia.download(...args);
      },
    });
    setService(service);
    await saveStudioMode(folder, "live");
    const options = { roles: ["ambience"], revision, executionMode: "live" };
    const quote = await service.estimate(p.id, options);
    const run = await service.submit(p.id, {
      ...options,
      quoteId: quote.quoteId,
    });
    await service.tick();
    await saveStudioMode(folder, "test");
    const before = events.length;
    await service.tick();
    assert.equal(events.length, before);
    assert.match(service.get(run.id).units[0].stage, /Paused/);
    await saveStudioMode(folder, "live");
    pending = false;
    let saved = service.get(run.id);
    saved.units[0].parts[0].nextPollAt = 0;
    store.db
      .prepare("UPDATE soundtrack_runs SET body=? WHERE id=?")
      .run(JSON.stringify(saved), run.id);
    await service.tick();
    assert.equal(service.get(run.id).state, "failed");
    saved = service.get(run.id);
    saved.units[0].parts[0].nextPollAt = 0;
    store.db
      .prepare("UPDATE soundtrack_runs SET body=? WHERE id=?")
      .run(JSON.stringify(saved), run.id);
    failDownload = false;
    await service.retry(p.id, run.id);
    await service.tick();
    assert.equal(service.get(run.id).state, "ready");
    assert.equal(events.filter((e) => e.submit).length, 1);
  }));

test("crash between POST and response becomes uncertain, never an automatic second POST", async () =>
  sandbox(async ({ folder, store, p, revision, setService }) => {
    const events = [],
      adapter = mockAdapter(events);
    let service = createSoundtrackService({
      store,
      data: folder,
      adapterFactory: async () => adapter,
      ...fakeMedia,
    });
    setService(service);
    await saveStudioMode(folder, "live");
    const options = {
      roles: ["effect"],
      clipIds: ["c1"],
      revision,
      executionMode: "live",
    };
    const quote = await service.estimate(p.id, options),
      run = await service.submit(p.id, { ...options, quoteId: quote.quoteId });
    run.state = "processing";
    run.units[0].state = "processing";
    run.units[0].parts[0].state = "submitting";
    service.close();
    store.db
      .prepare("UPDATE soundtrack_runs SET state=?,body=? WHERE id=?")
      .run("processing", JSON.stringify(run), run.id);
    service = createSoundtrackService({
      store,
      data: folder,
      adapterFactory: async () => adapter,
      ...fakeMedia,
    });
    setService(service);
    await service.tick();
    assert.equal(service.get(run.id).state, "failed");
    assert.equal(
      service.get(run.id).units[0].parts[0].state,
      "submission_uncertain",
    );
    assert.equal(events.filter((e) => e.submit).length, 0);
    assert.equal(
      soundtrackCostRecords(service.get(run.id))[0].status,
      "unknown",
    );
  }));

test("long effects use maximum video windows across cuts with shared overlapping picture context", () => {
  const p = fixture();
  p.clips = Array.from({ length: 7 }, (_, i) => ({
    ...p.clips[0],
    id: `c${i}`,
    start: i * 10,
    duration: 10,
  }));
  const run = createSoundtrackPlan(p, { roles: ["effect"] }, () =>
    crypto.randomUUID(),
  );
  assert.equal(run.units.length, 1);
  const parts = soundParts(run.units[0]);
  assert.deepEqual(
    parts.map((p) => [p.start, p.duration]),
    [
      [0, 30],
      [29, 30],
      [58, 12],
    ],
  );
  assert.equal(soundEstimate(run).requests, 3);
  assert.equal(soundEstimate(run).seconds, 72);
});

test("fal validation failures expose field explanations without media echoes and mark terminal results", async () => {
  const adapter = new FalSoundtrackAdapter({
    allowSubmit: async () => true,
    transport: async (url) =>
      url.endsWith("/status")
        ? Response.json({ status: "COMPLETED" })
        : Response.json(
            {
              detail: [
                {
                  loc: ["body", "duration"],
                  msg: "Input should be less than or equal to 30",
                  input: "PRIVATE_MEDIA",
                },
                {
                  loc: ["body", "video_url"],
                  msg: "Cannot decode data:video/mp4;base64,SECRET",
                  input: "PRIVATE_PROMPT",
                },
              ],
            },
            { status: 422 },
          ),
  });
  await assert.rejects(
    () => adapter.pollSound({ providerJobId: "request-validation" }),
    (e) => {
      assert.equal(e.terminal, true);
      assert.match(e.message, /body.duration.*less than or equal to 30/);
      assert.doesNotMatch(e.message, /SECRET|PRIVATE/);
      return true;
    },
  );
});

test("a rejected accepted job stays terminal; retry cannot poll it forever or submit it twice", async () =>
  sandbox(async ({ folder, store, p, revision, setService }) => {
    const events = [];
    const adapter = mockAdapter(events);
    adapter.pollSound = async () => {
      throw Object.assign(Error("fal.ai (422) · video_url: invalid video"), {
        terminal: true,
      });
    };
    const service = createSoundtrackService({
      store,
      data: folder,
      adapterFactory: async () => adapter,
      ...fakeMedia,
    });
    setService(service);
    await saveStudioMode(folder, "live"); // Mocked transport only.
    const options = { roles: ["effect"] };
    const quote = await service.estimate(p.id, options);
    assert.equal(quote.windows.length, 1);
    assert.equal(quote.windows[0].clips, 2);
    const run = await service.submit(p.id, {
      ...options,
      revision,
      executionMode: "live",
      quoteId: quote.quoteId,
    });
    await service.tick();
    const failed = service.get(run.id);
    assert.equal(failed.state, "failed");
    assert.equal(failed.units[0].parts[0].terminal, true);
    await assert.rejects(
      () => service.retry(p.id, run.id, { unitId: failed.units[0].id }),
      /provider rejected/,
    );
    assert.equal(events.filter((e) => e.submit).length, 1);
  }));

test("retry quotes replace only the rejected window, retain successful bytes across restart, and preserve all attempt costs", async () =>
  sandbox(async ({ folder, store, p, revision, setService }) => {
    p.clips[0].start = 0;
    p.clips[0].duration = 31;
    p.clips[1].start = 31;
    p.clips[1].duration = 30;
    p.clips.forEach((c) =>
      store.putMedia({ ...store.media(c.activeTake), duration: 100 }),
    );
    const rev = store.save(p, revision);
    let submissions = 0;
    const adapter = {
      pricing: async () => ({ ...SOUND_RATE, basis: "provider" }),
      submitSound: async () => ({
        providerJobId: `retry-request-${++submissions}`,
      }),
      pollSound: async (part) => {
        if (part.providerJobId === "retry-request-2")
          throw Object.assign(
            Error(
              "fal.ai (422) · body.prompt: flagged by a content checker; body.video_url: flagged by a content checker",
            ),
            {
              terminal: true,
              code: "content_policy",
              fields: ["prompt", "video_url"],
            },
          );
        return { state: "ready", downloadUrl: "https://fal.media/result.mp4" };
      },
    };
    const opts = {
      store,
      data: folder,
      adapterFactory: async () => adapter,
      ...fakeMedia,
    };
    let service = createSoundtrackService(opts);
    setService(service);
    await saveStudioMode(folder, "live"); // Fake credentials/transport in a disposable test directory only.
    const quote = await service.estimate(p.id, { roles: ["effect"] });
    const run = await service.submit(p.id, {
      roles: ["effect"],
      revision: rev,
      quoteId: quote.quoteId,
      executionMode: "live",
    });
    await service.tick();
    let failed = service.get(run.id),
      unit = failed.units[0];
    assert.deepEqual(
      unit.parts.map((p) => p.state),
      ["ready", "failed", "queued"],
    );
    const successFile = path.join(
      folder,
      "media",
      "soundtrack",
      ".work-" + unit.id,
      "0.wav",
    );
    const successBytes = await fs.readFile(successFile);
    const retryBody = {
      unitId: unit.id,
      index: 1,
      direction: "Footsteps and soft rain.",
    };
    const retryQuote = await service.retryEstimate(p.id, run.id, retryBody);
    assert.equal(retryQuote.amount, 0.03);
    assert.equal(retryQuote.preserved, 1);
    assert.equal(retryQuote.failure.code, "content_policy");
    assert.match(retryQuote.input.prompt, /Footsteps and soft rain/);
    const request = {
      ...retryBody,
      quoteId: retryQuote.quoteId,
      executionMode: "live",
      requestId: "retry-just-second",
    };
    const [a, b] = await Promise.all([
      service.retry(p.id, run.id, request),
      service.retry(p.id, run.id, request),
    ]);
    assert.equal(a.id, b.id);
    service.close();
    service = createSoundtrackService(opts);
    setService(service);
    await service.tick();
    failed = service.get(run.id);
    unit = failed.units[0];
    assert.deepEqual(
      unit.parts.map((p) => p.state),
      ["ready", "ready", "queued"],
    );
    assert.equal(
      submissions,
      3,
      "successful first window was never submitted again",
    );
    assert.deepEqual(await fs.readFile(successFile), successBytes);
    assert.equal(unit.parts[0].providerJobId, "retry-request-1");
    assert.equal(unit.parts[1].attempts[0].providerJobId, "retry-request-2");
    await service.retry(p.id, run.id, request); // Client retry of a lost response is idempotent, including after restart.
    assert.equal(submissions, 3);
    const last = { unitId: unit.id, index: 2 };
    const lastQuote = await service.retryEstimate(p.id, run.id, last);
    assert.equal(lastQuote.amount, 0.003);
    await service.retry(p.id, run.id, {
      ...last,
      quoteId: lastQuote.quoteId,
      executionMode: "live",
      requestId: "continue-last",
    });
    await service.tick();
    const completed = service.get(run.id);
    assert.equal(completed.state, "ready");
    assert.equal(submissions, 4);
    const costs = soundtrackCostRecords(completed);
    assert.equal(new Set(costs.map((c) => c.key)).size, costs.length);
    assert.equal(costs.filter((c) => c.requestId).length, 4);
    assert.ok(
      Math.abs(costs.reduce((n, c) => n + (c.amount || 0), 0) - 0.093) < 1e-8,
    );
    assert.equal((await probe(store.media(unit.id).path)).duration, 61);
  }));

test("Test section retry keeps saved windows, rejects stale quotes, and retries joining without rendering again", async () =>
  sandbox(async ({ folder, store, p, revision, setService }) => {
    p.clips[0].duration = 30;
    p.clips[1].start = 30;
    p.clips[1].duration = 10;
    p.clips.forEach((c) =>
      store.putMedia({ ...store.media(c.activeTake), duration: 100 }),
    );
    let rev = store.save(p, revision),
      failRender = true,
      failJoin = true;
    const rendered = [];
    const service = createSoundtrackService({
      store,
      data: folder,
      adapterFactory: async () => {
        throw Error("No provider access in Test");
      },
      render: async (unit, ...args) => {
        rendered.push(unit.partIndex);
        if (unit.partIndex === 1 && failRender)
          throw Error("Synthetic local failure");
        return renderTestSound(unit, ...args);
      },
      join: async (...args) => {
        if (failJoin) throw Error("Synthetic join failure");
        return joinSoundtrack(...args);
      },
    });
    setService(service);
    const run = await service.submit(p.id, {
      roles: ["effect"],
      revision: rev,
      executionMode: "test",
    });
    await service.tick();
    const unit = service.get(run.id).units[0];
    assert.deepEqual(
      unit.parts.map((p) => p.state),
      ["ready", "failed"],
    );
    const body = { unitId: unit.id, index: 1 };
    await assert.rejects(
      service.retryEstimate(p.id, run.id, { ...body, index: 0 }),
      /not ready|failed|unfinished|completed/i,
    );
    const q = await service.retryEstimate(p.id, run.id, body);
    assert.equal(q.cost, 0);
    rev = store.save(p, rev);
    await assert.rejects(
      service.retry(p.id, run.id, {
        ...body,
        quoteId: q.quoteId,
        executionMode: "test",
      }),
      /fresh estimate/,
    );
    assert.deepEqual(rendered, [0, 1]);
    const fresh = await service.retryEstimate(p.id, run.id, body);
    failRender = false;
    await service.retry(p.id, run.id, {
      ...body,
      quoteId: fresh.quoteId,
      executionMode: "test",
      requestId: "local-retry",
    });
    await service.tick();
    assert.deepEqual(rendered, [0, 1, 1]);
    assert.equal(service.get(run.id).state, "failed");
    assert.ok(
      service.get(run.id).units[0].parts.every((p) => p.state === "ready"),
    );
    failJoin = false;
    await service.retry(p.id, run.id, { unitId: unit.id });
    await service.tick();
    assert.equal(service.get(run.id).state, "ready");
    assert.deepEqual(
      rendered,
      [0, 1, 1],
      "joining does not regenerate completed windows",
    );
    assert.ok(
      soundtrackCostRecords(service.get(run.id)).every((c) => c.amount === 0),
    );
  }));

test("MMAudio preflight follows required fields and bounds, and content failures have a distinct reason", async () => {
  const { validateSoundInput, soundFailure } =
    await import("../shared/soundtrack-retry.mjs");
  const good = {
    video_url: "data:video/mp4;base64,VEVTVA==",
    prompt: "Wind in trees",
    duration: 30,
    seed: 1793,
    num_steps: 25,
    cfg_strength: 4.5,
    mask_away_clip: false,
  };
  assert.deepEqual(validateSoundInput(good), good);
  for (const change of [
    { duration: 31 },
    { duration: 0.5 },
    { seed: 65536 },
    { num_steps: 3 },
    { cfg_strength: 21 },
    { prompt: [] },
    { mask_away_clip: "false" },
    { enable_safety_checker: false },
  ])
    assert.throws(
      () => validateSoundInput({ ...good, ...change }),
      /Sound input/,
    );
  let calls = 0;
  const adapter = new FalSoundtrackAdapter({
    allowSubmit: async () => true,
    transport: async () => {
      calls++;
      return Response.json(
        {
          detail: [
            {
              loc: ["body", "prompt"],
              msg: "The content could not be processed because it contained material flagged by a content checker.",
            },
            {
              loc: ["body", "video_url"],
              msg: "The content could not be processed because it contained material flagged by a content checker.",
            },
          ],
        },
        { status: 422 },
      );
    },
  });
  await assert.rejects(
    () => adapter.submitSound({ ...good, duration: 31 }),
    /duration/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () => adapter.submitSound(good),
    (e) => {
      assert.equal(e.code, "content_policy");
      assert.deepEqual(e.fields, ["prompt", "video_url"]);
      return true;
    },
  );
  assert.equal(
    soundFailure("fal.ai (422) · body.video_url: flagged by a content checker")
      .code,
    "content_policy",
  );
});

test("transient polling errors back off and retrieve the same accepted request",()=>sandbox(async({folder,store,p,revision,setService})=>{
 await saveStudioMode(folder,"live");const events=[];let polls=0;
 const adapter=mockAdapter(events);adapter.pollSound=async()=>{if(++polls===1)throw Error("The operation was aborted due to timeout");return {state:"ready",downloadUrl:"https://fal.media/saved.mp4"}};
 const service=createSoundtrackService({store,data:folder,adapterFactory:async()=>adapter,...fakeMedia});setService(service);
 const q=await service.estimate(p.id,{roles:["effect"]});const run=await service.submit(p.id,{roles:["effect"],executionMode:"live",quoteId:q.quoteId,revision});
 await service.tick();let saved=service.get(run.id);assert.equal(saved.state,"processing");assert.equal(saved.units[0].parts[0].readRetries,1);assert.equal(saved.units[0].parts[0].error,null);
 saved.units[0].parts[0].nextPollAt=0;store.db.prepare("UPDATE soundtrack_runs SET body=? WHERE id=?").run(JSON.stringify(saved),saved.id);
 await service.tick();saved=service.get(run.id);assert.equal(saved.state,"ready");assert.equal(events.filter(e=>e.submit).length,1);assert.equal(polls,2);
}));
