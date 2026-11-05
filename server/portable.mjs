import fs from "node:fs/promises";
import path from "node:path";
import { id, validateProject } from "./domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
export function portablePaths(value, folder) {
  if (Array.isArray(value)) return value.map((v) => portablePaths(v, folder));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        if (
          ["path", "poster", "original", "output", "file"].includes(k) &&
          typeof v === "string" &&
          path.isAbsolute(v)
        ) {
          const relative = path.relative(folder, v);
          if (relative.startsWith("..") || path.isAbsolute(relative))
            throw new Error("Media is outside the project folder");
          return [k, relative];
        }
        return [k, portablePaths(v, folder)];
      }),
    );
  return value;
}
export function resolveProjectPath(folder, relative) {
  const resolved = path.resolve(folder, relative);
  if (resolved !== folder && !resolved.startsWith(folder + path.sep))
    throw new Error("Project path escapes its folder");
  return resolved;
}
// Effect artifacts are durable project files, not disposable preview cache entries.
export function effectPortablePaths(job, folder, resolve = false) {
  const copy = structuredClone(job);
  const convert = value => resolve ? resolveProjectPath(folder, value) : portablePaths({ path: value }, folder).path;
  for (const key of ['folder', 'sourcePath']) if (copy[key]) copy[key] = convert(copy[key]);
  for (const stage of copy.stages || []) for (const key of ['artifact', 'snapshot']) if (stage[key]) stage[key] = convert(stage[key]);
  for (const source of copy.frameSources || []) source.path = convert(source.path);
  for (const stage of copy.stages || []) for (const key of ['framePaths','frameSnapshots']) if (stage[key]) stage[key] = stage[key].map(convert);
  return resolve ? copy : portablePaths(copy, folder);
}
export function createPortableStore(store) {
  const chains = new Map();
  async function checkpoint(projectId) {
    const result = store.get(projectId);
    if (!result) return;
    const p = result.project;
    const media = store.db
      .prepare("SELECT body FROM media WHERE projectId=?")
      .all(projectId)
      .map((r) => JSON.parse(r.body));
    const history = store.db
      .prepare(
        "SELECT revision,body,at FROM history WHERE projectId=? ORDER BY revision",
      )
      .all(projectId)
      .map((r) => ({
        ...r,
        body: portablePaths(JSON.parse(r.body), p.folder),
      }));
    const bundle = {
      format: "frame-project",
      version: 2,
      revision: result.revision,
      project: portablePaths(p, p.folder),
      media: media.map((m) => portablePaths(m, p.folder)),
      jobs: store.jobs(projectId).map((j) => portablePaths(j, p.folder)),
      history,
      assetAnalyses: store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='asset_analyses'").get() ? store.db.prepare("SELECT body FROM asset_analyses WHERE projectId=? AND state != 'quoted'").all(projectId).map(r=>JSON.parse(r.body)) : [],
      photoAnalyses: store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='photo_analyses'").get() ? store.db.prepare("SELECT body FROM photo_analyses WHERE projectId=? AND state != 'quoted'").all(projectId).map(r=>JSON.parse(r.body)) : [],
      imageJobs: store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_jobs'").get() ? store.db.prepare("SELECT body FROM image_jobs WHERE projectId=?").all(projectId).map(r=>portablePaths(JSON.parse(r.body),p.folder)) : [],
      effectJobs: store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='effect_jobs'").get() ? store.db.prepare("SELECT body FROM effect_jobs WHERE projectId=?").all(projectId).map(r=>effectPortablePaths(JSON.parse(r.body),p.folder)) : [],
      lipSyncJobs: store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lip_sync_jobs'").get() ? store.db.prepare("SELECT body FROM lip_sync_jobs WHERE projectId=?").all(projectId).map(r=>portablePaths(JSON.parse(r.body),p.folder)) : [],
      soundtrackRuns: store.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='soundtrack_runs'",
        )
        .get()
        ? store.db
            .prepare("SELECT body FROM soundtrack_runs WHERE projectId=?")
            .all(projectId)
            .map((r) => portablePaths(JSON.parse(r.body), p.folder))
        : [],
      storyJobs: store.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='story_jobs'",
        )
        .get()
        ? store.db
            .prepare("SELECT body FROM story_jobs WHERE projectId=?")
            .all(projectId)
            .map((r) => portablePaths(JSON.parse(r.body), p.folder))
        : [],
      smartJobs: store.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='smart_jobs'",
        )
        .get()
        ? store.db
            .prepare("SELECT body FROM smart_jobs WHERE projectId=?")
            .all(projectId)
            .map((r) => portablePaths(JSON.parse(r.body), p.folder))
        : [],
    };
    delete bundle.project.folder;
    for (const h of bundle.history) delete h.body.folder;
    const dir = path.join(p.folder, ".frame");
    await fs.mkdir(dir, { recursive: true });
    const temp = path.join(dir, id() + ".tmp");
    await fs.writeFile(temp, JSON.stringify(bundle), { flush: true });
    await fs.rename(temp, path.join(dir, "project.bundle.json"));
    const mirror = path.join(p.folder, "project.json.tmp");
    await fs.writeFile(mirror, JSON.stringify(bundle.project, null, 2), {
      flush: true,
    });
    await fs.rename(mirror, path.join(p.folder, "project.json"));
    return { folder: p.folder, revision: result.revision };
  }
  function enqueue(id) {
    const work = (chains.get(id) || Promise.resolve())
      .catch(() => {})
      .then(() => checkpoint(id));
    chains.set(id, work);
    return work;
  }
  async function open(folder) {
    folder = await fs.realpath(path.resolve(folder));
    const file = path.join(folder, ".frame", "project.bundle.json");
    let bundle = JSON.parse(await fs.readFile(file, "utf8"));
    if (bundle.format !== "frame-project" || bundle.version !== 2)
      throw new Error("Not a supported Frame project folder");
    let p = upgradeProject(validateProject({ ...bundle.project, folder }));
    for (const m of bundle.media)
      for (const key of ["path", "poster", "original"])
        if (m[key]) {
          const file = resolveProjectPath(folder, m[key]);
          const actual = await fs.realpath(file);
          if (!actual.startsWith(folder + path.sep))
            throw new Error("Project media symlink escapes folder");
        }
    const old = store.get(p.id);
    const oldFolder = old
      ? await fs
          .realpath(old.project.folder)
          .catch(() => path.resolve(old.project.folder))
      : null;
    const importing = !old || oldFolder !== folder;
    if (old && oldFolder !== folder) {
      const mapping = new Map([
        [p.id, id()],
        ...bundle.media.map((m) => [m.id, id()]),
        ...bundle.jobs.map((j) => [j.id, id()]),
        ...(bundle.smartJobs || []).map((j) => [j.id, id()]),
        ...(bundle.storyJobs || []).map((j) => [j.id, id()]),
        ...(bundle.soundtrackRuns || []).map((j) => [j.id, id()]),
        ...(bundle.effectJobs || []).map((j) => [j.id, id()]),
        ...(bundle.lipSyncJobs || []).map((j) => [j.id, id()]),
        ...(bundle.imageJobs || []).map((j) => [j.id, id()]),
        ...(bundle.assetAnalyses || []).map((j) => [j.id, id()]),
        ...(bundle.photoAnalyses || []).map((j) => [j.id, id()]),
      ]);
      const remap = (value) => {
        if (typeof value === "string") {
          if (mapping.has(value)) return mapping.get(value);
          if (value.startsWith("/api/media/")) {
            for (const [from, to] of mapping)
              value = value.replace("/api/media/" + from, "/api/media/" + to);
          }
          return value;
        }
        if (Array.isArray(value)) return value.map(remap);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, remap(v)]),
          );
        return value;
      };
      bundle = remap(bundle);
      p = upgradeProject({ ...bundle.project, folder });
    }
    let revision = store.save(p, importing ? 0 : old.revision);
    if (importing && bundle.history?.length) {
      store.db.exec("BEGIN IMMEDIATE");
      try {
        store.db.prepare("DELETE FROM history WHERE projectId=?").run(p.id);
        for (const h of bundle.history) {
          store.db
            .prepare("INSERT OR REPLACE INTO history VALUES(?,?,?,?)")
            .run(
              p.id,
              h.revision,
              JSON.stringify({ ...h.body, id: p.id, folder }),
              h.at,
            );
        }
        revision =
          Math.max(bundle.revision, ...bundle.history.map((h) => h.revision)) +
          1;
        store.db
          .prepare("UPDATE projects SET revision=? WHERE id=?")
          .run(revision, p.id);
        store.db
          .prepare("INSERT INTO history VALUES(?,?,?,?)")
          .run(p.id, revision, JSON.stringify(p), new Date().toISOString());
        store.db.exec("COMMIT");
      } catch (e) {
        store.db.exec("ROLLBACK");
        throw e;
      }
    }
    for (const m of bundle.media) {
      m.projectId = p.id;
      store.putMedia({
        ...m,
        path: resolveProjectPath(folder, m.path),
        poster: m.poster ? resolveProjectPath(folder, m.poster) : undefined,
        original: m.original
          ? resolveProjectPath(folder, m.original)
          : undefined,
      });
    }
    for (const j of bundle.jobs) {
      if (
        j.snapshot?.provider === "Venice" &&
        !j.providerJobId &&
        !["ready", "cancelled", "submission_uncertain"].includes(j.state)
      ) {
        j.state = "interrupted";
        j.error =
          "Imported Online request was not submitted. Review its prompt and create a new generation.";
      }
      j.projectId = p.id;
      if (j.output) j.output = resolveProjectPath(folder, j.output);
      store.putJob(j);
    }
    if (bundle.smartJobs?.length) {
      store.db.exec(
        "CREATE TABLE IF NOT EXISTS smart_jobs(id TEXT PRIMARY KEY,projectId TEXT,body TEXT NOT NULL)",
      );
      for (const j of bundle.smartJobs) {
        j.projectId = p.id;
        if (["queued", "running"].includes(j.state)) {
          j.state = "interrupted";
          j.error =
            "Imported pending preparation: run a new proposal explicitly.";
        }
        store.db
          .prepare("INSERT OR REPLACE INTO smart_jobs VALUES(?,?,?)")
          .run(j.id, p.id, JSON.stringify(j));
      }
    }
    if (bundle.storyJobs?.length) {
      store.db.exec(
        "CREATE TABLE IF NOT EXISTS story_jobs(id TEXT PRIMARY KEY,projectId TEXT,body TEXT NOT NULL)",
      );
      for (const j of bundle.storyJobs) {
        j.projectId = p.id;
        if (["queued", "running"].includes(j.state)) {
          j.state = "interrupted";
          j.error =
            "Imported pending story proposal: prepare again explicitly.";
        }
        store.db
          .prepare("INSERT OR REPLACE INTO story_jobs VALUES(?,?,?)")
          .run(j.id, p.id, JSON.stringify(j));
      }
    }
    if (bundle.assetAnalyses?.length) {
      store.db.exec("CREATE TABLE IF NOT EXISTS asset_analyses(id TEXT PRIMARY KEY,projectId TEXT,state TEXT,body TEXT NOT NULL)");
      for (const j of bundle.assetAnalyses) {
        j.projectId=p.id;delete j.fingerprint;
        if (j.state==='processing') {j.state='interrupted';j.error='Imported unfinished analysis. No automatic retry.';}
        store.db.prepare("INSERT OR REPLACE INTO asset_analyses VALUES(?,?,?,?)").run(j.id,p.id,j.state,JSON.stringify(j));
      }
    }
    if (bundle.photoAnalyses?.length) {
      store.db.exec("CREATE TABLE IF NOT EXISTS photo_analyses(id TEXT PRIMARY KEY,projectId TEXT,state TEXT,body TEXT NOT NULL)");
      for (const j of bundle.photoAnalyses) {
        j.projectId=p.id;
        if (j.state==='processing') {j.state='interrupted';j.error='Imported unfinished photo analysis. No automatic retry.';}
        store.db.prepare("INSERT OR REPLACE INTO photo_analyses VALUES(?,?,?,?)").run(j.id,p.id,j.state,JSON.stringify(j));
      }
    }
    if (bundle.imageJobs?.length) {
      store.db.exec("CREATE TABLE IF NOT EXISTS image_jobs(id TEXT PRIMARY KEY,projectId TEXT,state TEXT,body TEXT NOT NULL)");
      for (const j of bundle.imageJobs) {
        j.projectId=p.id;
        if(j.media) j.media=store.media(j.media.id)||j.media;
        if(!["ready","failed","cancelled","submission_uncertain"].includes(j.state)) {j.state="failed"; j.error="Imported unfinished image. Retrieve its existing provider result before generating again.";}
        store.db.prepare("INSERT OR REPLACE INTO image_jobs VALUES(?,?,?,?)").run(j.id,p.id,j.state,JSON.stringify(j));
      }
    }
    if (bundle.effectJobs?.length) {
      store.db.exec("CREATE TABLE IF NOT EXISTS effect_jobs(id TEXT PRIMARY KEY,projectId TEXT,state TEXT,body TEXT NOT NULL)");
      for (const raw of bundle.effectJobs) {
        const j = effectPortablePaths(raw, folder, true);
        j.projectId = p.id;
        if (j.media) j.media = store.media(j.media.id) || j.media;
        j.signature = JSON.stringify(j.input);
        if (!["ready", "cancelled", "needs_attention"].includes(j.state)) {
          j.state = "needs_attention"; j.error = "Imported unfinished effect. Continue the saved stages; no automatic provider submission.";
          const stage = j.stages.find(s => s.state !== 'ready');
          if (stage?.state === 'submitting' && !stage.providerJobId) stage.state = 'submission_uncertain';
        }
        store.db.prepare("INSERT OR REPLACE INTO effect_jobs VALUES(?,?,?,?)").run(j.id,p.id,j.state,JSON.stringify(j));
      }
    }
    if (bundle.lipSyncJobs?.length) {
      store.db.exec("CREATE TABLE IF NOT EXISTS lip_sync_jobs(id TEXT PRIMARY KEY,projectId TEXT,state TEXT,body TEXT NOT NULL)");
      for (const j of bundle.lipSyncJobs) {
        j.projectId=p.id;
        if(j.media)j.media=store.media(j.media.id)||j.media;
        j.signature=JSON.stringify(j.input);
        if (!["ready","cancelled","failed","submission_uncertain"].includes(j.state)) {
          j.state="failed"; j.error="Imported unfinished lip-sync. Retrieve the existing request before starting a new pass.";
        }
        store.db.prepare("INSERT OR REPLACE INTO lip_sync_jobs VALUES(?,?,?,?)").run(j.id,p.id,j.state,JSON.stringify(j));
      }
    }
    if (bundle.soundtrackRuns?.length) {
      store.db.exec(
        "CREATE TABLE IF NOT EXISTS soundtrack_runs(id TEXT PRIMARY KEY,projectId TEXT,episodeId TEXT,state TEXT,body TEXT NOT NULL)",
      );
      for (const r of bundle.soundtrackRuns) {
        r.projectId = p.id;
        for (const unit of r.units)
          if (unit.media) unit.media = store.media(unit.media.id) || unit.media;
        if (["queued", "processing"].includes(r.state)) {
          r.state = "failed";
          for (const unit of r.units)
            if (unit.state !== "ready") {
              unit.state = "failed";
              unit.error =
                r.executionMode === "live"
                  ? "Imported unfinished soundtrack. Recover existing provider requests before continuing; do not submit duplicates."
                  : "Imported unfinished sample. Retry to continue in Offline mode.";
            }
        }
        store.db
          .prepare("INSERT OR REPLACE INTO soundtrack_runs VALUES(?,?,?,?,?)")
          .run(r.id, p.id, r.episodeId, r.state, JSON.stringify(r));
      }
    }
    await enqueue(p.id);
    return { project: p, revision };
  }
  return { checkpoint: enqueue, open };
}
