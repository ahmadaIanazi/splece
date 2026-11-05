import {readRouting} from "./ai-routing.mjs";
import { effectCostRecord } from '../shared/effects.mjs';
import {assetAnalysisCost} from "./asset-intelligence.mjs";
import {imageCostRecord} from "../shared/asset-generation.mjs";
import { assistantCostRecords } from "./composer-assistant.mjs";
import {lipSyncCosts} from "../shared/lip-sync.mjs";
import { soundtrackCostRecords } from "../shared/soundtrack-ai.mjs";
import { createHash } from "node:crypto";
import { providerTransport } from "./security.mjs";
import { studioMode } from "./mode.mjs";
import { costRecord, projectCostReport } from "../shared/costs.mjs";

const number = (v) =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))
    ? Number(v)
    : null;
export function normalizeBalance(provider, value) {
  if (provider === "venice") {
    if (
      value.data?.balances &&
      typeof value.data.accessPermitted === "boolean"
    ) {
      return {
        available: value.data.accessPermitted,
        source: "api_key",
        nextEpochBegins: value.data.nextEpochBegins,
        balances: Object.entries(value.data.balances)
          .filter(([, v]) => number(v) !== null)
          .map(([currency, v]) => ({ currency, amount: number(v) })),
      };
    }
    if (!value.balances || typeof value.canConsume !== "boolean")
      throw Error("Venice returned an unreadable balance.");
    const labels = {
      usd: "USD",
      diem: "DIEM",
      bundledCredits: "BUNDLED_CREDITS",
      earnedCredits: "EARNED_CREDITS",
    };
    const balances = Object.entries(labels)
      .filter(([key]) => number(value.balances[key]) !== null)
      .map(([key, currency]) => ({
        currency,
        amount: number(value.balances[key]),
      }));
    return {
      available: value.canConsume,
      consumptionCurrency: value.consumptionCurrency,
      balances,
      diemEpochAllocation: number(value.diemEpochAllocation),
    };
  }
  if (
    !Array.isArray(value.balance_infos) ||
    typeof value.is_available !== "boolean"
  )
    throw Error("DeepSeek returned an unreadable balance.");
  return {
    available: value.is_available,
    balances: value.balance_infos
      .filter((b) => number(b.total_balance) !== null)
      .map((b) => ({
        currency: b.currency,
        amount: number(b.total_balance),
        granted: number(b.granted_balance),
        toppedUp: number(b.topped_up_balance),
      })),
  };
}

// A billing line can be attributed only by its explicit request identifier.
// Timestamp/model proximity is ambiguous when generations run concurrently.
export function matchVeniceUsage(rows, jobs) {
  const index = new Map(),
    matches = new Map();
  for (const { key, job } of jobs) {
    for (const id of [
      job.providerJobId,
      job.providerRequestId,
      job.billing?.responseId,
      job.result?.responseId,
    ].filter(Boolean)) {
      if (!index.has(id)) index.set(id, new Set());
      index.get(id).add(key);
    }
  }
  const seen = new Set();
  for (const row of rows) {
    const requestId = row.inferenceDetails?.requestId;
    const keys = index.get(requestId);
    if (
      !requestId ||
      keys?.size !== 1 ||
      number(row.amount) === null ||
      !row.currency
    )
      continue;
    const signature = createHash("sha256")
      .update(JSON.stringify(row))
      .digest("hex");
    if (seen.has(signature)) continue;
    seen.add(signature);
    const key = [...keys][0],
      cost = -Number(row.amount);
    const usd =
      row.currency === "USD"
        ? cost
        : number(row.pricePerUnitUsd) !== null && number(row.units) !== null
          ? Math.sign(cost) *
            Math.abs(Number(row.pricePerUnitUsd) * Number(row.units))
          : null;
    const line = {
      amount: cost,
      currency: row.currency,
      usd,
      requestId,
      timestamp: row.timestamp,
      sku: row.sku,
      signature,
    };
    if (!matches.has(key)) matches.set(key, []);
    matches.get(key).push(line);
  }
  return matches;
}

export function createBillingService({
  store,
  data,
  settings,
  transport = providerTransport({ demo: false, timeoutMs: 15000 }),
  mode = async () => Object.values(await readRouting(data)).some(r=>r.enabled)?"live":"test",
  now = () => Date.now(),
}) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS billing_cache(key TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS billing_matches(key TEXT PRIMARY KEY,body TEXT NOT NULL)",
  );
  const read = (key) => {
    const row = store.db
      .prepare("SELECT body FROM billing_cache WHERE key=?")
      .get(key);
    return row ? JSON.parse(row.body) : null;
  };
  const write = (key, value) =>
    store.db
      .prepare("INSERT OR REPLACE INTO billing_cache VALUES(?,?)")
      .run(key, JSON.stringify(value));
  const fingerprint = (key) => createHash("sha256").update(key).digest("hex");
  const textJobs = (table, projectId) => {
    if (
      !store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)
    )
      return [];
    return store.db
      .prepare(
        `SELECT body FROM ${table}${projectId ? " WHERE projectId=?" : ""}`,
      )
      .all(...(projectId ? [projectId] : []))
      .map((r) => JSON.parse(r.body));
  };
  const allRecords = (projectId) => [
    ...store
      .jobViews(projectId)
      .filter((j) => j.kind === "generation")
      .map((job) => ({ key: "video:" + job.id, kind: "video", job })),
    ...textJobs("smart_jobs", projectId).map((job) => ({
      key: "smart:" + job.id,
      kind: "smart",
      job,
    })),
    ...textJobs("story_jobs", projectId).map((job) => ({
      key: "story:" + job.id,
      kind: "story",
      job,
    })),
  ];
  const get = async (url, key, label) => {
    const response = await transport(url, {
      method: "GET",
      headers: { Authorization: "Bearer " + key },
    });
    if (!response.ok) {
      const error = Error(
        `${label} unavailable (${response.status}). ${[401, 403].includes(response.status) ? "Check the key’s permissions in Settings." : "Your saved balance is retained; try again later."}`,
      );
      error.status = response.status;
      throw error;
    }
    return response.json();
  };
  async function accountBalance(provider, key, previousSource) {
    if (provider === "deepseek")
      return normalizeBalance(
        provider,
        await get(
          "https://api.deepseek.com/user/balance",
          key,
          "DeepSeek balance",
        ),
      );
    if (previousSource !== "api_key") {
      try {
        return normalizeBalance(
          provider,
          await get(
            "https://api.venice.ai/api/v1/billing/balance",
            key,
            "Venice balance",
          ),
        );
      } catch (error) {
        if (![401, 403, 404].includes(error.status)) throw error;
      }
    }
    return normalizeBalance(
      provider,
      await get(
        "https://api.venice.ai/api/v1/api_keys/rate_limits",
        key,
        "Venice API-key balance",
      ),
    );
  }
  async function reconcile(key) {
    const known = allRecords().filter(({ job, kind }) =>
      kind === "video"
        ? job.snapshot?.provider === "Venice"
        : job.config?.mode === "venice",
    );
    if (!known.length) return { checkedAt: now(), matched: 0 };
    const times = known
      .map(({ job }) => Number(job.createdAt))
      .filter((n) => Number.isFinite(n) && n > 0);
    let query = new URLSearchParams({
      pageSize: "1000",
      ...(times.length
        ? { startTimestamp: new Date(Math.min(...times) - 60000).toISOString() }
        : {}),
      endTimestamp: new Date(now()).toISOString(),
    });
    let rows = [],
      cursor;
    for (let page = 0; page < 20; page++) {
      const response = await get(
        "https://api.venice.ai/api/v1/billing/usage-history?" + query,
        key,
        "Venice billing history",
      );
      if (!Array.isArray(response.data))
        throw Error("Venice billing history returned an unreadable response.");
      rows.push(...response.data);
      cursor = response.nextCursor;
      if (!cursor) break;
      query = new URLSearchParams({ cursor });
    }
    if (cursor)
      throw Error(
        "Billing history is too large to reconcile in one refresh. Quotes remain estimates.",
      );
    const matches = matchVeniceUsage(rows, known);
    store.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [id, charges] of matches)
        store.db
          .prepare("INSERT OR REPLACE INTO billing_matches VALUES(?,?)")
          .run(id, JSON.stringify(charges));
      store.db.exec("COMMIT");
    } catch (e) {
      store.db.exec("ROLLBACK");
      throw e;
    }
    return {
      checkedAt: now(),
      matched: matches.size,
      unmatched: rows.filter((r) => !r.inferenceDetails?.requestId).length,
    };
  }
  let refreshing = null;
  async function balances({ refresh = false } = {}) {
    const test = (await mode()) !== "live";
    if (refreshing) return refreshing;
    const work = async () => {
      const providers = {};
      await Promise.all(
        Object.keys(settings).map(async (provider) => {
          const key = await settings[provider].key();
          if (!key) {
            providers[provider] = { configured: false, balances: [] };
            return;
          }
          if (provider === "fal") {
            providers[provider] = {configured: true, balances: [], balanceUnavailable: true};
            return;
          }
          const hash = fingerprint(key),
            old = read(provider);
          let entry =
            old?.fingerprint === hash
              ? old
              : { balances: [], fingerprint: hash };
          const due = now() - (entry.attemptedAt || 0) > 60000;
          if (refresh || (!test && due)) {
            entry = { ...entry, attemptedAt: now(), error: null };
            try {
              entry = {
                ...entry,
                ...(await accountBalance(provider, key, entry.source)),
                checkedAt: now(),
              };
            } catch (e) {
              entry.error = e.message;
            }
            if (
              provider === "venice" &&
              !entry.error &&
              (refresh || now() - (entry.history?.attemptedAt || 0) > 300000)
            ) {
              try {
                entry.history = {
                  ...(await reconcile(key)),
                  attemptedAt: now(),
                };
              } catch (e) {
                entry.history = {
                  ...entry.history,
                  attemptedAt: now(),
                  error: e.message,
                };
              }
            }
            write(provider, entry);
          }
          const { fingerprint: unused, ...publicEntry } = entry;
          providers[provider] = {
            ...publicEntry,
            configured: true,
            cached:
              test || !!entry.error || now() - (entry.checkedAt || 0) > 60000,
          };
        }),
      );
      return { providers, test, updatedAt: now() };
    };
    refreshing = work().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }
  return {
    balances,
    report(project) {
      const records = allRecords(project.id).map(({ key, kind, job }) => {
        const row = store.db
          .prepare("SELECT body FROM billing_matches WHERE key=?")
          .get(key);
        return costRecord(job, kind, row ? JSON.parse(row.body) : null);
      });
      records.push(
        ...assistantCostRecords(store, project.id),
        ...textJobs("image_jobs", project.id).map(imageCostRecord),
        ...textJobs("asset_analyses", project.id).filter(j=>j.state!=="quoted").map(assetAnalysisCost),
        ...textJobs("photo_analyses", project.id).filter(j=>j.state!=='quoted').map(j=>({key:'vision:'+j.id,id:j.id,kind:'vision',provider:j.config?.provider||'venice',test:j.executionMode!=='live',state:j.state,title:'Photo understanding',model:j.model,createdAt:j.createdAt,amount:j.executionMode!=='live'||!j.attempted?0:null,status:j.executionMode!=='live'?'test':j.attempted?'unknown':'not-submitted',charges:[]})),
        ...textJobs("lip_sync_jobs", project.id).map(lipSyncCosts),
        ...textJobs("effect_jobs", project.id).map(effectCostRecord),
        ...textJobs("soundtrack_runs", project.id).flatMap(
          soundtrackCostRecords,
        ),
      );
      return projectCostReport(project, records);
    },
  };
}

export function installBillingRoutes(app, service, getProject) {
  app.get("/api/billing/balances", async (_req, res) =>
    res.json(await service.balances()),
  );
  app.post("/api/billing/refresh", async (_req, res) =>
    res.json(await service.balances({ refresh: true })),
  );
  app.get("/api/projects/:id/costs", (req, res) =>
    res.json(service.report(getProject(req.params.id).project)),
  );
}
