import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import {
  createCatalogService,
  installCatalogRoutes,
} from "../server/catalog.mjs";
import { credentials, readJSON } from "../server/connections.mjs";
import {
  createProviderRegistry,
  installConnectionRoutes,
} from "../server/provider-registry.mjs";
import {
  createVeniceSettings,
  createDeepSeekSettings,
  discoverDeepSeekModels,
} from "../server/smart.mjs";
const falCatalog = JSON.parse(
  await fs.readFile(
    new URL("./fixtures/fal-wan3-catalog.json", import.meta.url),
    "utf8",
  ),
);
async function setup(t, intercept) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-qa-"));
  t.after(() => fs.rm(data, { recursive: true, force: true }));
  const calls = [];
  const transport = async (url, init) => {
    assert.equal(
      init.body,
      undefined,
      "checks must never send inference payloads",
    );
    assert.ok(
      /\/models|\/rate_limits|\/pricing/.test(url),
      `unexpected provider request ${url}`,
    );
    const key = init.headers.Authorization.replace(/^(Bearer|Key) /, "");
    calls.push({ url, key });
    await intercept?.(url, key);
    if (key === "candidate-bad") return new Response("", { status: 401 });
    if (url.endsWith("rate_limits"))
      return Response.json({
        data: { accessPermitted: key !== "candidate-restricted" },
      });
    if (key === "candidate-model-failure")
      return new Response("", { status: 503 });
    if (url.includes("fal.ai"))
      return Response.json(
        url.includes("/pricing") ? { prices: [] } : falCatalog,
      );
    return Response.json({
      data: [
        {
          id: url.includes("type=video") ? "video-test" : "deepseek-flash",
          model_spec: { constraints: {} },
        },
      ],
    });
  };
  const service = createCatalogService({
    data,
    venice: createVeniceSettings(data),
    deepseek: createDeepSeekSettings(data),
    discover: discoverDeepSeekModels,
    transport,
    video: {
      refresh() {
        throw Error("must not refresh using the old global connection");
      },
    },
  });
  const registry = createProviderRegistry({ data, transport });
  return {
    data,
    calls,
    service,
    registry,
    check: (provider, key) =>
      provider === "fal"
        ? registry.discoverFal(key)
        : service.test(provider, key),
  };
}
for (const provider of ["venice", "deepseek", "fal"]) {
  test(`${provider}: candidate checks preserve working keys/cache on failure and commit valid replacement`, async (t) => {
    const { data, check, registry, calls } = await setup(t);
    const cred = credentials(data, provider);
    const first = await check(provider, "candidate-working");
    assert.equal(first.testOk, true);
    assert.equal(first.keySaved, true);
    assert.equal(await cred.key(), "candidate-working");
    const cacheFile = path.join(data, `${provider}-connection.json`);
    const before = await fs.readFile(cacheFile, "utf8");
    const failed = await check(provider, "candidate-bad");
    assert.equal(failed.testOk, false);
    assert.equal(failed.keySaved, false);
    assert.equal(
      failed.verified,
      true,
      "old working connection stays verified",
    );
    assert.equal(await cred.key(), "candidate-working");
    assert.equal(await fs.readFile(cacheFile, "utf8"), before);
    const count = calls.length;
    await assert.rejects(check(provider, "Bearer invalid"), /Paste/);
    assert.equal(
      calls.length,
      count,
      "malformed candidates never contact provider",
    );
    const next = await check(provider, "  candidate-new  ");
    assert.equal(next.testOk, true);
    assert.equal(next.ready, true);
    assert.equal(await cred.key(), "candidate-new");
    assert.equal(
      (await registry.connections()).find((c) => c.id === provider).verified,
      true,
    );
    assert.ok(!JSON.stringify(next).includes("candidate-"));
    assert.ok(calls.filter((c) => c.key === "candidate-new").length > 0);
  });
}
test("Venice authenticates model discovery with candidate, retains both catalogs on model failure and surfaces restricted access", async (t) => {
  const { data, check, registry, calls } = await setup(t);
  await check("venice", "candidate-working");
  const catalogFile = path.join(data, "video-catalog.json");
  const old = await fs.readFile(catalogFile, "utf8");
  const result = await check("venice", "candidate-model-failure");
  assert.equal(result.testOk, false);
  assert.equal(await fs.readFile(catalogFile, "utf8"), old);
  assert.equal(await credentials(data, "venice").key(), "candidate-working");
  assert.ok(
    calls.some(
      (c) =>
        c.url.includes("type=video") && c.key === "candidate-model-failure",
    ),
  );
  const restricted = await check("venice", "candidate-restricted");
  assert.equal(restricted.testOk, true);
  assert.equal(restricted.keyVerified, true);
  assert.equal(restricted.accessPermitted, false);
  assert.equal(restricted.ready, false);
  const publicState = (await registry.connections()).find(
    (c) => c.id === "venice",
  );
  assert.equal(publicState.accessPermitted, false);
  assert.equal(publicState.ready, false);
  assert.equal(publicState.keyVerified, true);
  await credentials(data, "venice").saveKey("externally-changed");
  const changed = (await registry.connections()).find((c) => c.id === "venice");
  assert.equal(changed.verified, false);
  assert.equal(
    changed.accessPermitted,
    null,
    "stale access status must not attach to a different key",
  );
});
test("a delayed check cannot replace a newer key or its verification snapshot", async (t) => {
  let release, entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { data, check } = await setup(t, async (_url, key) => {
    if (key === "candidate-slow") {
      entered();
      await gate;
    }
  });
  await check("deepseek", "candidate-working");
  const pending = check("deepseek", "candidate-slow");
  await waiting;
  await check("deepseek", "candidate-new");
  const current = await readJSON(path.join(data, "deepseek-connection.json"));
  release();
  const stale = await pending;
  assert.equal(stale.testOk, false);
  assert.match(stale.message, /changed while checking/);
  assert.equal(await credentials(data, "deepseek").key(), "candidate-new");
  assert.deepEqual(
    await readJSON(path.join(data, "deepseek-connection.json")),
    current,
  );
});
test("HTTP candidate test saves only after verification; connection response exposes readiness and keeps mode unchanged", async (t) => {
  const { data, service, registry } = await setup(t);
  const app = express();
  app.use(express.json());
  installCatalogRoutes(app, service);
  installConnectionRoutes(app, registry, data);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + "/api/providers/venice/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "candidate-restricted" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).keySaved, true);
  const body = await (await fetch(base + "/api/connections")).json();
  const venice = body.connections.find((c) => c.id === "venice");
  assert.equal(venice.ready, false);
  assert.equal(venice.accessPermitted, false);
  assert.equal(body.onboarding.completed, false);
  assert.ok(!JSON.stringify(body).includes("candidate-restricted"));
  assert.equal(await credentials(data, "venice").key(), "candidate-restricted");
  assert.equal((await createVeniceSettings(data).config()).mode, "demo");
});
