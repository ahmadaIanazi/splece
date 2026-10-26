// Keep the original provider request on disk for recovery/auditing. Timeline polling
// needs its prompt/settings/references, not megabytes of encoded image uploads.
export function jobView(job) {
  if (!job?.snapshot?.requestPayload) return job;
  const { requestPayload, ...snapshot } = job.snapshot;
  return { ...job, snapshot: { ...snapshot, requestPayloadStored: true } };
}
export const runnableStates = [
  "queued",
  "running",
  "download_pending",
  "retry_scheduled",
  "rate_limited",
  "unreachable",
];
