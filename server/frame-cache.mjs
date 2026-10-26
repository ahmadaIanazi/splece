import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { thumbnail } from "./media.mjs";

// Never expose a JPEG while FFmpeg is still writing it. Identical requests share
// the same task, including requests using differently formatted timestamps.
export function createFrameCache(render = thumbnail, concurrency = 3) {
  const tasks = new Map(),
    queue = [];
  let active = 0;
  const bounded = async (fn) => {
    if (active >= concurrency)
      await new Promise((resolve) => queue.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      if (queue.length) queue.shift()();
      else active--;
    }
  };
  return (source, out, time) => {
    if (tasks.has(out)) return tasks.get(out);
    const task = (async () => {
      try {
        if ((await fs.stat(out)).size > 4) return out;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return bounded(async () => {
        const partial = out + "." + randomUUID() + ".partial.jpg";
        try {
          await render(source, partial, time);
          const data = await fs.readFile(partial);
          if (
            data.length < 4 ||
            data[0] !== 255 ||
            data[1] !== 216 ||
            data.at(-2) !== 255 ||
            data.at(-1) !== 217
          )
            throw Error("Frame capture did not produce a complete image.");
          await fs.rename(partial, out);
          return out;
        } finally {
          await fs.rm(partial, { force: true }).catch(() => {});
        }
      });
    })().finally(() => tasks.delete(out));
    tasks.set(out, task);
    return task;
  };
}
