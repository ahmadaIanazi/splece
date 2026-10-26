import test from "node:test";
import assert from "node:assert/strict";
import { connectionRequest, providerNeedsConnection } from "../shared/provider-connect.mjs";

test("contextual setup accepts known providers and never carries work, credentials or auto-submit callbacks", () => {
  for (const provider of ["venice", "deepseek", "fal"]) {
    assert.deepEqual(connectionRequest({ provider, feature: "sound", returnLabel: "Back to soundtrack", key: "never-forward", generate: true }), {
      provider, feature: "sound", returnLabel: "Back to soundtrack",
    });
  }
  assert.equal(connectionRequest({ provider: "https://untrusted.example" }), null);
  assert.equal(connectionRequest({ provider: "Local simulator" }), null);
  assert.equal(connectionRequest(), null);
  assert.equal(connectionRequest(null), null);
});

test("Offline work never requires keys while Online selects the exact required provider", () => {
  const connections = [
    { id: "deepseek", hasKey: true, verified: true, accessPermitted: true },
    { id: "venice", hasKey: true, verified: false, accessPermitted: null },
    { id: "fal", hasKey: false },
  ];
  for (const mode of ["test", "demo", undefined]) {
    assert.equal(providerNeedsConnection(connections, "fal", mode), false);
  }
  assert.equal(providerNeedsConnection(connections, "fal.ai", "live"), true);
  assert.equal(providerNeedsConnection(connections, "DeepSeek", "live"), false);
  assert.equal(providerNeedsConnection(connections, "Venice", "venice"), false, "legacy saved keys remain usable");
  assert.equal(providerNeedsConnection(null, "fal", "live"), false, "unknown status is not a missing-key error");
  assert.equal(providerNeedsConnection(connections, "local", "live"), false);
  assert.equal(providerNeedsConnection([{ id: "venice", hasKey: true, accessPermitted: false }], "venice", "live"), true);
});

test("connection request preserves the route label without accepting arbitrary payloads", () => {
  assert.deepEqual(connectionRequest({ provider: { providerId: "fal" }, returnLabel: "" }), {
    provider: "fal", feature: "", returnLabel: "Back to my work",
  });
  const request = connectionRequest({ provider: "DeepSeek", feature: "x".repeat(500), returnLabel: "y".repeat(500) });
  assert.equal(request.feature.length, 120);
  assert.equal(request.returnLabel.length, 80);
});
