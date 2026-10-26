import { useEffect, useRef, useState } from "react";
import { api } from "./state";
import {
  pendingSketches,
  sceneAssetContext,
  mergeSketch,
} from "../shared/scene-graph.mjs";
import { assistantFingerprint } from "../shared/composer-assistant.mjs";

export function useSceneWorkers({ project, assistant, update, paused }) {
  const desk = project.storyPlans?.[project.episodeId]?.setup?.directorDesk;
  const mode = assistant?.status?.mode || "test";
  const enabled =
    !!assistant?.status?.enabled &&
    assistant.status.writingSuggestions !== false &&
    desk?.autoDirection !== false;
  const pending = pendingSketches(desk || {}, mode);
  const key = JSON.stringify([
    project.id,
    project.episodeId,
    mode,
    pending.map((t) => t.key),
  ]);
  const latest = useRef();
  latest.current = { project, assistant, update, enabled, mode };
  const [status, setStatus] = useState({}),
    [retry, setRetry] = useState(0),
    [cycle, setCycle] = useState(0);
  const failures = useRef(new Map());
  useEffect(() => {
    if (!enabled || paused || !pending.length) {
      setStatus({});
      return;
    }
    let cancelled = false,
      timer,
      waits = 0,
      running = false;
    const abort = new AbortController();
    const task = pending.find((t) => !failures.current.has(t.key));
    if (!task) {
      setStatus({
        error: "Some sketches need another try. Your scene is kept.",
      });
      return;
    }
    const run = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      setStatus({ working: true, label: task.label });
      try {
        await latest.current.assistant.flush();
        if (cancelled || !latest.current.enabled) return;
        const context = sceneAssetContext(
          latest.current.project,
          task.assetKey,
          task.view,
        );
        const failed = failures.current.get(`retry:${task.key}`);
        const response = await api(
          `/projects/${project.id}/assistant-decisions`,
          {
            workspace: "scene-asset",
            assetKey: task.assetKey,
            view: task.view,
            fingerprint: assistantFingerprint(context),
            sessionId: latest.current.assistant.sessionId,
            ...(failed?.id ? { retryOf: failed.id } : {}),
          },
          "POST",
          { signal: abort.signal, timeoutMs: 35000 },
        );
        if (
          cancelled ||
          !latest.current.enabled ||
          latest.current.mode !== mode
        )
          return;
        if (
          ["busy", "running", "rate-limited"].includes(response.state) &&
          waits++ < 12
        ) {
          timer = setTimeout(
            run,
            response.state === "rate-limited" ? 10000 : 2500,
          );
          return;
        }
        if (!["ready", "applied"].includes(response.state)) {
          failures.current.set(task.key, response);
          throw Error(
            response.error ||
              (response.state === "budget"
                ? "Assistant budget reached. Your scene is kept."
                : "This sketch is unavailable. Your scene is kept."),
          );
        }
        latest.current.update(
          (p) => {
            const current = p.storyPlans?.[p.episodeId]?.setup?.directorDesk;
            if (
              p.id === project.id &&
              p.episodeId === context.episodeId &&
              current?.autoDirection !== false
            )
              current.sceneGraph = mergeSketch(
                current.sceneGraph,
                task,
                response.decision,
                mode,
              );
          },
          false,
          false,
          "assistant",
        );
        failures.current.delete(`retry:${task.key}`);
        setStatus({});
      } catch (e) {
        if (!cancelled) {
          if (!failures.current.has(task.key))
            failures.current.set(task.key, {});
          setStatus({ error: e.message });
          if (failures.current.size > 128)
            failures.current.delete(failures.current.keys().next().value);
          setCycle((n) => n + 1);
        }
      } finally {
        running = false;
      }
    };
    timer = setTimeout(run, 1200);
    const visible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        timer = setTimeout(run, 1200);
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      abort.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [key, enabled, paused, retry, cycle]);
  return {
    ...status,
    pending: pending.length,
    mode,
    retry: () => {
      for (const task of pending) {
        const failed = failures.current.get(task.key);
        if (
          failed &&
          ["failed", "cancelled", "interrupted"].includes(failed.state)
        )
          failures.current.set(`retry:${task.key}`, failed);
        failures.current.delete(task.key);
      }
      setRetry((n) => n + 1);
    },
  };
}
