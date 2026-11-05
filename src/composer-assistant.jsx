import { chooseLook } from "../shared/look-selection.mjs";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ConnectProviderButton, useProviderConnection } from "./provider-connect";
import { Sparkles, ChevronDown, X, RotateCcw, Plus } from "lucide-react";
import { api, uid } from "./state";
import {
  assistantContext,
  assistantFingerprint,
  applyAssistantDecision,
  appearanceOwner,
  acceptAssistantCompletion,
} from "../shared/composer-assistant.mjs";
import "./composer-assistant.css";

export function useComposerAssistant({
  project,
  draft,
  sceneId,
  model,
  visible,
  flush,
  update,
}) {
  const [status, setStatus] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const { needsConnection } = useProviderConnection("deepseek", status?.mode,"assistant");
  const session = useRef(null);
  if (!session.current) {
    try {
      session.current =
        sessionStorage.getItem("splece-assistant-session") || uid();
      sessionStorage.setItem("splece-assistant-session", session.current);
    } catch {
      session.current = uid();
    }
  }
  const live = useRef({}),
    running = useRef(false),
    generation = useRef(0),
    seen = useRef(new Set()),
    changed = useRef(Date.now()),
    lastRun = useRef(0),
    pointer = useRef(false),
    channel = useRef(null),
    requestAbort = useRef(null);
  const context = useMemo(() => {
    try {
      return assistantContext(project, draft, sceneId, model, status || {});
    } catch {
      return null;
    }
  }, [
    project,
    draft,
    sceneId,
    model,
    status?.creativeDecisions,
    status?.writingSuggestions,
  ]);
  const fingerprint = useMemo(() => assistantFingerprint(context), [context]);
  live.current = {
    project,
    draft,
    model,
    context,
    fingerprint,
    visible,
    flush,
    update,
    status,
    needsConnection,
  };
  const refresh = async () => {
    const value = await api(
      `/composer-assistant?sessionId=${encodeURIComponent(session.current)}&projectId=${encodeURIComponent(live.current.project?.id || "")}`,
    );
    setStatus((previous) => (previous?.epoch > value.epoch ? previous : value));
    return value;
  };
  useEffect(() => {
    changed.current = Date.now();
  }, [fingerprint]);
  useEffect(() => {
    let alive = true;
    const read = () => refresh().catch(() => {});
    read();
    const timer = setInterval(() => {
      if (alive && document.visibilityState === "visible") read();
    }, 4000);
    const focus = () => read(),
      down = () => {
        pointer.current = true;
      },
      up = () => {
        pointer.current = false;
        changed.current = Date.now();
      };
    window.addEventListener("focus", focus);
    window.addEventListener("studio-mode-changed", focus);
    window.addEventListener("provider-catalog-updated", focus);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    const bc =
      typeof BroadcastChannel === "function"
        ? new BroadcastChannel("splece-composer-assistant")
        : null;
    channel.current = bc;
    if (bc)
      bc.onmessage = (e) => {
        if (e.data?.type === "settings") {
          setStatus((s) =>
            s?.epoch > e.data.value.epoch ? s : { ...s, ...e.data.value },
          );
          generation.current++;
          if (!e.data.value.enabled) requestAbort.current?.abort();
        }
      };
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("studio-mode-changed", focus);
      window.removeEventListener("provider-catalog-updated", focus);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      bc?.close();
      generation.current++;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    if (!status?.enabled) requestAbort.current?.abort();
  }, [project?.id, draft?.id, visible, status?.enabled, status?.epoch]);
  useEffect(() => {
    const timer = setInterval(async () => {
      const v = live.current,
        now = Date.now(),
        key = `${v.status?.epoch}:${v.status?.mode}:${v.fingerprint}`;
      if (
        !v.status?.enabled ||
        v.needsConnection ||
        !v.visible ||
        document.visibilityState !== "visible" ||
        pointer.current ||
        running.current ||
        !v.context ||
        (!v.context.text.trim() &&
          !v.context.adjacent.some((s) => s.text) &&
          !v.context.structure.length &&
          !v.context.neighbors.before) ||
        !v.model ||
        seen.current.has(key) ||
        v.context.suppress.includes(v.fingerprint)
      )
        return;
      if (
        now - changed.current < 1500 &&
        !(now - lastRun.current >= 10000 && /[.!?\n]\s*$/.test(v.context.text))
      )
        return;
      running.current = true;
      setBusy(true);
      lastRun.current = now;
      setMessage("");
      const stamp = generation.current,
        controller = new AbortController();
      requestAbort.current = controller;
      const valid = () =>
        generation.current === stamp &&
        live.current.visible &&
        live.current.status?.enabled &&
        live.current.fingerprint === v.fingerprint &&
        !pointer.current &&
        document.visibilityState === "visible";
      let receipt;
      try {
        await v.flush();
        if (!valid()) return;
        receipt = await api(
          `/projects/${v.project.id}/assistant-decisions`,
          {
            draftId: v.draft.id,
            sceneId: v.context.sceneId,
            fingerprint: v.fingerprint,
            sessionId: session.current,
          },
          "POST",
          { signal: controller.signal, timeoutMs: 35000 },
        );
        if (["busy", "running", "rate-limited"].includes(receipt.state)) {
          changed.current = Date.now() + 4000;
          return;
        }
        seen.current.add(key);
        if (seen.current.size > 100)
          seen.current.delete(seen.current.values().next().value);
        if (!["ready", "applied"].includes(receipt.state)) {
          if (valid()) setMessage(receipt.error || "");
          return;
        }
        if (!valid()) {
          await api(`/composer-assistant/${receipt.id}/discard`, {});
          return;
        }
        const accepted = await api(
          `/composer-assistant/${receipt.id}/accept`,
          {},
        );
        if (accepted.state !== "applied" || !valid()) {
          await api(`/composer-assistant/${receipt.id}/discard`, {});
          return;
        }
        const preview = structuredClone(live.current.project);
        const changes = applyAssistantDecision(
          preview,
          v.draft.id,
          v.context,
          accepted.decision,
          receipt.id,
        );
        // A single undo entry for the whole decision. Check against latest state in the reducer, too.
        live.current.update(
          (next) => {
            if (generation.current !== stamp || !live.current.visible) return;
            applyAssistantDecision(
              next,
              v.draft.id,
              v.context,
              accepted.decision,
              receipt.id,
            );
          },
          changes,
          false,
          "assistant",
        );
        await live.current.flush();
      } catch (error) {
        if (!controller.signal.aborted && valid()) {
          seen.current.add(key);
          setMessage(error.message);
        }
      } finally {
        running.current = false;
        setBusy(false);
        requestAbort.current = null;
        refresh().catch(() => {});
      }
    }, 300);
    return () => clearInterval(timer);
  }, []);
  const configure = async (patch) => {
    generation.current++;
    if (patch.enabled === false) requestAbort.current?.abort();
    try {
      const value = await api("/composer-assistant", patch, "PUT");
      setStatus((s) => (s?.epoch > value.epoch ? s : { ...s, ...value }));
      channel.current?.postMessage({ type: "settings", value });
      setMessage("");
      await refresh();
    } catch (e) {
      setMessage(e.message);
    }
  };
  return {
    sessionId: session.current,
    status,
    busy,
    message,
    configure,
    context,
    last: draft?.assistant?.last,
    suggestion:
      status?.enabled &&
      status?.writingSuggestions !== false &&
      draft?.assistant?.last?.fingerprint === fingerprint &&
      !draft?.assistant?.last?.dismissed
        ? draft.assistant.last.completion
        : null,
    acceptSuggestion() {
      const v = live.current,
        receipt = v.draft?.assistant?.last?.receiptId;
      update((p) =>
        acceptAssistantCompletion(p, v.draft.id, v.context, receipt),
      );
    },
    dismissSuggestion() {
      const receipt = live.current.draft?.assistant?.last?.receiptId;
      update(
        (p) => {
          const d = p.drafts.find((d) => d.id === live.current.draft.id);
          if (d?.assistant?.last?.receiptId === receipt)
            d.assistant.last.dismissed = true;
        },
        false,
        false,
        "assistant",
      );
    },
    freeze() {
      generation.current++;
      seen.current.add(`${status?.epoch}:${status?.mode}:${fingerprint}`);
    },
    resetAppearance(id) {
      update((p) => {
        const d = p.drafts.find((d) => d.id === draft.id);
        chooseLook(d, id, "auto");
      });
    },
  };
}
const money = (value) => `$${Number(value || 0).toFixed(4)}`;
export function AssistantHeader({ assistant }) {
  const [open, setOpen] = useState(false),
    s = assistant.status;
  const { needsConnection } = useProviderConnection("deepseek", s?.mode,"assistant");
  if (!s) return null;
  return (
    <div className="composer-assistant-control">
      {needsConnection ? <ConnectProviderButton lane="assistant" provider="deepseek" feature="the Assistant" returnLabel="Back to my work" /> : <button
        className="assistant-switch"
        role="switch"
        aria-label="Assistant"
        aria-checked={s.enabled}
        title="AI director · decisions and writing suggestions"
        onClick={() => assistant.configure({ enabled: !s.enabled })}
      >
        <span>Assistant</span>
        <i aria-hidden="true" />
      </button>}
      <button
        className="assistant-details-button"
        aria-label="Assistant settings and usage"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={12} />
        {assistant.last?.issues?.length > 0 && <b />}
      </button>
      {open && (
        <section
          className="assistant-popover"
          aria-label="AI Assistant settings"
        >
          <header>
            <strong>Splece Assistant</strong>
            <button
              aria-label="Close assistant settings"
              onClick={() => setOpen(false)}
            >
              <X size={15} />
            </button>
          </header>
          <p>
            {assistant.busy
              ? "Following your writing…"
              : s.enabled
                ? "Following writing · manual choices stay yours"
                : "Off · your settings are kept"}
          </p>
          <small>
            {s.mode === "test"
              ? "Offline · local simulation, no credits"
              : "DeepSeek Flash · direction & writing suggestions"}
          </small>
          <div className="assistant-preferences">
            {[
              ["creativeDecisions", "Choose camera from the action"],
              ["writingSuggestions", "Suggest what comes next"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <button
                  role="switch"
                  aria-label={label}
                  aria-checked={s[key] !== false}
                  onClick={() =>
                    assistant.configure({ [key]: s[key] === false })
                  }
                >
                  <i />
                </button>
              </label>
            ))}
          </div>
          <div className="assistant-costs">
            <span>
              Session <strong>{money(s.session?.estimated)}</strong>
            </span>
            <span>
              Today (UTC) <strong>{money(s.today?.estimated)}</strong>
            </span>
          </div>
          {!!s.today?.held && (
            <p>
              {money(s.today.held)} reserved / usage unknown · {s.today.unknown}{" "}
              request(s). Included in budget.
            </p>
          )}
          <label>
            Daily limit{" "}
            <span>
              ${" "}
              <input
                aria-label="Daily assistant budget"
                key={s.budget}
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue={s.budget}
                onBlur={(e) => {
                  if (
                    Number.isFinite(e.target.valueAsNumber) &&
                    e.target.valueAsNumber !== s.budget
                  )
                    assistant.configure({ budget: e.target.valueAsNumber });
                }}
              />
            </span>
          </label>
          <small>
            Costs are token estimates, separate from Optimize, story, and video.
          </small>
          {assistant.message && (
            <p className="assistant-notice">{assistant.message}</p>
          )}
          {!!assistant.context?.candidates.length && (
            <details>
              <summary>Character appearances</summary>
              {assistant.context.candidates.map((a) => (
                <div className="assistant-appearance" key={a.id}>
                  <span>
                    {a.name}
                    <small>
                      {a.owner === "manual"
                        ? "Pinned manually"
                        : "Following writing"}
                    </small>
                  </span>
                  {a.owner === "manual" && (
                    <button
                      aria-label={`Follow writing for ${a.name}`}
                      title="Allow appearance decisions from your writing"
                      onClick={() => assistant.resetAppearance(a.id)}
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                </div>
              ))}
            </details>
          )}
          <details open={!!assistant.last?.issues?.length}>
            <summary>Recent checks & changes</summary>
            {(assistant.last?.changes || []).map((c, i) => (
              <p key={i}>{c}</p>
            ))}
            {(assistant.last?.issues || []).map((issue, i) => (
              <p key={"issue" + i}>
                <strong>Check {issue.kind}</strong> · {issue.message}
                <small>
                  From writing: “{issue.evidence}” · not visual verification
                </small>
              </p>
            ))}
            {(s.recent || []).slice(0, 4).map((r) => (
              <small key={r.id}>
                {r.state} ·{" "}
                {r.amount == null ? "usage unknown" : money(r.amount)}
                {r.error ? ` · ${r.error}` : ""}
              </small>
            ))}
          </details>
        </section>
      )}
    </div>
  );
}

export function AssistantWritingHelp({ assistant, scene }) {
  const last = assistant?.last;
  const active = assistant?.context?.sceneId === scene.id;
  const [recent, setRecent] = useState(false);
  useEffect(() => {
    const fresh = last?.sceneId === scene.id && Date.now() - last.at < 6000;
    setRecent(fresh);
    if (!fresh) return;
    const timer = setTimeout(
      () => setRecent(false),
      Math.max(0, 6000 - (Date.now() - last.at)),
    );
    return () => clearTimeout(timer);
  }, [last?.receiptId, scene.id]);
  if (!assistant?.status?.enabled || !active) return null;
  return (
    <div className="assistant-writing-help">
      {(assistant.busy || (recent && last?.changes?.length > 0)) && (
        <span className="assistant-control-update" role="status">
          <Sparkles
            size={11}
            className={assistant.busy ? "assistant-busy" : ""}
          />
          {assistant.busy ? "Reading this moment…" : last.changes.join(" · ")}
        </span>
      )}
      {assistant.suggestion && !assistant.busy && (
        <div className="assistant-completion" aria-label="Writing suggestion">
          <p>{assistant.suggestion.text}</p>
          <div>
            <small title={assistant.suggestion.reason}>
              {assistant.status.mode === "test"
                ? "Offline suggestion"
                : "Suggested next beat"}
            </small>
            <button
              type="button"
              onClick={assistant.acceptSuggestion}
              aria-label="Accept writing suggestion"
              title={assistant.suggestion.reason}
            >
              <Plus size={12} /> Add
            </button>
            <button
              type="button"
              aria-label="Dismiss writing suggestion"
              onClick={assistant.dismissSuggestion}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
