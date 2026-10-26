import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./state";
import { MemoryLRU, planPreviewSlots } from "../shared/preview-window.mjs";
const records = new MemoryLRU(24, 128 * 1024);

export function usePreviewMedia({
  current,
  next,
  enabled,
  scope,
  playing,
  retry = 0,
}) {
  const [states, setStates] = useState({});
  const currentId = current?.id,
    nextId = next?.id;
  useEffect(() => {
    if (!enabled) {
      setStates({});
      return;
    }
    const client = crypto.randomUUID();
    let alive = true,
      polling = false;
    const ids = [...new Set([currentId, nextId].filter(Boolean))];
    setStates(
      Object.fromEntries(
        ids.map((id) => [id, records.get(id)]).filter(([, v]) => v),
      ),
    );
    async function poll() {
      if (polling || !alive) return;
      polling = true;
      try {
        await api("/preview/working-set", {
          client,
          mediaIds: ids,
        });
        const values = await Promise.all(
          ids.map(async (id) => [id, await api(`/media/${id}/preview-status`)]),
        );
        if (!alive) return;
        const fresh = Object.fromEntries(values);
        for (const [id, value] of values)
          if (value.state === "ready")
            records.set(id, value, JSON.stringify(value).length * 2);
        setStates((previous) =>
          JSON.stringify(previous) === JSON.stringify(fresh) ? previous : fresh,
        );
      } catch {
        if (alive)
          setStates((previous) =>
            Object.fromEntries(
              ids.map((id) => [id, previous[id] || { state: "failed" }]),
            ),
          );
      } finally {
        if (!alive)
          api("/preview/working-set", { client, mediaIds: [] }).catch(() => {});
        polling = false;
      }
    }
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
      api("/preview/working-set", {
        client,
        mediaIds: [],
      }).catch(() => {});
    };
  }, [currentId, nextId, enabled, scope]);
  const selected = useRef(new Map());
  function resolve(take) {
    if (!take) return null;
    const state = states[take.id];
    const desired =
      state?.state === "ready"
        ? state.url
        : state?.state === "failed" || state?.state === "original"
          ? take.url
          : null;
    // Never change a playing clip's source just because background preparation finished.
    const existing = selected.current.get(take.id);
    const chosen = playing && existing ? existing : desired;
    const url =
      chosen && retry && take.id === currentId && !playing
        ? chosen.split("&repair=")[0] +
          (chosen.includes("?") ? "&" : "?") +
          "repair=" +
          retry
        : chosen;
    return { ...take, url, previewState: state?.state || "queued" };
  }
  const resolved = { current: resolve(current), next: resolve(next) };
  useLayoutEffect(() => {
    for (const id of selected.current.keys())
      if (!enabled || ![currentId, nextId].includes(id))
        selected.current.delete(id);
    if (enabled)
      for (const take of [resolved.current, resolved.next])
        if (take?.url) selected.current.set(take.id, take.url);
  });
  return resolved;
}
function release(el) {
  if (!el || (!el.getAttribute("src") && el.networkState === 0)) return;
  el.pause();
  el.removeAttribute("src");
  el.load();
}
export function PreviewDeck({ current, next, videoRef, enabled, playing, onClick, transform }) {
  const slots = useRef([null, null]),
    elements = useRef([null, null]);
  const clickTimer = useRef(null), latestClick = useRef(onClick);
  latestClick.current = onClick;
  const cancelClick = () => { clearTimeout(clickTimer.current); clickTimer.current = null; };
  useEffect(() => cancelClick, [current?.clip.id, enabled, playing]);
  const previewClick = (event) => {
    cancelClick();
    if (event.detail > 1) return;
    if (playing) { latestClick.current?.(); return; }
    // Wait for double-click intent before starting playback/audio.
    clickTimer.current = setTimeout(() => { clickTimer.current = null; latestClick.current?.(); }, 280);
  };
  const plan = planPreviewSlots(
    slots.current,
    enabled ? current : null,
    enabled ? next : null,
  );
  useLayoutEffect(() => {
    slots.current = plan.slots;
    videoRef.current = plan.slots[plan.active]
      ? elements.current[plan.active]
      : null;
    for (let i = 0; i < 2; i++)
      if (!plan.slots[i]) release(elements.current[i]);
  });
  useEffect(
    () => () => {
      elements.current.forEach(release);
      videoRef.current = null;
    },
    [videoRef],
  );
  return plan.slots.map((item, i) => (
    <video
      key={i}
      ref={(el) => {
        elements.current[i] = el;
      }}
      data-preview-slot={i}
      data-active={!!item && i === plan.active}
      aria-hidden={i !== plan.active}
      style={{ display: item && i === plan.active ? "block" : "none", ...(transform ? {position:'absolute',left:`${(transform.x-transform.w/2)*100}%`,top:`${(transform.y-transform.h/2)*100}%`,width:`${transform.w*100}%`,height:`${transform.h*100}%`,objectFit:transform.fit,transform:`rotate(${transform.rotation}deg)`,opacity:transform.opacity} : {}) }}
      src={item?.take.url || undefined}
      poster={item?.take.thumbnail}
      preload={item ? "auto" : "none"}
      playsInline
      muted={i !== plan.active}
      onLoadedMetadata={(event) => {
        if (i !== plan.active && item) {
          const el = event.currentTarget;
          el.currentTime = Math.max(
            0,
            Math.min(item.clip.in || 0, el.duration - 0.001),
          );
          el.pause();
        }
      }}
      onClick={i === plan.active ? previewClick : undefined}
      onDoubleClick={cancelClick}
    />
  ));
}
