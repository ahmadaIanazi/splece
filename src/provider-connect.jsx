import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, PlugZap, X } from "lucide-react";
import { Connections } from "./connections";
import { api } from "./state";
import { providerDefinitions } from "../shared/providers.mjs";
import { connectionRequest, providerConnectEvent, providerNeedsConnection } from "../shared/provider-connect.mjs";
import "./provider-connect.css";

const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]';
const focusableWithin = (node) => [...(node?.querySelectorAll(focusableSelector) || [])]
  .filter((item) => item.getClientRects().length > 0 && !item.closest('[inert]'));

let status = { connections: null, mode: null }, pending;
const subscribers = new Set();
const snapshot = () => status;
function publish(next) {
  status = next;
  for (const notify of subscribers) notify();
}
async function refreshStatus() {
  if (pending) return pending;
  pending = Promise.allSettled([api("/connections"), api("/studio/mode")]).then(([connections, mode]) => {
    publish({
      connections: connections.status === "fulfilled" ? connections.value.connections : status.connections,
      mode: mode.status === "fulfilled" ? mode.value.mode : status.mode,
    });
  }).finally(() => { pending = null; });
  return pending;
}
function subscribe(callback) {
  if (!subscribers.size) {
    window.addEventListener("provider-catalog-updated", refreshStatus);
    window.addEventListener("provider-key-saved", refreshStatus);
    window.addEventListener("studio-mode-changed", refreshStatus);
    refreshStatus();
  }
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
    if (!subscribers.size) {
      window.removeEventListener("provider-catalog-updated", refreshStatus);
      window.removeEventListener("provider-key-saved", refreshStatus);
      window.removeEventListener("studio-mode-changed", refreshStatus);
    }
  };
}

export function useProviderConnection(provider, mode) {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    needsConnection: providerNeedsConnection(value.connections, provider, mode ?? value.mode),
    loading: !value.connections || (mode == null && value.mode == null),
    refresh: refreshStatus,
  };
}

export function openProviderConnect(options) {
  const detail = connectionRequest(options);
  if (!detail) return false;
  window.dispatchEvent(new CustomEvent(providerConnectEvent, { detail }));
  return true;
}

export function ConnectProviderButton({ provider, feature, returnLabel, className = "", children, ...props }) {
  const request = connectionRequest({ provider, feature, returnLabel });
  if (!request) return null;
  const name = providerDefinitions.find((item) => item.id === request.provider)?.name;
  return <button type="button" className={`provider-connect-button ${className}`}
    title={`Connect ${name}${feature ? ` for ${feature}` : ""}`}
    aria-label={`Connect ${name}${feature ? ` for ${feature}` : ""}`}
    {...props} onClick={(event) => { event.stopPropagation(); openProviderConnect(request); }}>
    <PlugZap size={16} aria-hidden="true" />{children || "Connect"}
  </button>;
}

export function ProviderAction({ provider, mode, feature, returnLabel, children, className }) {
  const { needsConnection } = useProviderConnection(provider, mode);
  return needsConnection
    ? <ConnectProviderButton {...{ provider, feature, returnLabel, className }} />
    : children;
}

// This host is independent of the editor's panel state. The composer, selection,
// playhead and unsaved local fields stay mounted while the guide is in front.
export function ProviderConnectHost() {
  const [request, setRequest] = useState(null);
  const [checking, setChecking] = useState(false);
  const dialog = useRef(null), trigger = useRef(null), returnContext = useRef(null), busy = useRef(false);
  const close = useCallback(() => {
    if (busy.current) return;
    dialog.current?.close();
    setRequest(null);
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
      else if (returnContext.current?.node?.isConnected) {
        const controls = focusableWithin(returnContext.current.node);
        controls[Math.min(returnContext.current.index, controls.length - 1)]?.focus({ preventScroll: true });
      }
      trigger.current = null;
      returnContext.current = null;
    });
  }, []);
  useEffect(() => {
    const open = (event) => {
      const next = connectionRequest(event.detail);
      if (!next || dialog.current?.open) return;
      trigger.current = document.activeElement;
      const node = document.activeElement?.parentElement;
      returnContext.current = { node, index: Math.max(0, focusableWithin(node).indexOf(document.activeElement)) };
      setRequest(next);
    };
    window.addEventListener(providerConnectEvent, open);
    return () => window.removeEventListener(providerConnectEvent, open);
  }, []);
  useEffect(() => {
    if (request && !dialog.current.open) dialog.current.showModal();
  }, [request]);
  if (!request) return null;
  return createPortal(<dialog ref={dialog} className="provider-connect-dialog" aria-label="Connect an AI tool"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onKeyDown={(event) => {
      // Editor shortcuts must never run underneath this focused guide.
      event.stopPropagation();
      if (event.key === "Tab") {
        const controls = focusableWithin(event.currentTarget);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
    }}>
    <header className="provider-connect-header">
      <button type="button" disabled={checking} onClick={close}><ArrowLeft size={16} aria-hidden="true" />{request.returnLabel}</button>
      <button type="button" disabled={checking} className="icon" aria-label="Close connection guide" onClick={close}><X size={18} /></button>
    </header>
    <div className="provider-connect-content">
      <Connections initialProvider={request.provider} feature={request.feature} returnLabel={request.returnLabel}
        onBusy={(value) => { busy.current = value; setChecking(value); }} onChange={refreshStatus} onDone={close} />
    </div>
  </dialog>, document.body);
}
