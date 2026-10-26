import path from "node:path";
import {
  credentials,
  readJSON,
  writeJSON,
  keyFingerprint,
  validateAPIKey,
  connectionState,
} from "./connections.mjs";
import { providerDefinitions, providerId } from "../shared/providers.mjs";
import { VeniceAdapter } from "./providers.mjs";
import { FalAdapter } from "./adapters/fal.mjs";
import { providerTransport } from "./security.mjs";
import { studioMode } from "./mode.mjs";
export function createProviderRegistry({
  data,
  transport = providerTransport({ demo: false, timeoutMs: 120000 }),
}) {
  const factories = {
    venice: (options) => new VeniceAdapter(options),
    fal: (options) => new FalAdapter(options),
  };
  const registry = {
    definitions: providerDefinitions,
    credentials: (id) => credentials(data, id),
    async adapter(id = "venice") {
      id = providerId(id);
      if (!factories[id]) throw Error("No video adapter for this provider");
      const key = await credentials(data, id).key();
      if (!key)
        throw Error(
          `Save your ${providerDefinitions.find((p) => p.id === id).name} API key in Connections.`,
        );
      return factories[id]({
        key,
        transport,
        allowSubmit: async () => (await studioMode(data)) === "live",
      });
    },
    async catalog(id) {
      return readJSON(path.join(data, `${id}-connection.json`), { models: [] });
    },
    async connections() {
      return Promise.all(
        providerDefinitions.map(async (p) => {
          const key = await credentials(data, p.id).key(),
            saved = await registry.catalog(p.id);
          return {
            ...p,
            ...connectionState(key, saved),
            checkedAt: saved.checkedAt,
            error: saved.error,
            models: saved.models || [],
            balanceSupport: p.id === "fal" ? "unavailable" : "available",
          };
        }),
      );
    },
    async discoverFal(candidate) {
      const credential = credentials(data, "fal"),
        expectedKey = await credential.key();
      const key =
        candidate === undefined ? expectedKey : validateAPIKey(candidate);
      const replacing = key !== expectedKey;
      if (!key) throw Error("Add your fal.ai API key first.");
      const old = await registry.catalog("fal"),
        checkedAt = Date.now();
      try {
        const result = await new FalAdapter({ key, transport }).catalog();
        await credential.commitVerified(key, expectedKey, () =>
          writeJSON(path.join(data, "fal-connection.json"), {
            ...result,
            ok: true,
            checkedAt,
            keyHash: keyFingerprint(key),
            accessPermitted: true,
          }),
        );
        return {
          ...result,
          ok: true,
          testOk: true,
          keySaved: candidate !== undefined,
          ...connectionState(key, {
            ok: true,
            keyHash: keyFingerprint(key),
            accessPermitted: true,
          }),
          message: `Connected. ${result.models.length} video workflows saved. No generation was requested.`,
        };
      } catch (e) {
        if (!replacing)
          await credential
            .recordCheck(expectedKey, () =>
              writeJSON(path.join(data, "fal-connection.json"), {
                ...old,
                ok: false,
                checkedAt,
                keyHash: keyFingerprint(key),
                error: e.message,
              }),
            )
            .catch(() => {});
        const { keyHash, ...publicCatalog } = old;
        return {
          ...publicCatalog,
          testOk: false,
          keySaved: false,
          ...connectionState(
            await credential.key(),
            await registry.catalog("fal"),
          ),
          ok: false,
          message: e.message,
        };
      }
    },
  };
  return registry;
}
export function installConnectionRoutes(app, registry, data) {
  app.get("/api/connections", async (_req, res) =>
    res.json({
      connections: await registry.connections(),
      onboarding: await readJSON(path.join(data, "onboarding.json"), {
        completed: false,
      }),
    }),
  );
  app.put("/api/connections/:provider/key", async (req, res) => {
    await registry.credentials(req.params.provider).saveKey(req.body.key);
    res.json({ saved: true });
  });
  app.post("/api/connections/fal/test", async (req, res) => {
    if (
      req.body.key !== undefined &&
      (typeof req.body.key !== "string" ||
        !req.body.key.trim() ||
        /\s/.test(req.body.key))
    )
      throw Error("Paste only your API key.");
    res.json(await registry.discoverFal(req.body.key));
  });
  app.put("/api/onboarding", async (req, res) => {
    const value = {
      version: 1,
      completed: true,
      completedAt: Date.now(),
      skipped: !!req.body.skipped,
    };
    await writeJSON(path.join(data, "onboarding.json"), value);
    res.json(value);
  });
}
