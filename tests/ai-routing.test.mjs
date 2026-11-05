import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  updateRouting,
  readRouting,
  routedTextConfig,
  discoverTextProvider,
  sendRoutedText,
} from "../server/ai-routing.mjs";
import { studioMode, saveStudioMode } from "../server/mode.mjs";
import { credentials } from "../server/connections.mjs";
import {
  textRequest,
  validateRoute,
  tokenPricing,
} from "../shared/ai-routing.mjs";
const sandbox = async (fn) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splece-routing-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};
test("feature switches are independent and survive restart; unsupported assignments fail", () =>
  sandbox(async (dir) => {
    await saveStudioMode(dir, "test");
    await updateRouting(dir, {
      text: { enabled: true, provider: "openrouter", model: "test/text" },
    });
    assert.equal(await studioMode(dir, "text"), "live");
    for (const lane of ["image", "video", "audio", "assistant"])
      assert.equal(await studioMode(dir, lane), "test");
    await Promise.all([
      updateRouting(dir, { image: { enabled: true } }),
      updateRouting(dir, { video: { enabled: true } }),
    ]);
    assert.equal((await readRouting(dir)).image.enabled, true);
    assert.equal((await readRouting(dir)).video.enabled, true);
    assert.throws(() =>
      validateRoute("audio", {
        enabled: true,
        provider: "openai",
        model: "voice",
      }),
    );
  }));
test("OpenRouter verification is read-only, preserves working key on failure, and records prices", () =>
  sandbox(async (dir) => {
    let calls = [];
    const transport = async (url, options) => {
      calls.push({ url, method: options.method });
      return Response.json(
        url.endsWith("/key")
          ? { data: {} }
          : {
              data: [
                {
                  id: "test/model",
                  name: "Test",
                  architecture: {
                    input_modalities: ["text", "image"],
                    output_modalities: ["text"],
                  },
                  supported_parameters: ["tools"],
                  pricing: { prompt: "0.000001", completion: "0.000002" },
                },
              ],
            },
      );
    };
    await discoverTextProvider(dir, "openrouter", "fake-key", transport);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => !c.method || c.method === "GET"));
    assert.equal(await credentials(dir, "openrouter").key(), "fake-key");
    await assert.rejects(() =>
      discoverTextProvider(
        dir,
        "openrouter",
        "bad-key",
        async () => new Response("", { status: 401 }),
      ),
    );
    assert.equal(await credentials(dir, "openrouter").key(), "fake-key");
    await updateRouting(dir, {
      text: { enabled: true, provider: "openrouter", model: "test/model" },
    });
    const config = await routedTextConfig(dir);
    assert.equal(config.vision, true);
    assert.equal(config.pricing.prompt, 0.000001);
    let sent;
    await sendRoutedText(
      dir,
      config,
      { model: "old", thinking: { type: "disabled" }, messages: [] },
      async (url, options) => {
        sent = {
          url,
          body: JSON.parse(options.body),
          auth: options.headers.Authorization,
        };
        return Response.json({});
      },
    );
    assert.equal(sent.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(sent.body.model, "test/model");
    assert.equal(sent.body.thinking, undefined);
    assert.equal(sent.auth, "Bearer fake-key");
    await updateRouting(dir, { text: { enabled: false } });
    await assert.rejects(
      () =>
        sendRoutedText(dir, config, {}, async () =>
          assert.fail("off must not dispatch"),
        ),
      /off/,
    );
  }));
test("OpenAI verification never sends credentials to another provider or calls inference", () =>
  sandbox(async (dir) => {
    let calls = 0;
    await discoverTextProvider(
      dir,
      "openai",
      "fake-openai",
      async (url, opts) => {
        calls++;
        assert.equal(url, "https://api.openai.com/v1/models");
        assert.equal(opts.headers.Authorization, "Bearer fake-openai");
        return Response.json({
          data: [
            { id: "gpt-test-mini" },
            { id: "gpt-image-test" },
            { id: "text-embedding-test" },
          ],
        });
      },
    );
    assert.equal(calls, 1);
    const body = textRequest(
      { provider: "openai", model: "gpt-test-mini" },
      { max_tokens: 100, thinking: { type: "disabled" }, temperature: 0 },
    );
    assert.equal(body.max_completion_tokens, 100);
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.thinking, undefined);
  }));

test("Unknown or variable token prices cannot become a zero or invalid estimate", () => {
  assert.equal(tokenPricing({ prompt: "-1", completion: "0.001" }), null);
  assert.equal(tokenPricing({ input: 1, output: 2 }), null);
  assert.equal(tokenPricing({ prompt: "unknown", completion: "0.001" }), null);
  assert.deepEqual(tokenPricing({ prompt: "0", completion: "0" }), {
    prompt: 0,
    completion: 0,
  });
});
test("Changing providers cancels an already reviewed request without transmitting its key or prompt", () =>
  sandbox(async (dir) => {
    await credentials(dir, "openai").saveKey("fake-openai");
    await updateRouting(dir, {
      text: { enabled: true, provider: "openai", model: "gpt-test" },
    });
    const config = await routedTextConfig(dir);
    await updateRouting(dir, {
      text: { provider: "openrouter", model: "other-model" },
    });
    await assert.rejects(
      () =>
        sendRoutedText(
          dir,
          config,
          { messages: [{ role: "user", content: "Private draft" }] },
          async () =>
            assert.fail("No request may dispatch after a provider change"),
        ),
      /selection changed/,
    );
  }));

test('Online pause blocks every lane and text dispatch while preserving exact preferences',()=>sandbox(async dir=>{
  const {saveStudioOnline}=await import('../server/online.mjs');
  const {routingCatalog}=await import('../server/ai-routing.mjs');
  await saveStudioMode(dir,'test');
  await updateRouting(dir,{text:{enabled:true,provider:'openai',model:'gpt-test'},assistant:{enabled:false},image:{enabled:true,provider:'fal',model:''},video:{enabled:true,provider:'fal',model:'movie'},audio:{enabled:false}});
  const before=await readRouting(dir,{preferences:true}), config=await routedTextConfig(dir);
  await saveStudioOnline(dir,false);
  for(const lane of ['text','assistant','image','video','audio']) assert.equal(await studioMode(dir,lane),'test');
  assert.ok(Object.values(await readRouting(dir)).every(r=>!r.enabled));
  assert.deepEqual((await routingCatalog(dir)).routes,before);
  assert.equal((await routingCatalog(dir)).online,false);
  await assert.rejects(sendRoutedText(dir,config,{},()=>assert.fail('Offline must never dispatch')),/off/);
  await updateRouting(dir,{audio:{enabled:true}});
  assert.equal(await studioMode(dir,'audio'),'test');
  await saveStudioOnline(dir,true);
  assert.deepEqual(await readRouting(dir),{...before,audio:{...before.audio,enabled:true}});
  assert.equal(await studioMode(dir,'assistant'),'test');
  assert.equal(await studioMode(dir,'text'),'live');
}));

test('Offline gate also blocks legacy text configuration without stored lane settings',()=>sandbox(async dir=>{
  const {saveStudioOnline}=await import('../server/online.mjs');
  await fs.writeFile(path.join(dir,'deepseek-settings.json'),JSON.stringify({mode:'deepseek',model:'legacy'}));
  const config=await routedTextConfig(dir);assert.equal(config.mode,'deepseek');
  await saveStudioOnline(dir,false);
  assert.equal((await routedTextConfig(dir)).mode,'demo');
  await assert.rejects(sendRoutedText(dir,config,{},()=>assert.fail('No legacy bypass')),/off/);
  await assert.rejects(saveStudioOnline(dir,'false'),/Choose/);
}));
