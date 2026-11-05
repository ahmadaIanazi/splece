import React, { useEffect, useState } from "react";
import {
  Download,
  Check,
  LoaderCircle,
  Package,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { api } from "./state";
import "./addons.css";

export function useAddons() {
  const [addons, setAddons] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      timer;
    const refresh = async () => {
      try {
        const value = await api("/addons");
        if (alive) {
          setAddons(value);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e.message);
      }
      if (alive) timer = setTimeout(refresh, 2000);
    };
    refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return { addons, error, setAddons };
}
export function AddonSettings() {
  const { addons, error: loadError, setAddons } = useAddons();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [removing, setRemoving] = useState("");
  async function action(id, kind) {
    setBusy(id);
    setError("");
    try {
      const value =
        kind === "remove"
          ? await api(`/addons/${id}`, undefined, "DELETE")
          : kind === "enable" || kind === "disable"
            ? await api(`/addons/${id}`, { enabled: kind === "enable" }, "PUT")
            : await api(`/addons/${id}/${kind}`, {});
      setAddons((old) => old.map((a) => (a.id === id ? value : a)));
      setRemoving("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  const installing = addons.some((a) => a.status === "installing");
  return (
    <section className="addon-settings" aria-label="Optional add-ons">
      <header>
        <Package size={22} aria-hidden="true" />
        <div>
          <h2>Add-ons</h2>
          <p>
            Add only what you need. Local tools stay on this computer; your
            projects work without them.
          </p>
        </div>
      </header>
      {(error || loadError) && <p role="alert">{error || loadError}</p>}
      {!addons.length && !loadError && <p role="status">Loading add-ons…</p>}
      {addons.map((addon) => (
        <article className="addon-card" key={addon.id}>
          <div className="addon-heading">
            <strong>{addon.name}</strong>
            <span>{addon.local ? "Local" : "Online"}</span>
          </div>
          <p>{addon.description}</p>
          <small>{addon.download}</small>
          <div className="addon-status" role="status">
            {addon.status === "installing" ? (
              <LoaderCircle size={15} className="spin" aria-hidden="true" />
            ) : addon.status === "ready" && addon.enabled ? (
              <Check size={15} aria-hidden="true" />
            ) : null}
            {addon.status === "ready" && !addon.enabled
              ? "Disabled · files kept for later"
              : addon.message || addon.requirements}
          </div>
          <div className="addon-actions">
            {addon.status === "installing" ? (
              <button
                disabled={busy === addon.id}
                onClick={() => action(addon.id, "cancel")}
              >
                Cancel download
              </button>
            ) : addon.status === "ready" ? (
              <button
                disabled={busy === addon.id || addon.busy}
                onClick={() =>
                  action(addon.id, addon.enabled ? "disable" : "enable")
                }
              >
                {addon.enabled ? "Disable" : "Enable"}
              </button>
            ) : (
              <button
                className="primary"
                disabled={!!busy || installing || addon.status === "removing"}
                onClick={() => action(addon.id, "install")}
              >
                <Download size={15} aria-hidden="true" />
                {addon.status === "error"
                  ? "Retry setup"
                  : addon.local
                    ? "Install add-on"
                    : "Enable search"}
              </button>
            )}
            {["ready", "error"].includes(addon.status) && (
              <button
                className="icon"
                aria-label={`Remove ${addon.name}`}
                disabled={!!busy || addon.busy}
                onClick={() => setRemoving(addon.id)}
              >
                <Trash2 size={15} />
              </button>
            )}
            <a href={addon.source} target="_blank" rel="noreferrer">
              {addon.engine}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
          {removing === addon.id && (
            <div className="addon-remove">
              <p>
                Remove this add-on and its downloaded files? Your projects and
                completed results stay.
              </p>
              <button onClick={() => setRemoving("")}>Keep</button>
              <button
                disabled={!!busy}
                onClick={() => action(addon.id, "remove")}
              >
                Remove add-on
              </button>
            </div>
          )}
          <details>
            <summary>Requirements & license</summary>
            <p>{addon.requirements}</p>
            <p>{addon.license}</p>
            {addon.local && (
              <p>
                Setup needs an internet connection. After installation,
                processing is local and never switches to a paid service.
                Download size varies with dependencies.
              </p>
            )}
          </details>
        </article>
      ))}
    </section>
  );
}
