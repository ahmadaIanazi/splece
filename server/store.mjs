import {validateMediaVisual} from "../shared/media-animation.mjs";
import {validateElements} from "../shared/elements.mjs";
import { validateDirectionRanges } from "../shared/timeline-direction.mjs";
import { jobView, runnableStates } from "./job-view.mjs";
import { DatabaseSync } from "node:sqlite";
export function openStore(file, resolveSettings) {
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS history(projectId TEXT,revision INTEGER,body TEXT,at TEXT,PRIMARY KEY(projectId,revision));
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,projectId TEXT,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,projectId TEXT,path TEXT NOT NULL,body TEXT NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS job_views(
    id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    projectId TEXT, state TEXT, body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS job_views_state ON job_views(state);
    CREATE INDEX IF NOT EXISTS job_views_project ON job_views(projectId);`);
  const writeView = db.prepare(
    "INSERT OR REPLACE INTO job_views VALUES(?,?,?,?)",
  );
  // Backfill once. Historical full receipts are never rewritten or discarded.
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of db
      .prepare(
        "SELECT j.body FROM jobs j LEFT JOIN job_views v ON j.id=v.id WHERE v.id IS NULL",
      )
      .iterate()) {
      const j = JSON.parse(row.body);
      writeView.run(
        j.id,
        j.projectId,
        j.state || "unknown",
        JSON.stringify(jobView(j)),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const removing = new Set();
  return {
    db,
    removing,
    list: () =>
      db
        .prepare(
          "SELECT id,revision,body,updated FROM projects ORDER BY updated DESC",
        )
        .all()
        .map((r) => ({
          id: r.id,
          name: JSON.parse(r.body).name,
          revision: r.revision,
          updated: r.updated,
        })),
    get(id) {
      const r = db.prepare("SELECT * FROM projects WHERE id=?").get(id);
      if (!r) return null;
      const project = JSON.parse(r.body);
      if (resolveSettings && project.settings)
        project.settings = resolveSettings(project.settings);
      return { project, revision: r.revision };
    },
    save(project, revision) {
      validateDirectionRanges(project.directionRanges);
      validateElements(project.elements);
      for(const c of project.clips || []) if(c.visual) validateMediaVisual(c.visual);
      if (removing.has(project.id))
        throw Error("This project is being removed. Changes were not saved.");
      db.exec("BEGIN IMMEDIATE");
      try {
        const old = db
          .prepare("SELECT revision FROM projects WHERE id=?")
          .get(project.id);
        if (old && old.revision !== revision) {
          const e = new Error(
            "This project changed in another window. Your local draft is preserved.",
          );
          e.status = 409;
          throw e;
        }
        const next = (old?.revision || 0) + 1;
        const body = JSON.stringify(project),
          now = new Date().toISOString();
        db.prepare("INSERT OR REPLACE INTO projects VALUES(?,?,?,?)").run(
          project.id,
          next,
          body,
          now,
        );
        db.prepare("INSERT INTO history VALUES(?,?,?,?)").run(
          project.id,
          next,
          body,
          now,
        );
        db.exec("COMMIT");
        return next;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    jobs(projectId) {
      return db
        .prepare("SELECT body FROM jobs WHERE projectId=?")
        .all(projectId)
        .map((r) => JSON.parse(r.body));
    },
    jobViews(projectId, runnableOnly = false) {
      const where = [
        projectId ? "projectId=?" : "",
        runnableOnly
          ? `state IN (${runnableStates.map(() => "?").join(",")})`
          : "",
      ].filter(Boolean);
      return db
        .prepare(
          "SELECT body FROM job_views" +
            (where.length ? " WHERE " + where.join(" AND ") : ""),
        )
        .all(
          ...(projectId ? [projectId] : []),
          ...(runnableOnly ? runnableStates : []),
        )
        .map((r) => JSON.parse(r.body));
    },
    allJobs() {
      return db
        .prepare("SELECT body FROM jobs")
        .all()
        .map((r) => JSON.parse(r.body));
    },
    job(id) {
      const r = db.prepare("SELECT body FROM jobs WHERE id=?").get(id);
      return r ? JSON.parse(r.body) : null;
    },
    putJob(j) {
      if (removing.has(j.projectId))
        throw Error("This project is being removed. No job was submitted.");
      db.exec("SAVEPOINT put_job");
      try {
        db.prepare("INSERT OR REPLACE INTO jobs VALUES(?,?,?)").run(
          j.id,
          j.projectId,
          JSON.stringify(j),
        );
        writeView.run(
          j.id,
          j.projectId,
          j.state || "unknown",
          JSON.stringify(jobView(j)),
        );
        db.exec("RELEASE put_job");
      } catch (error) {
        db.exec("ROLLBACK TO put_job");
        db.exec("RELEASE put_job");
        throw error;
      }
    },
    putMedia(m) {
      db.prepare("INSERT OR REPLACE INTO media VALUES(?,?,?,?)").run(
        m.id,
        m.projectId,
        m.path,
        JSON.stringify(m),
      );
    },
    media(id) {
      const r = db.prepare("SELECT body FROM media WHERE id=?").get(id);
      return r ? JSON.parse(r.body) : null;
    },
  };
}
