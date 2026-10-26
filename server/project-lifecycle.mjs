import { homeProjectSummary } from "../shared/home-projects.mjs";
import fs from "node:fs/promises";
import path from "node:path";
export function projectLifecycle(store, library) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS project_visibility(id TEXT PRIMARY KEY, hidden INTEGER NOT NULL DEFAULT 0)",
  );
  const summaries = new Map();
  const list = () => {
    const records = store.list();
    const ids = new Set(records.map((p) => p.id));
    for (const id of summaries.keys()) if (!ids.has(id)) summaries.delete(id);
    return records.map((p) => {
      let cached = summaries.get(p.id);
      if (!cached || cached.revision !== p.revision) {
        cached = { revision: p.revision, summary: homeProjectSummary(store.get(p.id).project) };
        summaries.set(p.id, cached);
      }
      return {
        ...p,
        summary: cached.summary,
        hidden: !!store.db.prepare("SELECT hidden FROM project_visibility WHERE id=?").get(p.id)?.hidden,
      };
    });
  };
  function hide(id, hidden) {
    if (!store.get(id)) throw Error("Project not found.");
    store.db
      .prepare("INSERT OR REPLACE INTO project_visibility VALUES(?,?)")
      .run(id, hidden ? 1 : 0);
    return list();
  }
  function tables() {
    return ["jobs", "smart_jobs", "story_jobs", "soundtrack_runs", "lip_sync_jobs", "image_jobs", "photo_analyses", "asset_analyses"].filter((t) =>
      store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(t),
    );
  }
  async function remove(id, options = {}) {
    if (store.removing.has(id))
      throw Error("This project is already being removed.");
    store.removing.add(id);
    try {
      return await removeUnlocked(id, options);
    } finally {
      store.removing.delete(id);
    }
  }
  async function removeUnlocked(id, { files = false, confirmName } = {}) {
    const record = store.get(id);
    if (!record) throw Error("Project not found.");
    const p = record.project;
    if (files && confirmName !== p.name)
      throw Error("Type the exact project name to delete its files.");
    for (const table of tables()) {
      const active = store.db
        .prepare(`SELECT body FROM ${table} WHERE projectId=?`)
        .all(id)
        .map((r) => JSON.parse(r.body))
        .some(
          (j) =>
            !["ready", "failed", "cancelled", "interrupted", "quoted"].includes(j.state),
        );
      if (active)
        throw Error(
          "Wait for active jobs to finish before removing this project.",
        );
    }
    // Shared references have independent copies before any source folder is removed.
    await library?.sync(p);
    if (files) {
      const folder = await fs.realpath(p.folder);
      for (const other of store.list().filter((x) => x.id !== id)) {
        const otherFolder = path.resolve(store.get(other.id).project.folder);
        if (otherFolder === folder || otherFolder.startsWith(folder + path.sep))
          throw Error(
            "Another project uses this folder. Remove from Splece instead.",
          );
      }
      const checkpoint = JSON.parse(
        await fs.readFile(path.join(folder, "project.json"), "utf8"),
      );
      const identity = checkpoint.project?.id || checkpoint.id;
      if (identity !== id || folder === path.parse(folder).root)
        throw Error(
          "This folder could not be verified as the project folder. Files were kept.",
        );
      // Only the verified project directory is removed, never paths referenced outside it.
      await fs.rm(folder, { recursive: true, force: false });
    }
    store.db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of [...tables(), "history", "media"])
        store.db.prepare(`DELETE FROM ${table} WHERE projectId=?`).run(id);
      store.db.prepare("DELETE FROM projects WHERE id=?").run(id);
      store.db.prepare("DELETE FROM project_visibility WHERE id=?").run(id);
      store.db.exec("COMMIT");
    } catch (e) {
      store.db.exec("ROLLBACK");
      throw e;
    }
    return { removed: id, filesDeleted: files };
  }
  return { list, hide, remove };
}
export function installProjectLifecycle(app, { store, library }) {
  const service = projectLifecycle(store, library);
  app.get("/api/home/projects", (_req, res) => res.json(service.list()));
  app.patch("/api/projects/:id/visibility", (req, res) =>
    res.json(service.hide(req.params.id, !!req.body.hidden)),
  );
  app.delete("/api/projects/:id", async (req, res) =>
    res.json(await service.remove(req.params.id, req.body)),
  );
  return service;
}
