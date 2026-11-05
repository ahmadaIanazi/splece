import { hasComposerWriting } from "../shared/composer-sequence.mjs";
import { ProviderAction } from "./provider-connect";
import React, { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { api, uid } from "./state";
import { smartSignature } from "../shared/smart.mjs";
import { resolvePromptProfile } from "../shared/model-prompting.mjs";

const dollars = (v) => "$" + Number(v).toFixed(v && v < 0.01 ? 4 : 2);
export function usePromptOptimizer({
  project,
  draft,
  model,
  executionMode,
  flush,
}) {
  const [catalog, setCatalog] = useState(null),
    [estimate, setEstimate] = useState(null),
    [jobs, setJobs] = useState([]),
    [submitting, setSubmitting] = useState(false),
    [message, setMessage] = useState(""),
    [kick, setKick] = useState(0);
  const live = useRef(null),
    pending = useRef(false);
  live.current = { project, draft, model, flush };
  const requestKey =
    smartSignature(project, draft) +
    "|" +
    model?.catalogVersion +
    "|" +
    executionMode;
  const currentEstimate = estimate?.key === requestKey ? estimate.value : null;
  const latest = jobs
    .filter(
      (j) =>
        j.draftId === draft.id &&
        j.input?.operation === "optimize-writing" &&
        j.input?.submissionOnly,
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const busy = submitting || ["queued", "running"].includes(latest?.state);
  useEffect(() => {
    const refreshed = () => setKick((value) => value + 1);
    window.addEventListener("provider-catalog-updated", refreshed);
    return () => window.removeEventListener("provider-catalog-updated", refreshed);
  }, []);
  useEffect(() => {
    let alive = true;
    api("/optimizer-models")
      .then((v) => {
        if (alive) setCatalog(v);
      })
      .catch((e) => {
        if (alive) setMessage(e.message);
      });
    return () => {
      alive = false;
    };
  }, [project.id, kick]);
  useEffect(() => {
    let alive = true;
    if (
      !draft.optimizeOnGenerate ||
      !draft.scenes.some(hasComposerWriting) ||
      busy
    )
      return;
    const timer = setTimeout(async () => {
      try {
        const snapshot = live.current;
        await snapshot.flush();
        const value = await api(
          `/projects/${snapshot.project.id}/smart-estimate`,
          {
            draftId: snapshot.draft.id,
            textModel: snapshot.draft.optimizerModel,
          },
        );
        if (alive) {
          setEstimate({ key: requestKey, value });
          setMessage("");
        }
      } catch (e) {
        if (alive) {
          setEstimate(null);
          setMessage(e.message);
        }
      }
    }, 700);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project.id, requestKey, busy]);
  useEffect(() => {
    let alive = true,
      timer;
    async function poll() {
      if (!draft.optimizeOnGenerate) return;
      try {
        const value = await api(
          `/projects/${project.id}/smart-jobs?operation=optimize-writing`,
        );
        if (!alive) return;
        setJobs(value);
        if (value.some((j) => ["queued", "running"].includes(j.state)))
          timer = setTimeout(poll, 1200);
      } catch (e) {
        if (alive) {
          setMessage(e.message);
          timer = setTimeout(poll, 3000);
        }
      }
    }
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project.id, draft.id, draft.optimizeOnGenerate, kick]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function prepare() {
    if (pending.current || !currentEstimate?.canSubmit)
      throw Error(
        "Model adaptation is not ready. Check its connection and estimate.",
      );
    pending.current = true;
    setSubmitting(true);
    setMessage("");
    try {
      const snapshot = live.current;
      const revision = await snapshot.flush();
      const created = await api(`/projects/${snapshot.project.id}/smart-jobs`, {
        draftId: snapshot.draft.id,
        revision,
        requestId: uid(),
        operation: "optimize-writing",
        submissionOnly: true,
        textModel: currentEstimate.textModel,
        executionMode: currentEstimate.executionMode,
      });
      const deadline = Date.now() + 180000;
      while (mounted.current && Date.now() < deadline) {
        if (
          live.current.project.id !== snapshot.project.id ||
          live.current.draft.id !== snapshot.draft.id
        )
          throw Error(
            "Prompt changed. Adaptation is saved in history; no video was submitted.",
          );
        const list = await api(
          `/projects/${snapshot.project.id}/smart-jobs?operation=optimize-writing`,
        );
        if (!mounted.current || live.current.project.id !== snapshot.project.id || live.current.draft.id !== snapshot.draft.id)
          throw Error("Prompt changed. Adaptation remains saved; no video was submitted.");
        setJobs(list);
        const job = list.find((j) => j.id === created.id);
        if (job?.state === "ready") return job.id;
        if (["failed", "interrupted"].includes(job?.state))
          throw Error(
            job.error || "Model adaptation failed. No video was submitted.",
          );
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      throw Error(
        "Adaptation is saved in Jobs. No video was submitted; return to this prompt and try again when it is ready.",
      );
    } catch (e) {
      setMessage(e.message);
      throw e;
    } finally {
      pending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }
  return {
    prepare,
    busy,
    targetName: ["queued", "running"].includes(latest?.state)
      ? latest?.input?.optimization?.videoModelName
      : null,
    estimate: currentEstimate,
    catalog,
    receipt: latest?.billing
      ? { ...latest.billing, textModel: latest.billing.model }
      : draft.optimizationReceipt,
    error: message || (latest?.state === "failed" ? latest.error : ""),
    profile:
      (["queued", "running"].includes(latest?.state)
        ? latest.input.optimization
        : null) ||
      currentEstimate?.profile ||
      resolvePromptProfile(model),
    disabled:
      busy ||
      !currentEstimate?.canSubmit ||
      !draft.scenes.some(hasComposerWriting),
  };
}

export function OptimizerStatus({ optimizer, draft, modelName, change, feedbackOnly = false }) {
  const { estimate, busy, error, catalog, profile } = optimizer;
  if (feedbackOnly && !busy && !error && !(estimate && !estimate.canSubmit)) return null;
  return (
    <div className="prompt-optimizer">
      {busy ? (
        <div className="optimizer-progress" role="status">
          <Sparkles size={13} />
          <span>
            Adapting for {optimizer.targetName || modelName}…
            <small>Then video generation · original writing kept</small>
          </span>
        </div>
      ) : !feedbackOnly && (
        <details className="optimizer-options">
          <summary>
            Prompt optimization ·{" "}
            {estimate
              ? estimate.executionMode === "test"
                ? "Offline · free"
                : estimate.cost
                  ? `+ ${dollars(estimate.cost.min)}–${dollars(estimate.cost.max)} est.`
                  : "Price unavailable"
              : "Estimating…"}
          </summary>
          <p>
            Adapts the submitted copy. Your writing, dialogue, references and
            locked settings stay intact.
          </p>
          <label>
            Text model{" "}
            <select
              aria-label="Prompt optimizer text model"
              value={
                draft.optimizerModel ||
                estimate?.textModel ||
                catalog?.selected ||
                ""
              }
              onChange={(e) =>
                change((d) => {
                  d.optimizerModel = e.target.value;
                })
              }
            >
              {!(catalog?.models || []).length && (
                <option value={catalog?.selected || ""}>
                  {catalog?.selected || "Loading…"}
                </option>
              )}
              {(catalog?.models || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </label>
          <small>
            {profile?.name} · {estimate?.note}
          </small>
        </details>
      )}
      {error && (
        <p className="optimizer-error" role="alert">
          {error}
        </p>
      )}
      {!busy && estimate && !estimate.canSubmit && (
        <p className="optimizer-error">
          <ProviderAction provider="deepseek" feature="prompt optimization" returnLabel="Back to my prompt">
            Prompt adaptation is not ready. Refresh its estimate or turn Optimize off.
          </ProviderAction>
        </p>
      )}
    </div>
  );
}
