const finite = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
export function providerTiming(raw, now = Date.now()) {
  if (!raw) return null;
  const averageMs = raw.average_execution_time;
  const elapsedMs = raw.execution_duration;
  return finite(averageMs) && averageMs > 0 && finite(elapsedMs)
    ? { averageMs, elapsedMs, observedAt: now }
    : null;
}
export function jobProgress(job, now = Date.now()) {
  const labels = {
    queued: "Queued",
    preparing: "Preparing",
    submitting: "Submitting",
    running: "Generating",
    ready: "Ready",
    failed: "Failed",
    cancelled: "Cancelled",
    interrupted: "Needs attention",
    submission_uncertain: "Submission needs checking",
    unreachable: "Connection lost · retrying",
    rate_limited: "Provider busy · retrying",
    retry_scheduled: "Retry scheduled",
    download_pending: "Waiting for download",
    downloading: "Saving video",
    verifying: "Checking video",
    download_failed: "Download failed · retry transfer",
    rendering: "Rendering",
  };
  const terminal = [
    "ready",
    "failed",
    "cancelled",
    "interrupted",
    "submission_uncertain",
    "download_failed",
  ].includes(job.state);
  const stale =
    !terminal &&
    job.state === "running" &&
    (job.lastPolledAt || job.acceptedAt || job.createdAt) &&
    now - (job.lastPolledAt || job.acceptedAt || job.createdAt) > 90000;
  const timing = job.timing;
  const estimated =
    job.state === "running" &&
    !stale &&
    timing &&
    finite(timing.averageMs) &&
    timing.averageMs > 0 &&
    finite(timing.elapsedMs) &&
    finite(timing.observedAt);
  const elapsed = estimated
    ? timing.elapsedMs + Math.min(15000, Math.max(0, now - timing.observedAt))
    : 0;
  const remaining = estimated ? Math.max(0, timing.averageMs - elapsed) : null;
  return {
    label: stale ? "Status update delayed" : labels[job.state] || job.state,
    percent:
      job.state === "ready"
        ? 100
        : estimated
          ? Math.min(95, Math.round((elapsed / timing.averageMs) * 100))
          : null,
    detail: estimated
      ? remaining > 0
        ? `About ${Math.ceil(remaining / 1000)}s remaining · estimate`
        : "Taking longer than average · still processing"
      : job.state === "running"
        ? Number.isFinite(job.queuePosition)
          ? `Queue position ${job.queuePosition} · waiting for provider`
          : "Processing · duration estimate unavailable"
        : "",
    elapsedSeconds: Math.max(
      0,
      Math.floor(
        ((job.completedAt || (terminal ? job.updatedAt : now) || now) -
          job.createdAt) /
          1000,
      ),
    ),
    terminal,
  };
}
export function jobsForStory(jobs, beatId, episodeId) {
  return jobs.filter(
    (j) =>
      j.kind === "generation" &&
      j.snapshot?.draft?.storyBeatId === beatId &&
      j.snapshot?.draft?.episodeId === episodeId,
  );
}

// Detached terminal attempts are history, not new timeline events after deletion.
export function activeDetachedGenerations(jobs, project) {
  if (!project) return [];
  const clipIds = new Set(
    project.clips.flatMap((c) => [c.id, ...(c.generationTargets || [])]),
  );
  return jobs.filter(
    (j) =>
      j.kind === "generation" &&
      j.snapshot?.draft?.episodeId === project.episodeId &&
      !clipIds.has(j.snapshot?.targetId) &&
      !jobProgress(j).terminal,
  );
}
