import { useEffect, useRef, useState } from "react";
import "./preview-fullscreen.css";

export function usePreviewFullscreen({ enabled, scope, onExit }) {
  const ref = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const latest = useRef(onExit);
  latest.current = onExit;
  const enteredNative = useRef(false);
  const previousFocus = useRef(null);
  function close() {
    setExpanded(false);
    latest.current();
    if (document.fullscreenElement === ref.current)
      document.exitFullscreen?.().catch(() => {});
    previousFocus.current?.focus({ preventScroll: true });
  }
  function open() {
    const host = ref.current;
    if (!host) return;
    previousFocus.current = document.activeElement;
    setExpanded(true);
    host.focus({ preventScroll: true });
    // Keep an expanded, controllable preview when the browser lacks fullscreen.
    try { host.requestFullscreen?.().catch(() => {}); } catch { /* fallback */ }
  }
  useEffect(() => {
    const change = () => {
      if (document.fullscreenElement === ref.current && ref.current) {
        enteredNative.current = true;
      } else if (enteredNative.current) {
        enteredNative.current = false;
        close();
      }
    };
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const key = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [expanded]);
  useEffect(() => {
    if (!enabled && expanded) close();
  }, [enabled, expanded]);
  useEffect(() => { setExpanded(false); }, [scope]);
  return { ref, expanded, open, close };
}
