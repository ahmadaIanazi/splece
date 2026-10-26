import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await fs.cp(
  path.join(root, "node_modules/@mediapipe/tasks-vision/wasm"),
  path.join(root, "public/vision/wasm"),
  { recursive: true },
);
await build({
  configFile: false,
  publicDir: false,
  logLevel: "error",
  build: {
    outDir: path.join(root, "public/vision"),
    emptyOutDir: false,
    lib: {
      entry: path.join(root, "src/face-worker.js"),
      name: "SpleceFaceWorker",
      formats: ["iife"],
      fileName: () => "face-worker.js",
    },
  },
});
