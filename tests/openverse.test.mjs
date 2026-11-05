import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  publicAddress,
  downloadPublicAudio,
  openverseRecord,
  createOpenverse,
} from "../server/openverse.mjs";
const record = {
  id: "dfbe3cef-7859-4e6e-8b7c-34aaf97844ce",
  title: "Garden birds",
  creator: "Recorder",
  license: "by",
  license_version: "4.0",
  license_url: "https://creativecommons.org/licenses/by/4.0/",
  foreign_landing_url: "https://example.com/birds",
  url: "https://example.com/birds.wav",
  tags: [{ name: "birds" }],
};
test("Openverse anonymous queries are optional, cached and handle limits without paying or signing up", async () => {
  let enabled = false,
    calls = 0;
  const addons = {
    requireReady() {
      if (!enabled) throw Error("Enable search first");
    },
  };
  const service = createOpenverse({
    addons,
    store: {},
    fetcher: async (url, options) => {
      calls++;
      assert.ok(url.includes("license=cc0,by"));
      assert.equal(options.headers, undefined);
      return Response.json({
        results: [
          record,
          { ...record, license: "by-nc" },
          { ...record, mature: true },
        ],
      });
    },
  });
  await assert.rejects(service.search("birds"), /Enable/);
  assert.equal(calls, 0);
  enabled = true;
  const first = await service.search("birds");
  assert.equal(first.results.length, 1);
  assert.deepEqual(await service.search("birds"), first);
  assert.equal(calls, 1);
  enabled = false;
  await assert.rejects(service.search("birds"), /Enable/);
  const limited = createOpenverse({
    addons: { requireReady() {} },
    fetcher: async () => new Response("", { status: 429 }),
  });
  await assert.rejects(limited.search("rain"), /free search limit/);
  const unavailable = createOpenverse({
    addons: { requireReady() {} },
    fetcher: async () => new Response("", { status: 504 }),
  });
  await assert.rejects(unavailable.search("rain"), /local tools still work/);
});
test("Openverse metadata retains attribution and rejects unsupported licenses or unsafe links", () => {
  const value = openverseRecord(record);
  assert.match(value.attribution, /Recorder.*CC BY 4.0/);
  assert.equal(value.licenseUrl, record.license_url);
  assert.equal(
    openverseRecord({ ...record, foreign_landing_url: "javascript:alert(1)" })
      .source,
    "",
  );
  assert.throws(
    () => openverseRecord({ ...record, license: "by-nc" }),
    /CC0 or CC BY/,
  );
});
test("remote imports cannot reach private networks or redirect through insecure protocols", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("1.1.1.1"), true);
  await assert.rejects(
    downloadPublicAudio("http://example.com/a", "/unused"),
    /HTTPS/,
  );
  await assert.rejects(
    downloadPublicAudio("https://example.com/a", "/unused", {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      request: () => assert.fail("No request to private server"),
    }),
    /public media/,
  );
});
test("import re-fetches the license and stores credit with the local media, without editing the project", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "splece-openverse-"));
  try {
    const saved = [];
    const service = createOpenverse({
      addons: { requireReady() {} },
      store: {
        get: () => ({ project: { folder } }),
        putMedia: (m) => saved.push(m),
      },
      fetcher: async () => Response.json(record),
      download: async (_url, file) => fs.writeFile(file, "audio"),
      probeMedia: async () => ({ duration: 2, audio: true, video: false }),
      convert: async (args) => fs.copyFile(args[1], args.at(-1)),
    });
    const asset = await service.import("project", record.id);
    assert.equal(asset.kind, "audio");
    assert.equal(asset.attribution.source, record.foreign_landing_url);
    assert.equal(saved[0].attribution.creator, "Recorder");
    assert.equal(await fs.readFile(saved[0].path, "utf8"), "audio");
    await assert.rejects(
      service.import("project", "https://localhost"),
      /Choose a recording/,
    );
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
