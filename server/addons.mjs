import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { addonCatalog, addonById } from "../shared/addons.mjs";
import { addonProcess } from "./addon-process.mjs";
import { createAddonWorker } from "./addon-worker.mjs";
import ffmpeg from "./ffmpeg-path.mjs";
const worker = fileURLToPath(new URL("./local-worker.py", import.meta.url));
const earshotPin = "591fa3e028032e6dce56620a20e932e35667e8d8";
const whisperPin = "371b5a7561823ab2bb32142d2751e35e7534727b";
const modelHash =
  "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status });

export async function createAddonService({
  data,
  processRunner = addonProcess,
  fetcher = fetch,
}) {
  // Optional data lives outside the application bundle and all project folders.
  const root = path.join(data, "addons");
  await fs.mkdir(root, { recursive: true });
  const stateFile = path.join(root, "state.json");
  let state = {};
  try {
    state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    if (!state || typeof state !== "object" || Array.isArray(state))
      throw new SyntaxError("Invalid add-on state");
  } catch (e) {
    if (e instanceof SyntaxError) {
      await fs.rename(stateFile, stateFile + ".invalid-" + Date.now());
      state = {};
    } else if (e.code !== "ENOENT") throw e;
  }
  state = Object.fromEntries(
    Object.entries(state).filter(
      ([id, value]) => addonById(id) && value && typeof value === "object",
    ),
  );
  let writes = Promise.resolve();
  const persist = () => {
    const body = JSON.stringify(state);
    writes = writes
      .catch(() => {})
      .then(async () => {
        await fs.writeFile(stateFile + ".tmp", body, { mode: 0o600 });
        await fs.rename(stateFile + ".tmp", stateFile);
      });
    return writes;
  };
  for (const value of Object.values(state))
    if (["installing", "removing"].includes(value.status)) {
      value.status = "error";
      value.enabled = false;
      value.message = "Setup was interrupted. Retry to finish installing.";
    }
  await persist();
  const workers = new Map();
  const active = new Map(),
    uses = new Map();
  const directory = (id) => {
    if (!addonById(id)) throw fail("Unknown add-on", 404);
    return path.join(root, id);
  };
  const python = (id) =>
    path.join(
      directory(id),
      "venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
  const env = (id, offline = true) => ({
    ...process.env,
    PATH: path.dirname(ffmpeg) + path.delimiter + (process.env.PATH || ""),
    PYTHONNOUSERSITE: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_CACHE_DIR: path.join(directory(id), "pip-cache"),
    EARSHOT_HOME: path.join(directory(id), "models"),
    HF_HOME: path.join(directory(id), "models", "hf-home"),
    NUMBA_CACHE_DIR: path.join(directory(id), "numba"),
    EARSHOT_THREADS: "2",
    OMP_NUM_THREADS: "2",
    MKL_NUM_THREADS: "2",
    EARSHOT_OFFLINE: offline ? "1" : "0",
    HF_HUB_OFFLINE: offline ? "1" : "0",
    TRANSFORMERS_OFFLINE: offline ? "1" : "0",
    HF_HUB_DISABLE_TELEMETRY: "1",
  });
  const view = (id) => ({
    ...addonById(id),
    status: "available",
    enabled: false,
    ...state[id],
  });
  function requireReady(id) {
    directory(id);
    if (state[id]?.status !== "ready" || !state[id]?.enabled)
      throw fail(`Add ${addonById(id).name} in Settings → Add-ons first.`, 409);
  }
  async function findPython(signal) {
    for (const [command, prefix] of process.platform === "win32"
      ? [
          ["py", ["-3.12"]],
          ["py", ["-3.11"]],
          ["python", []],
        ]
      : [
          ["python3.12", []],
          ["python3.11", []],
          ["python3.10", []],
          ["python3", []],
        ]) {
      try {
        await processRunner(
          command,
          [
            ...prefix,
            "-c",
            "import sys; assert (3,10) <= sys.version_info[:2] <= (3,12)",
          ],
          { signal, timeout: 10000 },
        );
        return { command, prefix };
      } catch (e) {
        if (signal.aborted) throw e;
      }
    }
    throw Error(
      "Install Python 3.10–3.12 from python.org, then retry. Your system Python will not be changed.",
    );
  }
  async function setup(id, controller) {
    const folder = directory(id),
      signal = controller.signal;
    const stage = async (message) => {
      state[id].message = message;
      await persist();
    };
    const run = (command, args, options = {}) =>
      processRunner(command, args, {
        signal,
        env: env(id, false),
        timeout: 1800000,
        ...options,
      });
    try {
      await fs.mkdir(folder, { recursive: true });
      if (id === "captions") {
        await stage("Checking the local build tools…");
        try {
          await run("git", ["--version"]);
          await run("cmake", ["--version"]);
        } catch {
          throw Error(
            "Install Git, CMake and a C++ compiler, then retry Local captions.",
          );
        }
        const source = path.join(folder, "source"),
          build = path.join(folder, "build");
        await stage("Downloading the pinned whisper.cpp source…");
        await fs.rm(source, { recursive: true, force: true });
        await run("git", ["init", source]);
        await run("git", [
          "-C",
          source,
          "fetch",
          "--depth=1",
          "https://github.com/ggml-org/whisper.cpp.git",
          whisperPin,
        ]);
        await run("git", ["-C", source, "checkout", "--detach", "FETCH_HEAD"]);
        await stage("Building the local speech engine…");
        await run("cmake", [
          "-S",
          source,
          "-B",
          build,
          "-DCMAKE_BUILD_TYPE=Release",
          "-DBUILD_SHARED_LIBS=OFF",
          "-DWHISPER_BUILD_TESTS=OFF",
          "-DWHISPER_CURL=OFF",
        ]);
        await run("cmake", [
          "--build",
          build,
          "--config",
          "Release",
          "--target",
          "whisper-cli",
          "-j",
          "2",
        ]);
        await stage("Downloading the multilingual model · 148 MB…");
        const response = await fetcher(
          "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
          { signal: AbortSignal.any([signal, AbortSignal.timeout(1200000)]) },
        );
        if (!response.ok)
          throw Error(
            `Model download failed (${response.status}). Retry when connected.`,
          );
        const partial = path.join(folder, "model.partial"),
          hash = createHash("sha256");
        const output = await fs.open(partial, "w");
        let bytes = 0;
        try {
          for await (const chunk of response.body) {
            bytes += chunk.length;
            if (bytes > 148000000) throw Error("Unexpected model size.");
            hash.update(chunk);
            await output.write(chunk);
          }
        } finally {
          await output.close();
        }
        if (hash.digest("hex") !== modelHash)
          throw Error(
            "The model download did not pass verification. Retry installation.",
          );
        await fs.rename(partial, path.join(folder, "model.bin"));
        await run(whisperBinary(folder), ["--help"]);
      } else {
        await stage("Checking Python…");
        const found = await findPython(signal);
        await stage("Preparing an isolated environment…");
        await run(found.command, [
          ...found.prefix,
          "-m",
          "venv",
          path.join(folder, "venv"),
        ]);
        const packages =
          id === "rhythm"
            ? [
                "librosa==0.11.0",
                "numpy==1.26.4",
                "scipy==1.13.1",
                "numba==0.61.2",
              ]
            : id === "scenes"
              ? [
                  "scenedetect==0.6.7.1",
                  "opencv-python-headless==4.11.0.86",
                  "numpy==1.26.4",
                ]
              : [
                  `earshot @ https://github.com/Leonxlnx/earshot/archive/${earshotPin}.zip`,
                  "transformers==4.57.6",
                  "numpy==1.26.4",
                  "scipy==1.13.1",
                  "numba==0.61.2",
                ];
        await stage("Downloading the optional packages…");
        // Avoid multi-GB CUDA dependencies on Linux. Earshot is a CPU engine.
        if (id === "earshot" && process.platform === "linux")
          await run(python(id), [
            "-m",
            "pip",
            "install",
            "--index-url",
            "https://download.pytorch.org/whl/cpu",
            "torch==2.6.0",
          ]);
        await run(python(id), ["-m", "pip", "install", ...packages]);
        await stage(
          id === "earshot"
            ? "Downloading and checking the sound models · about 1.1 GB…"
            : "Checking the local engine…",
        );
        await run(python(id), [worker], {
          input: JSON.stringify({ action: "prepare", engine: id }),
        });
        // The readiness check must also work with downloads forbidden.
        await run(python(id), [worker], {
          env: env(id),
          input: JSON.stringify({ action: "prepare", engine: id }),
        });
        await fs.rm(path.join(folder, "pip-cache"), {
          recursive: true,
          force: true,
        });
      }
      if (signal.aborted) throw Error("Cancelled");
      state[id] = {
        status: "ready",
        enabled: true,
        message: "Ready · runs on this computer",
        installedAt: Date.now(),
      };
    } catch (e) {
      state[id] = {
        status: "error",
        enabled: false,
        message: signal.aborted
          ? "Installation cancelled. Retry or remove the partial download."
          : String(e.message).slice(-900),
      };
    } finally {
      active.delete(id);
      await persist();
    }
  }
  function whisperBinary(folder) {
    const bin = path.join(folder, "build", "bin");
    const candidates =
      process.platform === "win32"
        ? [
            path.join(bin, "Release", "whisper-cli.exe"),
            path.join(bin, "whisper-cli.exe"),
          ]
        : [path.join(bin, "whisper-cli")];
    return candidates.find((file) => existsSync(file)) || candidates[0];
  }
  return {
    list: () =>
      addonCatalog.map((a) => ({ ...view(a.id), busy: !!uses.get(a.id) })),
    requireReady,
    async install(id) {
      const spec = addonById(id);
      directory(id);
      if (state[id]?.status === "removing")
        throw fail("This add-on is being removed. Please wait.", 409);
      if (active.has(id)) return view(id);
      if (state[id]?.status === "ready") {
        state[id].enabled = true;
        await persist();
        return view(id);
      }
      if (!spec.local) {
        state[id] = {
          status: "ready",
          enabled: true,
          message: "Enabled · online search",
        };
        await persist();
        return view(id);
      }
      if (active.size)
        throw fail("Another add-on is installing. Wait for it to finish.", 409);
      const controller = new AbortController();
      active.set(id, controller);
      state[id] = {
        status: "installing",
        enabled: false,
        message: "Preparing download…",
      };
      await persist();
      void setup(id, controller);
      return view(id);
    },
    async cancel(id) {
      directory(id);
      active.get(id)?.abort();
      return view(id);
    },
    async enable(id, enabled) {
      directory(id);
      if (state[id]?.status !== "ready")
        throw fail("Install this add-on first.");
      if (uses.get(id))
        throw fail("Wait for this add-on’s analysis to finish.", 409);
      state[id].enabled = !!enabled;
      if (!enabled) {
        workers.get(id)?.close();
        workers.delete(id);
      }
      await persist();
      return view(id);
    },
    async remove(id) {
      const folder = directory(id);
      if (active.has(id) || uses.get(id) || state[id]?.status === "removing")
        throw fail(
          "Wait for the current operation to finish before removing this add-on.",
          409,
        );
      state[id] = { status: "removing", enabled: false };
      workers.get(id)?.close();
      workers.delete(id);
      await persist();
      try {
        await fs.rm(folder, { force: true, recursive: true });
        delete state[id];
      } catch (e) {
        state[id] = { status: "error", enabled: false, message: e.message };
        throw e;
      } finally {
        await persist();
      }
      return view(id);
    },
    async execute(id, request, { signal } = {}) {
      requireReady(id);
      uses.set(id, (uses.get(id) || 0) + 1);
      try {
        if (id === "captions") {
          const output = request.output;
          await processRunner(
            whisperBinary(directory(id)),
            [
              "-m",
              path.join(directory(id), "model.bin"),
              "-f",
              request.path,
              "-l",
              ["ar", "en"].includes(request.language) ? request.language : "auto",
              ...(request.prompt ? ["--prompt", String(request.prompt).slice(0, 500)] : []),
              "-oj",
              "-of",
              output,
              "-t",
              "2",
            ],
            { signal, env: env(id), timeout: 1800000 },
          );
          const result = JSON.parse(
            await fs.readFile(output + ".json", "utf8"),
          );
          return {
            segments: (result.transcription || []).map((s) => ({
              start: s.offsets.from / 1000,
              end: s.offsets.to / 1000,
              text: s.text.trim(),
            })),
          };
        }
        if (id === "earshot" && processRunner === addonProcess) {
          if (!workers.has(id))
            workers.set(
              id,
              createAddonWorker(python(id), [worker, "--serve"], env(id)),
            );
          return await workers.get(id).request(request, { signal });
        }
        return JSON.parse(
          await processRunner(python(id), [worker], {
            signal,
            env: env(id),
            input: JSON.stringify(request),
          }),
        );
      } finally {
        uses.set(id, Math.max(0, (uses.get(id) || 1) - 1));
      }
    },
  };
}

export function installAddonRoutes(app, service) {
  app.get("/api/addons", (_req, res) => res.json(service.list()));
  app.post("/api/addons/:addon/install", async (req, res) =>
    res.status(202).json(await service.install(req.params.addon)),
  );
  app.post("/api/addons/:addon/cancel", async (req, res) =>
    res.json(await service.cancel(req.params.addon)),
  );
  app.put("/api/addons/:addon", async (req, res) =>
    res.json(await service.enable(req.params.addon, req.body.enabled)),
  );
  app.delete("/api/addons/:addon", async (req, res) =>
    res.json(await service.remove(req.params.addon)),
  );
}
