import React, { useEffect, useState, useRef } from "react";
import { RefreshCw, PlugZap } from "lucide-react";
import { api } from "./state";
export function ProviderCatalog({ provider, onModels, candidateKey = "" }) {
  const [catalog, setCatalog] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState("");
  const callback = useRef(onModels);
  callback.current = onModels;
  const accept = (c) => {
    setCatalog(c);
    callback.current?.(c.models || []);
  };
  async function test() {
    setBusy(true);
    setMessage("Verifying your connection and refreshing models…");
    try {
      const result = await api(
        `/providers/${provider}/test`,
        candidateKey.trim() ? { key: candidateKey.trim() } : {},
      );
      accept(result);
      setMessage(result.message);
      window.dispatchEvent(
        new CustomEvent("provider-catalog-updated", { detail: provider }),
      );
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    api(`/providers/${provider}/catalog`)
      .then(async (c) => {
        if (!alive) return;
        accept(c);
        if (
          c.hasKey &&
          (!c.fetchedAt || c.keyChanged || Date.now() - c.fetchedAt > 86400000)
        )
          await test();
      })
      .catch((e) => alive && setMessage(e.message));
    const refresh = (e) => {
      if (e.detail === provider) test();
    };
    const refreshCached = (e) => {
      if (e.detail && e.detail !== provider) return;
      api(`/providers/${provider}/catalog`)
        .then((c) => {
          if (alive) accept(c);
        })
        .catch((e) => {
          if (alive) setMessage(e.message);
        });
    };
    window.addEventListener("provider-key-saved", refresh);
    window.addEventListener("provider-catalog-updated", refreshCached);
    return () => {
      alive = false;
      window.removeEventListener("provider-key-saved", refresh);
      window.removeEventListener("provider-catalog-updated", refreshCached);
    };
  }, [provider]);
  const models = (catalog?.models || []).filter((m) =>
    `${m.name} ${m.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  const model = models.find((m) => m.id === selected) || models[0];
  return (
    <div className="provider-catalog">
      {candidateKey.trim() && (
        <p className="muted">
          Verification uses the entered key without generating content.
        </p>
      )}
      <div className="author-actions">
        <button
          disabled={busy}
          onClick={test}
          aria-label={`Verify ${provider === "venice" ? "Venice" : "DeepSeek"} connection`}
        >
          <PlugZap size={14} />
          {busy ? "Verifying…" : "Verify connection & refresh models"}
        </button>
        <button
          disabled={busy}
          title={`Refresh ${provider} models`}
          onClick={test}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <p className={catalog?.verified ? "connection-ok" : "muted"}>
        {catalog?.verified
          ? "Connected · API key verified"
          : catalog?.error ||
            (catalog?.keyChanged
              ? "Key changed · test again"
              : "Not yet verified")}
        {catalog?.checkedAt
          ? " · " + new Date(catalog.checkedAt).toLocaleString()
          : ""}
      </p>
      {catalog?.accessPermitted === false && (
        <p className="error">
          API key accepted, but Venice reports API access is restricted. Check
          your account balance, key limits or access settings. Model discovery
          is still available.
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <p>
        <b>{catalog?.models?.length || 0} saved models</b>
        {catalog?.fetchedAt
          ? " · Fetched " + new Date(catalog.fetchedAt).toLocaleString()
          : ""}
      </p>
      {catalog?.models?.length > 0 && (
        <>
          <input
            aria-label={`Search ${provider} models`}
            placeholder="Search model names…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label={`${provider} model catalog`}
            value={model?.id || ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.supported === false ? " · unavailable in studio" : ""}
              </option>
            ))}
          </select>
          {!model && <p>No matching models.</p>}
          {model && (
            <article className="model-config">
              <b>{model.name}</b>
              <code>{model.id}</code>
              {model.unavailableReason && <p>{model.unavailableReason}</p>}
              {provider === "venice" ? (
                <dl>
                  <dt>Durations</dt>
                  <dd>{model.durations?.join(", ")} seconds</dd>
                  <dt>Resolutions</dt>
                  <dd>
                    {model.resolutions?.join(", ") ||
                      "Determined by provider / source"}
                  </dd>
                  <dt>Aspect ratios</dt>
                  <dd>{model.aspects?.join(", ") || "Determined by source"}</dd>
                  <dt>Prompt limit</dt>
                  <dd>{model.promptLimit} characters</dd>
                  <dt>References</dt>
                  <dd>
                    {model.referenceMode} · up to {model.maxReferences} images
                  </dd>
                  <dt>Frames</dt>
                  <dd>
                    {model.endFrame
                      ? "Start + end"
                      : model.frames
                        ? "Start only"
                        : "Not supported"}
                  </dd>
                  <dt>Audio</dt>
                  <dd>
                    {model.audioConfigurable
                      ? "Configurable"
                      : model.audio
                        ? "Included"
                        : "Not supported"}
                  </dd>
                </dl>
              ) : (
                <dl>
                  <dt>Context window</dt>
                  <dd>
                    {model.contextWindow?.toLocaleString() || "Not reported"}{" "}
                    tokens
                  </dd>
                  <dt>Output limit</dt>
                  <dd>
                    {model.maxOutputTokens?.toLocaleString() || "Not reported"}{" "}
                    tokens
                  </dd>
                  <dt>Input / output</dt>
                  <dd>
                    {model.inputModalities?.join(", ") || "Not reported"} /{" "}
                    {model.outputModalities?.join(", ") || "Not reported"}
                  </dd>
                  <dt>Reasoning effort</dt>
                  <dd>
                    {model.effort?.supported_levels?.join(", ") ||
                      "Not reported"}
                    {model.effort?.default_level
                      ? " · provider default: " + model.effort.default_level
                      : ""}
                  </dd>
                </dl>
              )}
              <details open>
                <summary>Studio defaults</summary>
                <pre>{JSON.stringify(model.studioDefaults || {}, null, 2)}</pre>
              </details>
              <details>
                <summary>
                  Provider defaults, pricing & full configuration
                </summary>
                <p className="muted">
                  Unreported fields remain unknown. Video prices are quoted for
                  the selected settings before generation.
                </p>
                <pre>{JSON.stringify(model.metadata || model, null, 2)}</pre>
              </details>
            </article>
          )}
        </>
      )}
      <small>
        Catalogs stay on this computer across restarts. Testing never generates
        text or video. Offline mode uses local models in the composer; live
        models are listed here.
      </small>
    </div>
  );
}
