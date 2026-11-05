import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  normalizeImageInput,
  imageAssetPrompt,
  applyGeneratedImage,
  imageCostRecord,
} from "../shared/asset-generation.mjs";
import {
  createImageService,
  imagePayload,
  boundedImage,
} from "../server/asset-images.mjs";
import { newProject } from "../server/domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { openStore } from "../server/store.mjs";
import { saveStudioMode } from "../server/mode.mjs";
import { credentials } from "../server/connections.mjs";
import { activeStudioJobs } from "../server/launcher.mjs";
import { createPortableStore } from "../server/portable.mjs";
const raw = {
  assetId: "asset-test",
  kind: "character",
  name: "Mira",
  description: "Curious traveller, green coat.",
  mode: "create",
  modelId: "venice-grok",
  framing: "sheet",
  look: "auto",
  ratio: "1:1",
};
async function fixture(t, options = {}) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "splece-image-"));
  const store = openStore(path.join(data, "db.sqlite"));
  const p = upgradeProject(newProject("Image test"));
  p.folder = path.join(data, "project");
  store.save(p, 0);
  await saveStudioMode(data, options.live ? "live" : "test");
  if (options.live) {
    await credentials(data, "venice").saveKey("test-key");
    await credentials(data, "fal").saveKey("test-key");
  }
  const service = createImageService({ store, data, ...options });
  t.after(async () => {
    service.stop();
    store.db.close();
    await fs.rm(data, { recursive: true, force: true });
  });
  return { data, store, p, service };
}
async function waitFor(service, id, pid) {
  for (let i = 0; i < 200; i++) {
    const j = service.list(pid).find((j) => j.id === id);
    if (j && ["ready", "failed", "submission_uncertain"].includes(j.state))
      return j;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Image job timed out");
}
test("Asset templates bind identity, keep authored description and exclude unrelated story cast", () => {
  const p = upgradeProject(newProject("Test"));
  p.settings.workflows = {
    version: 1,
    flows: {
      image: {
        nodes: { guidance: { text: "Cool blue shadows.", enabled: true } },
      },
    },
  };
  const i = normalizeImageInput({
    ...raw,
    mode: "vary",
    modelId: "venice-firered",
    sourceMediaId: "m",
  });
  const before = structuredClone(p);
  const result = imageAssetPrompt(i, p);
  assert.match(result.prompt, /attached image controls facial identity/);
  assert.match(result.prompt, /same subject, not three people/);
  assert.match(result.prompt, /Cool blue shadows/);
  assert.ok(result.prompt.includes(raw.description));
  assert.deepEqual(p, before);
  assert.equal(result.recipeId, "character-views");
  for (const kind of ["location", "prop", "style"]) {
    const prompt = imageAssetPrompt(
      normalizeImageInput({ ...raw, kind, framing: undefined }),
      p,
    ).prompt;
    assert.doesNotMatch(prompt, /facial identity|Character reference sheet/);
  }
});
test("Validation rejects wrong modalities, unsupported controls and missing variation references", () => {
  assert.throws(
    () => normalizeImageInput({ ...raw, mode: "vary" }),
    /compatible/,
  );
  assert.throws(
    () => normalizeImageInput({ ...raw, kind: "audio" }),
    /compatible/,
  );
  assert.throws(
    () => normalizeImageInput({ ...raw, ratio: "4:7" }),
    /supported/,
  );
  assert.throws(
    () => normalizeImageInput({ ...raw, description: "" }),
    /description/,
  );
  assert.throws(
    () =>
      normalizeImageInput({ ...raw, mode: "vary", modelId: "fal-flux-edit" }),
    /image to vary/,
  );
});
test("Provider payloads use documented field names and exactly one output", () => {
  const i = normalizeImageInput(raw),
    p = imagePayload(i, "words");
  assert.equal(p.model, "grok-imagine-image");
  assert.equal(p.variants, 1);
  assert.equal(p.return_binary, false);
  assert.equal(p.image, undefined);
  const edit = imagePayload(
    { ...i, mode: "vary", modelId: "venice-firered" },
    "change",
    "base64",
  );
  assert.equal(edit.image, "base64");
  assert.equal(edit.output_format, "png");
  assert.equal(edit.quality, undefined);
  const fal = imagePayload(
    { ...i, mode: "vary", modelId: "fal-flux-edit" },
    "change",
    "base64",
  );
  assert.deepEqual(fal.image_urls, ["data:image/png;base64,base64"]);
  assert.equal(fal.num_images, 1);
  assert.deepEqual(fal.image_size, { width: 1024, height: 1024 });
});
test("Test generation and variation save managed images without ANY provider call, and preserve originals", async (t) => {
  let calls = 0;
  const { service, p, store } = await fixture(t, {
    transport: async () => {
      calls++;
      throw Error("Network forbidden");
    },
    download: async () => {
      calls++;
      throw Error("Network forbidden");
    },
  });
  const q = await service.quote(p.id, raw);
  assert.equal(q.price.amount, 0);
  const [a, b] = await Promise.all([
    service.submit(p.id, q.id),
    service.submit(p.id, q.id),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(activeStudioJobs(store.db), 1);
  const j = await waitFor(service, a.id, p.id);
  assert.equal(j.state, "ready", j.error);
  assert.equal(j.media.kind, "image");
  const original = await fs.readFile(j.media.original);
  assert.equal(original.subarray(1, 4).toString(), "PNG");
  const q2 = await service.quote(p.id, {
    ...raw,
    mode: "vary",
    modelId: "fal-flux-edit",
    sourceMediaId: j.media.id,
    description: "A red scarf.",
  });
  const j2 = await waitFor(
    service,
    (await service.submit(p.id, q2.id)).id,
    p.id,
  );
  assert.equal(j2.state, "ready", j2.error);
  assert.notEqual(j.media.id, j2.media.id);
  assert.deepEqual(await fs.readFile(j.media.original), original);
  assert.equal(calls, 0);
  assert.equal(activeStudioJobs(store.db), 0);
  const asset = {
    id: raw.assetId,
    name: "Mira",
    kind: "character",
    description: "Original words",
    media: j.media,
  };
  const next = applyGeneratedImage(asset, j2, { variant: true });
  assert.equal(next.media.id, j.media.id);
  assert.equal(next.description, "Original words");
  assert.equal(next.variants[0].media.id, j2.media.id);
  assert.equal(
    applyGeneratedImage(next, j2, { variant: true }).variants.length,
    1,
  );
  assert.deepEqual(imageCostRecord(j2).amount, 0);
  await createPortableStore(store).checkpoint(p.id);
  const bundle = JSON.parse(
    await fs.readFile(
      path.join(p.folder, ".frame", "project.bundle.json"),
      "utf8",
    ),
  );
  assert.equal(bundle.imageJobs.length, 2);
});
test("Expired or mode-changed quotes cannot spend; variation cannot read another project media", async (t) => {
  const { service, p, store, data } = await fixture(t);
  const q = await service.quote(p.id, raw);
  await saveStudioMode(data, "live");
  await assert.rejects(service.submit(p.id, q.id), /Mode or estimate changed/);
  assert.equal(service.list(p.id).length, 0);
  store.putMedia({
    id: "foreign",
    projectId: "other",
    path: "/private/file",
    kind: "image",
  });
  await assert.rejects(
    service.quote(p.id, {
      ...raw,
      mode: "vary",
      modelId: "venice-firered",
      sourceMediaId: "foreign",
    }),
    /saved in this project/,
  );
});
test("Lost submission is not automatically resubmitted and remains unknown in costs", async (t) => {
  let calls = 0;
  const { service, p } = await fixture(t, {
    live: true,
    transport: async () => {
      calls++;
      throw Error("Lost response");
    },
  });
  const q = await service.quote(p.id, raw);
  const j = await waitFor(service, (await service.submit(p.id, q.id)).id, p.id);
  assert.equal(j.state, "submission_uncertain");
  await service.tick();
  await service.submit(p.id, q.id);
  assert.equal(calls, 1);
  assert.equal(imageCostRecord(j).status, "unknown");
});
test("fal queue ID persists and retry only retrieves the accepted image", async (t) => {
  let submissions = 0,
    statuses = 0;
  const { service, p, store } = await fixture(t, {
    live: true,
    transport: async (url, opts) => {
      if (url.includes("pricing/estimate"))
        return Response.json({ currency: "USD", total_cost: 0.003 });
      if (opts.method === "POST") {
        submissions++;
        return Response.json({
          request_id: "request-image-123",
          status_url:
            "https://queue.fal.run/fal-ai/flux/requests/request-image-123/status",
          response_url:
            "https://queue.fal.run/fal-ai/flux/requests/request-image-123",
        });
      }
      statuses++;
      return new Response("", { status: 503 });
    },
  });
  const q = await service.quote(p.id, { ...raw, modelId: "fal-schnell" });
  const j = await service.submit(p.id, q.id);
  for (let i = 0; i < 50 && !service.list(p.id)[0].providerRequestId; i++)
    await new Promise((r) => setTimeout(r, 10));
  await service.tick();
  let current = service.list(p.id)[0];
  assert.equal(current.state, "failed");
  assert.equal(current.providerRequestId, "request-image-123");
  await service.retry(p.id, j.id);
  await waitFor(service, j.id, p.id);
  assert.equal(submissions, 1);
  assert.ok(statuses >= 2);
  assert.equal(imageCostRecord(current).status, "estimated");
  assert.equal(
    JSON.parse(
      store.db.prepare("SELECT body FROM image_jobs").get().body,
    ).providerUrls.status.includes("queue.fal.run"),
    true,
  );
});
test("Image download size is bounded", async () => {
  const response = new Response(new Uint8Array(26 * 1024 * 1024));
  await assert.rejects(boundedImage(response), /25 MB/);
});
test("Mocked Venice create and edit responses become playable local media with separate originals", async (t) => {
  let bytes,
    payloads = [];
  const { service, p, data } = await fixture(t, {
    transport: async (url, opts) => {
      payloads.push({ url, body: JSON.parse(opts.body) });
      return url.endsWith("/edit")
        ? new Response(bytes, { headers: { "Content-Type": "image/png" } })
        : Response.json({
            id: "venice-image-request",
            images: [bytes.toString("base64")],
          });
    },
  });
  const seed = await service.quote(p.id, raw);
  const sample = await waitFor(
    service,
    (await service.submit(p.id, seed.id)).id,
    p.id,
  );
  bytes = await fs.readFile(sample.media.original);
  await credentials(data, "venice").saveKey("test-key");
  await saveStudioMode(data, "live");
  const q = await service.quote(p.id, raw);
  assert.equal(q.price.amount, 0.03);
  const created = await waitFor(
    service,
    (await service.submit(p.id, q.id)).id,
    p.id,
  );
  assert.equal(created.state, "ready", created.error);
  assert.equal(created.providerRequestId, "venice-image-request");
  const edit = await service.quote(p.id, {
    ...raw,
    mode: "vary",
    modelId: "venice-firered",
    sourceMediaId: created.media.id,
    description: "Red jacket.",
  });
  const varied = await waitFor(
    service,
    (await service.submit(p.id, edit.id)).id,
    p.id,
  );
  assert.equal(varied.state, "ready", varied.error);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].body.image, undefined);
  assert.equal(
    Buffer.from(payloads[1].body.image, "base64").subarray(1, 4).toString(),
    "PNG",
  );
  assert.equal(imageCostRecord(varied).amount, 0.04);
  assert.notEqual(varied.media.original, created.media.original);
});
test("Mocked fal successful queue result is downloaded once without exposing credentials to media hosts", async (t) => {
  let bytes,
    submits = 0,
    downloads = 0;
  const { service, p, data } = await fixture(t, {
    transport: async (url, opts) => {
      if (url.includes("pricing/estimate"))
        return Response.json({ currency: "USD", total_cost: 0.003 });
      if (opts.method === "POST") {
        submits++;
        return Response.json({
          request_id: "request-complete-123",
          status_url:
            "https://queue.fal.run/fal-ai/flux/requests/request-complete-123/status",
          response_url:
            "https://queue.fal.run/fal-ai/flux/requests/request-complete-123",
        });
      }
      return url.endsWith("/status")
        ? Response.json({ status: "COMPLETED" })
        : Response.json({
            images: [{ url: "https://v3.fal.media/files/image.png" }],
          });
    },
    download: async (url, fetcher, provider) => {
      downloads++;
      assert.equal(provider, "fal");
      assert.equal(url, "https://v3.fal.media/files/image.png");
      return new Response(bytes);
    },
  });
  const seed = await service.quote(p.id, raw);
  const sample = await waitFor(
    service,
    (await service.submit(p.id, seed.id)).id,
    p.id,
  );
  bytes = await fs.readFile(sample.media.original);
  await credentials(data, "fal").saveKey("test-key");
  await saveStudioMode(data, "live");
  const q = await service.quote(p.id, { ...raw, modelId: "fal-schnell" });
  const job = await service.submit(p.id, q.id);
  for (
    let i = 0;
    i < 50 &&
    !service.list(p.id).find((j) => j.id === job.id).providerRequestId;
    i++
  )
    await new Promise((r) => setTimeout(r, 10));
  await service.tick();
  const result = await waitFor(service, job.id, p.id);
  assert.equal(result.state, "ready", result.error);
  assert.equal(submits, 1);
  assert.equal(downloads, 1);
  assert.equal(result.downloadUrl, undefined);
});

test('Batch quote freezes four distinct directions; duplicate submission queues each once',async t=>{
 const {p,service,store}=await fixture(t);
 // Stop execution so this test can inspect the atomic queue independently of rendering.
 service.stop();
 const q=await service.batchQuote(p.id,{...raw,count:4});
 assert.equal(q.quotes.length,4);assert.equal(q.price.amount,0);assert.equal(new Set(q.quotes.map(x=>x.input.variationPrompt)).size,4);
 const [a,b]=await Promise.all([service.batchSubmit(p.id,q.id),service.batchSubmit(p.id,q.id)]);
 assert.deepEqual(a.jobs.map(j=>j.id),b.jobs.map(j=>j.id));assert.equal(service.list(p.id).length,4);assert.equal(activeStudioJobs(store.db),4);
 assert.ok(a.jobs.every(j=>j.input.description===raw.description));
 const extra=await service.batchQuote(p.id,{...raw,count:1});await assert.rejects(service.batchSubmit(p.id,extra.id),/Wait/);assert.equal(service.list(p.id).length,4);
});
test('Explicit visual details survive quotes and acceptance without replacing author prose or source identity',()=>{
 const p=upgradeProject(newProject('Visual test'));
 const input=normalizeImageInput({...raw,framing:'portrait',visualBrief:{age:'34 years',features:'Brown eyes, round face',wardrobe:'Sage abaya, cream hijab'}});
 const prompt=imageAssetPrompt(input,p).prompt;
 assert.ok(prompt.includes(raw.description));assert.match(prompt,/Age \/ life stage: 34 years/);assert.match(prompt,/Sage abaya, cream hijab/);
 const a={id:raw.assetId,description:'Original story',voice:{preset:'kept'}};
 const applied=applyGeneratedImage(a,{id:'j',state:'ready',input,media:{id:'image'}});
 assert.deepEqual(applied.visualBrief,input.visualBrief);assert.equal(applied.description,'Original story');assert.deepEqual(applied.voice,a.voice);
 const variant=applyGeneratedImage({...applied},{id:'v',state:'ready',input:{...input,visualBrief:{age:'60'}},media:{id:'other'}},{variant:true});assert.deepEqual(variant.visualBrief,input.visualBrief);
 assert.throws(()=>normalizeImageInput({...raw,visualBrief:{features:['not text']}}),/visual detail/);
});
test('Auto asset images inherit the planning art direction and explicit looks override its medium',()=>{
 const p=upgradeProject(newProject('Direction'));p.storyPlans={[p.episodeId]:{setup:{directionBrief:'Soft 3D, warm pastel classroom'},beats:[]}};
 const auto=imageAssetPrompt(normalizeImageInput(raw),p).prompt;assert.match(auto,/Project art direction: Soft 3D/);assert.match(auto,/Inherit its rendering style/);
 const custom=imageAssetPrompt(normalizeImageInput({...raw,look:'illustrated'}),p).prompt;assert.match(custom,/explicitly selected image style takes priority/);
});
test('FireRed edits fit their live provider limit and omit unchanged identity prose',()=>{
 const p=upgradeProject(newProject('Edit'));p.assets=[{id:raw.assetId,visualBrief:{features:'x'.repeat(600),wardrobe:'y'.repeat(600)}}];
 const input=normalizeImageInput({...raw,description:'Render as a soft 3D adult character.',mode:'vary',modelId:'venice-firered',sourceMediaId:'photo',visualBrief:p.assets[0].visualBrief});
 const prompt=imageAssetPrompt(input,p).prompt;assert.ok(prompt.length<=1500);assert.ok(prompt.startsWith(input.description));assert.ok(!prompt.includes('x'.repeat(100)));
 assert.throws(()=>imageAssetPrompt({...input,description:'z'.repeat(1501)},p),/1,500/);
});

test("Open image direction does not impose portrait framing, studio lighting or a fixed style", () => {
  const input=normalizeImageInput({assetId:"a",kind:"character",mode:"create",modelId:"venice-grok",description:"Full body watercolor teacher jumping in a neon garden",framing:"auto",look:"auto",ratio:"1:1"});
  const built=imageAssetPrompt(input,upgradeProject(newProject("Open styling")));
  assert.match(built.prompt,/watercolor teacher jumping/);
  assert.doesNotMatch(built.prompt,/Single close-up portrait|plain warm-grey studio backdrop|soft even light, restrained contrast/);
  assert.equal(input.ratio,"1:1");
});

test("Editing an alternate look does not inject its unchanged wardrobe as a new instruction", () => {
  const p=upgradeProject(newProject("Alternate look"));
  p.assets=[{id:"a",kind:"character",media:{id:"main"},visualBrief:{wardrobe:"Red coat"},variants:[{media:{id:"alt"},visualBrief:{wardrobe:"Blue coat"}}]}];
  const input=normalizeImageInput({assetId:"a",kind:"character",mode:"vary",modelId:"venice-firered",sourceMediaId:"alt",description:"Change the coat to green",visualBrief:{wardrobe:"Blue coat"},framing:"auto"});
  const built=imageAssetPrompt(input,p);
  assert.match(built.prompt,/coat to green/);
  assert.doesNotMatch(built.prompt,/Blue coat|Red coat/);
});
