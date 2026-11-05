import {transientSoundRead} from "../shared/soundtrack-retry.mjs";
import { AMBIENCE_MODEL, AMBIENCE_RATE, ambienceInput } from "../shared/sound-design.mjs";
import { soundFailure } from "../shared/soundtrack-retry.mjs";
import {
  DIALOGUE_MODEL,
  DIALOGUE_RATE,
  dialogueInput,
} from "../shared/soundtrack-dialogue.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { studioMode } from "./mode.mjs";
import {
  createSoundtrackPlan,
  activeSoundtrackRun,
  soundReceipts,
  soundUnitState,
} from "../shared/soundtrack.mjs";

import { credentials } from "./connections.mjs";
import { FalSoundtrackAdapter } from "./adapters/fal-soundtrack.mjs";
import {
  SOUND_MODEL,
  SOUND_RATE,
  soundParts,
  soundEstimate,
  soundPrompt,
} from "../shared/soundtrack-ai.mjs";
import {
  soundtrackVisual,
  soundtrackDownload,
  joinSoundtrack,
  dialogueDownload,
  joinDialogue,
} from "./soundtrack-media.mjs";

// Deliberately no network transport in the Test adapter. These are synthetic
// audition fixtures, not claimed visual analysis or generated Foley.
export async function renderTestSound(
  unit,
  output,
  progress = () => {},
  cancelled = () => false,
) {
  const rate = 24000,
    samples = Math.round(unit.duration * rate);
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples * 2, 40);
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = output + ".partial",
    file = await fs.open(temporary, "w");
  let random = 7391,
    low = 0;
  try {
    await file.write(header);
    const buffer = Buffer.alloc(rate * 2);
    for (let at = 0; at < samples; at += rate) {
      if (cancelled()) throw Error("Soundtrack cancelled.");
      const count = Math.min(rate, samples - at);
      for (let i = 0; i < count; i++) {
        const t = (at + i) / rate;
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        const noise = random / 2147483648 - 1;
        low = low * 0.97 + noise * 0.03;
        const edge = Math.min(1, t / 0.05, (unit.duration - t) / 0.05);
        const pulse = Math.exp(-((t + 0.38) % 0.8) * 45);
        const value =
          unit.silence || unit.clearDialogue
            ? 0
            : unit.role === "dialogue"
              ? Math.sin(t * Math.PI * 2 * 220) *
                0.018 *
                (Math.sin(t * 7) > 0 ? 1 : 0)
              : unit.role === "ambience"
                ? low * 0.1 + Math.sin(t * Math.PI * 2 * 83) * 0.002
                : (noise * 0.045 + Math.sin(t * Math.PI * 2 * 110) * 0.035) *
                  pulse;
        buffer.writeInt16LE(Math.round(value * edge * 32767), i * 2);
      }
      await file.write(buffer, 0, count * 2);
      progress((at + count) / samples);
    }
  } finally {
    await file.close();
  }
  if (cancelled()) {
    await fs.rm(temporary, { force: true });
    throw Error("Soundtrack cancelled.");
  }
  await fs.rename(temporary, output);
}

export function createSoundtrackService({
  store,
  data,
  render = renderTestSound,
  adapterFactory = async () => {
    const key = await credentials(data, "fal").key();
    if (!key)
      throw Error(
        "Add your fal.ai API key in Connections to create a soundtrack in Online mode.",
      );
    return new FalSoundtrackAdapter({
      key,
      allowSubmit: async () => (await studioMode(data, "audio")) === "live",
    });
  },
  visual = soundtrackVisual,
  download = soundtrackDownload,
  join = joinSoundtrack,
  downloadSpeech = dialogueDownload,
  joinSpeech = joinDialogue,
}) {
  const db = store.db;
  db.exec(
    "CREATE TABLE IF NOT EXISTS soundtrack_runs(id TEXT PRIMARY KEY, projectId TEXT, episodeId TEXT, state TEXT, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS soundtrack_project ON soundtrack_runs(projectId,episodeId);",
  );
  const save = (run) => {
    const old = db
      .prepare("SELECT body FROM soundtrack_runs WHERE id=?")
      .get(run.id);
    if (old) {
      if (JSON.parse(old.body).state === "cancelled") run.state = "cancelled";
      const delivered = new Set(
        JSON.parse(old.body)
          .units.filter((u) => u.delivered)
          .map((u) => u.id),
      );
      for (const unit of run.units)
        if (delivered.has(unit.id)) unit.delivered = true;
    }
    db.prepare("INSERT OR REPLACE INTO soundtrack_runs VALUES(?,?,?,?,?)").run(
      run.id,
      run.projectId,
      run.episodeId,
      run.state,
      JSON.stringify(run),
    );
  };
  const get = (id) => {
    const row = db
      .prepare("SELECT body FROM soundtrack_runs WHERE id=?")
      .get(id);
    return row && JSON.parse(row.body);
  };
  const list = (projectId) =>
    db
      .prepare(
        "SELECT body FROM soundtrack_runs WHERE projectId=? ORDER BY json_extract(body,'$.createdAt') DESC, id DESC LIMIT 100",
      )
      .all(projectId)
      .map((r) => JSON.parse(r.body));
  const quotes = new Map();
  const rates = new Map();
  async function price(model = SOUND_MODEL) {
    const cached = rates.get(model);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const entry = { expires: Date.now() + 60000 };
    entry.promise = adapterFactory().then(a => a.pricing(model)).catch(e => { if (rates.get(model) === entry) rates.delete(model); throw e; });
    rates.set(model, entry);
    return entry.promise;
  }
  const fingerprint = (run) =>
    createHash("sha256")
      .update(
        JSON.stringify({
          sources: run.sources,
          contexts: run.contexts,
          direction: run.direction,
          workflowSettings: run.workflowSettings,
          units: run.units.map((u) => ({
            role: u.role,
            sources: u.sources,
            start: u.start,
            duration: u.duration,
            scriptSignature: u.scriptSignature,
            reviewDialogue: u.reviewDialogue,
            partialRange: u.partialRange,
          })),
          changedOnly: run.changedOnly,
        }),
      )
      .digest("hex");
  function plan(projectId, options) {
    const record = store.get(projectId);
    if (!record)
      throw Object.assign(Error("Project not found."), { status: 404 });
    const run = createSoundtrackPlan(record.project, options, randomUUID);
    run.workflowSettings = {workflows: structuredClone(record.project.settings.workflows)};
    for (const source of run.sources) {
      const media = store.media(source.mediaId);
      if (
        !media ||
        media.projectId !== projectId ||
        source.in + source.duration > media.duration + 0.1
      )
        throw Error(
          "A soundtrack source is unavailable or outside its footage.",
        );
      const clip = record.project.clips.find((c) => c.id === source.clipId);
      const take = clip.takes.find((t) => t.id === clip.activeTake);
      const snapshot = take.jobId ? store.job(take.jobId)?.snapshot : null;
      const context = run.contexts.find((c) => c.clipId === source.clipId);
      // The successful take's writing is the authority, not a subsequently edited draft.
      if (snapshot?.draft) {
        context.description = "";
        context.title = snapshot.draft.name;
        context.scenes = snapshot.draft.scenes || [];
        context.notes = snapshot.draft.notes || "";
        context.visualPrompt = String(
          snapshot.compiled?.text ||
            snapshot.compiled?.prompt ||
            snapshot.requestPayload?.prompt ||
            "",
        ).slice(0, 6000);
      }
    }
    return { record, run };
  }
  async function estimate(projectId, options) {
    const { run } = plan(projectId, options);
    const mode = (await studioMode(data, "audio")) === "live" ? "live" : "test";
    const rate =
      mode === "live" && run.units.some(u => u.role === "effect" || (u.role === "ambience" && !u.model)) ? await price() : SOUND_RATE;
    const dialogueRate =
      mode === "live" &&
      run.units.some((u) => u.role === "dialogue" && u.lines.length)
        ? await price(DIALOGUE_MODEL)
        : DIALOGUE_RATE;
    const ambienceRate = mode === "live" && run.units.some(u => u.model === AMBIENCE_MODEL) ? await price(AMBIENCE_MODEL) : AMBIENCE_RATE;
    const estimate = soundEstimate(run, rate, dialogueRate, ambienceRate),
      quoteId = randomUUID();
    for (const [id, q] of quotes)
      if (q.expiresAt < Date.now()) quotes.delete(id);
    if (quotes.size > 200) quotes.delete(quotes.keys().next().value);
    const quote = {
      quoteId,
      projectId,
      mode,
      fingerprint: fingerprint(run),
      expiresAt: Date.now() + 10 * 60 * 1000,
      estimate,
    };
    quotes.set(quoteId, quote);
    return {
      quoteId,
      mode,
      expiresAt: quote.expiresAt,
      estimate,
      cost: mode === "test" ? 0 : estimate.amount,
      windows: run.units.flatMap((u) =>
        soundParts(u).map((p) => ({
          role: u.role,
          start: u.start + p.start,
          duration: p.duration,
          clips: u.sources.filter(
            (s) =>
              s.start < u.start + p.start + p.duration &&
              s.start + s.duration > u.start + p.start,
          ).length,
        })),
      ),
    };
  }
  function retryContext(projectId, runId, body) {
    const run = get(runId),
      record = store.get(projectId);
    if (
      !run ||
      run.projectId !== projectId ||
      run.state !== "failed" ||
      !record ||
      record.project.episodeId !== run.episodeId
    )
      throw Error("Choose a failed soundtrack section in the active edit.");
    const unit = run.units.find(
      (u) => u.id === body.unitId && u.state === "failed",
    );
    const part = unit?.parts?.find((p) => p.index === body.index);
    if (!part || part.state === "ready")
      throw Error(
        "Choose an unfinished sound section. Completed sections are kept.",
      );
    if (
      ["submitting", "submission_uncertain"].includes(part.state) &&
      !part.providerJobId
    )
      throw Error(
        "Recover the uncertain fal request ID first. Retrying could pay twice.",
      );
    if (soundUnitState(record.project, unit).stale)
      throw Error(
        "The picture or dialogue changed since this pass. Create sound for the changed range; the old recordings remain saved.",
      );
    const failure = soundFailure({
      ...part,
      error: part.error || (part.state !== "queued" ? unit.error : ""),
    });
    const requiresSubmit = !part.providerJobId || failure.terminal;
    const direction = String(
      body.direction ?? part.directionOverride ?? run.direction ?? "",
    ).slice(0, 2000);
    const signature = createHash("sha256")
      .update(
        JSON.stringify({ runId, unit, revision: record.revision, direction }),
      )
      .digest("hex");
    return {
      run,
      unit,
      part,
      record,
      failure,
      requiresSubmit,
      direction,
      signature,
    };
  }
  async function retryEstimate(projectId, runId, body) {
    const ctx = retryContext(projectId, runId, body);
    const mode = (await studioMode(data, "audio")) === "live" ? "live" : "test";
    if (mode !== ctx.run.executionMode)
      throw Error(
        `Switch to ${ctx.run.executionMode === "live" ? "Online" : "Offline"} to resume this saved pass.`,
      );
    const model = ctx.part.model || (ctx.unit.role === "dialogue" ? DIALOGUE_MODEL : ctx.unit.model || SOUND_MODEL);
    const rate =
      mode === "live" && ctx.requiresSubmit
        ? await price(model)
        : model === DIALOGUE_MODEL
          ? DIALOGUE_RATE
          : model === AMBIENCE_MODEL ? AMBIENCE_RATE : SOUND_RATE;
    const amount = ctx.requiresSubmit
      ? (model === DIALOGUE_MODEL
          ? ctx.part.characters
          : ctx.part.modelDuration) * rate.rate
      : 0;
    if (!Number.isFinite(amount))
      throw Error(
        "The saved section has incomplete pricing information. Create a new pass.",
      );
    for (const [id, q] of quotes)
      if (q.expiresAt < Date.now()) quotes.delete(id);
    if (quotes.size > 200) quotes.delete(quotes.keys().next().value);
    const quoteId = randomUUID();
    const quote = {
      kind: "soundtrack-retry",
      quoteId,
      projectId,
      runId,
      unitId: ctx.unit.id,
      index: ctx.part.index,
      mode,
      signature: ctx.signature,
      direction: ctx.direction,
      rate: rate.rate,
      amount,
      requiresSubmit: ctx.requiresSubmit,
      expiresAt: Date.now() + 600000,
    };
    quotes.set(quoteId, quote);
    return {
      ...quote,
      cost: mode === "test" ? 0 : amount,
      failure: ctx.failure,
      preserved: ctx.unit.parts.filter((p) => p.state === "ready").length,
      start: ctx.unit.start + ctx.part.start,
      duration: ctx.part.duration,
      input:
        ctx.unit.role === "dialogue"
          ? dialogueInput(ctx.unit.lines[ctx.part.index])
          : model === AMBIENCE_MODEL ? ambienceInput(soundPrompt({ ...ctx.run, direction: ctx.direction }, ctx.unit, ctx.part).prompt, ctx.part, ctx.unit.role) : {
              ...soundPrompt(
                { ...ctx.run, direction: ctx.direction },
                ctx.unit,
                ctx.part,
              ),
              duration: ctx.part.modelDuration,
              num_steps: 25,
              cfg_strength: 4.5,
              seed: 1793,
              mask_away_clip: false,
              video: "Silent MP4 · 640×360 · base64 data URI",
            },
    };
  }
  async function retrySection(projectId, runId, body) {
    const previous = get(runId);
    if (
      previous?.projectId === projectId &&
      body.requestId &&
      previous.retryRequests?.includes(body.requestId)
    )
      return previous;
    const mode = (await studioMode(data, "audio")) === "live" ? "live" : "test";
    // Re-read all state after the asynchronous mode read. No awaits below the commit checks.
    const raced = get(runId);
    if (
      raced?.projectId === projectId &&
      body.requestId &&
      raced.retryRequests?.includes(body.requestId)
    )
      return raced;
    const ctx = retryContext(projectId, runId, body);
    if (mode !== ctx.run.executionMode)
      throw Error("Execution mode changed. Review this retry again.");
    if (
      activeSoundtrackRun(list(projectId), ctx.run.episodeId, [ctx.unit.role])
    )
      throw Error("This sound layer is already running or queued for this edit.");
    const quote = quotes.get(body.quoteId);
    if (
      !quote ||
      quote.kind !== "soundtrack-retry" ||
      quote.projectId !== projectId ||
      quote.runId !== runId ||
      quote.unitId !== body.unitId ||
      quote.index !== body.index ||
      quote.mode !== mode ||
      quote.signature !== ctx.signature ||
      quote.expiresAt < Date.now() ||
      quote.used ||
      body.executionMode !== mode
    )
      throw Error("Review a fresh estimate for this section before retrying.");
    if (ctx.requiresSubmit) {
      const { attempts = [], ...old } = ctx.part;
      const base = {
        index: old.index,
        start: old.start,
        duration: old.duration,
        modelDuration: old.modelDuration,
        overlap: old.overlap,
        model: old.model,
        characters: old.characters,
      };
      const fresh = {
        ...base,
        state: "queued",
        attempt: (old.attempt || 0) + 1,
        attempts: [...attempts, { ...old, superseded: true }],
        rate: quote.rate,
        directionOverride: ctx.direction,
      };
      ctx.unit.parts[ctx.unit.parts.indexOf(ctx.part)] = fresh;
    } else {
      delete ctx.part.error;
      delete ctx.part.errorCode;
      delete ctx.part.errorFields;
      ctx.part.state = "processing";
      ctx.part.nextPollAt = 0;
    }
    quote.used = true;
    ctx.unit.retryOnlyIndices = [body.index];
    ctx.unit.state = "queued";
    delete ctx.unit.error;
    ctx.unit.progress =
      ctx.unit.parts.filter((p) => p.state === "ready").length /
      ctx.unit.parts.length;
    ctx.run.state = "queued";
    ctx.run.retryRequests ??= [];
    ctx.run.retryRequests.push(
      String(body.requestId || randomUUID()).slice(0, 100),
    );
    save(ctx.run);
    return ctx.run;
  }
  async function liveStep(run, unit, output, folder) {
    if ((await studioMode(data, "audio")) !== "live") {
      if (unit.stage !== "Paused · switch to Online to continue") {
        unit.stage = "Paused · switch to Online to continue";
        save(run);
      }
      return false;
    }
    if (unit.clearDialogue) {
      await renderTestSound({ ...unit, silence: true }, output);
      return true;
    }
    const adapter = await adapterFactory();
    unit.parts ??= soundParts(unit);
    const work = path.join(folder, "media", "soundtrack", ".work-" + unit.id);
    await fs.mkdir(work, { recursive: true });
    for (const part of unit.parts) {
      if (
        unit.retryOnlyIndices &&
        part.state !== "ready" &&
        !unit.retryOnlyIndices.includes(part.index)
      )
        continue;
      const audio = path.join(work, `${part.index}.wav`);
      const range = `${(unit.start + part.start).toFixed(1)}–${(unit.start + part.start + part.duration).toFixed(1)}s`;
      if (part.state === "ready") {
        if (
          await fs.access(audio).then(
            () => true,
            () => false,
          )
        )
          continue;
        if (!part.providerJobId)
          throw Error("Saved soundtrack part is missing. Create a new pass.");
        part.state = "processing";
      }
      if (
        ["submitting", "submission_uncertain"].includes(part.state) &&
        !part.providerJobId
      ) {
        part.state = "submission_uncertain";
        throw Error(
          "A soundtrack submission has an unknown result. Check fal's request history and recover its request ID; no automatic resubmission.",
        );
      }
      if (part.nextPollAt > Date.now()) return false;
      if (!part.providerJobId) {
        unit.stage = `${unit.role === "dialogue" ? "Preparing dialogue" : part.model === AMBIENCE_MODEL ? "Preparing sound cues" : "Preparing visuals"} · ${part.index + 1}/${unit.parts.length}`;
        save(run);
        const partFolder = path.join(work, String(part.index));
        const speech = unit.role === "dialogue";
        const ambience = part.model === AMBIENCE_MODEL;
        const video_url = speech || ambience
          ? null
          : await visual(unit, part, partFolder, store);
        if (cancelled.has(run.id) || closed) return false;
        const prompt = speech
          ? dialogueInput(unit.lines[part.index])
          : soundPrompt(
              { ...run, direction: part.directionOverride ?? run.direction },
              unit,
              part,
            );
        part.prompt = prompt;
        part.seed ??= Number.parseInt(createHash("sha256").update(run.id + unit.id + part.index).digest("hex").slice(0,4),16);
        part.state = "submitting";
        unit.stage = `Submitting · ${range}`;
        save(run);
        try {
          Object.assign(
            part,
            await adapter.submitSound(
              speech
                ? prompt
                : ambience ? ambienceInput(prompt.prompt, part, unit.role) : {
                    video_url,
                    ...prompt,
                    duration: part.modelDuration,
                    num_steps: 25,
                    cfg_strength: 4.5,
                    seed: part.seed,
                    mask_away_clip: false,
                  },
              part.model || (speech ? DIALOGUE_MODEL : SOUND_MODEL),
            ),
          );
          part.state = "processing";
          part.acceptedAt = Date.now();
        } catch (e) {
          part.state = e.uncertain ? "submission_uncertain" : "failed";
          part.error = String(e.message).slice(0, 500);
          part.errorCode = e.code;
          part.errorFields = e.fields;
          part.terminal = !e.uncertain;
          save(run);
          throw e;
        }
        save(run); // Save the provider ID before any polling, download or cleanup.
        await fs.rm(partFolder, { recursive: true, force: true });
        if (cancelled.has(run.id)) {
          await adapter.cancelSound(part).catch(() => {});
          return false;
        }
      }
      let result;
      try {
        result = await adapter.pollSound(part);
      } catch (e) {
        part.error = String(e.message).slice(0, 500);
        part.errorCode = e.code;
        part.errorFields = e.fields;
        part.terminal = !!e.terminal;
        if (e.terminal) part.state = "failed";
        if (transientSoundRead(e) && (part.readRetries || 0) < 3) {
          part.readRetries=(part.readRetries || 0)+1;
          part.nextPollAt=Date.now()+5000*2**(part.readRetries-1);
          part.lastReadError=part.error;part.error=null;
          unit.stage="Connection interrupted · retrieving existing request";
          save(run);return false;
        }
        save(run);
        throw e;
      }
      part.nextPollAt = Date.now() + 3000;
      unit.stage =
        result.state === "queued"
          ? `Queued at fal.ai${Number.isFinite(result.queuePosition) ? ` · ${result.queuePosition} ahead` : ""}`
          : `Generating · ${range}`;
      if (result.state !== "ready") {
        save(run);
        return false;
      }
      part.downloadUrl = result.downloadUrl;
      part.state = "downloading";
      unit.stage = `Saving audio · ${range}`;
      save(run);
      try {
        if (unit.role === "dialogue") part.audioDuration = await downloadSpeech(part.downloadUrl, audio);
        else await download(part.downloadUrl, audio, part.duration);
      } catch(e) {
        if (transientSoundRead(e) && (part.downloadRetries || 0) < 3) {
          part.downloadRetries=(part.downloadRetries || 0)+1;
          part.nextPollAt=Date.now()+5000*2**(part.downloadRetries-1);
          unit.stage="Download interrupted · retrieving existing result";
          save(run);return false;
        }
        throw e;
      }
      part.state = "ready";
      unit.progress =
        unit.parts.filter((p) => p.state === "ready").length /
        unit.parts.length;
      save(run);
      if (cancelled.has(run.id) || closed) return false;
    }
    if (unit.parts.some((p) => p.state !== "ready"))
      throw Error(
        "Other sections still need attention. Completed sections are saved; continue or retry them individually.",
      );
    delete unit.retryOnlyIndices;
    unit.stage = "Joining soundtrack";
    save(run);
    if(unit.role==="dialogue") {
      const original=output+".original.wav";
      const originalDuration=await joinSpeech(unit.parts,unit.parts.map(p=>path.join(work,`${p.index}.wav`)),original,unit.duration,{maxTempo:1});
      const originalId=unit.id+"-original";
      unit.originalMedia={id:originalId,projectId:run.projectId,path:original,original,name:"Original dialogue recording",kind:"audio",audio:true,duration:originalDuration,url:"/api/media/"+originalId,thumbnail:"/audio.svg"};
      store.putMedia(unit.originalMedia);
    }
    const length = await (unit.role === "dialogue" ? joinSpeech : join)(
      unit.parts,
      unit.parts.map((p) => path.join(work, `${p.index}.wav`)),
      output,
      unit.duration,
      unit.role === "dialogue" ? {maxTempo:1.2} : unit.role,
    );
    if (unit.role === "dialogue") {
      unit.outputDuration = length;
      unit.needsTiming = length > unit.duration + 0.02;
    }
    // Retain completed pieces until the ready state is durably saved, then clean up.
    return true;
  }
  async function testStep(run, unit, output, folder) {
    unit.parts ??= soundParts(unit);
    if (!unit.parts.length) return render(unit, output);
    const work = path.join(folder, "media", "soundtrack", ".work-" + unit.id);
    await fs.mkdir(work, { recursive: true });
    for (const part of unit.parts) {
      if (part.state === "ready") continue;
      if (unit.retryOnlyIndices && !unit.retryOnlyIndices.includes(part.index))
        continue;
      const file = path.join(work, `${part.index}.wav`);
      try {
        part.state = "processing";
        unit.stage = `Offline audio · ${part.index + 1}/${unit.parts.length}`;
        save(run);
        await render(
          {
            ...unit,
            start: unit.start + part.start,
            duration: unit.role === "dialogue" ? Math.max(.2,part.duration-.12) : part.duration,
            partIndex: part.index,
          },
          file,
          (value) => {
            unit.progress =
              (unit.parts.filter((p) => p.state === "ready").length + value) /
              unit.parts.length;
          },
          () =>
            cancelled.has(run.id) ||
            closed ||
            store.removing.has(run.projectId),
        );
        part.state = "ready";
        part.audioDuration = unit.role === "dialogue" ? Math.max(.2,part.duration-.12) : part.duration;
        delete part.error;
        save(run);
      } catch (e) {
        part.state = "failed";
        part.error = String(e.message).slice(0, 500);
        save(run);
        throw e;
      }
    }
    if (unit.parts.some((p) => p.state !== "ready"))
      throw Error(
        "Other sections still need attention. Completed sections are saved; continue or retry them individually.",
      );
    delete unit.retryOnlyIndices;
    await (unit.role === "dialogue" ? joinSpeech : join)(
      unit.parts,
      unit.parts.map((p) => path.join(work, `${p.index}.wav`)),
      output,
      unit.duration,
    );
  }
  let working = false,
    closed = false;
  const cancelled = new Set();
  async function tick() {
    if (working || closed) return;
    const row = db
      .prepare(
        "SELECT body FROM soundtrack_runs WHERE state IN ('queued','processing') ORDER BY rowid LIMIT 1",
      )
      .get();
    if (!row) return;
    const run = JSON.parse(row.body);
    working = true;
    try {
      const record = store.get(run.projectId);
      if (!record || store.removing.has(run.projectId)) {
        run.state = "cancelled";
        save(run);
        return;
      }
      const folder = record.project.folder;
      if (run.state !== "processing") {
        run.state = "processing";
        save(run);
      }
      for (const unit of run.units) {
        if (["ready", "failed"].includes(unit.state)) continue;
        if (cancelled.has(run.id) || closed) {
          run.state = "cancelled";
          break;
        }
        if (unit.state !== "processing") {
          unit.state = "processing";
          unit.progress ??= 0;
          unit.error = null;
          save(run);
        }
        const output = path.join(
          folder,
          "media",
          "soundtrack",
          unit.id + ".wav",
        );
        try {
          if (run.executionMode === "live") {
            if (!(await liveStep(run, unit, output, folder))) return;
          } else await testStep(run, unit, output, folder);
          unit.media = {
            id: unit.id,
            projectId: run.projectId,
            path: output,
            original: output,
            name: `${run.executionMode === "live" ? "AI" : "Offline"} ${unit.role === "effect" ? "effects" : unit.role === "dialogue" ? "dialogue" : "ambience"} · ${unit.start.toFixed(1)}s`,
            kind: "audio",
            audio: true,
            duration: unit.outputDuration || unit.duration,
            thumbnail: "/audio.svg",
            url: "/api/media/" + unit.id,
            generated: true,
            soundtrackRunId: run.id,
            executionMode: run.executionMode,
            providerId: run.providerId,
            model:
              run.executionMode === "live"
                ? unit.role === "dialogue"
                  ? DIALOGUE_MODEL
                  : unit.model || SOUND_MODEL
                : null,
          };
          store.putMedia(unit.media);
          unit.state = "ready";
          unit.progress = 1;
          unit.stage = "Ready";
          save(run);
          await fs.rm(
            path.join(folder, "media", "soundtrack", ".work-" + unit.id),
            { recursive: true, force: true },
          );
        } catch (e) {
          unit.state = "failed";
          unit.error = String(e.message).slice(0, 500);
          await fs.rm(output + ".partial", { force: true });
        }
        save(run);
      }
      if (cancelled.has(run.id)) run.state = "cancelled";
      else if (closed) run.state = "queued";
      else
        run.state = run.units.some((u) => u.state === "failed")
          ? "failed"
          : "ready";
      save(run);
    } finally {
      working = false;
    }
  }
  const timer = setInterval(() => tick().catch(() => {}), 1000);
  timer.unref();
  return {
    async fitTiming(projectId,runId,body) {
      const source=get(runId),unit=source?.units.find(u=>u.id===body.unitId);
      const existing=list(projectId).find(r=>r.timingSourceRunId===runId && r.timingSourceUnitId===body.unitId);
      if(existing){
        if(!soundReceipts(store.get(projectId).project).has(existing.units[0].id)) {
          delete existing.units[0].delivered;save(existing);
        }
        return existing;
      }
      if(source?.projectId!==projectId || unit?.role!=="dialogue" || unit.state!=="ready" || !(unit.needsTiming || unit.media?.duration > unit.duration + .02)) throw Error("Choose a completed dialogue recording that needs timing.");
      const record=store.get(projectId), current=soundUnitState(record.project,unit);
      if(current.stale) throw Error("The picture or script changed. Update this section first.");
      const media=store.media(unit.media.id);
      const speed=media.duration/Math.max(.2,unit.duration-.02);
      if(speed*Math.max(1,...(unit.parts||[]).map(p=>p.tempo||1))>1.5) throw Error("This recording needs more picture time. Shorten the line or extend the clip; a faster voice would sound unnatural.");
      const replacement=structuredClone(unit), id=randomUUID();
      const output=path.join(record.project.folder,"media","soundtrack",id+".wav");
      const {run:render,probe}=await import("./media.mjs");
      await render(["-i",media.path,"-af",`atempo=${speed},apad`,"-t",String(unit.duration),"-c:a","pcm_s16le",output]);
      const info=await probe(output);
      delete replacement.delivered;
      replacement.id=id;replacement.needsTiming=false;replacement.outputDuration=info.duration;
      replacement.media={...unit.media,id,path:output,original:output,duration:info.duration,url:"/api/media/"+id};
      replacement.originalMedia=unit.media;
      replacement.parts=(replacement.parts||[]).map(p=>({...p,tempo:(p.tempo||1)*speed,actualStart:(p.actualStart??p.start)/speed,actualDuration:(p.actualDuration??p.audioDuration??p.duration)/speed}));
      const result={...source,id:randomUUID(),state:"ready",createdAt:new Date().toISOString(),units:[replacement],cost:0,estimate:{amount:0},executionMode:"test",providerId:"local-timing",timingSourceRunId:source.id,timingSourceUnitId:unit.id};
      store.putMedia(replacement.media); save(result);
      return result;
    },
    list,
    estimate,
    retryEstimate,
    listViews: (projectId) =>
      db
        .prepare(
          "SELECT json_object('id',id,'projectId',projectId,'episodeId',episodeId,'state',state,'executionMode',json_extract(body,'$.executionMode'),'providerId',json_extract(body,'$.providerId'),'estimate',json_extract(body,'$.estimate'),'cost',json_extract(body,'$.cost'),'changedOnly',json_extract(body,'$.changedOnly'),'direction',json_extract(body,'$.direction'),'units',json_extract(body,'$.units'),'createdAt',json_extract(body,'$.createdAt')) AS body FROM soundtrack_runs WHERE projectId=? ORDER BY json_extract(body,'$.createdAt') DESC, id DESC LIMIT 100",
        )
        .all(projectId)
        .map((r) => {
          const view = JSON.parse(r.body);
          view.units.forEach((u) => {
            if(u.role==="dialogue" && u.outputDuration > u.duration+.02) u.needsTiming=true;
            if (u.parts)
              u.parts = u.parts.map(({ prompt, downloadUrl, ...p }) => ({
                ...p,
                attempts: p.attempts?.map(({ prompt, downloadUrl, ...a }) => a),
              }));
          });
          return view;
        }),
    get,
    tick,
    close: () => {
      closed = true;
      clearInterval(timer);
    },
    async submit(projectId, options) {
      const mode = (await studioMode(data, "audio")) === "live" ? "live" : "test";
      if (options.executionMode && options.executionMode !== mode)
        throw Object.assign(
          Error(
            "Execution mode changed. Review the soundtrack estimate again.",
          ),
          { status: 409 },
        );
      const record = store.get(projectId);
      if (!record)
        throw Object.assign(Error("Project not found."), { status: 404 });
      const duplicate = list(projectId).find(
        (r) => r.requestId === options.requestId && options.requestId,
      );
      if (duplicate) return duplicate;
      if (record.revision !== options.revision)
        throw Object.assign(Error("Project changed. Save and try again."), {
          status: 409,
        });
      if (
        activeSoundtrackRun(list(projectId), record.project.episodeId, options.roles)
      )
        throw Object.assign(
          Error("This sound layer is already running or queued for this edit."),
          { status: 409 },
        );
      const { run } = plan(projectId, options);
      run.executionMode = mode;
      run.providerId = mode === "live" ? "fal" : "local-test";
      if (mode === "live") {
        const quote = quotes.get(options.quoteId);
        if (
          !quote ||
          quote.projectId !== projectId ||
          quote.mode !== mode ||
          quote.expiresAt < Date.now() ||
          quote.used ||
          quote.fingerprint !== fingerprint(run) ||
          options.executionMode !== "live"
        )
          throw Object.assign(
            Error("Review a fresh Online soundtrack estimate before submitting."),
            { status: 409 },
          );
        run.estimate = quote.estimate;
        await adapterFactory();
      } else run.estimate = soundEstimate(run);
      run.cost = mode === "test" ? 0 : null;
      run.units.forEach((u) => {
        u.parts = soundParts(u).map(part => ({...part, rate: run.estimate.layers.find(l => l.role === u.role)?.rates?.[part.model] ?? run.estimate.layers.find(l => l.role === u.role)?.rate ?? run.estimate.rate}));
      });
      run.requestId = String(options.requestId || randomUUID()).slice(0, 100);
      // Credentials/pricing checks await IO. Recheck after that gap to deduplicate concurrent tabs.
      const raced = list(projectId).find((r) => r.requestId === run.requestId);
      if (raced) return raced;
      if (
        activeSoundtrackRun(list(projectId), run.episodeId, run.units.map(u => u.role))
      )
        throw Object.assign(
          Error("This sound layer is already running or queued for this edit."),
          { status: 409 },
        );
      if (mode === "live") {
        const quote = quotes.get(options.quoteId);
        if ((await studioMode(data, "audio")) !== "live")
          throw Object.assign(
            Error(
              "The estimate was used or mode changed. Review a new estimate.",
            ),
            { status: 409 },
          );
        // The mode read also yields: check the idempotency key once more.
        const accepted = list(projectId).find(
          (r) => r.requestId === run.requestId,
        );
        if (accepted) return accepted;
        if (
          activeSoundtrackRun(list(projectId), run.episodeId, run.units.map(u => u.role))
        )
          throw Object.assign(
            Error("This sound layer is already running or queued for this edit."),
            { status: 409 },
          );
        // No awaits between consuming the quote and saving the run.
        if (quote.used)
          throw Error("This soundtrack estimate was already used.");
        if (store.get(projectId)?.revision !== options.revision)
          throw Object.assign(
            Error("Project changed. Review a new estimate."),
            { status: 409 },
          );
        quote.used = true;
      }
      save(run);
      return run;
    },
    ack(projectId, runId) {
      const run = get(runId),
        record = store.get(projectId);
      if (!run || run.projectId !== projectId || !record)
        throw Error("Soundtrack not found.");
      const receipts = soundReceipts(record.project);
      for (const unit of run.units)
        if (receipts.has(unit.id)) unit.delivered = true;
      // A running task holds its own object. Preserve acknowledgements at every write.
      save(run);
      return { ok: true };
    },
    async cancel(projectId, runId) {
      const run = get(runId);
      if (!run || run.projectId !== projectId)
        throw Error("Soundtrack not found.");
      cancelled.add(runId);
      run.state = "cancelled";
      save(run);
      if (run.executionMode === "live" && (await studioMode(data, "audio")) === "live") {
        const adapter = await adapterFactory();
        for (const unit of run.units)
          for (const part of unit.parts || [])
            if (part.providerJobId && part.state !== "ready")
              await adapter.cancelSound(part).catch(() => {});
      }
      return { ok: true };
    },
    recover(projectId, runId, body) {
      const run = get(runId);
      if (
        !run ||
        run.projectId !== projectId ||
        run.state !== "failed" ||
        run.executionMode !== "live"
      )
        throw Error("Choose a failed Online soundtrack.");
      const part = run.units
        .find((u) => u.id === body.unitId)
        ?.parts?.find((p) => p.index === body.index);
      if (
        !part ||
        !["submitting", "submission_uncertain"].includes(part.state) ||
        part.providerJobId ||
        !/^[\w-]{8,200}$/.test(body.requestId || "")
      )
        throw Error("Enter the fal request ID for the uncertain section.");
      part.providerJobId = body.requestId;
      part.state = "processing";
      save(run);
      return { ok: true };
    },
    async retry(projectId, runId, body = {}) {
      if (body.index !== undefined) return retrySection(projectId, runId, body);
      const run = get(runId);
      if (!run || run.projectId !== projectId || run.state !== "failed")
        throw Error("Choose a failed soundtrack pass.");
      const failed = run.units.filter(
        (u) => u.state === "failed" && (!body.unitId || u.id === body.unitId),
      );
      if (!failed.length) throw Error("Choose a failed sound section.");
      if (failed.some((u) => u.parts?.some((p) => p.terminal)))
        throw Error(
          "The provider rejected this section. Adjust its direction or range and create a new generation with a fresh estimate. Resume cannot repair a rejected request.",
        );
      const mode = (await studioMode(data, "audio")) === "live" ? "live" : "test";
      if (mode !== run.executionMode)
        throw Error(
          `Switch to ${run.executionMode === "live" ? "Online" : "Offline"} to resume this soundtrack.`,
        );
      if (
        run.executionMode === "live" &&
        failed.some((u) =>
          u.parts?.some((p) => !p.providerJobId && p.state !== "queued"),
        )
      )
        throw Error(
          "This pass contains an uncertain or rejected submission. Recover uncertain request IDs first, or create a new pass after checking fal. Retry never repeats a paid submission.",
        );
      if (
        activeSoundtrackRun(list(projectId).filter(r => r.id !== runId), run.episodeId, failed.map(u => u.role))
      )
        throw Object.assign(
          Error("This sound layer is already running or queued for this edit."),
          { status: 409 },
        );
      for (const unit of failed) {
        delete unit.retryOnlyIndices;
        delete unit.error;
        unit.state = "queued";
        unit.progress = 0;
      }
      run.state = "queued";
      save(run);
      return run;
    },
  };
}
export function installSoundtrackRoutes(app, service) {
  app.get("/api/projects/:id/soundtrack", (req, res) =>
    res.json(service.listViews(req.params.id)),
  );
  app.post("/api/projects/:id/soundtrack/estimate", async (req, res) =>
    res.json(await service.estimate(req.params.id, req.body)),
  );
  app.post(
    "/api/projects/:id/soundtrack/:runId/retry-estimate",
    async (req, res) =>
      res.json(
        await service.retryEstimate(req.params.id, req.params.runId, req.body),
      ),
  );
  app.post("/api/projects/:id/soundtrack/:runId/recover", (req, res) =>
    res.json(service.recover(req.params.id, req.params.runId, req.body)),
  );
  app.post("/api/projects/:id/soundtrack", async (req, res) =>
    res.json(await service.submit(req.params.id, req.body)),
  );
  for (const action of ["ack", "cancel", "retry", "fitTiming"])
    app.post(
      `/api/projects/:id/soundtrack/:runId/${action}`,
      async (req, res) =>
        res.json(
          await service[action](req.params.id, req.params.runId, req.body),
        ),
    );
}
