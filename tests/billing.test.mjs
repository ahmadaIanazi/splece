import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store.mjs";
import {
  createBillingService,
  normalizeBalance,
  matchVeniceUsage,
} from "../server/billing.mjs";
import {
  costRecord,
  projectCostReport,
  textCostEstimate,
} from "../shared/costs.mjs";
import { requestSmart } from "../server/smart.mjs";
import { requestStory } from "../server/authoring.mjs";

const at = Date.parse("2026-10-22T15:00:00Z");
const video = (id = "j", state = "ready") => ({
  id,
  kind: "generation",
  projectId: "p",
  state,
  createdAt: at,
  providerJobId: state === "queued" ? null : "queue-" + id,
  snapshot: {
    provider: "Venice",
    model: "wan",
    targetId: "slot",
    start: 5,
    end: 20,
    price: { amount: 3, unit: "USD" },
    draft: { name: "Opening", episodeId: "e", settings: { duration: 15 } },
  },
});
const p = { id: "p", episodeId: "e", clips: [] };
test("Balances retain currencies and avoid adding granted credit twice", () => {
  const ds = normalizeBalance("deepseek", {
    is_available: true,
    balance_infos: [
      {
        currency: "CNY",
        total_balance: "110",
        granted_balance: "10",
        topped_up_balance: "100",
      },
      { currency: "USD", total_balance: "3.50" },
    ],
  });
  assert.equal(ds.balances[0].amount, 110);
  assert.equal(ds.balances[1].amount, 3.5);
  const v = normalizeBalance("venice", {
    canConsume: true,
    balances: { usd: 0, diem: 8, bundledCredits: 2 },
    consumptionCurrency: "DIEM",
  });
  assert.deepEqual(
    v.balances.map((b) => b.currency),
    ["USD", "DIEM", "BUNDLED_CREDITS"],
  );
  assert.throws(() => normalizeBalance("deepseek", {}));
});
test("All attempts survive deletion in totals; pending quotes stay out of spending and bins prorate", () => {
  const first = video(),
    second = video("retry"),
    pending = video("pending", "queued");
  const demo = video("test");
  demo.snapshot.provider = "Local simulator";
  const report = projectCostReport(
    p,
    [first, second, pending, demo].map((j) => costRecord(j)),
  );
  assert.equal(report.total, 6);
  assert.equal(report.totals.pending, 3);
  assert.equal(report.totals.test, 1);
  assert.deepEqual(
    report.bins.map((b) => b.amount),
    [2, 4],
  );
  assert.equal(report.bins[0].removed, 2);
  const moved = projectCostReport(
    { ...p, clips: [{ id: "slot", start: 0, duration: 15, takes: [] }] },
    [costRecord(first)],
  );
  assert.deepEqual(
    moved.bins.map((b) => b.amount),
    [2, 1],
  );
  const other = video("other");
  other.snapshot.draft.episodeId = "other";
  const mixed = projectCostReport(p, [costRecord(first), costRecord(other)]);
  assert.equal(mixed.total, 6);
  assert.equal(
    mixed.bins.reduce((s, b) => s + b.amount, 0),
    3,
  );
});
test("Rejected, uncertain and accepted failed requests have distinct cost states", () => {
  const rejected = {
    ...video("denied", "failed"),
    providerJobId: null,
    submitCount: 1,
    error: "Venice rejected payment (402).",
  };
  assert.equal(costRecord(rejected).status, "not-submitted");
  assert.equal(
    costRecord({
      ...rejected,
      state: "submission_uncertain",
      error: "Lost response",
    }).status,
    "unknown",
  );
  assert.equal(costRecord(video("failed", "failed")).status, "estimated");
  const unpriced = video();
  delete unpriced.snapshot.price;
  assert.equal(costRecord(unpriced).status, "unknown");
});
test("Venice matches only explicit IDs; repeated refresh is idempotent and refunds reduce costs", () => {
  const row = {
    amount: -0.5,
    currency: "USD",
    timestamp: "t",
    sku: "video",
    inferenceDetails: { requestId: "queue-j" },
  };
  const refund = { ...row, amount: 0.2, timestamp: "t2" };
  const rows = [
    row,
    row,
    refund,
    { ...row, inferenceDetails: null },
    { ...row, inferenceDetails: { requestId: "elsewhere" } },
  ];
  const matches = matchVeniceUsage(rows, [{ key: "video:j", job: video() }]);
  assert.equal(matches.size, 1);
  assert.equal(matches.get("video:j").length, 2);
  const record = costRecord(video(), "video", matches.get("video:j"));
  assert.equal(record.amount, 0.3);
  assert.equal(record.status, "confirmed");
  assert.equal(
    matchVeniceUsage(rows, [
      { key: "video:j", job: video() },
      { key: "video:dup", job: video() },
    ]).size,
    0,
  );
  const diem = matchVeniceUsage(
    [{ ...row, currency: "DIEM", pricePerUnitUsd: 0.1, units: 2 }],
    [{ key: "video:j", job: video() }],
  ).get("video:j")[0];
  assert.equal(diem.amount, 0.5);
  assert.equal(diem.usd, 0.2);
});
test("DeepSeek estimates use cached tokens and dated rates; unknown models remain unpriced", () => {
  const usage = {
    prompt_tokens: 1000000,
    prompt_cache_hit_tokens: 200000,
    completion_tokens: 100000,
  };
  const estimate = textCostEstimate("deepseek-flash", usage, at);
  assert.ok(Math.abs(estimate.amount - 0.1806) < 1e-10);
  assert.equal(
    textCostEstimate("deepseek-flash", usage, Date.parse("2026-10-22T02:00Z"))
      .amount,
    estimate.amount * 2,
  );
  assert.equal(textCostEstimate("new-model", usage, at), null);
  assert.equal(
    textCostEstimate("deepseek-flash", usage, Date.parse("2026-01-01")),
    null,
  );
  assert.equal(textCostEstimate("deepseek-flash", {}, at), null);
});
test("Usage is saved before malformed or truncated text is rejected, for both AI workflows", async () => {
  const data = {
    id: "response",
    model: "deepseek-flash",
    usage: { prompt_tokens: 100, completion_tokens: 40 },
    choices: [{ finish_reason: "length", message: { content: "broken JSON" } }],
  };
  const mock = async () => Response.json(data),
    config = { mode: "deepseek", model: "deepseek-flash", guide: "" };
  const receipts = [];
  await assert.rejects(
    () =>
      requestSmart(
        { draft: { settings: { model: "wan" } } },
        config,
        "fake",
        mock,
        (r) => receipts.push(r),
      ),
    /incomplete/,
  );
  await assert.rejects(
    () =>
      requestStory(
        { plan: {} },
        config,
        "fake",
        mock,
        () => {},
        (r) => receipts.push(r),
      ),
    /cut short/,
  );
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].usage.completion_tokens, 40);
  assert.equal(receipts[1].responseId, "response");
  const failed = costRecord(
    { id: "s", state: "failed", config, billing: receipts[0] },
    "smart",
  );
  assert.equal(failed.status, "estimated");
  assert.ok(failed.amount > 0);
});
test("Test mode makes no balance calls; explicit read-only refresh persists balances, cursor-only history and confirmed charges", async () => {
  const store = openStore(":memory:");
  store.putJob(video());
  let calls = [],
    mode = "test",
    key = "fake-a";
  const settings = {
    venice: { key: async () => key },
    deepseek: { key: async () => "fake-b" },
  };
  const transport = async (url, opts) => {
    assert.equal(opts.method, "GET");
    calls.push(url);
    if (url.endsWith("/billing/balance"))
      return Response.json({
        canConsume: true,
        balances: { usd: 12, diem: 8 },
      });
    if (url.endsWith("/user/balance"))
      return Response.json({
        is_available: true,
        balance_infos: [{ currency: "USD", total_balance: "9" }],
      });
    const u = new URL(url);
    if (u.searchParams.has("cursor")) {
      assert.deepEqual([...u.searchParams.keys()], ["cursor"]);
      return Response.json({ data: [], nextCursor: null });
    }
    return Response.json({
      data: [
        {
          amount: -0.25,
          currency: "USD",
          timestamp: "now",
          inferenceDetails: { requestId: "queue-j" },
        },
      ],
      nextCursor: "next",
    });
  };
  const make = () =>
    createBillingService({
      store,
      settings,
      mode: async () => mode,
      now: () => at + 60000,
      transport,
    });
  const service = make();
  await service.balances();
  assert.equal(calls.length, 0);
  const balances = await service.balances({ refresh: true });
  assert.equal(calls.length, 4);
  assert.equal(balances.providers.venice.balances[0].amount, 12);
  assert.equal(JSON.stringify(balances).includes("fake-"), false);
  assert.equal(service.report(p).total, 0.25);
  await service.balances({ refresh: true });
  assert.equal(service.report(p).total, 0.25);
  calls = [];
  const reopened = make();
  await reopened.balances();
  assert.equal(calls.length, 0);
  assert.equal(reopened.report(p).total, 0.25);
  key = "changed";
  assert.deepEqual((await reopened.balances()).providers.venice.balances, []);
  store.db.close();
});

test("Venice API-key balances work when billing account endpoints reject a valid inference key", async () => {
  const store = openStore(":memory:");
  store.putJob(video());
  let fail = false,
    calls = [];
  const service = createBillingService({
    store,
    mode: async () => "live",
    now: () => at,
    settings: { venice: { key: async () => "fake" } },
    transport: async (url) => {
      calls.push(url);
      if (url.includes("rate_limits") && !fail)
        return Response.json({
          data: {
            accessPermitted: true,
            balances: { USD: 50, DIEM: 0, BUNDLED_CREDITS: 0.02 },
          },
        });
      return Response.json({ error: "Unavailable" }, { status: 401 });
    },
  });
  const first = await service.balances({ refresh: true });
  assert.equal(first.providers.venice.balances[0].amount, 50);
  assert.equal(first.providers.venice.error, null);
  assert.match(first.providers.venice.history.error, /401/);
  calls = [];
  fail = true;
  const second = await service.balances({ refresh: true });
  assert.equal(second.providers.venice.balances[0].amount, 50);
  assert.equal(second.providers.venice.cached, true);
  assert.ok(calls[0].includes("rate_limits"));
  assert.match(second.providers.venice.error, /401/);
  store.db.close();
});
