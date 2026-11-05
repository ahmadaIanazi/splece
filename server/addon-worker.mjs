import { spawn } from "node:child_process";

// A single warm model process, serialized requests, released after five idle minutes.
// Closing stdin on server exit also makes the Python loop exit; it is never daemonized.
export function createAddonWorker(command, args, env) {
  let child,
    pending,
    buffer = "",
    stderr = "",
    idle,
    chain = Promise.resolve();
  function close() {
    clearTimeout(idle);
    const old = child;
    child = null;
    if (old) {
      old.stdin.end();
      old.kill();
      const timer = setTimeout(() => old.kill("SIGKILL"), 2000);
      timer.unref();
    }
  }
  function start() {
    if (child) return;
    buffer = "";
    stderr = "";
    const process = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child = process;
    const failed = (error) => {
      if (child !== process) return;
      child = null;
      const p = pending;
      pending = null;
      p?.reject(error);
    };
    process.on("error", failed);
    process.on("close", () =>
      failed(Error(stderr.trim() || "The local engine stopped. Try again.")),
    );
    process.stderr.on("data", (b) => {
      stderr = (stderr + b).slice(-4000);
    });
    process.stdin.on("error", failed);
    process.stdout.on("data", (b) => {
      if (child !== process) return;
      buffer += b;
      if (buffer.length > 4000000) {
        failed(Error("The analysis returned too much data."));
        process.kill();
        return;
      }
      const at = buffer.indexOf("\n");
      if (at < 0 || !pending) return;
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      const request = pending;
      pending = null;
      try {
        const value = JSON.parse(line);
        value.error
          ? request.reject(Error(value.error))
          : request.resolve(value.result);
      } catch {
        request.reject(
          Error("The local engine returned an unreadable result."),
        );
        close();
      }
    });
  }
  return {
    close,
    request(body, { signal, timeout = 1800000 } = {}) {
      const task = chain
        .catch(() => {})
        .then(async () => {
          if (signal?.aborted) throw Error("Cancelled");
          clearTimeout(idle);
          start();
          let timer, abort;
          try {
            return await new Promise((resolve, reject) => {
              pending = { resolve, reject };
              abort = () => {
                pending = null;
                close();
                reject(Error("Cancelled"));
              };
              signal?.addEventListener("abort", abort, { once: true });
              timer = setTimeout(() => {
                pending = null;
                close();
                reject(
                  Error(
                    "Local analysis took too long. Try a shorter recording.",
                  ),
                );
              }, timeout);
              child.stdin.write(JSON.stringify(body) + "\n");
            });
          } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            idle = setTimeout(close, 300000);
            idle.unref();
          }
        });
      chain = task;
      return task;
    },
  };
}
