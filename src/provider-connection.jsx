import React, { useRef, useState, useId } from "react";
import { Check, ExternalLink, Film, KeyRound, MessageSquare, RefreshCw, AudioLines } from "lucide-react";
import { api } from "./state";
import { providerGuides } from "../shared/connection-guide.mjs";
const guides = Object.fromEntries(Object.entries(providerGuides).map(([id,g])=>[id,{title:g.summary,description:'',steps:[g.accountText,g.creditText,g.keyText],docs:g.docs}]));
function connectionLabel(p) {
  return p.verified
    ? p.accessPermitted === false
      ? "Key verified · access restricted"
      : "Connected"
    : p.hasKey
      ? "Key saved · verify connection"
      : "Not connected";
}
export function ProviderConnection({
  connection: p,
  onRefresh,
  guided = false,
  onBusy,
  compact = false,
  hideGuide = false,
}) {
  const [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  const keyInput = useRef(null), messageText = useRef(null);
  const guide = guides[p.id];
  const fieldId=useId();
  async function connect(e) {
    e.preventDefault();
    setBusy(true);
    onBusy?.(true);
    setFailed(false);
    setMessage("Verifying connection…");
    requestAnimationFrame(() => messageText.current?.focus());
    let connected = false;
    try {
      const result = await api(
        p.id === "fal" ? "/connections/fal/test" : `/providers/${p.id}/test`,
        key.trim() ? { key: key.trim() } : {},
      );
      await onRefresh();
      if (result.testOk !== true)
        throw Error(
          result.message ||
            "We couldn’t verify this key. Please check it and try again.",
        );
      setKey("");
      connected = true;
      setMessage(
        result.message ||
          "Connection verified. Your key is saved on this computer.",
      );
      window.dispatchEvent(
        new CustomEvent("provider-catalog-updated", { detail: p.id }),
      );
    } catch (e) {
      setFailed(true);
      const explanation = /401|key rejected/i.test(e.message)
        ? `This key wasn’t accepted. Copy the full key from ${p.name} and try again.`
        : e.message;
      setMessage(
        explanation +
          (key.trim() && p.hasKey ? " Your previous key is still saved." : ""),
      );
    } finally {
      setBusy(false);
      onBusy?.(false);
      requestAnimationFrame(() => (connected ? messageText : keyInput).current?.focus());
    }
  }
  return (
    <section className="connection-card" aria-label={`${p.name} connection`}>
      <header>
        <span className="connection-mark">
          {p.id === "deepseek" ? (
            <MessageSquare size={22} />
          ) : p.id === "fal" ? (
            <AudioLines size={22} />
          ) : (
            <Film size={22} />
          )}
        </span>
        <div>
          <h3>{guide?.title || p.name}</h3>
          <p>
            {p.name}
            {!guide && p.description ? ` · ${p.description}` : ""}
          </p>
        </div>
      </header>
      <span
        className={`connection-status ${p.verified && p.accessPermitted !== false ? "verified" : ""}`}
      >
        <span aria-hidden="true">
          {p.verified && p.accessPermitted !== false ? "✓" : "○"}
        </span>
        {connectionLabel(p)}
      </span>
      {guide && !hideGuide && (
        <details className="connection-guide" open={guided || undefined}>
          <summary>How to get your {p.name} key</summary>
          <ol>
            {guide.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <a href={p.keyUrl} target="_blank" rel="noreferrer">
            Open {p.name} <ExternalLink size={14} />
          </a>
          <a href={guide.docs} target="_blank" rel="noreferrer">
            Official guide <ExternalLink size={14} />
          </a>
        </details>
      )}
      {!guide && !hideGuide && (
        <a href={p.keyUrl} target="_blank" rel="noreferrer">
          Get your {p.name} key <ExternalLink size={14} />
        </a>
      )}
      <form onSubmit={connect}>
        <label className="connection-key-label" htmlFor={`key-${fieldId}`}>
          {p.name} API key
          <span className="connection-key">
            <KeyRound size={16} />
            <input
              ref={keyInput}
              id={`key-${fieldId}`}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              placeholder={
                p.hasKey
                  ? "Paste a new key to replace yours"
                  : "Paste your key here"
              }
              value={key}
              onChange={(e) => { setKey(e.target.value); setFailed(false); }}
              disabled={busy}
              aria-describedby={`key-help-${fieldId}`}
              aria-invalid={failed || undefined}
            />
          </span>
        </label>
        <button
          className="primary"
          disabled={busy || (!p.hasKey && !key.trim())}
          type="submit"
        >
          {busy ? (
            <RefreshCw className="spin" size={15} />
          ) : (
            <Check size={15} />
          )}{" "}
          {busy ? "Verifying…" : "Verify connection"}
        </button>
      </form>
      <p className="connection-footnote" id={`key-help-${fieldId}`}>
        {compact ? "Verification uses no credits. A failed replacement keeps your working key." : "Verification does not generate content or spend credits. A working key stays saved if a replacement fails."}
      </p>
      {(message || p.error) && (
        <p className="connection-message" role="status" tabIndex={-1} ref={messageText}>
          {message || p.error}
        </p>
      )}
      {p.accessPermitted === false && (
        <p className="connection-message">
          Your key is valid, but generation is restricted. Check your provider’s
          balance and key spending limits.{" "}
          <a href={p.keyUrl} target="_blank" rel="noreferrer">
            Open account <ExternalLink size={13} />
          </a>
        </p>
      )}
      {guide && !compact && (
        <p className="connection-footnote">
          Usage is billed by {p.name}. You may need to add credit to your
          provider account before generating.
        </p>
      )}
    </section>
  );
}

