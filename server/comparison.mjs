import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { comparisonChoices } from "../shared/take-comparison.mjs";
import { run, probe } from "./media.mjs";

export async function renderComparison(sides, output) {
  const metadata = await Promise.all(sides.map((s) => probe(s.path)));
  const duration = Math.min(
    60,
    ...sides.map((s, i) => Math.min(s.duration, metadata[i].duration - s.in)),
  );
  if (!(duration > 0)) throw Error("Choose two completed clips.");
  const args = [],
    filters = [],
    audioIndexes = [];
  let index = 0;
  for (let i = 0; i < 2; i++) {
    const side = sides[i],
      info = metadata[i],
      v = index++;
    args.push(
      "-threads",
      "2",
      "-ss",
      String(side.in),
      "-t",
      String(duration),
      "-i",
      side.path,
    );
    filters.push(
      `[${v}:v]setpts=PTS-STARTPTS,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`,
    );
    let a = v;
    if (side.voicePath) {
      a = index++;
      args.push(
        "-ss",
        String(side.voice.in),
        "-t",
        String(duration),
        "-i",
        side.voicePath,
      );
    } else if (!info.audio) {
      a = index++;
      args.push(
        "-f",
        "lavfi",
        "-t",
        String(duration),
        "-i",
        "anullsrc=r=48000:cl=stereo",
      );
    }
    audioIndexes.push(a);
    filters.push(
      `[${a}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${duration}[a${i}]`,
    );
  }
  filters.push("[v0][v1]hstack=inputs=2[outv]");
  // One decoder owns all picture and sound. Channels 0/1 audition A; 2/3 audition B.
  filters.push(
    "[a0][a1]join=inputs=2:channel_layout=quad:map=0.0-FL|0.1-FR|1.0-BL|1.1-BR[outa]",
  );
  const partial = output + ".partial.mp4";
  try {
    await run([
      "-threads",
      "2",
      "-filter_complex_threads",
      "1",
      ...args,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[outv]",
      "-map",
      "[outa]",
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "384k",
      "-movflags",
      "+faststart",
      partial,
    ]);
    await fs.rename(partial, output);
  } finally {
    await fs.rm(partial, { force: true });
  }
  return { duration };
}
export function installComparisonRoutes(
  app,
  { store, data, render = renderComparison },
) {
  const root = path.join(data, "comparison-cache"),
    tasks = new Map();
  let chain = Promise.resolve();
  const file = (id) => path.join(root, id + ".mp4");
  const valid = (id) => /^[a-f0-9]{40}$/.test(id);
  async function prune() {
    const names = await fs.readdir(root),
      files = [];
    for (const n of names.filter((n) => /^[a-f0-9]{40}\.mp4$/.test(n))) {
      const f = path.join(root, n),
        s = await fs.stat(f);
      files.push({ f, ...s });
    }
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let bytes = files.reduce((n, s) => n + s.size, 0);
    for (const s of files)
      if (bytes > 512 * 1024 ** 2 && Date.now() - s.mtimeMs > 300000) {
        await fs.rm(s.f, { force: true });
        bytes -= s.size;
      }
  }
  app.post("/api/projects/:id/comparisons", async (req, res) => {
    const p = store.get(req.params.id)?.project;
    if (!p) return res.status(404).json({ error: "Project not found." });
    const choices = comparisonChoices(p);
    const sides = [req.body.a, req.body.b].map((key) =>
      choices.find((c) => c.key === key),
    );
    if (sides.some((s) => !s))
      return res.status(400).json({ error: "Choose two available takes." });
    for (const s of sides) {
      s.path = store.media(s.mediaId)?.path;
      if (!s.path) throw Error("Comparison source is unavailable.");
      if (s.voice) {
        s.voicePath = store.media(s.voice.mediaId)?.path;
        if (!s.voicePath) throw Error("The take’s voice is unavailable.");
      }
      const stat = await fs.stat(s.path);
      s.stamp = [stat.size, stat.mtimeMs];
    }
    const id = createHash("sha1").update(JSON.stringify(sides)).digest("hex");
    await fs.mkdir(root, { recursive: true });
    const present = await fs.stat(file(id)).catch(() => null);
    if (present)
      return res.json({
        id,
        state: "ready",
        url: `/api/comparisons/${id}/video`,
        duration: (await probe(file(id))).duration,
      });
    if (tasks.get(id)?.state === "failed") tasks.delete(id);
    if (!tasks.has(id)) {
      if (
        [...tasks.values()].filter((t) =>
          ["queued", "processing"].includes(t.state),
        ).length >= 4
      )
        return res
          .status(429)
          .json({ error: "Comparison previews are busy. Try again shortly." });
      for (const [key, t] of tasks)
        if (["ready", "failed"].includes(t.state)) tasks.delete(key);
      const task = { id, state: "queued" };
      tasks.set(id, task);
      chain = chain
        .catch(() => {})
        .then(async () => {
          task.state = "processing";
          try {
            Object.assign(task, await render(sides, file(id)), {
              state: "ready",
              url: `/api/comparisons/${id}/video`,
            });
            await prune();
          } catch (e) {
            task.state = "failed";
            task.error = e.message.slice(0, 400);
          }
        });
    }
    res.json(tasks.get(id));
  });
  app.get("/api/comparisons/:id", async (req, res) => {
    const id = req.params.id;
    if (!valid(id)) return res.sendStatus(404);
    const task = tasks.get(id);
    if (task) return res.json(task);
    const present = await fs.stat(file(id)).catch(() => null);
    if (!present)
      return res
        .status(404)
        .json({ error: "Preview expired. Choose the takes again." });
    res.json({
      id,
      state: "ready",
      url: `/api/comparisons/${id}/video`,
      duration: (await probe(file(id))).duration,
    });
  });
  app.get("/api/comparisons/:id/video", async (req, res) => {
    if (!valid(req.params.id)) return res.sendStatus(404);
    const f = file(req.params.id);
    await fs.utimes(f, new Date(), new Date()).catch(() => {});
    res.sendFile(f);
  });
}
