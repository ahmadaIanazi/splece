import React, { useEffect, useState } from "react";
import { jobProgress } from "../shared/job-progress.mjs";
import { GenerationSurface } from "./generation-surface";
export function JobProgress({ job, compact = false, inline = false, surface, title, count }) {
  const [now, setNow] = useState(Date.now());
  const terminal = jobProgress(job).terminal;
  useEffect(() => {
    if (terminal) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [terminal]);
  const p = jobProgress(job, now);
  if (surface) return <GenerationSurface job={job} progress={p} surface={surface} title={title} count={count} />;
  return (
    <div
      className={
        "generation-progress " +
        (compact ? "compact " : "") +
        (inline ? "inline " : "") +
        job.state
      }
      title={job.error || p.detail}
    >
      <div className="generation-progress-heading">
        <strong>{p.label}</strong>
        <span>
          {p.percent !== null
            ? `${p.percent}${job.state === "ready" ? "%" : "% est."}`
            : `${p.elapsedSeconds}s`}
        </span>
      </div>
      <progress
        aria-label={`${job.snapshot?.draft?.name || "Video"}: ${p.label}`}
        max="100"
        {...(p.percent !== null
          ? { value: p.percent }
          : p.terminal
            ? { value: 0 }
            : {})}
      />
      {!inline && p.detail && <small>{p.detail}</small>}
      {!inline && job.error && (
        <small className="error">
          {job.error.includes("(402)")
            ? "Venice rejected payment (402). Check your Venice credits or billing before submitting again."
            : job.error}
        </small>
      )}
      {!compact && job.lastPolledAt && (
        <small>
          Last checked {new Date(job.lastPolledAt).toLocaleTimeString()}
        </small>
      )}
    </div>
  );
}
