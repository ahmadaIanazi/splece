import { useEffect, useRef, useState } from "react";
import { api } from "./state";
import {
  setupAssistantContext,
  simulateSetupDecision,
  validateSetupFacts,
} from "../shared/director-desk.mjs";

export function useDeskAssistant({
  project,
  assistant,
  update,
  onFacts,
  paused,
}) {
  const enabled =
    project.storyPlans?.[project.episodeId]?.setup?.directorDesk
      ?.autoDirection !== false && assistant?.status?.enabled === true;
  const [working, setWorking] = useState(false);
  const context = setupAssistantContext(project),
    fingerprint = JSON.stringify(context);
  const [notice, setNotice] = useState(""),
    [retry, setRetry] = useState(0);
  const last = useRef({});
  last.current = { project, assistant, update, onFacts, fingerprint, enabled };
  const tried = useRef(""),
    failed = useRef(null);
  const receipt = project.setupAssistantReview;
  const fresh =
    receipt?.fingerprint === fingerprint &&
    receipt.mode === assistant?.status?.mode;
  useEffect(() => {
    if (!enabled || paused) return;
    // Keep the existing stage while a new decision is pending. No provisional
    // whole-scene replacement on every keystroke.
    if (!fresh && project.storyPlans?.[project.episodeId]?.setup?.directorDesk?.sceneGraph?.nodes?.length) return;
    const timer = setTimeout(() => {
      if (!last.current.enabled || last.current.fingerprint !== fingerprint)
        return;
      last.current.onFacts(
        validateSetupFacts(
          fresh
            ? receipt.decision || { facts: receipt.facts }
            : simulateSetupDecision(context),
          context,
        ),
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [fingerprint, enabled, paused]);
  useEffect(() => {
    if (
      !enabled ||
      paused ||
      (!context.text.trim() && !context.lookText.trim()) ||
      !assistant?.status?.enabled ||
      assistant.status.writingSuggestions === false ||
      fresh
    )
      return;
    const attemptKey = fingerprint + ":" + retry + ":" + assistant.status.mode;
    if (tried.current === attemptKey) return;
    const abort = new AbortController();
    let cancelled = false,
      timer,
      waits = 0;
    const run = async () => {
      if (document.visibilityState !== "visible") return;
      tried.current = attemptKey;
      setWorking(true);
      setNotice("");
      try {
        await last.current.assistant.flush();
        if (
          cancelled ||
          !last.current.enabled ||
          fingerprint !== last.current.fingerprint
        )
          return;
        const answer = await api(
          `/projects/${project.id}/assistant-decisions`,
          {
            workspace: "setup",
            fingerprint,
            sessionId: last.current.assistant.sessionId,
            ...(failed.current?.fingerprint === fingerprint && retry
              ? { retryOf: failed.current.id }
              : {}),
          },
          "POST",
          { signal: abort.signal, timeoutMs: 35000 },
        );
        if (
          cancelled ||
          !last.current.enabled ||
          fingerprint !== last.current.fingerprint
        )
          return;
        if (
          ["busy", "running", "rate-limited", "stale"].includes(answer.state) &&
          waits++ < 5
        ) {
          timer = setTimeout(
            run,
            answer.state === "rate-limited" ? 10000 : 4000,
          );
          return;
        }
        if (answer.state !== "ready" && answer.state !== "applied") {
          failed.current = ["failed", "interrupted", "cancelled"].includes(
            answer.state,
          )
            ? { id: answer.id, fingerprint }
            : null;
          throw Error(
            answer.error ||
              "The Assistant is unavailable. You can still edit every detail.",
          );
        }
        last.current.onFacts(answer.decision);
        last.current.update(
          (p) => {
            p.setupAssistantReview = {
              fingerprint,
              mode: answer.executionMode,
              facts: answer.decision.facts,
              decision: answer.decision,
            };
          },
          false,
          false,
          "assistant",
        );
        setNotice("");
        failed.current = null;
      } catch (e) {
        if (!cancelled && !abort.signal.aborted) setNotice(e.message);
      } finally {
        if (!cancelled) setWorking(false);
      }
    };
    timer = setTimeout(run, retry ? 100 : 1800);
    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(timer);
      tried.current = "";
      setWorking(false);
    };
  }, [
    fingerprint,
    enabled,
    retry,
    paused,
    fresh,
    assistant?.status?.enabled,
    assistant?.status?.writingSuggestions,
    assistant?.status?.mode,
  ]);
  return { notice, working, check: () => setRetry((n) => n + 1), fresh };
}
