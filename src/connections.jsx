import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Film,
  HardDrive,
  KeyRound,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  AudioLines,
} from "lucide-react";
import { api } from "./state";
import { VideoSettings } from "./video";
import { DeepSeekSettings } from "./smart";
import { providerDefinitions } from "../shared/providers.mjs";
import "./connections.css";

const guides = {
  fal: {
    title: "Sound & motion",
    description: "Create sound effects, ambience, character voices and lip-synced takes.",
    steps: [
      "Sign in to fal.ai and open API keys.",
      "Create an API key for Splece and copy the complete key.",
      "Return here and paste your key below.",
    ],
    docs: "https://docs.fal.ai/documentation/development/getting-started/deploy-your-first-image-generator",
  },
  deepseek: {
    title: "Story assistant",
    description:
      "Develop your ideas, organize your story, and refine your prompts.",
    steps: [
      "Sign in to DeepSeek and open API keys.",
      "Create a new key. Give it a name like Splece, then copy it.",
      "Return here and paste your key below.",
    ],
    docs: "https://api-docs.deepseek.com/",
  },
  venice: {
    title: "Images & video",
    description:
      "Create reference images and turn your scenes into video clips.",
    steps: [
      "Sign in to Venice and open API settings.",
      "Choose Generate New API Key. Name it Splece and select Inference Only, then copy the key.",
      "Return here and paste your key below.",
    ],
    docs: "https://docs.venice.ai/guides/getting-started/generating-api-key",
  },
};
function connectionLabel(p) {
  return p.verified
    ? p.accessPermitted === false
      ? "Key verified · access restricted"
      : "Connected"
    : p.hasKey
      ? "Key saved · verify connection"
      : "Not connected";
}
function ProviderConnection({
  connection: p,
  onRefresh,
  guided = false,
  onBusy,
  compact = false,
}) {
  const [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  const keyInput = useRef(null), messageText = useRef(null);
  const guide = guides[p.id];
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
            {guide ? ` · ${guide.description}` : ` · ${p.description}`}
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
      {guide && (
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
      {!guide && (
        <a href={p.keyUrl} target="_blank" rel="noreferrer">
          Get a {p.name} key <ExternalLink size={14} />
        </a>
      )}
      <form onSubmit={connect}>
        <label className="connection-key-label" htmlFor={`key-${p.id}`}>
          {p.name} API key
          <span className="connection-key">
            <KeyRound size={16} />
            <input
              ref={keyInput}
              id={`key-${p.id}`}
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
              aria-describedby={`key-help-${p.id}`}
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
      <p className="connection-footnote" id={`key-help-${p.id}`}>
        {compact ? "Verification uses no credits. A failed replacement keeps your working key." : "Verification does not generate content or spend AI credits. A working key stays saved if a replacement fails."}
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
          AI usage is billed by {p.name}. You may need to add credit to your
          provider account before generating.
        </p>
      )}
    </section>
  );
}

export function Connections({
  onChange = () => {},
  onboarding = false,
  onDone = () => {},
  initialProvider,
  feature = "",
  returnLabel = "Back to my work",
  onBusy = () => {},
}) {
  const contextual = Object.hasOwn(guides, initialProvider || "");
  const [state, setState] = useState(null),
    [error, setError] = useState(""),
    [step, setStep] = useState(contextual ? initialProvider : "welcome"),
    [guided, setGuided] = useState(onboarding || contextual),
    [busy, setBusy] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const heading = useRef(null);
  async function refresh() {
    const value = await api("/connections");
    setState(value);
    return value;
  }
  useEffect(() => {
    let active = true;
    api("/connections")
      .then((v) => {
        if (active) setState(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (guided) heading.current?.focus();
  }, [step, guided, !!state]);
  async function finish(skipped = false, create = false) {
    if (contextual) { onDone(); return; }
    setBusy(true);
    setError("");
    try {
      await api("/onboarding", { skipped }, "PUT");
      if (onboarding) onDone({ create });
      else {
        setGuided(false);
        await refresh();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const primary = ["deepseek", "venice"]
    .map((id) => state?.connections.find((p) => p.id === id))
    .filter(Boolean);
  const ready = step === "ready";
  const provider = state?.connections.find((p) => p.id === step);
  return (
    <section
      className={`connections ${guided ? "connections-guided" : ""} ${contextual ? "connections-contextual" : ""}`}
      aria-label={contextual ? "Provider setup guide" : guided ? "Welcome to Splece" : "AI connections"}
    >
      {guided && !contextual && (
        <div className="setup-brand">
          <img src="/splece.svg" alt="" />
          <span>Splece</span>
          <small>Your ideas, in motion.</small>
        </div>
      )}
      <div className="connections-intro">
        <div>
          <p className="setup-eyebrow">
            {contextual ? "CONNECT ONCE, KEEP CREATING" : guided ? "YOUR STUDIO, YOUR WAY" : "YOUR AI TOOLS"}
          </p>
          <h2 ref={heading} tabIndex={-1}>
            {contextual ? `Connect ${provider?.name || providerDefinitions.find((item) => item.id === initialProvider)?.name}` : guided
              ? step === "welcome"
                ? "Make room for your next idea."
                : ready
                  ? "Your studio is ready."
                  : "A little help for your creativity."
              : "AI connections"}
          </h2>
          <p>
            {contextual ? `${feature ? `For ${feature}. ` : ""}Your work stays right here.` : guided && step === "welcome"
              ? "Create and edit on your computer. Connect AI when you’re ready."
              : "Connect only what you need. You can change this anytime."}
          </p>
        </div>
      </div>
      {guided && !contextual && step !== "welcome" && (
        <ol className="setup-progress" aria-label="Setup progress">
          {["deepseek", "venice", "ready"].map((id, i) => (
            <li key={id} aria-current={step === id ? "step" : undefined}>
              <span>{i + 1}</span>
              {["Story", "Images & video", "Ready"][i]}
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p role="alert" className="connection-message">
          {error}{" "}
          {!state && (
            <button
              onClick={() => {
                setError("");
                heading.current?.focus();
                refresh().catch((e) => setError(e.message));
              }}
            >
              Try again
            </button>
          )}
        </p>
      )}
      {!state && !error && <p role="status">Loading your connections…</p>}
      {state && guided && step === "welcome" && (
        <>
          <div className="setup-benefits">
            <div>
              <HardDrive />
              <h3>Start on your computer</h3>
              <p>
                Import, edit and export your own media. No AI account needed.
              </p>
            </div>
            <div>
              <MessageSquare />
              <h3>Add your AI tools</h3>
              <p>
                Connect your accounts for story help, images and video
                generation.
              </p>
            </div>
          </div>
          <p className="setup-explanation">
            Splece is free. AI providers charge separately for their services.
            An API key is the private code that connects your provider account
            to Splece.
          </p>
          <footer className="connection-footer">
            <button disabled={busy} onClick={() => finish(true)}>
              Explore first
            </button>
            <button className="primary" onClick={() => setStep("deepseek")}>
              Connect AI tools <ArrowRight size={16} />
            </button>
          </footer>
        </>
      )}
      {state && guided && provider && (
        <>
          <ProviderConnection
            key={provider.id}
            connection={provider}
            guided
            compact={contextual}
            onBusy={(value) => { setBusy(value); onBusy(value); }}
            onRefresh={async () => {
              await refresh();
              onChange();
            }}
          />
          <footer className="connection-footer">
            {!contextual && <button
              disabled={busy}
              onClick={() =>
                setStep(step === "deepseek" ? "welcome" : "deepseek")
              }
            >
              Back
            </button>}
            <button
              className="primary"
              disabled={busy}
              onClick={() => contextual ? finish() : setStep(step === "deepseek" ? "venice" : "ready")}
            >
              {contextual ? returnLabel : provider.verified ? "Continue" : "Set up later"}
              <ArrowRight size={16} />
            </button>
          </footer>
        </>
      )}
      {state && guided && ready && (
        <>
          <div className="setup-ready-list">
            <div>
              <HardDrive size={20} />
              <span>Local editing</span>
              <strong>Ready</strong>
            </div>
            {primary.map((p) => (
              <div key={p.id}>
                {p.id === "deepseek" ? (
                  <MessageSquare size={20} />
                ) : (
                  <Film size={20} />
                )}
                <span>{guides[p.id].title}</span>
                <strong>
                  {p.verified && p.accessPermitted !== false
                    ? "Connected"
                    : p.accessPermitted === false
                      ? "Access restricted"
                      : "Set up later"}
                </strong>
              </div>
            ))}
          </div>
          <p className="setup-explanation">
            Offline lets you edit locally and explore with sample previews.
            Choose Online when you want AI generation using your provider
            credits. Connecting a key does not switch this on.
          </p>
          <footer className="connection-footer">
            <button disabled={busy} onClick={() => setStep("venice")}>
              Back
            </button>
            <button
              disabled={busy}
              className="primary"
              onClick={() => finish(false, true)}
            >
              {onboarding ? "Create your first project" : "Finish setup"}{" "}
              <ArrowRight size={16} />
            </button>
          </footer>
        </>
      )}
      {state && !guided && (
        <>
          <button
            className="setup-guide-button"
            onClick={() => {
              setStep("welcome");
              setGuided(true);
            }}
          >
            Need a hand? Open the setup guide <ArrowRight size={15} />
          </button>
          <div className="connection-list">
            {primary.map((p) => (
              <ProviderConnection
                key={p.id}
                connection={p}
                onRefresh={async () => {
                  await refresh();
                  onChange();
                }}
              />
            ))}
          </div>
          {state.connections.some((p) => p.id === "fal" && p.hasKey) && (
            <details className="connection-preferences">
              <summary>Other connected providers</summary>
              {state.connections
                .filter((p) => p.id === "fal" && p.hasKey)
                .map((p) => (
                  <ProviderConnection
                    key={p.id}
                    connection={p}
                    onRefresh={async () => {
                      await refresh();
                      onChange();
                    }}
                  />
                ))}
            </details>
          )}
          <details
            className="connection-preferences"
            onToggle={(e) => setPreferencesOpen(e.currentTarget.open)}
          >
            <summary>Model & prompt preferences</summary>
            {preferencesOpen && (
              <>
                <DeepSeekSettings preferencesOnly />
                <VideoSettings onChange={onChange} />
              </>
            )}
          </details>
        </>
      )}
      <p className="connection-local">
        <ShieldCheck size={16} />
        <span>
          {contextual ? "Keys stay on this computer. Generation is billed by your provider and only starts when you choose." : "Keys are stored on this computer. AI requests send the necessary prompts and media to your chosen provider. Your projects stay local."}
        </span>
      </p>
    </section>
  );
}
