import { spawn } from "node:child_process";

// Bounded output, cancellation and no shell interpolation, shared by install and local workers.
export function addonProcess(
  command,
  args,
  { env, cwd, signal, input, timeout = 1800000, onProgress } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error("Cancelled"));
    const child = spawn(command, args, {
      env: env || process.env,
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "",
      stderr = "",
      stopped = "";
    const stop = (reason) => {
      stopped = reason;
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 2000);
      force.unref();
    };
    const abort = () => stop("Cancelled");
    const timer = setTimeout(
      () => stop("This operation took too long. Try a shorter recording."),
      timeout,
    );
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    child.stdout.on("data", (b) => {
      stdout += b;
      if (stdout.length > 4000000)
        stop("The analysis returned too much data. Try a shorter recording.");
    });
    child.stderr.on("data", (b) => {
      stderr = (stderr + b).slice(-4000);
      onProgress?.(String(b));
    });
    child.on("error", (e) => {
      cleanup();
      reject(e);
    });
    child.on("close", (code) => {
      cleanup();
      code === 0 && !stopped
        ? resolve(stdout)
        : reject(
            Error(
              stopped ||
                stderr.trim() ||
                `${command} could not finish (${code}).`,
            ),
          );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input || "");
  });
}
