import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createAddonService } from "../server/addons.mjs";
import { addonProcess } from "../server/addon-process.mjs";
import { createAddonWorker } from "../server/addon-worker.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(service, id, status) {
  for (let i = 0; i < 100; i++) {
    const a = service.list().find((a) => a.id === id);
    if (a.status === status) return a;
    await sleep(20);
  }
  assert.fail(
    `Add-on did not reach ${status}: ${JSON.stringify(service.list())}`,
  );
}
test("startup never installs, downloads or probes engines; offline use and removal are isolated", async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "splece-addons-"));
  const calls = [];
  try {
    const runner = async (command, args, options) => {
      calls.push({ command, args, options });
      return '{"ready":true}';
    };
    let service = await createAddonService({
      data,
      processRunner: runner,
      fetcher: () => {
        throw Error("Unexpected download");
      },
    });
    assert.equal(calls.length, 0);
    assert.ok(
      service.list().every((a) => a.status === "available" && !a.enabled),
    );
    assert.throws(
      () => service.requireReady("earshot"),
      /Add Sound intelligence/,
    );
    await assert.rejects(service.install("../../elsewhere"), /Unknown add-on/);
    await service.install("rhythm");
    await waitFor(service, "rhythm", "ready");
    assert.ok(calls.some((c) => c.args.includes("venv")));
    assert.ok(calls.some((c) => c.args.includes("librosa==0.11.0")));
    calls.length = 0;
    await service.execute("rhythm", { action: "beats", path: "fixture.wav" });
    assert.equal(calls[0].options.env.HF_HUB_OFFLINE, "1");
    assert.equal(calls[0].options.env.EARSHOT_OFFLINE, "1");
    assert.equal(calls[0].options.env.TRANSFORMERS_OFFLINE, "1");
    assert.ok(
      calls[0].options.env.HF_HOME.startsWith(
        path.join(data, "addons", "rhythm"),
      ),
    );
    await service.enable("rhythm", false);
    await assert.rejects(
      service.execute("rhythm", { action: "beats" }),
      /Add Beat/,
    );
    service = await createAddonService({ data, processRunner: runner });
    assert.equal(service.list().find((a) => a.id === "rhythm").enabled, false);
    await fs.writeFile(path.join(data, "keep-project.txt"), "keep");
    await service.remove("rhythm");
    assert.equal(
      await fs.readFile(path.join(data, "keep-project.txt"), "utf8"),
      "keep",
    );
    assert.equal(
      service.list().find((a) => a.id === "rhythm").status,
      "available",
    );
  } finally {
    await fs.rm(data, { recursive: true, force: true });
  }
});
test("installation cancellation and restart are recoverable; Openverse enable needs no dependencies", async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "splece-addon-cancel-"));
  try {
    const runner = async (_cmd, args, { signal }) => {
      if (!args.includes("pip")) return "";
      await new Promise((_resolve, reject) => {
        if (signal.aborted) reject(Error("Cancelled"));
        else
          signal.addEventListener("abort", () => reject(Error("Cancelled")), {
            once: true,
          });
      });
    };
    let service = await createAddonService({ data, processRunner: runner });
    await service.install("rhythm");
    await assert.rejects(service.remove("rhythm"), /Wait/);
    await assert.rejects(service.install("scenes"), /Another/);
    await service.cancel("rhythm");
    const cancelled = await waitFor(service, "rhythm", "error");
    assert.match(cancelled.message, /cancelled/);
    await service.remove("rhythm");
    await service.install("openverse");
    service.requireReady("openverse");
    await fs.writeFile(
      path.join(data, "addons", "state.json"),
      JSON.stringify({ earshot: { status: "installing", enabled: false } }),
    );
    service = await createAddonService({ data, processRunner: runner });
    assert.match(
      service.list().find((a) => a.id === "earshot").message,
      /interrupted/,
    );
  } finally {
    await fs.rm(data, { recursive: true, force: true });
  }
});
test("caption spelling hints and language stay local without lossy forced segment splitting", async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "splece-caption-options-"));
  try {
    await fs.mkdir(path.join(data, "addons"));
    await fs.writeFile(path.join(data, "addons/state.json"), JSON.stringify({ captions: { status: "ready", enabled: true } }));
    let argsUsed;
    const output = path.join(data, "result");
    const service = await createAddonService({ data, processRunner: async (_cmd, args, { env }) => {
      argsUsed = args;
      assert.equal(env.HF_HUB_OFFLINE, "1");
      await fs.writeFile(output + ".json", JSON.stringify({ transcription: [{ offsets: { from: 0, to: 30000 }, text: " أهلاً أنا المعلمة نورة " }] }));
    } });
    const result = await service.execute("captions", { path: "local.wav", output, language: "ar", prompt: "نورة، صوص" });
    assert.equal(argsUsed[argsUsed.indexOf("-l") + 1], "ar");
    assert.equal(argsUsed[argsUsed.indexOf("--prompt") + 1], "نورة، صوص");
    assert.ok(!argsUsed.includes("-ml"), "forced word splitting can push Arabic tails beyond the audio boundary");
    assert.equal(result.segments[0].text, "أهلاً أنا المعلمة نورة");
  } finally { await fs.rm(data, { recursive: true, force: true }); }
});
test("local processes accept structured stdin, reject timeout and cancellation", async () => {
  assert.equal(
    await addonProcess(
      process.execPath,
      ["-e", "process.stdin.pipe(process.stdout)"],
      { input: "عربي English" },
    ),
    "عربي English",
  );
  await assert.rejects(
    addonProcess(process.execPath, ["-e", "setTimeout(()=>{}, 10000)"], {
      timeout: 30,
    }),
    /too long/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    addonProcess(process.execPath, ["-e", "process.exit(0)"], {
      signal: controller.signal,
    }),
    /Cancelled/,
  );
});

test("warm local worker reuses its process and safely restarts after cancellation", async () => {
  const code = `const readline=require('node:readline');let count=0;readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.wait)return;console.log(JSON.stringify({result:{count:++count,text:r.text}}));});`;
  const worker = createAddonWorker(process.execPath, ["-e", code], process.env);
  try {
    assert.deepEqual(await worker.request({ text: "مرحبا" }), {
      count: 1,
      text: "مرحبا",
    });
    assert.equal((await worker.request({ text: "next" })).count, 2);
    await assert.rejects(
      worker.request({ wait: true }, { timeout: 30 }),
      /too long/,
    );
    assert.equal((await worker.request({ text: "recovered" })).count, 1);
  } finally {
    worker.close();
  }
});
