import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCatalogService } from "../server/catalog.mjs";
import {
  createDeepSeekSettings,
  createVeniceSettings,
  discoverDeepSeekModels,
} from "../server/smart.mjs";
test("Connection discovery persists full models, authenticates Venice, retains cache on errors and invalidates changed keys", async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-"));
  try {
    const deepseek = createDeepSeekSettings(data),
      venice = createVeniceSettings(data);
    await deepseek.saveKey("fake-deepseek");
    await venice.saveKey("fake-venice");
    let fail = false,
      permitted = true;
    const calls = [];
    const options = {
      data,
      deepseek,
      venice,
      discover: discoverDeepSeekModels,
      video: {
        refresh: async () => ({
          models: [
            {
              id: "video-test",
              name: "Video",
              studioDefaults: { duration: 5 },
            },
          ],
          fetchedAt: Date.now(),
        }),
      },
      transport: async (url, init) => {
        calls.push(url);
        assert.ok(!url.includes("chat/completions"));
        assert.equal(init.body, undefined);
        if (fail) return new Response("", { status: 401 });
        return Response.json(
          url.endsWith("/models")
            ? {
                data: [
                  {
                    id: "deepseek-flash",
                    name: "Flash",
                    context_window: 100000,
                    max_output_tokens: 8000,
                    input_modalities: ["text"],
                    effort: {
                      supported_levels: ["high"],
                      default_level: "high",
                    },
                  },
                ],
              }
            : url.includes("models?type=video")
              ? {
                  data: [{ id: "video-test", model_spec: { constraints: {} } }],
                }
              : { data: { accessPermitted: permitted } },
        );
      },
    };
    const service = createCatalogService(options);
    const result = await service.test("deepseek");
    assert.equal(result.verified, true);
    assert.equal(result.models[0].studioDefaults.storyMaxTokens, 8000);
    assert.equal(result.models[0].effort.default_level, "high");
    assert.equal(
      (await createCatalogService(options).status("deepseek")).models.length,
      1,
    );
    assert.ok(!JSON.stringify(result).includes("fake-deepseek"));
    const v = await service.test("venice");
    assert.equal(v.verified, true);
    assert.ok(
      calls.includes("https://api.venice.ai/api/v1/api_keys/rate_limits"),
    );
    permitted = false;
    const restricted = await service.test("venice");
    assert.equal(restricted.verified, true);
    assert.equal(restricted.accessPermitted, false);
    assert.equal(restricted.models.length, 1);
    assert.equal((await deepseek.config()).outputLimit, 8000);
    fail = true;
    const failure = await service.test("deepseek");
    assert.equal(failure.testOk, false);
    assert.equal(failure.verified, false);
    assert.equal(failure.models.length, 1);
    assert.ok(failure.error.includes("401"));
    await deepseek.saveKey("replacement");
    assert.equal((await service.status("deepseek")).keyChanged, true);
    assert.equal((await service.status("deepseek")).verified, false);
  } finally {
    await fs.rm(data, { recursive: true, force: true });
  }
});
