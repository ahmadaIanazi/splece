import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { preparePlayback, PLAYBACK_PROFILE_VERSION } from "./media.mjs";

// Only this dedicated directory contains evictable proxies. Media records and
// portable bundles always point to durable project files, never into this cache.
export function createPreviewCache({
  store,
  data,
  budgetBytes = 2 * 1024 ** 3,
  render = preparePlayback,
  now = Date.now,
}) {
  const root = path.join(data, "preview-cache");
  store.db
    .exec(`CREATE TABLE IF NOT EXISTS preview_cache(key TEXT PRIMARY KEY, mediaId TEXT, bytes INTEGER, used INTEGER, info TEXT);
    CREATE INDEX IF NOT EXISTS preview_cache_used ON preview_cache(used);`);
  const tasks = new Map(),
    leases = new Map(),
    streams = new Map(),
    failures = new Map();
  let active = 0,
    stopped = false,
    maintenance = Promise.resolve();
  const file = (key) => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw Error("Invalid preview cache key");
    return path.join(root, key + ".mp4");
  };
  async function describe(media) {
    if (!media || ["audio", "image"].includes(media.kind)) return null;
    const source = media.original || media.path;
    const stat = await fs.stat(source);
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          source,
          stat.size,
          stat.mtimeMs,
          PLAYBACK_PROFILE_VERSION,
        ]),
      )
      .digest("hex");
    return { key, source, mediaId: media.id };
  }
  function touch(key) {
    store.db
      .prepare("UPDATE preview_cache SET used=? WHERE key=?")
      .run(now(), key);
  }
  async function ready(desc) {
    if (!desc) return null;
    const row = store.db
      .prepare("SELECT * FROM preview_cache WHERE key=?")
      .get(desc.key);
    if (!row) return null;
    try {
      const stat = await fs.stat(file(desc.key));
      if (!stat.isFile() || stat.size !== row.bytes)
        throw Error("Incomplete preview");
      touch(desc.key);
      return {
        key: desc.key,
        path: file(desc.key),
        info: JSON.parse(row.info),
      };
    } catch {
      store.db.prepare("DELETE FROM preview_cache WHERE key=?").run(desc.key);
      return null;
    }
  }
  function protectedKeys() {
    for (const [id, lease] of leases)
      if (lease.expires < now()) leases.delete(id);
    return new Set([
      ...tasks.keys(),
      ...streams.keys(),
      ...[...leases.values()].flatMap((l) => l.keys),
    ]);
  }
  let recovered = false;
  async function recoverFiles() {
    if (recovered) return;
    recovered = true;
    // Recover completed proxies after an interrupted metadata write. Old partial
    // outputs are disposable; recent files may still be under construction.
    const entries = await fs.readdir(root).catch(() => []);
    for (const name of entries) {
      if (!/^[a-f0-9]{64}\.mp4(?:\.partial\.mp4)?$/.test(name)) continue;
      const key = name.slice(0, 64);
      if (tasks.has(key)) continue;
      const target = path.join(root, name);
      const stat = await fs.stat(target).catch(() => null);
      if (!stat || now() - stat.mtimeMs < 86400000) continue;
      if (!store.db.prepare("SELECT 1 FROM preview_cache WHERE key=?").get(key))
        await fs.rm(target, { force: true });
    }
  }
  function prune() {
    maintenance = maintenance
      .catch(() => {})
      .then(async () => {
        await recoverFiles();
        const protectedSet = protectedKeys();
        const rows = store.db
          .prepare("SELECT * FROM preview_cache ORDER BY used ASC")
          .all();
        let bytes = rows.reduce((n, r) => n + r.bytes, 0);
        for (const row of rows) {
          if (bytes <= budgetBytes) break;
          if (protectedSet.has(row.key) || now() - row.used < 30000) continue;
          await fs.rm(file(row.key), { force: true });
          store.db
            .prepare("DELETE FROM preview_cache WHERE key=?")
            .run(row.key);
          bytes -= row.bytes;
        }
        return {
          bytes,
          budgetBytes,
          entries: store.db
            .prepare("SELECT count(*) n FROM preview_cache")
            .get().n,
        };
      });
    return maintenance;
  }
  function pump() {
    if (active || stopped) return;
    const task = [...tasks.values()]
      .filter((t) => t.state === "queued")
      .sort((a, b) => b.priority - a.priority)[0];
    if (!task) return;
    active++;
    task.state = "building";
    (async () => {
      try {
        await fs.mkdir(root, { recursive: true });
        const info = await render(task.source, file(task.key));
        const stat = await fs.stat(file(task.key));
        store.db
          .prepare("INSERT OR REPLACE INTO preview_cache VALUES(?,?,?,?,?)")
          .run(task.key, task.mediaId, stat.size, now(), JSON.stringify(info));
        failures.delete(task.key);
        task.resolve({ key: task.key, path: file(task.key), info });
      } catch (error) {
        if (failures.size >= 64) failures.delete(failures.keys().next().value);
        failures.set(task.key, { at: now(), message: error.message });
        task.reject(error);
      } finally {
        tasks.delete(task.key);
        active--;
        prune().catch(() => {});
        pump();
      }
    })();
  }
  async function ensure(media, priority = 0, rebuild = false) {
    const desc = await describe(media);
    if (!desc) return null;
    const cached = rebuild ? null : await ready(desc);
    if (cached) return cached;
    if (tasks.has(desc.key)) {
      const task = tasks.get(desc.key);
      task.priority = Math.max(priority, task.priority);
      return task.promise;
    }
    if (stopped || tasks.size >= 32)
      throw Error("Preview queue busy; the original remains available.");
    const task = { ...desc, state: "queued", priority };
    task.promise = new Promise((resolve, reject) =>
      Object.assign(task, { resolve, reject }),
    );
    tasks.set(desc.key, task);
    pump();
    return task.promise;
  }
  async function status(media, priority = 1) {
    const desc = await describe(media);
    if (!desc) return { state: "original", url: media?.url };
    const cached = await ready(desc);
    if (cached)
      return {
        state: "ready",
        key: desc.key,
        url: `/api/media/${media.id}/preview?key=${desc.key}`,
        playback: cached.info.playback,
      };
    const failure = failures.get(desc.key);
    if (failure && now() - failure.at < 30000)
      return {
        state: "failed",
        url: media.url,
        message: "Preview preparation failed. Original footage is available.",
      };
    if (!tasks.has(desc.key)) ensure(media, priority).catch(() => {});
    else
      tasks.get(desc.key).priority = Math.max(
        priority,
        tasks.get(desc.key).priority,
      );
    return { state: tasks.get(desc.key)?.state || "queued", url: media.url };
  }
  async function pin(client, media) {
    if (typeof client !== "string" || client.length > 80)
      throw Error("Invalid preview session");
    protectedKeys();
    if (!media.length) {
      leases.delete(client);
      return;
    }
    if (!leases.has(client) && leases.size >= 32)
      throw Error("Too many preview sessions");
    const keys = (await Promise.all(media.slice(0, 2).map(describe)))
      .filter(Boolean)
      .map((d) => d.key);
    leases.set(client, { keys, expires: now() + 20000 });
  }
  async function send(media, res) {
    const desc = await describe(media);
    if (!desc) return res.sendFile(media.path);
    // Pin before awaiting construction, so eviction cannot race a range response.
    streams.set(desc.key, (streams.get(desc.key) || 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const count = streams.get(desc.key) - 1;
      if (count) streams.set(desc.key, count);
      else streams.delete(desc.key);
    };
    res.once("close", release);
    res.once("finish", release);
    try {
      const cached = await ensure(media, 2);
      if (!res.destroyed)
        res.sendFile(
          cached.path,
          {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          },
          (error) => {
            release();
            if (error && !res.headersSent && !res.destroyed)
              res.status(500).end();
          },
        );
    } catch (error) {
      release();
      throw error;
    }
  }
  const timer = setInterval(() => prune().catch(() => {}), 60000);
  timer.unref();
  return {
    ensure,
    status,
    pin,
    send,
    prune,
    root,
    describe,
    ready,
    stats: () => ({
      pending: tasks.size,
      active,
      leases: leases.size,
      streams: streams.size,
    }),
    stop: () => {
      stopped = true;
      clearInterval(timer);
      for (const [k, t] of tasks)
        if (t.state === "queued") {
          tasks.delete(k);
          t.reject(Error("Preview queue stopped"));
        }
    },
  };
}
