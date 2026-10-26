import { smartSignature } from "./smart.mjs";
import { normalizeWritingVariation } from "./writing-variation.mjs";

// The optimizer changes the submitted copy, never the working draft.
export function optimizedSubmissionDraft(
  project,
  draft,
  job,
  model,
  executionMode,
) {
  if (
    !job ||
    job.projectId !== project.id ||
    job.draftId !== draft.id ||
    job.state !== "ready" ||
    job.input?.operation !== "optimize-writing" ||
    job.input?.submissionOnly !== true
  )
    throw Error("The model adaptation is not ready. Nothing was submitted.");
  if (job.sourceSignature !== smartSignature(project, draft))
    throw Error(
      "The prompt or its context changed during adaptation. Hold Generate again for the current version.",
    );
  if (
    job.input.videoCapabilities.id !== model.id ||
    job.input.videoCapabilities.promptLimit !== model.promptLimit ||
    job.input.videoCapabilities.referenceMode !== model.referenceMode ||
    (job.config.mode === "demo" ? "test" : "live") !== executionMode
  )
    throw Error(
      "The model or mode changed. Prepare a fresh adaptation before generating.",
    );
  const result = normalizeWritingVariation(job.result, job.input);
  const copy = structuredClone(draft);
  delete copy.smartAccepted;
  // Locked manual final-text overrides are authoritative; do not pretend to adapt them.
  if (copy.sectionOverrides?.Scenes != null)
    throw Error(
      "Clear the manual Scenes override or turn off model adaptation before generating.",
    );
  for (const scene of copy.scenes)
    scene.text = result.scenes.find((s) => s.id === scene.id).text;
  copy.optimizationReceipt = {
    jobId: job.id,
    profile: job.input.optimization,
    usage: job.billing?.usage,
    estimate: job.billing?.estimate,
  };
  return copy;
}
