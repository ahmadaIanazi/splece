import { ownsTransport, editableSelector, controlSelector } from "../shared/editor-shortcuts.mjs";
import React, { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  RotateCcw,
  Columns2,
  LoaderCircle,
  X,
  Maximize2,
} from "lucide-react";
import { comparisonChoices } from "../shared/take-comparison.mjs";
import { api } from "./state";
import "./take-comparison.css";

export function TakeComparison({
  project,
  selectedClipId,
  onClose,
  onPlay,
  timelinePlaying,
}) {
  const choices = comparisonChoices(project),
    preferred = choices.filter((c) => c.clipId === selectedClipId);
  const [keys, setKeys] = useState(() => {
    const activeId = project.clips.find(
      (c) => c.id === selectedClipId,
    )?.activeTake;
    const current =
      preferred.find((c) => c.takeId === activeId) ||
      preferred.at(-1) ||
      choices.at(-1);
    const prior =
      preferred.filter((c) => c.key !== current?.key).at(-1) ||
      choices.find((c) => c.key !== current?.key);
    return [prior?.key, current?.key];
  });
  const [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [listen, setListen] = useState("a");
  const video = useRef(null),
    audio = useRef(null),
    panel = useRef(null);
  const sources = keys.map((k) => choices.find((c) => c.key === k));
  const identity = JSON.stringify([project.id, sources]);
  useEffect(() => {
    let alive = true,
      timer;
    setPreview(null);
    setError("");
    setPlaying(false);
    setPosition(0);
    video.current?.pause();
    if (sources.some((s) => !s)) {
      setError("Choose two completed takes to compare.");
      return;
    }
    async function poll(id) {
      try {
        const r = await api(`/comparisons/${id}`);
        if (!alive) return;
        setPreview(r);
        if (r.state === "failed") setError(r.error);
        else if (r.state !== "ready") timer = setTimeout(() => poll(id), 700);
      } catch (e) {
        if (alive) setError(e.message);
      }
    }
    api(`/projects/${project.id}/comparisons`, { a: keys[0], b: keys[1] })
      .then((r) => {
        if (!alive) return;
        setPreview(r);
        if (r.state === "failed") setError(r.error);
        else if (r.state !== "ready") poll(r.id);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      clearTimeout(timer);
      video.current?.pause();
    };
  }, [identity, retry]);
  useEffect(() => {
    if (timelinePlaying) {
      video.current?.pause();
      setPlaying(false);
    }
  }, [timelinePlaying]);
  useEffect(() => {
    if (audio.current)
      audio.current.gains.forEach((g, i) =>
        g.gain.setTargetAtTime(
          listen === (i < 2 ? "a" : "b") ? 1 : 0,
          audio.current.context.currentTime,
          0.008,
        ),
      );
  }, [listen]);
  useEffect(() => {
    const v = video.current;
    return () => {
      v?.pause();
      v?.removeAttribute("src");
      v?.load();
      audio.current?.context.close().catch(() => {});
    };
  }, []);
  const toggleRef = useRef(null);
  useEffect(() => {
    function keyboard(e) {
      if (e.code !== "Space" || !ownsTransport(e, {
        editable: !!e.target.closest?.(editableSelector),
        control: !!e.target.closest?.(controlSelector + ',[role="dialog"],.creative-composer,.composer-companion'),
      })) return;
      e.preventDefault();
      e.stopPropagation();
      toggleRef.current?.();
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  async function toggle() {
    const v = video.current;
    if (!v || preview?.state !== "ready") return;
    if (!v.paused) {
      v.pause();
      return;
    }
    try {
      if (!audio.current) {
        const context = new AudioContext(),
          source = context.createMediaElementSource(v),
          split = context.createChannelSplitter(4),
          merge = context.createChannelMerger(2);
        source.connect(split);
        const gains = Array.from({ length: 4 }, (_, i) => {
          const g = context.createGain();
          g.gain.value = listen === (i < 2 ? "a" : "b") ? 1 : 0;
          split.connect(g, i);
          g.connect(merge, 0, i % 2);
          return g;
        });
        merge.connect(context.destination);
        audio.current = { context, gains };
      }
      await audio.current.context.resume();
      v.muted = false;
      onPlay?.();
      if (v.currentTime >= v.duration - 0.04) v.currentTime = 0;
      await v.play();
      setError("");
    } catch {
      v.pause();
      v.muted = true;
      setError("Comparison audio could not start. Try playing again.");
    }
  }
  toggleRef.current = toggle;
  return (
    <section
      ref={panel}
      className="take-comparison"
      aria-label="Side-by-side take comparison"
    >
      <header>
        <span>
          <Columns2 size={15} /> Compare takes
        </span>
        <small>One clock · frame-locked picture</small>
        <button
          className="icon"
          aria-label="Fullscreen comparison"
          onClick={() => panel.current.requestFullscreen()}
        >
          <Maximize2 size={15} />
        </button>
        <button
          className="icon"
          aria-label="Close comparison"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="comparison-choices">
        {["a", "b"].map((side, i) => (
          <div key={side}>
            <b>{side.toUpperCase()}</b>
            {sources[i]?.thumbnail && <img src={sources[i].thumbnail} alt="" />}
            <select
              aria-label={`Comparison ${side.toUpperCase()} take`}
              value={keys[i] || ""}
              onChange={(e) =>
                setKeys(keys.map((k, j) => (i === j ? e.target.value : k)))
              }
            >
              {choices.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              aria-label={`Listen to ${side.toUpperCase()}`}
              aria-pressed={listen === side}
              onClick={() => setListen(listen === side ? "mute" : side)}
            >
              {listen === side ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
          </div>
        ))}
      </div>
      <div className="comparison-picture">
        <video
          ref={video}
          src={preview?.state === "ready" ? preview.url : undefined}
          muted
          playsInline
          preload="metadata"
          aria-label="Frame-locked side-by-side preview"
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() =>
            setError(
              "The local comparison could not load. Try preparing it again.",
            )
          }
        />
        {preview?.state !== "ready" && !error && (
          <div role="status">
            <LoaderCircle className="spin" size={20} />
            Preparing paired preview locally…
          </div>
        )}
      </div>
      <footer>
        <button
          className="icon"
          aria-label="Restart comparison"
          onClick={() => {
            video.current.currentTime = 0;
            setPosition(0);
          }}
          disabled={preview?.state !== "ready"}
        >
          <RotateCcw size={15} />
        </button>
        <button
          aria-label={playing ? "Pause comparison" : "Play comparison"}
          onClick={toggle}
          disabled={preview?.state !== "ready"}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <input
          aria-label="Comparison position"
          type="range"
          min="0"
          max={preview?.duration || 1}
          step={1 / 30}
          value={position}
          onChange={(e) => {
            video.current.currentTime = +e.target.value;
            setPosition(+e.target.value);
          }}
          disabled={preview?.state !== "ready"}
        />
        <small>
          {position.toFixed(1)} / {(preview?.duration || 0).toFixed(1)}s
        </small>
      </footer>
      <small className="comparison-caption">
        {listen === "mute" ? "Muted" : `Listening to ${listen.toUpperCase()}`} ·
        aligned at clip start ·{" "}
        {Math.min(...sources.filter(Boolean).map((s) => s.duration)) > 60
          ? "first 60 seconds"
          : "common duration"}
        · 640px-wide previews; originals unchanged
      </small>
      {error && (
        <div role="alert">
          {error}
          <button onClick={() => setRetry((v) => v + 1)}>Try again</button>
        </div>
      )}
    </section>
  );
}
