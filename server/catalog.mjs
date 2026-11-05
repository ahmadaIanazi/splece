import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  credentials,
  validateAPIKey,
  connectionState,
} from "./connections.mjs";
import { normalizeVideoCatalog } from "./video.mjs";
import { providerTransport } from "./security.mjs";
export function connectionError(provider, status) {
  const reason =
    {
      401: "API key rejected. Check or replace the saved key.",
      403: "Access denied. Check key permissions, expiry and IP restrictions.",
      429: "Provider rate limit reached. Try again later.",
    }[status] || `Provider unavailable (HTTP ${status}). Try again later.`;
  return new Error(`${provider}: ${reason}`);
}
export function createCatalogService({
  data,
  venice,
  deepseek,
  video,
  discover,
  transport = providerTransport({ demo: false, timeoutMs: 20000 }),
}) {
  const file = (p) => path.join(data, `${p}-connection.json`);
  const read = async (p) => {
    try {
      return JSON.parse(await fs.readFile(file(p), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return {};
      throw e;
    }
  };
  const write = async (f, v) => {
    const temp = f + "." + randomUUID();
    await fs.writeFile(temp, JSON.stringify(v), { mode: 0o600, flush: true });
    await fs.rename(temp, f);
  };
  const setting = (p) => {
    if (!["venice", "deepseek"].includes(p)) throw Error("Unknown provider");
    return p === "venice" ? venice : deepseek;
  };
  const fingerprint = (key) =>
    createHash("sha256")
      .update(key || "")
      .digest("hex");
  const service = {
    async status(provider) {
      const key = await setting(provider).key(),
        saved = await read(provider);
      const { keyHash, ...publicData } = saved;
      return {
        ...publicData,
        provider,
        ...connectionState(key, saved),
        models: saved.models || [],
      };
    },
    async test(provider, candidate) {
      setting(provider);
      const expectedKey = await setting(provider).key();
      const key =
        candidate === undefined ? expectedKey : validateAPIKey(candidate);
      const replacing = key !== expectedKey;
      const credential = credentials(data, provider);
      if (!key)
        throw Error(
          `Save your ${provider === "venice" ? "Venice" : "DeepSeek"} API key first.`,
        );
      const old = await read(provider),
        checkedAt = Date.now();
      try {
        let models, textModels,
          fetchedAt,
          accessPermitted = true;
        if (provider === "venice") {
          const response = await transport(
            "https://api.venice.ai/api/v1/api_keys/rate_limits",
            { headers: { Authorization: "Bearer " + key } },
          );
          if (!response.ok) throw connectionError("Venice", response.status);
          const account = await response.json();
          if (typeof account.data?.accessPermitted !== "boolean")
            throw Error("Venice returned an unreadable account status.");
          accessPermitted = account.data.accessPermitted;
          const responseModels = await transport(
            "https://api.venice.ai/api/v1/models?type=video",
            {
              headers: { Authorization: "Bearer " + key },
            },
          );
          if (!responseModels.ok)
            throw connectionError("Venice", responseModels.status);
          const catalog = {
            fetchedAt: Date.now(),
            models: normalizeVideoCatalog(await responseModels.json()),
          };
          models = catalog.models;
          fetchedAt = catalog.fetchedAt;
          // One verified Venice key can serve both writing and media.
          // An unavailable text catalog must not discard a working media connection.
          try {
            const textResponse=await transport("https://api.venice.ai/api/v1/models?type=text",{headers:{Authorization:"Bearer "+key}});
            if(textResponse.ok){const body=await textResponse.json();if(Array.isArray(body.data))textModels=body.data.filter(m=>!m.model_spec?.offline).map(m=>({id:m.id,name:m.model_spec?.name||m.id,vision:!!m.model_spec?.capabilities?.supportsVision,pricing:m.model_spec?.pricing||null}));}
          } catch {}
        } else {
          const catalog = await discover(key, transport);
          models = catalog.models;
          fetchedAt = catalog.fetchedAt;
        }
        await credential.commitVerified(key, expectedKey, async () => {
          if(textModels)await write(path.join(data,"venice-text-models.json"),{models:textModels,fetchedAt});
          await write(
            path.join(
              data,
              provider === "venice"
                ? "video-catalog.json"
                : "deepseek-text-models.json",
            ),
            { models, fetchedAt },
          );
          await write(file(provider), {
            ok: true,
            keyHash: fingerprint(key),
            checkedAt,
            fetchedAt,
            models,
            accessPermitted,
          });
        });
        return {
          ...(await service.status(provider)),
          tested: true,
          testOk: true,
          keySaved: candidate !== undefined,
          message: `${provider === "venice" ? "Venice" : "DeepSeek"} key verified. ${models.length} models fetched and saved locally.${accessPermitted ? "" : " Venice reports API access is currently restricted; check account balance, key limits or account access."} No generation was requested.`,
        };
      } catch (e) {
        const message =
          e.name === "TimeoutError"
            ? "Connection timed out. Check the network and try again."
            : e.message === "fetch failed"
              ? "Cannot reach the provider. Check your connection and try again."
              : e.message;
        // A rejected candidate does not invalidate the working connection or its cache.
        if (!replacing)
          await credential
            .recordCheck(expectedKey, () =>
              write(file(provider), {
                ...old,
                ok: false,
                keyHash: fingerprint(key),
                checkedAt,
                error: message,
              }),
            )
            .catch(() => {});
        return {
          ...(await service.status(provider)),
          tested: true,
          testOk: false,
          keySaved: false,
          message,
        };
      }
    },
  };
  return service;
}
export function installCatalogRoutes(app, service) {
  app.get("/api/providers/:provider/catalog", async (req, res) =>
    res.json(await service.status(req.params.provider)),
  );
  app.post("/api/providers/:provider/test", async (req, res) =>
    res.json(await service.test(req.params.provider, req.body.key)),
  );
}
