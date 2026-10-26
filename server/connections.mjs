import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { providerDefinitions } from "../shared/providers.mjs";
export async function readJSON(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
export async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600, flush: true });
  await fs.rename(tmp, file);
}
export const keyFingerprint = (key) =>
  createHash("sha256")
    .update(key || "")
    .digest("hex");
export function validateAPIKey(key) {
  if (
    typeof key !== "string" ||
    !key.trim() ||
    /\s/.test(key.trim()) ||
    /^(Bearer|Key)\s/i.test(key)
  )
    throw Error(
      "Paste only the API key, without spaces or an authorization prefix.",
    );
  return key.trim();
}
export function connectionState(key, saved = {}) {
  const verified =
    !!key && saved.ok === true && saved.keyHash === keyFingerprint(key);
  const accessPermitted = verified ? (saved.accessPermitted ?? null) : null;
  return {
    hasKey: !!key,
    verified,
    keyVerified: verified,
    accessPermitted,
    ready: verified && accessPermitted !== false,
    keyChanged: !!saved.keyHash && saved.keyHash !== keyFingerprint(key),
  };
}
const writes = new Map();
async function serialize(file, action) {
  const task = (writes.get(file) || Promise.resolve())
    .catch(() => {})
    .then(action);
  writes.set(file, task);
  try {
    return await task;
  } finally {
    if (writes.get(file) === task) writes.delete(file);
  }
}
// Keep legacy paths: existing credentials need no destructive migration.
export function credentials(data, provider) {
  if (!providerDefinitions.some((p) => p.id === provider))
    throw Error("Unknown provider");
  const file = path.join(
    data,
    provider === "venice" ? "credentials.json" : `${provider}-credentials.json`,
  );
  return {
    async key() {
      return (await readJSON(file))[provider];
    },
    async saveKey(key) {
      key = validateAPIKey(key);
      return serialize(file, async () =>
        writeJSON(file, { ...(await readJSON(file)), [provider]: key }),
      );
    },
    // A slow check must never overwrite a key saved by another window.
    async recordCheck(expectedKey, persist) {
      return serialize(file, async () => {
        if ((await readJSON(file))[provider] !== expectedKey)
          throw Error(
            "The saved key changed while checking. Check the current key again.",
          );
        return persist();
      });
    },
    async commitVerified(key, expectedKey, persist) {
      key = validateAPIKey(key);
      return serialize(file, async () => {
        const current = await readJSON(file);
        if (current[provider] !== expectedKey)
          throw Error(
            "The saved key changed while checking. Check the current key again.",
          );
        await persist();
        if (key !== expectedKey)
          await writeJSON(file, { ...current, [provider]: key });
      });
    },
  };
}
