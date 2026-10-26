import { isProjectOnly } from "../shared/asset-scope.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

// Shared originals live independently of project folders. Projects adopt snapshots.
export function createAssetLibrary(store, data) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS asset_library(id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL);",
  );
  const folder = path.join(data, "library");
  const read = (id) => {
    const row = store.db
      .prepare("SELECT body FROM asset_library WHERE id=?")
      .get(id);
    return row ? JSON.parse(row.body) : null;
  };
  const mediaMemo = new Map();
  async function copyMedia(media, destination, projectId) {
    const source = store.media(media.id);
    if (!source)
      throw Error("The asset media is missing. Re-import it before sharing.");
    const key = destination + ":" + source.id;
    if (mediaMemo.has(key)) return mediaMemo.get(key);
    const task = (async () => {
      await fs.mkdir(destination, { recursive: true });
      const id = randomUUID(),
        result = { ...source, id, projectId };
      const copiedFiles = new Map();
      for (const field of ["path", "original", "poster"])
        if (source[field]) {
          const target = path.join(
            destination,
            id + "-" + field + path.extname(source[field]),
          );
          if (!copiedFiles.has(source[field])) {
            await fs.copyFile(source[field], target);
            copiedFiles.set(source[field], target);
          }
          result[field] = copiedFiles.get(source[field]);
        }
      result.url = "/api/media/" + id;
      result.thumbnail = result.poster
        ? result.url + "/thumbnail"
        : "/audio.svg";
      delete result.jobId;
      delete result.treatment;
      result.sourceMediaId = source.sourceMediaId || source.id;
      store.putMedia(result);
      return result;
    })();
    mediaMemo.set(key, task);
    try {
      return await task;
    } catch (e) {
      mediaMemo.delete(key);
      throw e;
    }
  }
  async function mapMedia(value, destination, projectId) {
    if (Array.isArray(value))
      return Promise.all(value.map((v) => mapMedia(v, destination, projectId)));
    if (!value || typeof value !== "object") return value;
    if (
      value.id &&
      value.url?.startsWith("/api/media/") &&
      store.media(value.id)
    )
      return copyMedia(value, destination, projectId);
    const result = {};
    for (const [key, v] of Object.entries(value)) {
      if (key === "history") continue; // Asset snapshots, not another project's edit history.
      result[key] = await mapMedia(v, destination, projectId);
    }
    return result;
  }
  let chain = Promise.resolve();
  function sync(project) {
    const snapshot = structuredClone(project);
    const task = chain
      .catch(() => {})
      .then(async () => {
        const entries = [...snapshot.assets];
        const known = new Set(entries.map((a) => a.media?.id));
        for (const job of store.jobViews(snapshot.id))
          if (
            job.kind === "generation" &&
            job.state === "ready" &&
            job.media &&
            !known.has(job.media.id)
          )
            entries.push({
              id: "generation-" + job.id,
              name: job.snapshot?.draft?.name || job.media.name,
              kind: "footage",
              media: job.media,
              generated: true,
              description: "AI generated footage",
            });
        for (const asset of entries) {
          if (asset.libraryId) continue; // Adopted snapshots never overwrite a shared master.
          const id = snapshot.id + ":" + asset.id;
          if (isProjectOnly(asset)) {
            store.db.prepare("DELETE FROM asset_library WHERE id=?").run(id);
            continue;
          }
          const fingerprint = JSON.stringify(asset),
            previous = read(id);
          if (previous?.fingerprint === fingerprint) continue;
          const copied = await mapMedia(
            asset,
            path.join(folder, "media"),
            "shared-library",
          );
          const entry = {
            id,
            owner: snapshot.id,
            originName: snapshot.name,
            sourceAssetId: asset.id,
            fingerprint,
            asset: { ...copied, scope: "shared" },
            updatedAt: Date.now(),
          };
          store.db
            .prepare("INSERT OR REPLACE INTO asset_library VALUES(?,?,?)")
            .run(id, snapshot.id, JSON.stringify(entry));
        }
      });
    chain = task;
    return task;
  }
  async function list() {
    // Include older projects without changing any of their revisions or drafts.
    for (const row of store.list()) await sync(store.get(row.id).project);
    return store.db
      .prepare("SELECT body FROM asset_library")
      .all()
      .map((r) => {
        const { fingerprint, ...entry } = JSON.parse(r.body);
        return entry;
      });
  }
  async function adopt(id, project) {
    const entry = read(id);
    if (!entry)
      throw Error("Shared asset no longer available. Refresh the library.");
    const existing = project.assets.find(
      (a) =>
        a.libraryId === id ||
        (entry.owner === project.id && a.id === entry.sourceAssetId),
    );
    if (existing) return existing;
    const asset = await mapMedia(
      entry.asset,
      path.join(project.folder, "media"),
      project.id,
    );
    return {
      ...asset,
      id:
        "library-" +
        createHash("sha256")
          .update(project.id + ":" + id)
          .digest("hex")
          .slice(0, 24),
      libraryId: id,
      scope: "shared",
      libraryVersion: entry.updatedAt,
    };
  }
  return { sync, list, adopt };
}
export function installLibraryRoutes(app, { library, getProject }) {
  app.get("/api/library/assets", async (_req, res) =>
    res.json(await library.list()),
  );
  app.post("/api/projects/:id/library/adopt", async (req, res) => {
    const { project } = getProject(req.params.id);
    res.json(await library.adopt(req.body.libraryId, project));
  });
}
