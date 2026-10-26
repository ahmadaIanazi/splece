import React, { useEffect, useMemo, useRef, useState } from "react";
import { ConnectProviderButton, useProviderConnection } from "./provider-connect";
import {
  Sparkles,
  Plus,
  X,
  LoaderCircle,
  Check,
  ArrowUpRight,
  RotateCcw,
} from "lucide-react";
import { api } from "./state";
import {
  structureAssistantContext,
  structureReviewKey,
  saveStructureReview,
  resolveStructureSuggestion,
} from "../shared/structure-context.mjs";
import "./structure-onboarding.css";

export function StructureAssistant({
  project,
  nodeId,
  assistant,
  update,
  paused = false,
  onOpenAsset,
}) {
  const { needsConnection } = useProviderConnection("deepseek", assistant?.status?.mode);
  const context = useMemo(
    () => structureAssistantContext(project, nodeId),
    [project, nodeId],
  );
  const fingerprint = JSON.stringify(context);
  const review =
    project.structureAssistantReviews?.[structureReviewKey(project, nodeId)];
  const fresh =
    review?.fingerprint === fingerprint &&
    review.mode === assistant?.status?.mode;
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState(null),
    [attempt, setAttempt] = useState(null);
  const latest = useRef();
  latest.current = { project, context, fingerprint, update, assistant };
  const enabled =
    assistant?.status?.enabled &&
    assistant?.status?.writingSuggestions !== false;
  useEffect(() => {
    if (!enabled || needsConnection || paused || !context?.text?.trim() || fresh) return;
    let cancelled = false,
      timer;
    const abort = new AbortController();
    let waiting = 0;
    const run = async () => {
      if (document.visibilityState !== "visible") return;
      setBusy(true);
      setFeedback(null);
      try {
        await latest.current.assistant.flush();
        if (cancelled || latest.current.fingerprint !== fingerprint) return;
        const answer = await api(
          `/projects/${project.id}/assistant-decisions`,
          {
            workspace: "structure",
            sceneId: nodeId || null,
            fingerprint,
            sessionId: latest.current.assistant.sessionId,
            ...(attempt?.fingerprint === fingerprint && attempt.retryOf
              ? { retryOf: attempt.retryOf }
              : {}),
          },
          "POST",
          { signal: abort.signal, timeoutMs: 35000 },
        );
        if (cancelled || latest.current.fingerprint !== fingerprint) return;
        if (["ready", "applied"].includes(answer.state)) {
          latest.current.update(
            (p) => {
              saveStructureReview(p, context, answer);
            },
            false,
            false,
            "assistant",
          );
        } else if (
          ["busy", "running", "rate-limited", "stale"].includes(answer.state) &&
          waiting++ < 8
        ) {
          setFeedback({
            fingerprint,
            message: "Waiting for the current check to finish…",
          });
          timer = setTimeout(
            run,
            answer.state === "rate-limited" ? 10000 : 4000,
          );
        } else {
          setFeedback({
            fingerprint,
            error: true,
            retryOf: ["failed", "interrupted", "cancelled"].includes(
              answer.state,
            )
              ? answer.id
              : null,
            message:
              answer.error ||
              "The Assistant couldn’t finish this check. Your story is saved; you can try again.",
          });
        }
      } catch (e) {
        if (!cancelled && !abort.signal.aborted)
          setFeedback({ fingerprint, error: true, message: e.message });
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        timer = setTimeout(run, 1200);
      }
    };
    timer = setTimeout(run, attempt?.fingerprint === fingerprint ? 0 : 2200);
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      setBusy(false);
    };
  }, [
    enabled,
    needsConnection,
    paused,
    fingerprint,
    fresh,
    attempt,
    assistant?.status?.epoch,
    assistant?.status?.mode,
  ]);

  const notice = feedback?.fingerprint === fingerprint ? feedback : null;
  const items = fresh
    ? review.items.filter((item) => item.status !== "dismissed")
    : [];
  const resolve = (item, dismiss) => {
    try {
      update((p) => {
        resolveStructureSuggestion(p, nodeId, item.id, dismiss);
      });
    } catch (e) {
      setFeedback({ fingerprint, error: true, message: e.message });
    }
  };
  return (
    <section
      className="structure-assistant story-assistant"
      aria-label="Story Assistant"
      aria-busy={busy}
    >
      <header>
        <Sparkles aria-hidden="true" size={17} />
        <div>
          <b>Story Assistant</b>
          <small>
            {paused
              ? "Ready when your outline finishes"
              : "Ideas you choose. Your writing stays yours."}
          </small>
        </div>
        {needsConnection ? <ConnectProviderButton provider="deepseek" feature="story suggestions" returnLabel="Back to my story" /> : busy ? (
          <LoaderCircle
            aria-hidden="true"
            size={17}
            className="structure-spin"
          />
        ) : !enabled ? (
          <button
            type="button"
            onClick={() =>
              assistant?.configure({ enabled: true, writingSuggestions: true })
            }
          >
            Enable
          </button>
        ) : (
          <button
            type="button"
            disabled={paused || !context.text.trim() || !!fresh}
            onClick={() =>
              setAttempt({
                fingerprint,
                retryOf: notice?.retryOf,
                nonce: Date.now(),
              })
            }
          >
            {fresh ? (
              <Check aria-hidden="true" size={14} />
            ) : (
              <RotateCcw aria-hidden="true" size={14} />
            )}
            {fresh ? "Checked" : notice?.error ? "Try again" : "Check story"}
          </button>
        )}
      </header>
      <div role="status" className="story-assistant-status">
        {!enabled
          ? "Enable to suggest characters, places and story connections."
          : busy
            ? "Finding useful additions to your story…"
            : notice?.message ||
              (fresh && !items.some((i) => i.status === "pending")
                ? "All caught up. Keep writing; I’ll check new ideas as you go."
                : !context.text.trim()
                  ? "Write a little about your idea to get started."
                  : "")}
      </div>
      {!!items.length && (
        <div className="story-suggestion-grid">
          {items.map((item) => (
            <article key={item.id} data-accepted={item.status === "accepted"}>
              <div>
                <small>{item.kind === "location" ? "Place" : item.kind}</small>
                <strong>{item.name || "Story connection"}</strong>
                <p>{item.message}</p>
              </div>
              <footer>
                {item.status === "accepted" ? (
                  <>
                    <span className="story-suggestion-saved">
                      <Check aria-hidden="true" size={14} />
                      Saved to{" "}
                      {item.kind === "connection"
                        ? "story notes"
                        : "story world"}
                    </span>
                    {item.assetId && (
                      <button
                        type="button"
                        onClick={() => onOpenAsset?.(item.assetId)}
                      >
                        Open {item.kind === "location" ? "place" : item.kind}
                        <ArrowUpRight aria-hidden="true" size={14} />
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-label={`Add ${item.name || "connection note"}`}
                      onClick={() => resolve(item, false)}
                    >
                      <Plus aria-hidden="true" size={14} />
                      {item.kind === "connection"
                        ? "Keep note"
                        : item.assetId
                          ? "Use in story"
                          : `Create ${item.kind === "location" ? "place" : item.kind}`}
                    </button>
                    <button
                      type="button"
                      className="icon"
                      aria-label={`Dismiss ${item.name || "connection note"}`}
                      onClick={() => resolve(item, true)}
                    >
                      <X aria-hidden="true" size={14} />
                    </button>
                  </>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
