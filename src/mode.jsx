import React, { useState, useEffect } from "react";
import { api } from "./state";
export function StudioMode() {
  const [mode, setMode] = useState("test"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api("/studio/mode")
      .then((s) => setMode(s.mode))
      .catch((e) => setError(e.message));
  }, []);
  async function change(next) {
    setBusy(true);
    setError("");
    try {
      const s = await api("/studio/mode", { mode: next }, "PUT");
      setMode(s.mode);
      window.dispatchEvent(new Event("studio-mode-changed"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="studio-mode"
      title="Offline: local editing and sample previews. Online: AI generation using your provider credits. Existing jobs keep running."
    >
      <button
        className="mode-switch"
        role="switch"
        aria-label="Online AI generation"
        aria-checked={mode === "live"}
        disabled={busy}
        onClick={() => change(mode === "live" ? "test" : "live")}
      >
        <span className="mode-track">
          <i />
        </span>
        <span>{mode === "live" ? "Online" : "Offline"}</span>
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
