import {tokenPricing} from "./ai-routing.mjs";
// Frozen rate card. Estimates are never represented as provider-confirmed bills.
export const DEEPSEEK_RATE_SOURCE =
  "https://api-docs.deepseek.com/quick_start/pricing/";
export function textCostEstimate(model, usage, at = Date.now()) {
  if (!usage || new Date(at).getTime() < Date.parse("2026-10-17T00:00:00Z"))
    return null;
  const id = String(model).toLowerCase();
  const rates =
    /^(deepseek-flash|deepseek-v4-flash(?:-vision-exp)?|deepseek-v4\.1-flash-1017)$/.test(
      id,
    )
      ? [0.003, 0.15, 0.6]
      : /^(deepseek-v4-pro|deepseek-v4-pro-0813)$/.test(id)
        ? [0.022, 0.66, 1.98]
        : null;
  const input = Number(usage.prompt_tokens),
    output = Number(usage.completion_tokens);
  if (
    !rates ||
    !Number.isFinite(input) ||
    !Number.isFinite(output) ||
    input < 0 ||
    output < 0
  )
    return null;
  const hit = Math.max(
    0,
    Math.min(input, Number(usage.prompt_cache_hit_tokens) || 0),
  );
  const miss = Math.max(0, input - hit);
  const low = (hit * rates[0] + miss * rates[1] + output * rates[2]) / 1e6;
  const date = new Date(at),
    hour = date.getUTCHours(),
    day = date.getUTCDay();
  const peak =
    day > 0 && day < 6 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
  return {
    amount: low * (peak ? 2 : 1),
    low,
    currency: "USD",
    rates,
    model,
    verified: "2026-10-22",
    source: DEEPSEEK_RATE_SOURCE,
    note: peak
      ? "Peak-rate upper estimate; public holidays may be cheaper."
      : "Off-peak token estimate.",
    cacheAssumed: usage.prompt_cache_hit_tokens == null,
  };
}

export function usageReceipt(data, config, at = Date.now()) {
  const provider = config.provider || (config.mode === "deepseek" ? "deepseek" : ["openai","openrouter"].includes(config.mode) ? config.mode : "venice");
  const model = data.model || config.model;
  const pricing=tokenPricing(config.pricing);
  const tokenAmount=pricing && data.usage ? pricing.prompt*data.usage.prompt_tokens+pricing.completion*data.usage.completion_tokens : null;
  return {
    provider,
    model,
    responseId: data.id,
    usage: data.usage || null,
    receivedAt: at,
    estimate:
      provider === "deepseek" ? textCostEstimate(model, data.usage, at) : tokenAmount!==null && Number.isFinite(tokenAmount) && tokenAmount>=0 ? {amount:tokenAmount,currency:"USD",note:"Catalog token estimate"} : null,
  };
}
const finite = (v) =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const amount = (v) => (finite(v) ? Number(v) : null);
export function costRecord(job, kind = "video", confirmed = null) {
  const video = kind === "video",
    snap = job.snapshot || {},
    receipt = job.billing;
  const provider = video
    ? String(snap.providerId || snap.provider || "demo").toLowerCase()
    : receipt?.provider || job.config?.mode;
  const test = video
    ? snap.executionMode
      ? snap.executionMode !== "live"
      : !["venice", "kie", "fal", "fal.ai"].includes(provider)
    : !["venice", "deepseek", "openai", "openrouter"].includes(job.config?.mode);
  const record = {
    key: `${kind}:${job.id}`,
    id: job.id,
    kind,
    provider,
    test,
    state: job.state,
    title: video
      ? snap.draft?.name || "Video generation"
      : kind === "story"
        ? "Story · " + (job.input?.action || "planning")
        : "Prompt enhancement",
    model:
      receipt?.model ||
      job.result?.model ||
      (video ? snap.model : job.config?.model),
    createdAt: job.createdAt,
    episodeId:
      snap.draft?.episodeId ||
      job.input?.episodeId ||
      job.input?.draft?.episodeId,
    start: video ? Number(snap.start ?? snap.draft?.start) : null,
    duration: video
      ? Number(snap.draft?.settings?.duration || snap.end - snap.start)
      : null,
    targetId: snap.targetId,
    usage: receipt?.usage || job.result?.usage || null,
    amount: null,
    status: "unknown",
    charges: [],
  };
  if (test) return { ...record, amount: 0, status: "test" };
  if (confirmed?.length) {
    const usd = confirmed.map((c) => c.usd);
    return {
      ...record,
      amount: usd.every(finite) ? usd.reduce((s, n) => s + Number(n), 0) : null,
      status: "confirmed",
      charges: confirmed,
    };
  }
  if (video) {
    const quote = snap.price?.unit === "USD" ? amount(snap.price.amount) : null;
    if (job.providerJobId || job.acceptedAt || job.state === "ready")
      return {
        ...record,
        amount: quote,
        status: quote === null ? "unknown" : "estimated",
      };
    if (["queued", "submitting"].includes(job.state))
      return { ...record, amount: quote, status: "pending" };
    if (
      job.state === "submission_uncertain" ||
      (job.submitCount &&
        !/\b(400|401|402|403|422|429)\b/.test(job.error || ""))
    )
      return record;
    return { ...record, amount: 0, status: "not-submitted" };
  }
  const estimate =
    receipt?.estimate ||
    (provider === "deepseek" &&
      textCostEstimate(record.model, record.usage, job.createdAt));
  if (estimate)
    return {
      ...record,
      amount: estimate.amount,
      status: "estimated",
      estimate,
    };
  if (job.state === "queued") return { ...record, status: "pending" };
  if (
    !record.usage &&
    /returned (400|401|402|403|422|429)\b/.test(job.error || "")
  )
    return { ...record, amount: 0, status: "not-submitted" };
  return record;
}

export function projectCostReport(project, records) {
  const totals = {
    confirmed: 0,
    estimated: 0,
    pending: 0,
    unknown: 0,
    test: 0,
  };
  const currencies = {};
  for (const r of records) {
    if (
      ["confirmed", "estimated", "pending"].includes(r.status) &&
      finite(r.amount)
    )
      totals[r.status] += r.amount;
    if (
      r.status === "unknown" ||
      (r.status === "confirmed" && r.amount === null)
    )
      totals.unknown++;
    if (r.test) totals.test++;
    for (const c of r.charges)
      currencies[c.currency] = (currencies[c.currency] || 0) + c.amount;
  }
  const positioned = records
    .filter(
      (r) =>
        ["video", "soundtrack"].includes(r.kind) &&
        r.episodeId === project.episodeId &&
        !r.test,
    )
    .map((r) => {
      const clip = project.clips.find(
        (c) =>
          c.id === r.targetId ||
          c.generationTargets?.includes(r.targetId) ||
          c.takes?.some((t) => t.jobId === r.id),
      );
      return {
        ...r,
        start: r.kind === "soundtrack" ? r.start : (clip?.start ?? r.start),
        removed: !clip,
      };
    })
    .filter(
      (r) =>
        Number.isFinite(r.start) &&
        r.start >= 0 &&
        Number.isFinite(r.duration) &&
        r.duration > 0,
    );
  const end = Math.max(
    10,
    ...project.clips.map((c) => c.start + c.duration),
    ...positioned.map((r) => r.start + r.duration),
  );
  const bins = Array.from(
    { length: Math.min(10000, Math.ceil(end / 10)) },
    (_, i) => ({
      start: i * 10,
      end: (i + 1) * 10,
      amount: 0,
      confirmed: 0,
      estimated: 0,
      jobs: [],
      removed: 0,
    }),
  );
  for (const r of positioned) {
    if (!["estimated", "confirmed"].includes(r.status) || r.amount === null)
      continue;
    for (
      let i = Math.floor(r.start / 10);
      i < Math.min(bins.length, Math.ceil((r.start + r.duration) / 10));
      i++
    ) {
      const b = bins[i],
        overlap = Math.max(
          0,
          Math.min(b.end, r.start + r.duration) - Math.max(b.start, r.start),
        );
      const cost = (r.amount * overlap) / r.duration;
      b.amount += cost;
      b[r.status] += cost;
      b.jobs.push(r.key);
      if (r.removed) b.removed++;
    }
  }
  return {
    projectId: project.id,
    episodeId: project.episodeId,
    total: totals.confirmed + totals.estimated,
    totals,
    currencies,
    bins,
    records: records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    updatedAt: Date.now(),
  };
}

export function money(value, currency = "USD") {
  if (value === null || value === undefined || !Number.isFinite(Number(value)))
    return "—";
  if (!["USD", "CNY"].includes(currency))
    return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${{ BUNDLED_CREDITS: "bundled credits", EARNED_CREDITS: "earned credits" }[currency] || currency}`;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits:
      Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 5 : 2,
  }).format(value);
}
