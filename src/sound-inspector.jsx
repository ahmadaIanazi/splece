import React, { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Copy,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { copyAudio, editAudio } from "../shared/audio-editing.mjs";
import { audioGain } from "../shared/studio.mjs";
import { tc, uid } from "./state";
import { Waveform } from "./audio";
import "./sound-inspector.css";

// Keep rapid input local; one completed gesture produces one saved edit/Undo step.
function SoundSlider({
  label,
  value,
  max = 1,
  step = 0.01,
  format = (v) => `${Math.round(v * 100)}%`,
  onPreview,
  onCommit,
}) {
  const [draft, setDraft] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    current.current = value;
    setDraft(value);
  }, [value]);
  const commit = () => {
    if (current.current !== value) onCommit(current.current);
  };
  return (
    <label className="sound-inspector-slider">
      <span>
        {label}
        <output>{format(draft)}</output>
      </span>
      <input
        type="range"
        min="0"
        max={max}
        step={step}
        value={draft}
        aria-label={label}
        onChange={(e) => {
          const next = Number(e.target.value);
          current.current = next;
          setDraft(next);
          onPreview?.(next);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        onPointerCancel={() => {
          current.current = value;
          setDraft(value);
          onPreview?.(value);
        }}
      />
    </label>
  );
}
function SoundNumber({ label, value, onCommit, max, min = 0 }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  useEffect(() => setDraft(String(Number(value.toFixed(3)))), [value]);
  const commit = () => {
    if (draft.trim() && Number.isFinite(Number(draft))) {
      const next = Math.min(max ?? Infinity, Math.max(min, Number(draft)));
      setDraft(String(Number(next.toFixed(3))));
      if (next !== value) onCommit(next);
    } else setDraft(String(Number(value.toFixed(3))));
  };
  return (
    <label>
      {label}
      <div className="sound-inspector-number">
        <input
          type="number"
          min={min}
          max={max}
          step="0.1"
          value={draft}
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span>s</span>
      </div>
    </label>
  );
}
export function SoundInspector({
  project,
  audioId,
  update,
  onClose,
  onSeek,
  onRegenerate,
  onInspect,
}) {
  const clip = project.audioClips.find((c) => c.id === audioId);
  const audio = useRef(null),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [error, setError] = useState("");
  const [volume, setVolume] = useState(clip?.volume ?? 1);
  const [fadeIn, setFadeIn] = useState(clip?.fadeIn || 0),
    [fadeOut, setFadeOut] = useState(clip?.fadeOut || 0);
  const [name, setName] = useState(clip?.name || "");
  const latest = useRef(null);
  latest.current = clip ? { ...clip, volume, fadeIn, fadeOut } : null;
  useEffect(() => {
    setVolume(clip?.volume ?? 1);
  }, [clip?.volume, clip?.id]);
  useEffect(() => {
    setFadeIn(clip?.fadeIn || 0);
    setFadeOut(clip?.fadeOut || 0);
  }, [clip?.fadeIn, clip?.fadeOut, clip?.id]);
  useEffect(() => {
    setName(clip?.name || "");
  }, [clip?.name, clip?.id]);
  useEffect(() => {
    setPlaying(false);
    setPosition(0);
    setError("");
    audio.current?.pause();
  }, [clip?.id, clip?.mediaId]);
  useEffect(() => {
    if (!playing) return;
    let frame;
    const tick = () => {
      const a = audio.current,
        c = latest.current;
      if (!a || !c) return;
      const local = Math.max(0, a.currentTime - c.in);
      setPosition(Math.min(local, c.duration));
      a.volume = audioGain(c, c.start + local);
      if (local >= c.duration - 0.01) {
        a.pause();
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => {
    if (audio.current && latest.current)
      audio.current.volume = audioGain(latest.current, clip.start + position);
  }, [volume, clip?.mute, fadeIn, fadeOut]);
  if (!clip) return null;
  const patch = (change) =>
    update((p) => {
      const c = p.audioClips.find((v) => v.id === audioId);
      if (c) editAudio(c, change);
    });
  async function audition() {
    const a = audio.current;
    if (!a) return;
    if (!a.paused) {
      a.pause();
      setPlaying(false);
      return;
    }
    onSeek?.(clip.start);
    if (
      a.currentTime < clip.in ||
      a.currentTime >= clip.in + clip.duration - 0.02
    )
      a.currentTime = clip.in;
    a.volume = audioGain(
      latest.current,
      clip.start + Math.max(0, a.currentTime - clip.in),
    );
    try {
      await a.play();
      setPlaying(true);
      setError("");
    } catch {
      setError("This sound could not play. Try again.");
    }
  }
  return (
    <aside className="sound-inspector" aria-label="Sound inspector">
      <header>
        <AudioLines size={18} aria-hidden="true" />
        <strong>Sound</strong>
        <button
          className="icon"
          aria-label="Close sound inspector"
          title="Close inspector"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <label className="sound-inspector-name">
        Name
        <input
          aria-label="Sound name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== clip.name)
              patch({ name: name.trim() });
            else setName(clip.name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </label>
      <div className="sound-audition">
        <div className="sound-audition-wave">
          <Waveform
            mediaId={clip.mediaId}
            sourceIn={clip.in}
            duration={clip.duration}
            volume={clip.mute ? 0 : volume}
          />
        </div>
        <div className="sound-audition-transport">
          <button
            aria-label={
              playing ? "Pause selected sound" : "Preview selected sound"
            }
            title="Listen to this sound only"
            onClick={audition}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <input
            aria-label="Selected sound playback position"
            type="range"
            min="0"
            max={clip.duration}
            step="0.01"
            value={position}
            onChange={(e) => {
              const next = Number(e.target.value);
              setPosition(next);
              if (audio.current) audio.current.currentTime = clip.in + next;
            }}
          />
          <small>{tc(position)}</small>
        </div>
        <audio
          ref={audio}
          src={`/api/media/${clip.mediaId}/audio`}
          preload="metadata"
          onLoadedMetadata={() => {
            if (audio.current) audio.current.currentTime = clip.in;
          }}
          onEnded={() => setPlaying(false)}
          onPause={() => setPlaying(false)}
          onError={() => {
            setError("This sound could not be loaded.");
            setPlaying(false);
          }}
        />
        {error && (
          <small role="alert" className="sound-inspector-error">
            {error}
          </small>
        )}
      </div>
      <div className="sound-inspector-level">
        <SoundSlider
          label="Volume"
          value={clip.volume ?? 1}
          onPreview={setVolume}
          onCommit={(v) => patch({ volume: v })}
        />
        <button
          aria-label={
            clip.mute ? "Unmute selected sound" : "Mute selected sound"
          }
          aria-pressed={!!clip.mute}
          title={clip.mute ? "Unmute" : "Mute"}
          onClick={() => patch({ mute: !clip.mute })}
        >
          {clip.mute ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>
      <div className="sound-inspector-pair">
        <SoundSlider
          label="Fade in"
          value={clip.fadeIn || 0}
          max={clip.duration - (clip.fadeOut || 0)}
          step="0.05"
          format={(v) => `${v.toFixed(1)}s`}
          onPreview={setFadeIn}
          onCommit={(v) => patch({ fadeIn: v })}
        />
        <SoundSlider
          label="Fade out"
          value={clip.fadeOut || 0}
          max={clip.duration - (clip.fadeIn || 0)}
          step="0.05"
          format={(v) => `${v.toFixed(1)}s`}
          onPreview={setFadeOut}
          onCommit={(v) => patch({ fadeOut: v })}
        />
      </div>
      <details className="sound-inspector-timing">
        <summary>Timing</summary>
        <div className="sound-inspector-pair">
          <SoundNumber
            label="Timeline start"
            value={clip.start}
            onCommit={(v) => patch({ start: v })}
          />
          <SoundNumber
            label="Duration"
            value={clip.duration}
            min={0.02}
            max={(clip.sourceDuration || clip.in + clip.duration) - clip.in}
            onCommit={(v) => patch({ duration: v })}
          />
          <SoundNumber
            label="Source start"
            value={clip.in}
            max={Math.max(
              0,
              (clip.sourceDuration || clip.in + clip.duration) - 0.02,
            )}
            onCommit={(v) => patch({ in: v })}
          />
        </div>
      </details>
      {clip.soundtrack && (
        <button
          className="sound-inspector-regenerate"
          onClick={() => onRegenerate?.(clip)}
        >
          <RefreshCw size={15} aria-hidden="true" />
          Regenerate this section
        </button>
      )}
      <footer>
        <button
          aria-label="Duplicate sound"
          title="Duplicate sound"
          onClick={() => {
            const id = uid();
            update((p) => copyAudio(p, clip, id, clip.start + clip.duration));
            onInspect?.(id);
          }}
        >
          <Copy size={16} />
          Duplicate
        </button>
        <button
          aria-label="Delete sound"
          title="Delete sound · Delete or Backspace"
          onClick={() => {
            audio.current?.pause();
            update((p) => {
              p.audioClips = p.audioClips.filter((c) => c.id !== audioId);
            });
            onClose?.();
          }}
        >
          <Trash2 size={16} />
          Delete
        </button>
      </footer>
    </aside>
  );
}
