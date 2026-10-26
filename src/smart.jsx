import { ProviderCatalog } from "./catalog";
import React, { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api } from "./state";
import { smartGuide } from "../shared/smart.mjs";
export function DeepSeekSettings({ preferencesOnly = false }) {
  const [config, setConfig] = useState(null),
    [key, setKey] = useState(""),
    [show, setShow] = useState(false),
    [message, setMessage] = useState(""),
    [models, setModels] = useState([]);
  useEffect(() => {
    api("/deepseek/settings")
      .then(setConfig)
      .catch((e) => setMessage(e.message));
  }, []);
  const save = async () => {
    try {
      if (key.trim()) {
        await api("/deepseek/key", { key });
        setKey("");
        window.dispatchEvent(
          new CustomEvent("provider-key-saved", { detail: "deepseek" }),
        );
      }
      setConfig(await api("/deepseek/settings", config, "PUT"));
      setMessage("Saved on this computer.");
    } catch (e) {
      setMessage(e.message);
    }
  };
  return (
    <section className="venice-settings">
      <h3>DeepSeek · Smart prompting</h3>
      {config && (
        <>
          {!preferencesOnly && (
            <>
              <p className="muted">
                {config.hasKey
                  ? "API key saved · persists after restart"
                  : "Add your DeepSeek API key once"}
              </p>
              <div className="key-entry">
                <input
                  aria-label="DeepSeek API key"
                  type={show ? "text" : "password"}
                  placeholder={
                    config.hasKey
                      ? "Replace saved key…"
                      : "Paste DeepSeek API key"
                  }
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button
                  title={show ? "Hide key" : "Show key"}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </>
          )}
          <label className="field">
            <span>Text model</span>
            <select
              aria-label="DeepSeek text model"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
            >
              {!models.some((m) => m.id === config.model) && (
                <option value={config.model}>
                  {config.model} · selected model
                </option>
              )}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.uncensored ? " · Uncensored" : ""}
                </option>
              ))}
            </select>
            <small>
              {models.length} available text models · discovery uses no
              inference credits
            </small>
          </label>
          <ProviderCatalog
            provider="deepseek"
            candidateKey={key}
            onModels={setModels}
          />
          <p className="muted">
            Text enhancements use DeepSeek. Model availability is checked by
            DeepSeek at request time. Choose Offline or Online in the studio
            header.
          </p>
          <details>
            <summary>Smart editor instructions</summary>
            <button onClick={() => setConfig({ ...config, guide: smartGuide })}>
              Use preservation guide
            </button>
            <textarea
              aria-label="Smart editor instructions"
              rows={8}
              value={config.guide}
              onChange={(e) => setConfig({ ...config, guide: e.target.value })}
            />
          </details>
          <button className="primary" onClick={save}>
            Save DeepSeek settings
          </button>
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
export function VeniceSettings() {
  const [status, setStatus] = useState(null),
    [key, setKey] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    api("/venice/settings")
      .then(setStatus)
      .catch((e) => setMessage(e.message));
  }, []);
  return (
    <section className="venice-settings">
      <h3>Venice · Video API key</h3>
      <p className="muted">
        {status?.hasKey
          ? "API key saved · persists after restart"
          : "Add your Venice video API key"}
      </p>
      <input
        aria-label="Venice API key"
        type="password"
        autoComplete="off"
        placeholder={
          status?.hasKey ? "Replace saved key…" : "Paste Venice API key"
        }
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <button
        disabled={!key.trim()}
        onClick={async () => {
          try {
            setStatus(await api("/venice/key", { key }));
            setKey("");
            setMessage("Saved on this computer.");
            window.dispatchEvent(
              new CustomEvent("provider-key-saved", { detail: "venice" }),
            );
          } catch (e) {
            setMessage(e.message);
          }
        }}
      >
        Save Venice key
      </button>
      <ProviderCatalog provider="venice" candidateKey={key} />
      <p role="status">{message}</p>
    </section>
  );
}
