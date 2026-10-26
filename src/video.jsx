import React, { useEffect, useState } from "react";
import { api } from "./state";
import { fitVideoSettings } from "../shared/video-selection.mjs";
export function VideoSettings({ onChange }) {
  const [status, setStatus] = useState(null),
    [message, setMessage] = useState(""),
    [defaults, setDefaults] = useState(null);
  useEffect(() => {
    api("/video-defaults")
      .then((v) => setDefaults(v.venice || {}))
      .catch((e) => setMessage(e.message));
    api("/video/settings")
      .then(setStatus)
      .catch((e) => setMessage(e.message));
    const refreshed = () =>
      api("/video/settings")
        .then((s) => {
          setStatus(s);
          onChange();
        })
        .catch((e) => setMessage(e.message));
    window.addEventListener("provider-catalog-updated", refreshed);
    return () =>
      window.removeEventListener("provider-catalog-updated", refreshed);
  }, []);
  return (
    <section className="venice-settings">
      <h3>Video generation defaults</h3>
      <p className="muted">
        Uses the selected provider’s saved key. Jobs continue while the local
        studio server runs, even after closing the browser. Restarting the
        server resumes accepted jobs.
      </p>
      {status && (
        <>
          <p className="muted">
            {status.models.length} discovered ·{" "}
            {status.models.filter((m) => m.supported).length} available video
            workflows
            {status.fetchedAt
              ? " · " + new Date(status.fetchedAt).toLocaleString()
              : ""}
            . Discovery does not generate content.
          </p>
          <h4>Favorite video defaults</h4>
          <p className="muted">
            Saved locally for new drafts. Existing drafts keep their settings;
            story generations use their suggested duration when supported. You
            can also save the current composer settings with ☆.
          </p>
          {!status.models.some((m) => m.supported) && (
            <p className="muted">
              Connect a video provider to choose Online defaults. Offline mode is
              already ready to use without a key.
            </p>
          )}
          {defaults && status.models.some((m) => m.supported) && (
            <>
              <label className="field">
                <span>Favorite model</span>
                <select
                  aria-label="Favorite video model"
                  value={defaults.model || ""}
                  onChange={(e) =>
                    setDefaults(
                      fitVideoSettings(
                        { ...defaults, audio: defaults.audio ?? true },
                        status.models.find((m) => m.id === e.target.value),
                      ),
                    )
                  }
                >
                  <option value="" disabled>
                    Choose default model
                  </option>
                  {status.models
                    .filter((m) => m.supported)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="details-grid">
                {[
                  ["resolution", "resolutions"],
                  ["duration", "durations"],
                  ["aspect", "aspects"],
                ].map(([key, field]) => (
                  <label className="field" key={key}>
                    <span>{key}</span>
                    <select
                      aria-label={"Default video " + key}
                      value={defaults[key] || ""}
                      onChange={(e) =>
                        setDefaults({
                          ...defaults,
                          [key]:
                            key === "duration"
                              ? +e.target.value
                              : e.target.value,
                        })
                      }
                    >
                      {(
                        status.models.find((m) => m.id === defaults.model)?.[
                          field
                        ] || []
                      ).map((v) => (
                        <option key={v} value={v}>
                          {v}
                          {key === "duration" ? "s" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={!!defaults.audio}
                  disabled={
                    !status.models.find((m) => m.id === defaults.model)
                      ?.audioConfigurable
                  }
                  onChange={(e) =>
                    setDefaults({ ...defaults, audio: e.target.checked })
                  }
                />{" "}
                Audio by default
              </label>
              <button
                disabled={!defaults.model}
                onClick={async () => {
                  try {
                    await api(
                      "/video-defaults",
                      { ...defaults, mode: "venice" },
                      "PUT",
                    );
                    onChange();
                    setMessage("Favorite video defaults saved.");
                  } catch (e) {
                    setMessage(e.message);
                  }
                }}
              >
                Save video defaults
              </button>
            </>
          )}
          <p className="muted">
            Browse model names, defaults and limitations in the connection
            panels above. The header switch controls all new requests.
          </p>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
