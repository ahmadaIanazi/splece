import React, { useEffect, useState, useRef, useMemo } from "react";
import { ChevronDown, X, Settings2, Globe, Cable } from "lucide-react";
import { api } from "./state";
import { aiLanes, laneLabels, laneProviders } from "../shared/ai-routing.mjs";
import "./ai-providers.css";
export function useAIRouting({ preferences = false } = {}) {
  const [state, setState] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      api("/ai-routing")
        .then((v) => {
          if (alive) setState(v);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    refresh();
    window.addEventListener("ai-routing-changed", refresh);
    window.addEventListener("provider-catalog-updated", refresh);
    window.addEventListener("studio-mode-changed", refresh);
    return () => {
      alive = false;
      window.removeEventListener("ai-routing-changed", refresh);
      window.removeEventListener("provider-catalog-updated", refresh);
      window.removeEventListener("studio-mode-changed", refresh);
    };
  }, []);
  async function save(patch) {
    const value = await api("/ai-routing", patch, "PUT");
    setState(value);
    window.dispatchEvent(
      new CustomEvent("ai-routing-changed", { detail: patch }),
    );
    window.dispatchEvent(new Event("studio-mode-changed"));
    return value;
  }
  async function setOnline(online) {
    await api("/studio/online", {online}, "PUT");
    const value = await api("/ai-routing");
    setState(value);
    window.dispatchEvent(new Event("ai-routing-changed"));
    window.dispatchEvent(new Event("studio-mode-changed"));
    return value;
  }
  const visibleState = useMemo(() => state && !preferences && state.online === false
    ? {...state, routes:Object.fromEntries(Object.entries(state.routes).map(([lane,route])=>[lane,{...route,enabled:false}]))}
    : state, [state, preferences]);
  return { state:visibleState, error, save, setOnline };
}
export function AIProviderHeader({ assistant, onConnections }) {
  const { state, error: loadError, save, setOnline } = useAIRouting({preferences:true});
  const [open, setOpen] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [expanded,setExpanded]=useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!expanded) return;
    const close = (e) => {
      if (!root.current?.contains(e.target)) {setOpen(null);setExpanded(false);}
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [expanded]);
  async function change(lane, patch) {
    setBusy(true);
    setError("");
    try {
      await save({ [lane]: patch });
      if (lane === "assistant" && patch.enabled !== undefined)
        await assistant.configure({ enabled: patch.enabled });
    } catch (e) {
      setError(e.message);
      setOpen(lane);
    } finally {
      setBusy(false);
    }
  }
  async function toggleOnline() {
    setBusy(true); setError("");
    try { await setOnline(!state.online); } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  if (!state) return <small>{loadError || "Connections…"}</small>;
  return (
    <div
      className="ai-tools-menu"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (!open) {setExpanded(false);root.current?.querySelector(".ai-tools-trigger")?.focus();}
          setOpen(null);
          root.current?.querySelector(`[data-picker="${open}"]`)?.focus();
        }
      }}
      aria-label="Connections"
    >
      <button className="ai-tools-trigger" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><Cable size={14}/> Connections <span className="connection-online-dot" data-online={state.online} aria-label={state.online ? "Online" : "Offline"}/><ChevronDown size={12}/></button>
      {expanded && <div className="ai-tools-popover" data-online={state.online}>
      <button className="connections-master" role="switch" aria-label="Online" aria-checked={state.online} disabled={busy} onClick={toggleOnline}>
        <Globe size={18}/><span><strong>Online</strong><small>{state.online ? 'Your enabled connections can run' : 'Paused · your choices are saved'}</small></span><i className="connections-switch" data-on={state.online}/>
      </button>
      <p>{state.online ? 'Choose what you want to use.' : 'Local editing and add-ons still work. Your enabled choices below will resume when Online.'}</p>
      {error && !open && <p role="alert">{error}</p>}
      {aiLanes.map((lane) => {
        const route = state.routes[lane],
          provider = state.providers.find((p) => p.id === route.provider),
          models = state.models[lane].filter(
            (m) => m.provider === route.provider,
          ),
          model = models.find((m) => m.id === route.model);
        const enabled =
          route.enabled && (lane !== "assistant" || assistant.status?.enabled);
        return (
          <div className="ai-lane" key={lane} data-active={!!enabled}>
            <button
              type="button"
              role="switch"
              aria-label={`${laneLabels[lane]} enabled preference`}
              aria-checked={!!enabled}
              disabled={busy}
              title={`${laneLabels[lane]} · ${enabled ? state.online ? "On" : "Enabled · paused" : "Off"} · ${provider?.name}`}
              onClick={() => change(lane, { enabled: !enabled })}
            >
              <span>{laneLabels[lane]}</span>
              <i />
            </button>
            <button
              type="button"
              data-picker={lane}
              aria-label={`${laneLabels[lane]} provider and model`}
              aria-expanded={open === lane}
              onClick={() => {
                setError("");
                setOpen(open === lane ? null : lane);
              }}
            >
              <ChevronDown size={12} />
            </button>
            {open === lane && (
              <section
                className="ai-lane-popover"
                aria-label={`${laneLabels[lane]} connection settings`}
              >
                <header>
                  <strong>
                    {laneLabels[lane]}
                    {lane === "audio" ? " · optional" : ""}
                  </strong>
                  <button
                    aria-label="Close provider picker"
                    onClick={() => setOpen(null)}
                  >
                    <X size={15} />
                  </button>
                </header>
                <label>
                  Provider
                  <select
                    aria-label={`${laneLabels[lane]} provider`}
                    disabled={busy}
                    value={route.provider}
                    onChange={(e) =>
                      change(lane, {
                        provider: e.target.value,
                        model: "",
                        enabled: false,
                      })
                    }
                  >
                    {state.providers
                      .filter((p) => laneProviders[lane].includes(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Model
                  <select
                    aria-label={`${laneLabels[lane]} model`}
                    disabled={busy}
                    value={route.model}
                    onChange={(e) => change(lane, { model: e.target.value })}
                  >
                    <option value="">
                      {lane === "audio"
                        ? "Automatic for each sound task"
                        : "Choose a model / use current default"}
                    </option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.id}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="ai-rate">
                  {model?.priceLabel ||
                    "Choose a model to see its rate. Media generation shows an estimate before you submit."}
                </p>
                <small>
                  {enabled && state.online
                    ? "On · requests use provider credits."
                    : enabled ? "Paused while Offline · will resume when Online." : "Off · no new paid requests for this feature."}{" "}
                  Existing accepted jobs can finish.
                </small>
                {!models.length && (
                  <p>Connect {provider?.name} to load available models.</p>
                )}
                {lane === "assistant" && (
                  <>
                    <label>
                      Daily assistant budget (USD)
                      <input
                        type="number"
                        min="0.01"
                        step="0.25"
                        defaultValue={assistant.status?.budget || 1}
                        onBlur={(e) => {
                          const budget = Number(e.target.value);
                          if (budget > 0) assistant.configure({ budget });
                        }}
                      />
                    </label>
                    {[
                      ["creativeDecisions", "Choose camera from the action"],
                      ["writingSuggestions", "Suggest what comes next"],
                    ].map(([key, label]) => (
                      <label className="ai-assistant-preference" key={key}>
                        <input
                          type="checkbox"
                          checked={assistant.status?.[key] !== false}
                          onChange={(e) =>
                            assistant.configure({ [key]: e.target.checked })
                          }
                        />
                        {label}
                      </label>
                    ))}
                    {model?.priceLabel?.startsWith("Rate unavailable") && (
                      <small>
                        Without a published rate, each request reserves the full
                        daily budget until its cost is known.
                      </small>
                    )}
                    {assistant.message && (
                      <p role="status">{assistant.message}</p>
                    )}
                  </>
                )}
                {error && <p role="alert">{error}</p>}
                <button
                  className="ai-connect-link"
                  onClick={() => {
                    setOpen(null);setExpanded(false);
                    onConnections();
                  }}
                >
                  <Settings2 size={14} />
                  Connections & defaults
                </button>
              </section>
            )}
          </div>
        );
      })}
      <button className="ai-connect-link connections-guide-link" onClick={()=>{setExpanded(false);setOpen(null);onConnections();}}><Settings2 size={15}/> Setup guide & connections</button>
      <small className="connections-menu-note">Turning Offline stops new requests. Jobs already accepted by a provider may finish.</small>
      </div>}
    </div>
  );
}
