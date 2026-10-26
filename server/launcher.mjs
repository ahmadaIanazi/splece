import { sourceVersion } from "../shared/source-version.mjs";

export function activeStudioJobs(db) {
  const terminal = new Set([
    "ready",
    "quoted",
    "failed",
    "cancelled",
    "interrupted",
    "applied",
    "dismissed",
    "submission_uncertain",
  ]);
  let count = 0;
  for (const table of ["jobs", "smart_jobs", "story_jobs", "soundtrack_runs", "lip_sync_jobs", "image_jobs", "photo_analyses", "asset_analyses"]) {
    if (
      !db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)
    )
      continue;
    for (const row of db.prepare(`SELECT body FROM ${table}`).all()) {
      if (!terminal.has(JSON.parse(row.body).state)) count++;
    }
  }
  return count;
}

// Installed before application routes. A restart is refused while either work
// or an API write is in flight; new writes cannot race an accepted shutdown.
export async function installLauncherControl(app, { store, root, data, stop }) {
  const version = await sourceVersion(root, "server"),
    startedAt = Date.now();
  let writes = 0,
    draining = false;
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.path !== "/launcher/stop"
    ) {
      if (draining)
        return res.status(503).json({
          error:
            "The local server is restarting. Your browser draft is preserved; please try again shortly.",
        });
      writes++;
      let finished = false;
      const done = () => {
        if (!finished) {
          finished = true;
          writes--;
        }
      };
      res.on("finish", done);
      res.on("close", done);
    }
    next();
  });
  app.get("/api/launcher/status", (_req, res) =>
    res.json({
      service: "frame-studio",
      root,
      data,
      pid: process.pid,
      startedAt,
      version,
      activeJobs: activeStudioJobs(store.db),
      activeWrites: writes,
      draining,
    }),
  );
  app.post("/api/launcher/stop", (req, res) => {
    if (req.body?.expectedPid !== process.pid)
      return res.status(409).json({
        error: "The server changed. Reopen the studio and try again.",
      });
    const count = activeStudioJobs(store.db);
    if (count || writes)
      return res.status(409).json({
        error: count
          ? `${count} job${count === 1 ? " is" : "s are"} still active. The server was left running.`
          : "The studio is saving or submitting work. Try again after it finishes.",
      });
    draining = true;
    res.once("finish", () => setImmediate(stop));
    res.json({ stopping: true });
  });
}
