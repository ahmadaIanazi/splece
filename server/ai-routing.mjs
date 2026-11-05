import { referenceCapabilities } from "../shared/references.mjs";
import { studioOnline, saveStudioOnline } from './online.mjs';
import { smartGuide } from "../shared/smart.mjs";
import path from "node:path";
import {
  credentials,
  readJSON,
  writeJSON,
  connectionState,
  keyFingerprint,
  validateAPIKey,
} from "./connections.mjs";
import { providerTransport } from "./security.mjs";
import {
  aiLanes,
  routingDefaults,
  validateRoute,
  textEndpoints,
  tokenPricing,
} from "../shared/ai-routing.mjs";
import { imageModels } from "../shared/asset-generation.mjs";
import { providerDefinitions } from "../shared/providers.mjs";
import { textCostEstimate } from "../shared/costs.mjs";
const file = (data) => path.join(data, "ai-routing.json");
export async function readRouting(data, { preferences = false } = {}) {
  const global = await readJSON(path.join(data, "studio-mode.json"));
  const routes = {
    ...routingDefaults(global.mode === "live"),
    ...(await readJSON(file(data))),
  };
  return preferences || await studioOnline(data) ? routes : Object.fromEntries(Object.entries(routes).map(([lane, route]) => [lane, {...route, enabled:false}]));
}
let writes = new Map();
export function updateRouting(data, patch) {
  const task = (writes.get(data) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const next = await readRouting(data, {preferences:true});
      for (const [lane, value] of Object.entries(patch))
        next[lane] = validateRoute(lane, { ...next[lane], ...value });
      await writeJSON(file(data), next);
      return next;
    });
  writes.set(data, task);
  return task.finally(() => {
    if (writes.get(data) === task) writes.delete(data);
  });
}
export async function routedTextConfig(data, lane = "text") {
  const route = (await readRouting(data))[lane];
  const stored = await readJSON(file(data));
  const global = await readJSON(path.join(data, "studio-mode.json"));
  const legacy = await readJSON(
    path.join(data, `${route.provider}-settings.json`),
  );
  const catalog = await readJSON(
    path.join(data, `${route.provider}-text-models.json`),
    { models: [] },
  );
  const model =
    route.model ||
    legacy.model ||
    (route.provider === "deepseek"
      ? "deepseek-flash"
      : catalog.models?.[0]?.id);
  const item = catalog.models?.find((m) => m.id === model);
  return {
    ...legacy,
    guide:
      legacy.guide ??
      (await readJSON(path.join(data, "venice-settings.json"))).guide ??
      smartGuide,
    provider: route.provider,
    mode:
      (await studioOnline(data)) && !stored[lane] && !global.mode
        ? legacy.mode || "demo"
        : route.enabled
          ? route.provider
          : "demo",
    model,
    pricing: tokenPricing(item?.pricing),
    outputLimit: item?.maxOutputTokens,
    vision:
      item?.vision ??
      (Array.isArray(item?.inputModalities)
        ? item.inputModalities.includes("image")
        : undefined),
  };
}
export async function discoverTextProvider(
  data,
  provider,
  candidate,
  transport = providerTransport({ demo: false, timeoutMs: 20000 }),
) {
  if (!["openai", "openrouter"].includes(provider))
    throw Error("Choose a supported text provider.");
  const credential = credentials(data, provider),
    expected = await credential.key();
  const key = candidate === undefined ? expected : validateAPIKey(candidate);
  if (!key) throw Error("Paste your API key.");
  if (provider === "openrouter") {
    const check = await transport(textEndpoints[provider] + "/key", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!check.ok)
      throw Error(
        `Connection could not be verified (${check.status}). Your saved key is unchanged.`,
      );
  }
  const response = await transport(textEndpoints[provider] + "/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok)
    throw Error(
      `Connection could not be verified (${response.status}). Your saved key is unchanged.`,
    );
  const raw = await response.json();
  if (!Array.isArray(raw.data))
    throw Error("The provider returned an invalid model list.");
  const models = raw.data
    .filter((m) =>
      provider === "openrouter"
        ? m.architecture?.output_modalities?.includes("text") &&
          m.supported_parameters?.includes("tools")
        : /^(gpt-|o[134])/.test(m.id) &&
          !/(audio|realtime|image|search|codex|instruct|transcribe)/.test(m.id),
    )
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      vision:
        provider === "openrouter"
          ? m.architecture?.input_modalities?.includes("image")
          : undefined,
      pricing: provider === "openrouter" ? tokenPricing(m.pricing) : null,
      maxOutputTokens: m.top_provider?.max_completion_tokens,
    }));
  models.sort(
    (a, b) =>
      Number(a.pricing?.prompt ?? Infinity) -
        Number(b.pricing?.prompt ?? Infinity) || a.id.localeCompare(b.id),
  );
  const saved = {
    models,
    ok: true,
    checkedAt: Date.now(),
    keyHash: keyFingerprint(key),
    accessPermitted: true,
  };
  await credential.commitVerified(key, expected, async () => {
    await writeJSON(path.join(data, `${provider}-connection.json`), saved);
    await writeJSON(path.join(data, `${provider}-text-models.json`), {
      models,
      fetchedAt: saved.checkedAt,
    });
  });
  return {
    testOk: true,
    message: `Connected. ${models.length} compatible text models available. No content was generated.`,
    ...connectionState(key, saved),
  };
}
export async function routingCatalog(data) {
  const routes = await readRouting(data, {preferences:true}),
    models = {
      text: [],
      assistant: [],
      image: imageModels.map((m) => ({
        ...m,
        priceLabel: m.price
          ? `≈ $${m.price}/image`
          : "Estimate before generating",
      })),
      video: [],
      audio: [
        {
          id: "soundtrack-auto",
          provider: "fal",
          name: "Automatic · voice, ambience & effects",
          priceLabel: "Voice ≈ $0.0001/character · effects quoted by duration",
        },
      ],
    };
  for (const provider of ["deepseek", "venice", "openai", "openrouter"]) {
    const catalog = await readJSON(
      path.join(data, `${provider}-text-models.json`),
      { models: [] },
    );
    for (const m of catalog.models || []) {
      const estimate =
        provider === "deepseek"
          ? textCostEstimate(m.id, {
              prompt_tokens: 1000000,
              completion_tokens: 0,
            })
          : null;
      models.text.push({
        ...m,
        provider,
        priceLabel: tokenPricing(m.pricing)
          ? `$${(Number(m.pricing.prompt) * 1e6).toFixed(2)} in / $${(Number(m.pricing.completion) * 1e6).toFixed(2)} out · 1M tokens`
          : estimate
            ? `≈ $${estimate.amount.toFixed(2)} in / $${textCostEstimate(m.id, { prompt_tokens: 0, completion_tokens: 1000000 }).amount.toFixed(2)} out · 1M tokens`
            : "Rate unavailable · usage recorded",
      });
    }
  }
  models.assistant = models.text;
  const venice = await readJSON(path.join(data, "video-catalog.json"), {
    models: [],
  });
  const fal = await readJSON(path.join(data, "fal-connection.json"), {
    models: [],
  });
  const xai = await readJSON(path.join(data, "xai-connection.json"), {models:[], imageModelIds:[]});
  models.image = models.image.filter(m => m.provider !== "xai" || xai.imageModelIds?.includes(m.model));
  models.video = [
    ...xai.models.map(m => ({...m,provider:"xai"})),
    ...venice.models.map((m) => {
      const mapping=referenceCapabilities(m.id,m.type);
      const mapped=["flat","elements"].includes(mapping.referenceMode) || mapping.requiresEnd;
      const supported=m.unavailableReason === 'Provider offline' ? false : mapped ? !!m.durations?.length : m.supported;
      return {...m,...mapping,provider:'venice',supported,unavailableReason:supported ? null : m.unavailableReason};
    }),
    ...fal.models.map((m) => ({ ...m, provider: "fal" })),
  ]
    .filter((m) => m.supported !== false && !m.unavailableReason)
    .map((m) => ({
      ...m,
      priceLabel: "Estimate before generation · depends on settings",
    }));
  return { routes, models, providers: providerDefinitions, online: await studioOnline(data) };
}
export function installAIRouting(app, { data }) {
  app.put("/api/studio/online", async (req, res) => res.json(await saveStudioOnline(data, req.body?.online)));
  app.get("/api/ai-routing", async (req, res) =>
    res.json(await routingCatalog(data)),
  );
  app.put("/api/ai-routing", async (req, res) => {
    const catalog = await routingCatalog(data);
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
      throw Error("Choose AI settings.");
    for (const [lane, patch] of Object.entries(req.body)) {
      const route = validateRoute(lane, { ...catalog.routes[lane], ...patch });
      if (
        route.model &&
        !catalog.models[lane].some(
          (m) => m.id === route.model && m.provider === route.provider,
        )
      )
        throw Error("Refresh this provider and choose an available model.");
      if (route.enabled) {
        const key = await credentials(data, route.provider).key();
        const check = await readJSON(
          path.join(data, `${route.provider}-connection.json`),
        );
        if (!connectionState(key, check).ready)
          throw Error("Connect this provider first.");
        if (
          !route.model &&
          (lane === "video" ||
            ["openai", "openrouter"].includes(route.provider) ||
            (["text", "assistant"].includes(lane) &&
              route.provider === "venice"))
        )
          throw Error("Choose a model first.");
      }
    }
    await updateRouting(data, req.body);
    res.json(await routingCatalog(data));
  });
  for (const provider of ["openai", "openrouter"])
    app.post(`/api/providers/${provider}/test`, async (req, res) =>
      res.json(await discoverTextProvider(data, provider, req.body.key)),
    );
}
export async function sendRoutedText(
  data,
  config,
  request,
  transport,
  options = {},
  lane = "text",
) {
  const current = await routedTextConfig(data, lane);
  if (!(await studioOnline(data)) || ((await readJSON(file(data)))[lane] && current.mode === "demo"))
    throw Error(`${lane} AI is off. No request was sent.`);
  if (current.provider !== config.provider || current.model !== config.model)
    throw Error("The AI selection changed. Review this request again.");
  const key = await credentials(data, config.provider).key();
  if (!key) throw Error("Connect the selected provider first.");
  const { textRequest } = await import("../shared/ai-routing.mjs");
  return transport(
    textEndpoints[config.provider] +
      (config.provider === "deepseek" && request.tools
        ? "/beta/chat/completions"
        : "/chat/completions"),
    {
      ...options,
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(textRequest(config, request)),
    },
  );
}
