import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  effectDefinitions,
  prepareEffectIntent,
  effectSignature,
  effectActive,
} from "../shared/effects.mjs";
import { morphDimensions } from "../shared/morph-effects.mjs";
import {
  prepareMorphFrames,
  morphPayload,
  saveMorphMedia,
} from "./morph-effects.mjs";
import { FalEffectsAdapter } from "./adapters/fal-effects.mjs";
import { uploadFalMedia } from "./adapters/fal-storage.mjs";
import { credentials } from "./connections.mjs";
import { studioMode } from "./mode.mjs";
import { run, probe, thumbnail } from "./media.mjs";
import { downloadVideo, writeVideoResponse } from "./video.mjs";

export async function imageInfo(file) {
  try {
    await run(["-i", file]);
  } catch (e) {
    const match = (e.log || e.message).match(
      /Video:.*?\b(\d{2,5})x(\d{2,5})\b/,
    );
    if (match)
      return { width: +match[1], height: +match[2], audio: false, video: true };
  }
  throw Error("Unreadable image.");
}
const stamp = (s) => [s.size, s.mtimeMs];
export function createEffectsService({
  store,
  data,
  mode = () => studioMode(data, "video"),
  adapterFactory = async () =>
    new FalEffectsAdapter({
      key: await credentials(data, "fal").key(),
      allowSubmit: async () => (await mode()) === "live",
    }),
  upload = uploadFalMedia,
  download = async (url, file) =>
    writeVideoResponse(await downloadVideo(url, undefined, "fal"), file),
  autoStart = true,
  checkpoint = async () => {},
}) {
  const db = store.db,
    quotes = new Map();
  let busy = false,
    closed = false;
  db.exec(
    "CREATE TABLE IF NOT EXISTS effect_jobs(id TEXT PRIMARY KEY,projectId TEXT,state TEXT,body TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS effect_request ON effect_jobs(projectId,json_extract(body,'$.requestId'));",
  );
  const save = (j) => {
    db.prepare("INSERT OR REPLACE INTO effect_jobs VALUES(?,?,?,?)").run(
      j.id,
      j.projectId,
      j.state,
      JSON.stringify(j),
    );
    checkpoint(j.projectId).catch(() => {});
    return j;
  };
  const list = (id) =>
    db
      .prepare(
        "SELECT body FROM effect_jobs WHERE projectId=? ORDER BY rowid DESC",
      )
      .all(id)
      .map((r) => JSON.parse(r.body));
  const get = (id, jobId) => list(id).find((j) => j.id === jobId);
  // Paths and signed provider URLs stay server-side.
  const view = (j) => {
    const copy = structuredClone(j);
    delete copy.sourcePath;
    delete copy.folder;
    delete copy.frameSources;
    for (const s of copy.stages) {
      delete s.providerUrls;
      delete s.downloadUrl;
      delete s.artifact;
      delete s.snapshot;
      delete s.framePaths;
      delete s.frameSnapshots;
    }
    return copy;
  };
  async function context(id, intent) {
    const record = store.get(id);
    if (!record || store.removing.has(id)) throw Error("Project unavailable.");
    const input = prepareEffectIntent(record.project, intent),
      media = store.media(input.source.mediaId);
    if (!media || media.projectId !== id)
      throw Error("Source media is unavailable in this project.");
    const sourcePath =
      input.source.kind === "image" ? media.original || media.path : media.path;
    const info =
      input.source.kind === "image"
        ? await imageInfo(sourcePath)
        : await probe(sourcePath);
    const d = effectDefinitions.find((d) => d.id === input.effectId),
      { scale } = input.settings;
    if (
      !info.video ||
      !info.width ||
      !info.height ||
      Math.max(info.width, info.height) > d.limits.maxInputEdge ||
      Math.max(info.width, info.height) * scale > d.limits.maxOutputEdge
    )
      throw Error(
        "Use a smaller source or scale; output is limited to 4096 pixels per edge.",
      );
    if (
      input.source.kind === "video" &&
      input.source.in + input.source.duration > info.duration + 0.1
    )
      throw Error("Selected trim extends beyond the source.");
    const stat = await fs.stat(sourcePath);
    if (input.effectId === "ai-morph") {
      const frameSources = [];
      for (const ref of input.references) {
        const m = store.media(ref.source.mediaId);
        if (!m || m.projectId !== id)
          throw Error("A frame source is unavailable in this project.");
        const file =
          ref.source.kind === "image" ? m.original || m.path : m.path;
        const frameInfo =
          ref.source.kind === "image"
            ? await imageInfo(file)
            : await probe(file);
        if (
          !frameInfo.video ||
          !frameInfo.width ||
          !frameInfo.height ||
          Math.max(frameInfo.width, frameInfo.height) > 16384 ||
          (ref.source.kind === "video" &&
            (ref.time >= frameInfo.duration ||
              ref.source.in + ref.source.duration > frameInfo.duration + 0.1))
        )
          throw Error("A frame lies outside its source. Choose a valid trim.");
        frameSources.push({ path: file, stamp: stamp(await fs.stat(file)) });
      }
      return {
        record,
        input,
        signature: effectSignature(input),
        sourcePath,
        sourceStamp: [stamp(stat), ...frameSources.map((f) => f.stamp)],
        info,
        frameSources,
      };
    }
    return {
      record,
      input,
      signature: effectSignature(input),
      sourcePath,
      sourceStamp: stamp(stat),
      info,
    };
  }
  async function estimate(id, body) {
    const c = await context(id, body),
      executionMode = (await mode()) === "live" ? "live" : "test";
    const model = effectDefinitions.find((d) => d.id === c.input.effectId)
      .models[c.input.source.kind];
    const rate =
      executionMode === "live"
        ? await (await adapterFactory()).estimate(model)
        : {
            amount: 0,
            basis: "offline",
            currency: "USD",
            note: "Local workflow check. No AI enhancement and no provider credits.",
          };
    if (!Number.isFinite(rate.amount) || rate.amount < 0)
      throw Error("A verified estimate is required.");
    const q = {
      ...rate,
      id: randomUUID(),
      projectId: id,
      signature: c.signature,
      sourceStamp: c.sourceStamp,
      mode: executionMode,
      model,
      expires: Date.now() + 600000,
    };
    for (const [key, v] of quotes)
      if (v.expires < Date.now()) quotes.delete(key);
    if (quotes.size >= 100) quotes.delete(quotes.keys().next().value);
    q.inputDimensions = { width: c.info.width, height: c.info.height };
    q.outputDimensions =
      c.input.effectId === "ai-morph"
        ? morphDimensions(c.input.settings)
        : {
            width:
              c.info.width *
              (executionMode === "test" ? 1 : c.input.settings.scale),
            height:
              c.info.height *
              (executionMode === "test" ? 1 : c.input.settings.scale),
          };
    quotes.set(q.id, q);
    return q;
  }
  function makeJob(id, requestId, c, q, executionMode) {
    const jobId = randomUUID(),
      definition = effectDefinitions.find((d) => d.id === c.input.effectId);
    const job = {
      id: jobId,
      projectId: id,
      requestId,
      input: c.input,
      signature: c.signature,
      sourcePath: c.sourcePath,
      sourceStamp: c.sourceStamp,
      sourceInfo: c.info,
      ...(c.frameSources ? { frameSources: c.frameSources } : {}),
      folder: path.join(c.record.project.folder, "media", "effects", jobId),
      executionMode,
      model: q.model,
      estimate: {
        amount: q.amount,
        basis: q.basis,
        note: q.note,
        expires: q.expires,
      },
      state: "queued",
      createdAt: Date.now(),
      stages: definition.stages.map((s) => ({ ...s, state: "queued" })),
    };
    return job;
  }
  const batchQuotes = new Map();
  function batchIntents(id, body) {
    if (body.effectId !== "ai-upscale")
      throw Error("All videos is supported for AI upscale.");
    const project = store.get(id)?.project;
    if (!project) throw Error("Project unavailable.");
    const clips = project.clips.filter(
      (c) =>
        (c.takes.find((t) => t.id === c.activeTake)?.kind || "video") ===
          "video" && c.activeTake,
    );
    if (!clips.length || clips.length > 50)
      throw Error("Choose an edit with 1–50 completed video clips.");
    return clips.map((c) => ({
      effectId: "ai-upscale",
      target: { kind: "clip", id: c.id },
      settings: body.settings,
    }));
  }
  async function estimateBatch(id, body) {
    const intents = batchIntents(id, body),
      items = [];
    for (const intent of intents)
      items.push({ intent, quote: await estimate(id, intent) });
    if (items.some((i) => i.quote.mode !== items[0].quote.mode))
      throw Error("Generation mode changed. Review again.");
    const q = {
      id: randomUUID(),
      projectId: id,
      items,
      amount: items.reduce((n, i) => n + i.quote.amount, 0),
      mode: items[0].quote.mode,
      expires: Math.min(...items.map((i) => i.quote.expires)),
      note: "Combined estimate for all video clips in this edit. Each clip is processed once; originals are preserved.",
    };
    if (batchQuotes.size >= 20)
      batchQuotes.delete(batchQuotes.keys().next().value);
    batchQuotes.set(q.id, q);
    return {
      id: q.id,
      amount: q.amount,
      mode: q.mode,
      expires: q.expires,
      note: q.note,
      count: items.length,
    };
  }
  function submitBatch(id, body) {
    const next = submission
      .catch(() => {})
      .then(async () => {
        if (!/^[\w-]{8,160}$/.test(body.requestId || ""))
          throw Error("A stable request ID is required.");
        const existing = list(id).filter((j) => j.batchId === body.requestId);
        if (existing.length) return existing;
        const q = batchQuotes.get(body.quoteId),
          executionMode = (await mode()) === "live" ? "live" : "test";
        if (
          !q ||
          q.projectId !== id ||
          q.used ||
          q.expires < Date.now() ||
          q.mode !== executionMode
        )
          throw Error("Review a fresh batch estimate.");
        if (executionMode === "live" && body.confirmedAmount !== q.amount)
          throw Error("Confirm the combined cost estimate first.");
        const intents = batchIntents(id, body);
        if (
          JSON.stringify(intents) !==
          JSON.stringify(q.items.map((i) => i.intent))
        )
          throw Error(
            "The video selection changed. Review the estimate again.",
          );
        const jobs = [];
        for (let i = 0; i < q.items.length; i++) {
          const item = q.items[i],
            c = await context(id, item.intent),
            rate = quotes.get(item.quote.id);
          if (
            !rate ||
            rate.used ||
            rate.signature !== c.signature ||
            JSON.stringify(rate.sourceStamp) !== JSON.stringify(c.sourceStamp)
          )
            throw Error("A batch source changed. Review again.");
          if (
            list(id).some((j) => effectActive(j) && j.signature === c.signature)
          )
            throw Error("One of these clips already has this effect running.");
          jobs.push({
            ...makeJob(id, body.requestId + "-" + i, c, rate, executionMode),
            batchId: body.requestId,
          });
        }
        if (body.revision !== store.get(id)?.revision)
          throw Error("Save your edit before processing.");
        if (((await mode()) === "live" ? "live" : "test") !== executionMode)
          throw Error("Generation mode changed.");
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const j of jobs) save(j);
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        q.used = true;
        for (const item of q.items) quotes.get(item.quote.id).used = true;
        return jobs;
      });
    submission = next;
    return next;
  }
  // Serialize submissions across asynchronous source inspection; quotes cannot race into duplicate charges.
  let submission = Promise.resolve();
  function submit(id, body) {
    const next = submission
      .catch(() => {})
      .then(async () => {
        if (!/^[\w-]{8,200}$/.test(body.requestId || ""))
          throw Error("A stable request ID is required.");
        const existing = list(id).find((j) => j.requestId === body.requestId);
        if (existing) return existing;
        const c = await context(id, body),
          q = quotes.get(body.quoteId),
          executionMode = (await mode()) === "live" ? "live" : "test";
        if (
          !q ||
          q.used ||
          q.projectId !== id ||
          q.signature !== c.signature ||
          q.mode !== executionMode ||
          q.expires < Date.now() ||
          JSON.stringify(q.sourceStamp) !== JSON.stringify(c.sourceStamp)
        )
          throw Error("Review a fresh effect estimate.");
        if (body.revision !== store.get(id)?.revision)
          throw Error("Save your edit before processing.");
        if (executionMode === "live" && body.confirmedAmount !== q.amount)
          throw Error("Confirm the displayed cost estimate first.");
        if (
          list(id).some((j) => effectActive(j) && j.signature === c.signature)
        )
          throw Error("This source already has the same effect running.");
        const job = makeJob(id, body.requestId, c, q, executionMode);
        save(job);
        q.used = true;
        return job;
      });
    submission = next;
    return next;
  }
  async function tick() {
    if (busy || closed) return;
    busy = true;
    let j, s;
    try {
      const liveAllowed = (await mode()) === "live";
      const row = db
        .prepare(
          "SELECT body FROM effect_jobs WHERE state IN ('queued','processing') AND (json_extract(body,'$.executionMode') != 'live' OR ? = 1) ORDER BY rowid LIMIT 1",
        )
        .get(liveAllowed ? 1 : 0);
      if (!row) return;
      j = JSON.parse(row.body);
      if (!store.get(j.projectId) || store.removing.has(j.projectId)) {
        j.state = "cancelled";
        save(j);
        return;
      }
      if (j.executionMode === "live" && (await mode()) !== "live") return;
      await fs.mkdir(j.folder, { recursive: true });
      s = j.stages.find(
        (s) =>
          s.state !== "ready" &&
          s.dependsOn.every(
            (id) => j.stages.find((p) => p.id === id)?.state === "ready",
          ),
      );
      if (!s) throw Error("Effect has no pending stage.");
      if (s.state === "submitting" && !s.providerJobId) {
        s.state = "submission_uncertain";
        j.state = "needs_attention";
        j.error =
          "Provider acceptance is unknown. Recover its request ID before continuing.";
        save(j);
        return;
      }
      j.state = "processing";
      j.stage = s.id;
      save(j);
      const source = j.input.source,
        morph = j.input.effectId === "ai-morph",
        image = !morph && source.kind === "image";
      if (morph && s.id === "prepare") {
        await prepareMorphFrames(j, s);
      } else if (morph && s.id === "save") {
        j.media = await saveMorphMedia(j, store);
        s.artifact = j.media.path;
        s.state = "ready";
        j.state = "ready";
        j.completedAt = Date.now();
      } else if (s.id === "prepare") {
        if (
          JSON.stringify(stamp(await fs.stat(j.sourcePath))) !==
          JSON.stringify(j.sourceStamp)
        )
          throw Error("Source file changed. Create a fresh effect pass.");
        const frozen = path.join(
          j.folder,
          "snapshot" + path.extname(j.sourcePath),
        );
        await fs.copyFile(j.sourcePath, frozen);
        if (
          JSON.stringify(stamp(await fs.stat(j.sourcePath))) !==
          JSON.stringify(j.sourceStamp)
        )
          throw Error("Source changed during snapshot. Create a fresh pass.");
        const file = path.join(j.folder, image ? "input.png" : "input.mp4");
        if (image) await run(["-i", frozen, "-frames:v", "1", file]);
        else
          await run([
            "-ss",
            String(source.in),
            "-i",
            frozen,
            "-t",
            String(source.duration),
            "-map",
            "0:v:0",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            file,
          ]);
        if ((await fs.stat(file)).size > 24 * 1024 ** 2)
          throw Error(
            "Prepared input exceeds 24 MB. Choose a shorter or smaller source.",
          );
        s.artifact = file;
        s.snapshot = frozen;
        s.state = "ready";
      } else if (s.id === "transform") {
        const file = path.join(
          j.folder,
          image ? "transformed.png" : "transformed.mp4",
        );
        if (j.executionMode === "test") {
          await fs.copyFile(j.stages[0].artifact, file);
          s.artifact = file;
          s.state = "ready";
        } else {
          const adapter = await adapterFactory();
          if (!s.providerJobId) {
            if (j.estimate.expires < Date.now())
              throw Error(
                "This cost estimate expired. Review a new estimate before retrying.",
              );
            if ((await mode()) !== "live") return;
            const urls = morph
              ? await Promise.all(
                  j.stages[0].framePaths.map((file) =>
                    upload(adapter, file, "image/png"),
                  ),
                )
              : [
                  await upload(
                    adapter,
                    j.stages[0].artifact,
                    image ? "image/png" : "video/mp4",
                  ),
                ];
            const url = urls[0];
            if ((await mode()) !== "live") return;
            s.state = "submitting";
            save(j);
            try {
              Object.assign(
                s,
                await adapter.submitEffect(
                  j.model,
                  morph
                    ? morphPayload(j, urls)
                    : image
                      ? {
                          image_url: url,
                          scale: j.input.settings.scale,
                          model: "RealESRGAN_x4plus",
                          output_format: "png",
                          face: false,
                        }
                      : {
                          video_url: url,
                          scale: j.input.settings.scale,
                          enable_safety_checker: true,
                        },
                ),
              );
            } catch (e) {
              s.state = e.uncertain ? "submission_uncertain" : "failed";
              throw e;
            }
            s.state = "processing";
            save(j);
          }
          if (!s.downloadUrl) {
            const r = await adapter.pollEffect(j.model, s);
            if (r.state !== "ready") {
              save(j);
              return;
            }
            s.downloadUrl = r.downloadUrl;
            save(j);
          }
          await download(s.downloadUrl, file);
          s.artifact = file;
          s.state = "ready";
        }
      } else if (s.id === "save") {
        const transformed = j.stages[1].artifact;
        const info = image
          ? await imageInfo(transformed)
          : await probe(transformed);
        const expectedScale =
          j.executionMode === "test" ? 1 : j.input.settings.scale;
        if (
          Math.abs(info.width - j.sourceInfo.width * expectedScale) > 4 ||
          Math.abs(info.height - j.sourceInfo.height * expectedScale) > 4 ||
          (!image && Math.abs(info.duration - source.duration) > 0.15)
        )
          throw Error(
            "Output dimensions or duration do not match this pass. Original preserved.",
          );
        const output = path.join(j.folder, "result.mp4"),
          poster = path.join(j.folder, "poster.jpg");
        if (image)
          await run([
            "-loop",
            "1",
            "-i",
            transformed,
            "-t",
            String(source.duration),
            "-vf",
            "scale=ceil(iw/2)*2:ceil(ih/2)*2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            output,
          ]);
        else {
          // Restore only original embedded audio. Linked voice tracks stay on the timeline.
          await run([
            "-i",
            transformed,
            "-ss",
            String(source.in),
            "-i",
            j.stages[0].snapshot,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0?",
            "-t",
            String(source.duration),
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            output,
          ]);
        }
        await thumbnail(output, poster);
        j.media = {
          ...info,
          id: j.id,
          projectId: j.projectId,
          kind: source.kind,
          path: output,
          original: image ? transformed : output,
          poster,
          url: "/api/media/" + j.id,
          thumbnail: "/api/media/" + j.id + "/thumbnail",
          duration: source.duration,
          audio: image ? false : j.sourceInfo.audio,
          generated: true,
          name:
            j.executionMode === "test"
              ? "Offline upscale check · unchanged detail"
              : `AI upscale ${j.input.settings.scale}×`,
          provenance: {
            effectId: j.input.effectId,
            version: j.input.version,
            jobId: j.id,
            source: structuredClone(source),
            settings: j.input.settings,
            model: j.model,
            executionMode: j.executionMode,
            estimate: j.estimate,
          },
        };
        store.putMedia(j.media);
        s.artifact = output;
        s.state = "ready";
        j.state = "ready";
        j.completedAt = Date.now();
      }
      j.error = null;
      save(j);
    } catch (e) {
      if (!j) throw e;
      if (s && s.state !== "submission_uncertain") s.state = "failed";
      if (s) {
        s.error = e.message;
        s.terminal = !!e.terminal;
      }
      j.state = "needs_attention";
      j.error = String(e.message).slice(0, 400);
      save(j);
    } finally {
      busy = false;
    }
  }
  async function recover(id, jobId, body) {
    const j = get(id, jobId);
    if (!j || j.state !== "needs_attention")
      throw Error("This effect is not waiting for recovery.");
    const s = j.stages.find((s) => s.state !== "ready");
    if (!s || s.terminal)
      throw Error(
        "Provider rejected this result. Prepare a new pass. Completed artifacts are retained.",
      );
    if (s.state === "submission_uncertain" && !s.providerJobId) {
      if (!/^[\w-]{8,200}$/.test(body.providerJobId || ""))
        throw Error(
          "Recover the existing fal request ID; automatic resubmission is blocked.",
        );
      s.providerJobId = body.providerJobId;
    }
    if (
      j.executionMode === "live" &&
      !s.providerJobId &&
      s.id === "transform" &&
      j.estimate.expires < Date.now()
    ) {
      const q = quotes.get(body.quoteId);
      if (
        !q ||
        q.used ||
        q.projectId !== id ||
        q.signature !== j.signature ||
        q.mode !== "live" ||
        q.expires < Date.now() ||
        body.confirmedAmount !== q.amount
      )
        throw Error(
          "Review and confirm a fresh cost estimate before retrying.",
        );
      j.estimate = {
        amount: q.amount,
        basis: q.basis,
        note: q.note,
        expires: q.expires,
      };
      q.used = true;
    }
    s.state = s.providerJobId ? "processing" : "queued";
    delete s.error;
    j.state = "queued";
    j.error = null;
    return save(j);
  }
  const timer = autoStart
    ? setInterval(() => tick().catch(() => {}), 1500)
    : null;
  timer?.unref();
  return {
    list,
    get,
    view,
    estimate,
    submit,
    estimateBatch,
    submitBatch,
    recover,
    tick,
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}
export function installEffectsRoutes(app, service) {
  app.get("/api/effects", (_req, res) => res.json(effectDefinitions));
  app.get("/api/projects/:id/effects/:job/frames/:index", async (req, res) => {
    const j = service.get(req.params.id, req.params.job),
      index = Number(req.params.index);
    const file = [0, 1].includes(index) && j?.stages[0]?.framePaths?.[index];
    if (!file)
      return res.status(404).json({ error: "Prepared frame unavailable." });
    res.type("png").sendFile(file);
  });
  app.get("/api/projects/:id/effects", (req, res) =>
    res.json(service.list(req.params.id).map(service.view)),
  );
  app.post("/api/projects/:id/effects/batch/prepare", async (req, res) =>
    res.json(await service.estimateBatch(req.params.id, req.body)),
  );
  app.post("/api/projects/:id/effects/batch", async (req, res) =>
    res.json({
      jobs: (await service.submitBatch(req.params.id, req.body)).map(
        service.view,
      ),
    }),
  );
  // Assistant prepares intents through this same validation boundary, never starts jobs.
  app.post("/api/projects/:id/assistant-effects/prepare", async (req, res) =>
    res.json(await service.estimate(req.params.id, req.body)),
  );
  app.post("/api/projects/:id/effects/prepare", async (req, res) =>
    res.json(await service.estimate(req.params.id, req.body)),
  );
  app.post("/api/projects/:id/effects", async (req, res) =>
    res.json(service.view(await service.submit(req.params.id, req.body))),
  );
  app.post("/api/projects/:id/effects/:job/recover", async (req, res) =>
    res.json(
      service.view(
        await service.recover(req.params.id, req.params.job, req.body),
      ),
    ),
  );
}
