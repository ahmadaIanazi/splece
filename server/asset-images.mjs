import { imageBatchInputs } from "../shared/asset-intelligence.mjs";
import { frameImageContext } from "../shared/image-story.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  imageModels,
  normalizeImageInput,
  imageAssetPrompt,
  imageRatios,
} from "../shared/asset-generation.mjs";
import { providerTransport } from "./security.mjs";
import { credentials } from "./connections.mjs";
import { studioMode } from "./mode.mjs";
import { FalAdapter, falQueueURL } from "./adapters/fal.mjs";
import { downloadVideo } from "./video.mjs";
import { run, thumbnail } from "./media.mjs";
const pending = ["queued", "submitting", "processing", "saving"];
export async function boundedImage(response) {
  if (!response.ok) throw Error(`Image request failed (${response.status}).`);
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 25 * 1024 * 1024) throw Error("Image exceeds 25 MB.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export function imagePayload(input, prompt, base64) {
  const model = imageModels.find((m) => m.id === input.modelId),
    [width, height] = imageRatios[input.ratio];
  if (model.provider === "fal")
    return {
      prompt,
      image_size: { width, height },
      num_images: 1,
      ...(input.mode === "vary"
        ? {
            image_urls: (Array.isArray(base64) ? base64 : [base64]).map(b => `data:image/png;base64,${b}`),
            output_format: "png",
          }
        : { output_format: "png" }),
    };
  return input.mode === "vary"
    ? {
        model: model.model,
        prompt,
        image: Array.isArray(base64) ? base64[0] : base64,
        output_format: "png",
        aspect_ratio: input.ratio,
      }
    : {
        model: model.model,
        prompt,
        width,
        height,
        aspect_ratio: input.ratio,
        resolution: "1K",
        format: "png",
        variants: 1,
        return_binary: false,
      };
}
export function createImageService({
  store,
  data,
  checkpoint = async () => {},
  transport = providerTransport({ demo: false, timeoutMs: 180000 }),
  mode = () => studioMode(data),
  download = downloadVideo,
  render = run,
}) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS image_jobs(id TEXT PRIMARY KEY,projectId TEXT,state TEXT,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS image_quotes(id TEXT PRIMARY KEY,projectId TEXT,body TEXT NOT NULL)",
  );
  store.db.exec("CREATE TABLE IF NOT EXISTS image_batches(id TEXT PRIMARY KEY,projectId TEXT,body TEXT NOT NULL)");
  const save = (j) => {
    store.db
      .prepare("INSERT OR REPLACE INTO image_jobs VALUES(?,?,?,?)")
      .run(j.id, j.projectId, j.state, JSON.stringify(j));
    return j;
  };
  const get = (id) => {
    const r = store.db
      .prepare("SELECT body FROM image_jobs WHERE id=?")
      .get(id);
    return r ? JSON.parse(r.body) : null;
  };
  const list = (projectId) =>
    store.db
      .prepare(
        "SELECT body FROM image_jobs WHERE projectId=? ORDER BY rowid DESC LIMIT 100",
      )
      .all(projectId)
      .map((r) => JSON.parse(r.body));
  const view = (j) => {
    const { providerUrls, downloadUrl, ...rest } = j;
    return {...rest, canRetrieve: !!(providerUrls || downloadUrl)};
  };
  const project = (id) => {
    const p = store.get(id)?.project;
    if (!p || store.removing.has(id)) throw Error("Project unavailable.");
    return p;
  };
  const call = async (provider, url, body) => {
    const key = await credentials(data, provider).key();
    if (!key)
      throw Error(
        `Connect ${provider === "fal" ? "fal.ai" : "Venice"} in Connections first.`,
      );
    return transport(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: (provider === "fal" ? "Key " : "Bearer ") + key,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  };
  const source = (p, input) => {
    if (!input.sourceMediaId) return null;
    const m = store.media(input.sourceMediaId);
    if (!m || m.kind !== "image" || m.projectId !== p.id)
      throw Error(
        "Choose an image saved in this project. Adopt a library asset first.",
      );
    return m;
  };
  async function quote(projectId, value) {
    const p = project(projectId),
      input = normalizeImageInput(value),
      model = imageModels.find((m) => m.id === input.modelId),
      executionMode = await mode();
    source(p, input);
    const built = input.kind === "frame" ? frameImageContext(input, p) : imageAssetPrompt(input, p);
    if (built.references?.length) {
      if (input.mode !== 'vary') throw Error('Choose an image editing model to preserve this clip’s references.');
      if (model.provider === 'venice' && built.references.length > 1) throw Error('Choose fal.ai for multiple frame references. Venice edits accept one source image.');
      for (const ref of built.references) {
        const media = store.media(ref.mediaId);
        if (!media || media.projectId !== p.id || media.kind === 'audio') throw Error('A frame reference is missing from this project.');
      }
    } else if (input.kind === 'frame' && input.mode === 'vary') throw Error('Attach an image or start frame first, or choose Create.');
    if (model.promptLimit && built.prompt.length > model.promptLimit) throw Error(`This model allows ${model.promptLimit} prompt characters. Shorten the direction or choose another model. Your writing is kept.`);
    let amount = 0,
      basis = "Offline mode · local sample, no AI call";
    if (executionMode === "live") {
      if (!(await credentials(data, model.provider).key()))
        throw Error("Connect this provider in Connections first.");
      if (model.provider === "fal") {
        const adapter = new FalAdapter({
          key: await credentials(data, "fal").key(),
          transport,
        });
        const q = await adapter.quote({
          capabilities: { endpointId: model.model },
        });
        amount = q.quote;
        basis = q.note;
      } else {
        amount = model.price;
        basis =
          "Published 1K price · checked 24 Oct 2026. Estimate, not a confirmed charge.";
      }
    }
    const q = {
      id: randomUUID(),
      projectId,
      input,
      ...built,
      executionMode,
      provider: model.provider,
      model: model.model,
      price: { amount, currency: "USD", basis },
      createdAt: Date.now(),
      expiresAt: Date.now() + 300000,
    };
    store.db
      .prepare(
        "DELETE FROM image_quotes WHERE json_extract(body,'$.expiresAt') < ?",
      )
      .run(Date.now());
    store.db
      .prepare("INSERT INTO image_quotes VALUES(?,?,?)")
      .run(q.id, projectId, JSON.stringify(q));
    return q;
  }
  async function submit(projectId, quoteId) {
    project(projectId);
    const old = get(quoteId);
    if (old) {
      if (old.projectId !== projectId) throw Error("Wrong project.");
      return view(old);
    }
    const row = store.db
      .prepare("SELECT body FROM image_quotes WHERE id=? AND projectId=?")
      .get(quoteId, projectId);
    if (!row) throw Error("Refresh the image estimate first.");
    const q = JSON.parse(row.body);
    if (q.expiresAt < Date.now() || q.executionMode !== (await mode()))
      throw Error("Mode or estimate changed. Review a fresh estimate.");
    project(projectId);
    // Recheck after awaits so concurrent double-clicks cannot submit twice.
    const existing = get(quoteId);
    if (existing) return view(existing);
    if (list(projectId).filter((j) => pending.includes(j.state)).length >= 4)
      throw Error("Wait for an image to finish before starting another.");
    const j = save({ ...q, state: "queued" });
    void tick();
    return view(j);
  }
  async function batchQuote(projectId,value) {
    const inputs=imageBatchInputs(value),quotes=[];
    for(const input of inputs) quotes.push(await quote(projectId,input));
    if(quotes.some(q=>q.executionMode!==quotes[0].executionMode))throw Error('Mode changed. Review again.');
    const batch={id:randomUUID(),projectId,quotes,executionMode:quotes[0].executionMode,
      price:{amount:quotes.reduce((n,q)=>n+q.price.amount,0),currency:'USD'},expiresAt:Math.min(...quotes.map(q=>q.expiresAt))};
    store.db.prepare('INSERT INTO image_batches VALUES(?,?,?)').run(batch.id,projectId,JSON.stringify(batch));
    return batch;
  }
  async function batchSubmit(projectId,id) {
    project(projectId);
    const row=store.db.prepare('SELECT body FROM image_batches WHERE id=? AND projectId=?').get(id,projectId);
    if(!row)throw Error('Review a fresh variation estimate.');
    const batch=JSON.parse(row.body);
    if(batch.quotes.every(q=>get(q.id)))return {id,jobs:batch.quotes.map(q=>view(get(q.id)))};
    if(batch.expiresAt<Date.now()||batch.executionMode!==await mode())throw Error('Mode or estimate changed. Review again.');
    project(projectId);
    // No awaits between rechecking existing jobs and inserting the entire batch.
    const missing=batch.quotes.filter(q=>!get(q.id));
    if(list(projectId).filter(j=>pending.includes(j.state)).length+missing.length>4)throw Error('Wait for current images before starting this set.');
    store.db.exec('BEGIN IMMEDIATE');
    try {for(const q of missing)save({...q,batchId:id,state:'queued'});store.db.exec('COMMIT');}
    catch(e){store.db.exec('ROLLBACK');throw e;}
    const result={id,jobs:batch.quotes.map(q=>view(get(q.id)))};
    void tick();return result;
  }
  async function persist(j, p, bytes) {
    const folder = path.join(p.folder, "media");
    await fs.mkdir(folder, { recursive: true });
    const original = path.join(folder, j.id + "-original.png"),
      poster = path.join(folder, j.id + ".jpg"),
      video = path.join(folder, j.id + ".mp4"),
      temp = path.join(folder, j.id + "-response");
    if (bytes) {
      await fs.writeFile(temp, bytes);
      await render(["-y", "-i", temp, "-frames:v", "1", original]);
      await fs.rm(temp, { force: true });
    }
    await render([
      "-y",
      "-loop",
      "1",
      "-i",
      original,
      "-t",
      "5",
      "-vf",
      "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    await thumbnail(original, poster, 0);
    const media = {
      id: j.id,
      projectId: p.id,
      path: video,
      original,
      poster,
      duration: 5,
      originalDuration: 5,
      audio: false,
      kind: "image",
      name:
        (j.input.name || j.input.kind) +
        (j.executionMode === "test" ? " · Offline sample" : " · Generated"),
      url: "/api/media/" + j.id,
      thumbnail: "/api/media/" + j.id + "/thumbnail",
      generation: {
        jobId: j.id,
        provider: j.provider,
        model: j.model,
        test: j.executionMode === "test",
        sourceMediaId: j.input.sourceMediaId,
      },
    };
    store.putMedia(media);
    j.media = media;
    j.state = "ready";
    j.completedAt = Date.now();
    save(j);
    await checkpoint(p.id).catch(() => {});
  }
  async function process(j) {
    const p = project(j.projectId);
    if (j.state === "queued") {
      if (j.executionMode !== (await mode()))
        throw Error(
          "Studio mode changed before submission. Review a new estimate.",
        );
      if (j.executionMode === "test") {
        j.state = "saving";
        save(j);
        const folder = path.join(p.folder, "media");
        await fs.mkdir(folder, { recursive: true });
        const output = path.join(folder, j.id + "-original.png");
        const [w, h] = imageRatios[j.input.ratio];
        await render([
          "-y",
          "-f",
          "lavfi",
          "-i",
          `testsrc2=size=${w}x${h}:rate=1`,
          "-frames:v",
          "1",
          output,
        ]);
        await persist(j, p);
        return;
      }
      const refs = j.references?.length ? j.references : j.input.sourceMediaId ? [{mediaId:j.input.sourceMediaId,time:0}] : [];
      const base64 = [];
      for (const [index, ref] of refs.entries()) {
        const m = store.media(ref.mediaId);
        if (!m || m.projectId !== p.id) throw Error('Reference no longer available.');
        if (m.kind === 'image' && (await fs.stat(m.original || m.path)).size > 24 * 1024 * 1024)
          throw Error('Reference is larger than 24 MB. Use a smaller image.');
        const cache = path.join(data, 'image-inputs');
        await fs.mkdir(cache, {recursive:true});
        const normalized = path.join(cache, `${j.id}-${index}.png`);
        try {
          await render(['-y', ...(m.kind === 'image' ? [] : ['-ss', String(Math.min(Math.max(0,m.duration-.05),ref.time || 0))]), '-i', m.original || m.path, '-vf', 'scale=1024:1024:force_original_aspect_ratio=decrease', '-frames:v', '1', normalized]);
          base64.push((await fs.readFile(normalized)).toString('base64'));
        } finally { await fs.rm(normalized,{force:true}); }
      }
      // Credential validation happens before entering the uncertain submission state.
      if (!(await credentials(data, j.provider).key()))
        throw Error("Provider key is missing.");
      if ((await mode()) !== "live")
        throw Error("Offline mode blocks AI provider submission.");
      const payload = imagePayload(j.input, j.prompt, base64);
      j.state = "submitting";
      save(j);
      let response;
      try {
        response = await call(
          j.provider,
          j.provider === "fal"
            ? "https://queue.fal.run/" + j.model
            : "https://api.venice.ai/api/v1/image/" +
                (j.input.mode === "vary" ? "edit" : "generate"),
          payload,
        );
      } catch {
        throw Object.assign(
          Error(
            "Submission response lost. Check provider history before trying again.",
          ),
          { uncertain: true },
        );
      }
      if (!response.ok) {
        if (response.status >= 500 || response.status === 408)
          throw Object.assign(
            Error(
              "Provider acceptance is uncertain. Check provider history before trying again.",
            ),
            { uncertain: true },
          );
        let detail = "";
        try {
          const reader=response.body.getReader(); let bytes=0, chunks=[];
          try { while (bytes<8192) { const {done,value}=await reader.read(); if(done) break; bytes+=value.length; chunks.push(value); } } finally { await reader.cancel(); }
          if(bytes<=8192) {
            const body=JSON.parse(Buffer.concat(chunks).toString());
            const errors=Object.entries(body.details || {}).flatMap(([field,v])=>Array.isArray(v?._errors)?v._errors.filter(x=>typeof x==='string').map(x=>`${field}: ${x}`):[]);
            detail=errors.join('; ') || (typeof body.error==='string'?body.error:body.error?.message || '');
            detail=String(detail).replace(/(?:Bearer|Key)\s+\S+/gi,'[redacted]').replace(/[A-Za-z0-9+/=_-]{80,}/g,'[redacted]').slice(0,350);
          }
        } catch {}
        throw Error(`Image provider rejected the request (${response.status}). ${detail || 'Review the image and description.'}`);
      }
      j.acceptedAt = Date.now();
      save(j);
      if (j.provider === "fal") {
        let result;
        try {
          result = await response.json();
          if (!/^[\w-]{8,200}$/.test(result.request_id || "")) throw Error();
          j.providerRequestId = result.request_id;
          j.providerUrls = {
            status: falQueueURL(result.status_url),
            result: falQueueURL(result.response_url),
          };
        } catch {
          throw Object.assign(
            Error(
              "Accepted request could not be read. Check provider history.",
            ),
            { uncertain: true },
          );
        }
        j.state = "processing";
        save(j);
        return;
      }
      let bytes;
      if (j.input.mode === "vary") bytes = await boundedImage(response);
      else {
        const result = await response.json();
        j.providerRequestId = result.id;
        if (!result.images?.[0])
          throw Error(
            "No image returned. The provider may have declined the content.",
          );
        if (result.images[0].length > 34 * 1024 * 1024)
          throw Error("Image exceeds download limit.");
        bytes = Buffer.from(result.images[0], "base64");
      }
      j.state = "saving";
      save(j);
      await persist(j, p, bytes);
      return;
    }
    if (j.state === "processing") {
      if ((await mode()) !== "live") return; // Test mode never contacts a provider, even for recovery.
      const response = await call("fal", falQueueURL(j.providerUrls.status));
      if (!response.ok)
        throw Error(
          `Status unavailable (${response.status}). Retry retrieves this request only.`,
        );
      const status = await response.json();
      if (["FAILED", "CANCELLED"].includes(status.status))
        throw Error("The provider could not generate this image.");
      if (status.status !== "COMPLETED") return;
      const result = await call("fal", falQueueURL(j.providerUrls.result));
      if (!result.ok)
        throw Error(`Image result unavailable (${result.status}).`);
      const body = await result.json();
      if (!body.images?.[0]?.url) throw Error("Provider returned no image.");
      j.downloadUrl = body.images[0].url;
      j.state = "saving";
      save(j);
    }
    if (j.state === "saving") {
      const original = path.join(p.folder, "media", j.id + "-original.png");
      if (await fs.stat(original).catch(() => null)) return persist(j, p);
      const temp = path.join(p.folder, "media", j.id + "-response");
      if (await fs.stat(temp).catch(() => null))
        return persist(j, p, await fs.readFile(temp));
      if (j.downloadUrl) {
        if ((await mode()) !== "live") return;
        const bytes = await boundedImage(
          await download(j.downloadUrl, fetch, "fal"),
        );
        return persist(j, p, bytes);
      }
      throw Error(
        "Image response interrupted. Check provider history before generating again.",
      );
    }
  }
  let running = false,
    stopped = false;
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const rows = store.db
        .prepare(
          "SELECT body FROM image_jobs WHERE state IN ('queued','processing','saving') ORDER BY rowid",
        )
        .all();
      for (const row of rows) {
        const j = JSON.parse(row.body);
        try {
          await process(j);
        } catch (e) {
          j.state = e.uncertain ? "submission_uncertain" : "failed";
          j.error = e.message;
          save(j);
          await checkpoint(j.projectId).catch(() => {});
        }
      }
    } finally {
      running = false;
    }
  }
  for (const row of store.db
    .prepare("SELECT body FROM image_jobs WHERE state='submitting'")
    .all()) {
    const j = JSON.parse(row.body);
    j.state = "submission_uncertain";
    j.error =
      "Server stopped during submission. Check provider history before trying again.";
    save(j);
  }
  const timer = setInterval(() => void tick(), 2500);
  timer.unref();
  async function retry(projectId, id) {
    const j = get(id);
    if (!j || j.projectId !== projectId) throw Error("Image not found.");
    if (!["failed", "submission_uncertain"].includes(j.state)) return view(j);
    if (!j.providerUrls && !j.downloadUrl)
      throw Error(
        "This request cannot be retrieved automatically. Check provider history; create a fresh estimate only if you want a new generation.",
      );
    if ((await mode()) !== "live")
      throw Error("Retrieving a provider result requires Online mode.");
    j.state = j.downloadUrl ? "saving" : "processing";
    delete j.error;
    save(j);
    void tick();
    return view(j);
  }
  return {
    quote,
    submit,
    batchQuote,
    batchSubmit,
    list: (id) => list(id).map(view),
    retry,
    tick,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
export function installImageRoutes(app, service) {
  app.post('/api/projects/:id/images/batch/quote',async(req,res)=>res.json(await service.batchQuote(req.params.id,req.body)));
  app.post('/api/projects/:id/images/batch',async(req,res)=>res.json(await service.batchSubmit(req.params.id,req.body.quoteId)));
  app.get("/api/projects/:id/images", (req, res) =>
    res.json(service.list(req.params.id)),
  );
  app.post("/api/projects/:id/images/quote", async (req, res) =>
    res.json(await service.quote(req.params.id, req.body)),
  );
  app.post("/api/projects/:id/images", async (req, res) =>
    res.json(await service.submit(req.params.id, req.body.quoteId)),
  );
  app.post("/api/projects/:id/images/:job/retrieve", async (req, res) =>
    res.json(await service.retry(req.params.id, req.params.job)),
  );
}
