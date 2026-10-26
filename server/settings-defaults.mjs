import fs from "node:fs";
import path from "node:path";
import { validateDefaults } from "../shared/settings-defaults.mjs";
export function settingsDefaults(data, fallback) {
  const file = path.join(data, "studio-defaults.json");
  let saved = {};
  try {
    saved = validateDefaults(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (e) {
    if (e.code !== "ENOENT")
      console.warn(
        "Studio defaults could not be loaded; preserving project settings.",
      );
  }
  return {
    get: () => structuredClone({ ...fallback, ...saved }),
    save(value) {
      const next = validateDefaults(value);
      fs.writeFileSync(file + ".tmp", JSON.stringify(next, null, 2));
      fs.renameSync(file + ".tmp", file);
      saved = next;
      return this.get();
    },
  };
}
