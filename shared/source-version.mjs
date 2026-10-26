import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export async function sourceVersion(root, kind = "ui") {
  const hash = createHash("sha256");
  const inputs =
    kind === "server"
      ? ["server", "shared", "package.json", "package-lock.json"]
      : [
          "src",
          "shared",
          "public",
          "index.html",
          "package.json",
          "package-lock.json",
          "vite.config.js",
          "vite.config.mjs",
        ];
  async function visit(relative) {
    const file = path.join(root, relative);
    let stat;
    try {
      stat = await fs.lstat(file);
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(file)).sort())
        await visit(path.join(relative, name));
    } else if (stat.isFile()) {
      hash
        .update(relative)
        .update("\0")
        .update(await fs.readFile(file))
        .update("\0");
    }
  }
  for (const input of inputs) await visit(input);
  return hash.digest("hex");
}
