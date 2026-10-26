import { soundtrackChanges } from "../shared/soundtrack.mjs";
import { MemoryLRU } from "../shared/preview-window.mjs";
import React, {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  AudioLines,
  ChevronDown,
  ChevronRight,
  Copy,
  Clipboard,
  Scissors,
  SplitSquareHorizontal,
  Trash2,
  Volume2,
  VolumeX,
  Plus,
  SlidersHorizontal,
  WandSparkles,
  Blend,
  Layers,
  LoaderCircle,
} from "lucide-react";
import { api, uid, tc } from "./state";
import {
  audioClip,
  freeAudioLane,
  editAudio,
  blendAudio,
  matchAudioLevels,
} from "../shared/audio-editing.mjs";
import { audioGain } from "../shared/studio.mjs";
import { AudioTransport } from "../shared/audio-playback.mjs";
import "./audio.css";

const waves = new MemoryLRU(32, 8 * 1024 * 1024);
export function loadWaveform(id) {
  const existing = waves.get(id);
  if (existing) return existing;
  const promise = api(`/media/${id}/waveform`, undefined, undefined, {
    timeoutMs: 660000,
  })
    .then((value) => {
      // Store lightweight peaks, not decoded audio buffers. Evicted requests cannot
      // reinsert themselves after the user has moved to another part of the edit.
      if (waves.get(id) === promise)
        waves.set(id, promise, JSON.stringify(value).length * 2);
      return value;
    })
    .catch((error) => {
      if (waves.get(id) === promise) waves.delete(id);
      throw error;
    });
  waves.set(id, promise, 1024);
  return promise;
}
export const Waveform = memo(function Waveform({
  mediaId,
  sourceIn = 0,
  duration,
  volume = 1,
  variant = "bars",
}) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    loadWaveform(mediaId)
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [mediaId]);
  const shape = useMemo(() => {
    if (!data) return "";
    const columns = Math.min(420, Math.max(24, Math.ceil(duration * 32)));
    const max = Math.max(0.01, ...data.peaks);
    let result = variant === "area" ? "M0,50" : "";
    for (let i = 0; i < columns; i++) {
      const first = Math.floor(
        (sourceIn + (duration * i) / columns) / data.step,
      );
      const last = Math.ceil(
        (sourceIn + (duration * (i + 1)) / columns) / data.step,
      );
      let peak = 0;
      for (let j = first; j < last; j++)
        peak = Math.max(peak, data.peaks[j] || 0);
      const height = Math.max(0.25, Math.min(22, (peak / max) * 22 * volume));
      const x = (((i + 0.5) / columns) * 1000).toFixed(2);
      result +=
        variant === "area"
          ? `L${x},${(50 - (volume ? height * 2 : 0)).toFixed(2)}`
          : `M${x},${(25 - height).toFixed(2)}V${(25 + height).toFixed(2)}`;
    }
    return variant === "area" ? result + "L1000,50Z" : result;
  }, [data, sourceIn, duration, volume, variant]);
  if (!data)
    return (
      <span className="wave-status" title={error}>
        {error ? "Waveform unavailable" : "Reading waveform…"}
      </span>
    );
  return (
    <svg
      className={`sound-waveform ${variant === "area" ? "wave-area" : ""}`}
      viewBox="0 0 1000 50"
      preserveAspectRatio="none"
      role="img"
      aria-label="Audio waveform"
    >
      <path d={shape} vectorEffect="non-scaling-stroke" />
    </svg>
  );
});
export function ClipAudioShape({ clip, media, sourceIn, onChange }) {
  const [preview, setPreview] = useState(null),
    [open, setOpen] = useState(false);
  const cleanup = useRef(null),
    dragged = useRef(false);
  useEffect(() => () => cleanup.current?.(), []);
  const gain = preview ?? (clip.mute ? 0 : (clip.volume ?? 1));
  const commit = (volume) => onChange({ volume, mute: volume === 0 });
  function begin(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const y = e.clientY,
      initial = gain;
    let next = initial;
    dragged.current = false;
    const move = (event) => {
      if (Math.abs(event.clientY - y) < 3 && !dragged.current) return;
      dragged.current = true;
      next =
        Math.round(
          Math.max(0, Math.min(1, initial + (y - event.clientY) / 100)) * 100,
        ) / 100;
      setPreview(next);
    };
    const release = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      cleanup.current = null;
    };
    const end = () => {
      release();
      if (dragged.current) commit(next);
      setPreview(null);
    };
    const cancel = () => {
      release();
      setPreview(null);
    };
    cleanup.current = release;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
  }
  return (
    <div
      className={`clip-source-wave ${gain === 0 ? "muted" : ""} ${open || preview !== null ? "adjusting" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label="Clip audio volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(gain * 100)}
        aria-valuetext={gain ? `${Math.round(gain * 100)} percent` : "Muted"}
        aria-orientation="vertical"
        className="clip-wave-hit"
        title="Drag up/down to adjust volume · click for mute"
        onPointerDown={begin}
        onClick={() => {
          if (!dragged.current) setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (
            [
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
              "m",
              "Enter",
              "Escape",
            ].includes(e.key)
          ) {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Enter") setOpen(!open);
            else if (e.key === "Escape") setOpen(false);
            else
              commit(
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? 1
                    : e.key === "m"
                      ? gain
                        ? 0
                        : clip.volume || 1
                      : Math.max(
                          0,
                          Math.min(
                            1,
                            gain + (e.key === "ArrowUp" ? 0.05 : -0.05),
                          ),
                        ),
              );
          }
        }}
      >
        <Waveform
          mediaId={media.id}
          sourceIn={sourceIn}
          duration={clip.duration}
          volume={gain}
          variant="area"
        />
      </div>
      {(open || preview !== null) && (
        <div className="clip-wave-control">
          <span>{Math.round(gain * 100)}%</span>
          <button
            aria-label={gain ? "Mute clip audio" : "Unmute clip audio"}
            onClick={() =>
              onChange({ mute: !clip.mute, volume: clip.volume || 1 })
            }
          >
            {gain ? <Volume2 size={12} /> : <VolumeX size={12} />}
          </button>
          <button aria-label="Close clip audio" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
export function AudioPlayback({
  clips,
  time,
  playing,
  seekId,
  onError,
  readTime,
  onWaiting,
}) {
  const [ready, setReady] = useState({});
  const reportReady = useCallback(
    (id, value) =>
      setReady((previous) =>
        previous[id] === value ? previous : { ...previous, [id]: value },
      ),
    [],
  );
  const waiting =
    playing &&
    clips.some(
      (c) =>
        !c.mute &&
        time >= c.start &&
        time < c.start + c.duration &&
        !ready[c.id + c.mediaId],
    );
  useEffect(() => {
    onWaiting?.(waiting);
  }, [waiting, onWaiting]);
  return clips
    .filter((c) => time >= c.start - 2 && time <= c.start + c.duration + 0.2)
    .map((c) => (
      <AudioSource
        key={c.id + c.mediaId}
        clip={c}
        time={time}
        playing={playing && !waiting}
        seekId={seekId}
        onError={onError}
        readTime={readTime}
        reportReady={reportReady}
      />
    ));
}
function AudioSource({
  clip,
  time,
  playing,
  seekId,
  onError,
  readTime,
  reportReady,
}) {
  const ref = useRef(null),
    controller = useRef(null),
    callback = useRef(onError);
  callback.current = onError;
  useEffect(() => {
    const a = ref.current,
      id = clip.id + clip.mediaId;
    const loaded = () => reportReady(id, true),
      waiting = () => reportReady(id, false);
    reportReady(id, a.readyState >= 2);
    a.addEventListener("canplay", loaded);
    a.addEventListener("error", loaded);
    a.addEventListener("waiting", waiting);
    return () => {
      a.removeEventListener("canplay", loaded);
      a.removeEventListener("error", loaded);
      a.removeEventListener("waiting", waiting);
      reportReady(id, false);
    };
  }, [clip.id, clip.mediaId, reportReady]);
  useEffect(() => {
    controller.current = new AudioTransport(ref.current, (message) =>
      callback.current?.(message),
    );
    return () => controller.current.destroy();
  }, []);
  useEffect(() => {
    controller.current.update({ clip, time, playing, seekId, readTime });
  });
  return (
    <audio ref={ref} preload="auto" src={`/api/media/${clip.mediaId}/audio`} />
  );
}
function Tool({ icon: Icon, label, onClick, disabled, active }) {
  return (
    <button
      className={`sound-tool ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={15} />
    </button>
  );
}
export function AudioTimeline({
  onFocusItem,
  project,
  update,
  selected,
  onSelect,
  zoom,
  viewport,
  time,
  snap,
  onSeek,
  onMixer,
  onInspect,
}) {
  const lanes = [...new Set(project.audioClips.map((c) => c.lane || 0))].sort(
    (a, b) => a - b,
  );
  function pointer(e, c, edge) {
    if (!edge && onFocusItem?.(e,c.id)) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(c.id);
    const x = e.clientX,
      y = e.clientY,
      element = e.currentTarget.closest("[data-audio-clip]"),
      rowHeight = element.parentElement.getBoundingClientRect().height;
    element.focus({ preventScroll: true });
    let moved = false,
      next = { ...c };
    const move = (ev) => {
      const delta = (ev.clientX - x) / zoom;
      moved ||= Math.abs(ev.clientX - x) + Math.abs(ev.clientY - y) > 4;
      if (!moved) return;
      next = { ...c };
      if (edge === "left") {
        const shift = Math.max(
          -c.in,
          -c.start,
          Math.min(c.duration - 0.02, delta),
        );
        editAudio(next, {
          in: c.in + shift,
          start: c.start + shift,
          duration: c.duration - shift,
        });
      } else if (edge === "right")
        editAudio(next, { duration: c.duration + delta });
      else {
        next.start = Math.max(0, c.start + delta);
        if (snap) {
          const points = [
            0,
            time,
            ...project.clips.flatMap((v) => [v.start, v.start + v.duration]),
            ...project.audioClips
              .filter((v) => v.id !== c.id)
              .flatMap((v) => [v.start, v.start + v.duration]),
          ];
          const candidates = points
            .flatMap((p) => [p, p - c.duration])
            .filter((p) => p >= 0 && Math.abs(next.start - p) < 8 / zoom)
            .sort(
              (a, b) => Math.abs(next.start - a) - Math.abs(next.start - b),
            );
          if (candidates.length) next.start = candidates[0];
        }
        const row = Math.max(
          0,
          Math.min(
            lanes.length,
            lanes.indexOf(c.lane || 0) +
              Math.round((ev.clientY - y) / rowHeight),
          ),
        );
        next.lane = lanes[row] ?? Math.max(-1, ...lanes) + 1;
      }
      element.style.left = next.start * zoom + "px";
      element.style.width = Math.max(3, next.duration * zoom) + "px";
      element.style.transform = `translateY(${edge ? 0 : (next.lane === c.lane ? 0 : (lanes.indexOf(next.lane) < 0 ? lanes.length : lanes.indexOf(next.lane)) - lanes.indexOf(c.lane)) * rowHeight}px)`;
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      element.style.left = c.start * zoom + "px";
      element.style.width = Math.max(3, c.duration * zoom) + "px";
      element.style.transform = "";
    };
    const cancel = () => cleanup();
    const up = () => {
      cleanup();
      if (moved)
        update((p) => {
          const value = p.audioClips.find((v) => v.id === c.id);
          if (value) Object.assign(value, next);
          p.audioLanes = Math.max(p.audioLanes, next.lane + 1);
        });
      else onSeek(c.start);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }
  if (!lanes.length) return null;
  return (
    <div className="sound-timeline" aria-label="Audio timeline">
      {lanes.map((lane) => (
        <div
          className="sound-track"
          key={lane}
          aria-label={`Audio track ${lane + 1}`}
        >
          <span
            className="sound-track-label"
            style={{ left: viewport.left + 4 }}
          >
            A{lane + 1}
          </span>
          {project.audioClips
            .filter(
              (c) =>
                c.lane === lane &&
                (c.start + c.duration) * zoom >= viewport.left - 200 &&
                c.start * zoom <= viewport.left + viewport.width + 200,
            )
            .map((c) => (
              <div
                key={c.id}
                data-audio-clip={c.id}
                data-sound-role={c.soundtrack?.role}
                data-sound-stale={
                  !!c.soundtrack &&
                  soundtrackChanges(project, c.soundtrack).affected.length > 0
                }
                className={`sound-clip ${c.id === selected ? "selected" : ""} ${c.mute ? "muted" : ""}`}
                style={{
                  left: c.start * zoom,
                  width: Math.max(3, c.duration * zoom),
                }}
                tabIndex={0}
                role="button"
                aria-label={`${c.name}, audio at ${tc(c.start)}`}
                onContextMenu={e=>{if(e.ctrlKey)e.preventDefault();}}
                onPointerDown={(e) => pointer(e, c)}
                onDoubleClick={() => {
                  onSelect(c.id);
                  onInspect ? onInspect(c.id) : onMixer?.();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelect(c.id);
                    onSeek(c.start);
                    onInspect?.(c.id);
                  }
                }}
              >
                <span className="sound-clip-name">
                  {c.mute ? <VolumeX size={11} /> : <AudioLines size={11} />}{" "}
                  {c.name}
                </span>
                <Waveform
                  mediaId={c.mediaId}
                  sourceIn={c.in}
                  duration={c.duration}
                  volume={c.volume ?? 1}
                />
                <svg
                  className="sound-envelope"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path
                    d={Array.from(
                      { length: 41 },
                      (_, i) =>
                        `${i ? "L" : "M"}${i * 2.5},${100 * (1 - audioGain({ ...c, mute: false, volume: 1 }, c.start + (c.duration * i) / 40 - (i === 40 ? 0.00001 : 0)))}`,
                    ).join(" ")}
                  />
                </svg>
                <span
                  className="sound-trim left"
                  title="Trim audio start"
                  onPointerDown={(e) => pointer(e, c, "left")}
                />
                <span
                  className="sound-trim right"
                  title="Trim audio end"
                  onPointerDown={(e) => pointer(e, c, "right")}
                />
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
export function AudioEditor({
  project,
  update,
  time,
  flush,
  notice,
  onImport,
}) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const current = useRef(project);
  current.current = project;
  const sources = [
    ...new Map(
      [
        ...project.assets
          .filter((a) => a.media?.audio)
          .map((a) => ({ ...a.media, name: a.name })),
        ...project.clips.flatMap((c) => c.takes.filter((t) => t.audio)),
      ].map((m) => [m.id, m]),
    ).values(),
  ];
  const change = (id, patch) =>
    update((p) => {
      const c = p.audioClips.find((c) => c.id === id);
      editAudio(c, patch, sources.find((m) => m.id === c.mediaId)?.duration);
    });
  const work = async (label, fn) => {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };
  const match = () =>
    work("Matching levels", async () => {
      const before = JSON.stringify(project.audioClips);
      const data = Object.fromEntries(
        await Promise.all(
          [...new Set(project.audioClips.map((c) => c.mediaId))].map(
            async (id) => [id, await loadWaveform(id)],
          ),
        ),
      );
      if (before !== JSON.stringify(current.current.audioClips))
        throw new Error("Audio changed while measuring. Try matching again.");
      const clips = structuredClone(project.audioClips);
      const count = matchAudioLevels(clips, data);
      update((p) => {
        if (p.id === project.id && p.episodeId === project.episodeId)
          p.audioClips = clips;
      });
      notice(`Matched ${count} clips to a common level.`);
    });
  const merge = () =>
    work("Creating audio mix", async () => {
      const before = JSON.stringify(project.audioClips);
      const revision = await flush();
      const result = await api(
        `/projects/${project.id}/audio-mix`,
        { revision },
        undefined,
        { timeoutMs: 600000 },
      );
      update((p) => {
        if (p.id !== project.id || p.episodeId !== project.episodeId) return;
        p.assets.push({
          id: uid(),
          kind: "footage",
          name: result.media.name,
          description: "Combined audio mix",
          media: result.media,
        });
        if (before === JSON.stringify(p.audioClips))
          p.audioClips = [audioClip(result.media, uid(), result.start)];
      });
      notice(
        before === JSON.stringify(current.current.audioClips)
          ? "Audio combined. Undo restores the individual clips."
          : "Audio mix saved to the library. Your edits are kept.",
      );
    });
  return (
    <div className="sound-editor">
      <div className="sound-editor-actions">
        <button onClick={onImport}>
          <Plus size={14} /> Import audio
        </button>
        <select
          aria-label="Add audio source"
          value=""
          disabled={!!busy}
          onChange={(e) => {
            const m = sources.find((m) => m.id === e.target.value);
            if (m)
              update((p) => {
                const lane = freeAudioLane(p.audioClips, time, m.duration);
                p.audioClips.push(audioClip(m, uid(), time, lane));
                p.audioLanes = Math.max(p.audioLanes, lane + 1);
              });
          }}
        >
          <option value="">Add sound from library…</option>
          {sources.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || "Video take"}
            </option>
          ))}
        </select>
        <button
          disabled={!!busy || project.audioClips.length < 2}
          onClick={match}
        >
          <WandSparkles size={14} /> Match levels
        </button>
        <button
          disabled={!!busy || project.audioClips.length < 2}
          onClick={merge}
        >
          <Layers size={14} /> Combine into mix
        </button>
      </div>
      <p className="sound-help">
        Drag waveforms to move sound; drag their edges to trim. Match levels
        lowers louder clips to a common level. Combining creates a local audio
        file and keeps the originals.
      </p>
      {busy && (
        <p role="status">
          <LoaderCircle size={14} className="spin" /> {busy}…
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!project.audioClips.length && (
        <p>
          Choose a video clip → Clip sound → Detach audio, or import music and
          sound effects.
        </p>
      )}
      {[...project.audioClips]
        .sort((a, b) => a.lane - b.lane || a.start - b.start)
        .map((c) => (
          <article className="sound-editor-card" key={c.id}>
            <header>
              <AudioLines size={16} />
              <input
                aria-label="Audio clip name"
                value={c.name}
                onChange={(e) =>
                  update((p) => {
                    p.audioClips.find((v) => v.id === c.id).name =
                      e.target.value;
                  })
                }
              />
              <span>A{c.lane + 1}</span>
              <Tool
                icon={c.mute ? VolumeX : Volume2}
                label={c.mute ? "Unmute audio clip" : "Mute audio clip"}
                onClick={() => change(c.id, { mute: !c.mute })}
              />
              <Tool
                icon={Trash2}
                label="Remove audio clip"
                onClick={() =>
                  update((p) => {
                    p.audioClips = p.audioClips.filter((v) => v.id !== c.id);
                  })
                }
              />
            </header>
            <Waveform
              mediaId={c.mediaId}
              sourceIn={c.in}
              duration={c.duration}
              volume={c.volume ?? 1}
            />
            <div className="sound-fields">
              {[
                ["start", "Timeline start"],
                ["in", "Source in"],
                ["duration", "Duration"],
                ["fadeIn", "Fade in"],
                ["fadeOut", "Fade out"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label} <small>s</small>
                  <input
                    type="number"
                    aria-label={c.name + " " + label}
                    min={key === "duration" ? 0.02 : 0}
                    step=".05"
                    value={+(c[key] || 0).toFixed(3)}
                    onChange={(e) => change(c.id, { [key]: +e.target.value })}
                  />
                </label>
              ))}
              <label>
                Track
                <input
                  type="number"
                  min="1"
                  max="256"
                  step="1"
                  value={c.lane + 1}
                  onChange={(e) => {
                    change(c.id, { lane: Math.max(0, +e.target.value - 1) });
                  }}
                />
              </label>
            </div>
            <div className="sound-editor-bottom">
              <Volume2 size={14} />
              <input
                aria-label={c.name + " volume"}
                type="range"
                min="0"
                max="1"
                step=".01"
                value={c.volume ?? 1}
                onChange={(e) => change(c.id, { volume: +e.target.value })}
              />
              <output>{Math.round((c.volume ?? 1) * 100)}%</output>
              {c.envelope && <small>Original fade preserved</small>}
              <button
                disabled={!!busy}
                title="Blend into the next clip on this track, using up to 0.5 seconds of spare source audio. Keeps timing fixed."
                onClick={() => {
                  try {
                    const next = structuredClone(project);
                    const duration = blendAudio(next, c.id);
                    update((p) => {
                      p.audioClips = next.audioClips;
                    });
                    setError("");
                    notice(`${duration.toFixed(2)}s crossfade added.`);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                <Blend size={14} /> Crossfade next
              </button>
            </div>
          </article>
        ))}
    </div>
  );
}
