import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import { usePreviewMedia } from "./preview-media";

// One decoder and one voice element, with an explicit shared audition clock.
// Comparison never changes the timeline's chosen take or its mix.
export function LipSyncCompare({ job, onPlay, timelinePlaying }) {
  const video = useRef(null),
    voice = useRef(null),
    position = useRef(0);
  const [side, setSide] = useState("new"),
    [originalSound, setOriginalSound] = useState(false);
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [error, setError] = useState("");
  const offset = side === "original" ? job.input.source.in : 0;
  const duration = job.input.duration;
  const useVoice = side === "new" || !originalSound;
  const generation = useRef(0);
  const mediaId = side === "new" ? job.media.id : job.input.source.mediaId;
  const preview = usePreviewMedia({
    current: {
      id: mediaId,
      url: side === "new" ? job.media.url : `/api/media/${mediaId}`,
    },
    enabled: true,
    scope: `compare-${job.id}`,
    playing,
  });
  useEffect(() => {
    if (!playing) return;
    let frame;
    const boundary = () => {
      if (
        video.current &&
        video.current.currentTime - offset >= duration - 0.01
      )
        pause();
      else frame = requestAnimationFrame(boundary);
    };
    frame = requestAnimationFrame(boundary);
    return () => cancelAnimationFrame(frame);
  }, [playing, offset, duration]);
  function pause() {
    generation.current++;
    video.current?.pause();
    voice.current?.pause();
    setPlaying(false);
  }
  useEffect(() => {
    const v = video.current,
      a = voice.current;
    return () => {
      generation.current++;
      v?.pause();
      a?.pause();
      v?.removeAttribute("src");
      a?.removeAttribute("src");
      v?.load();
      a?.load();
    };
  }, []);
  useEffect(() => {
    if (timelinePlaying) pause();
  }, [timelinePlaying]);
  function seek(t) {
    t = Math.max(0, Math.min(duration, t));
    position.current = t;
    setTime(t);
    if (video.current?.readyState) video.current.currentTime = offset + t;
    if (voice.current?.readyState)
      voice.current.currentTime = job.input.audioIn + t;
  }
  async function play() {
    if (playing) return pause();
    onPlay?.();
    setError("");
    if (position.current >= duration - 0.04) seek(0);
    const ticket = ++generation.current;
    try {
      const v = video.current,
        a = voice.current;
      v.currentTime = offset + position.current;
      a.currentTime = job.input.audioIn + position.current;
      await Promise.all([v.play(), ...(useVoice ? [a.play()] : [])]);
      if (ticket === generation.current) setPlaying(true);
      else {
        v.pause();
        a.pause();
      }
    } catch {
      pause();
      setError(
        "Playback could not start. Try again once the preview has loaded.",
      );
    }
  }
  function tick() {
    const v = video.current,
      a = voice.current;
    const t = Math.max(0, v.currentTime - offset);
    position.current = Math.min(duration, t);
    setTime(position.current);
    if (t >= duration - 0.025) pause();
    else if (
      useVoice &&
      !v.paused &&
      a.readyState &&
      Math.abs(a.currentTime - (job.input.audioIn + t)) > 0.15
    )
      a.currentTime = job.input.audioIn + t;
  }
  return (
    <div className="lip-compare" aria-label="Compare speaking takes">
      <div
        className="lip-compare-tabs"
        role="group"
        aria-label="Comparison take"
      >
        {[
          ["original", "Original"],
          ["new", "New take"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={side === id}
            onClick={() => {
              pause();
              setSide(id);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
        <small>
          {job.executionMode === "test"
            ? "Offline · mouths unchanged"
            : "Same voice · compare the lips"}
        </small>
      </div>
      <video
        ref={video}
        muted={useVoice}
        playsInline
        preload="metadata"
        src={preview.current?.url || undefined}
        aria-label={`${side === "new" ? "New" : "Original"} speaking take`}
        onLoadedMetadata={() => {
          setError("");
          seek(position.current);
        }}
        onTimeUpdate={tick}
        onEnded={pause}
        onWaiting={() => {
          voice.current?.pause();
        }}
        onPlaying={() => {
          if (useVoice) {
            voice.current.currentTime = job.input.audioIn + position.current;
            voice.current.play().catch(() => {
              pause();
              setError("Voice preview could not play. Try again.");
            });
          }
        }}
        onError={() => {
          pause();
          setError(
            "This preview could not load. Your saved takes are unchanged.",
          );
        }}
      />
      <audio
        ref={voice}
        preload="metadata"
        src={`/api/media/${job.input.audioMediaId}/audio`}
        onLoadedMetadata={() => seek(position.current)}
      />
      <div className="lip-compare-transport">
        <button
          className="icon"
          disabled={!preview.current?.url}
          aria-label={playing ? "Pause comparison" : "Play comparison"}
          onClick={play}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button
          className="icon"
          aria-label="Restart comparison"
          onClick={() => {
            pause();
            seek(0);
          }}
        >
          <RotateCcw size={14} />
        </button>
        <input
          type="range"
          min="0"
          max={duration}
          step="0.01"
          value={time}
          aria-label="Comparison position"
          onChange={(e) => {
            pause();
            seek(Number(e.target.value));
          }}
        />
        <small>
          {time.toFixed(1)} / {duration.toFixed(1)}s
        </small>
      </div>
      {side === "original" && (
        <label className="lip-original-sound">
          <input
            type="checkbox"
            checked={originalSound}
            onChange={(e) => {
              pause();
              setOriginalSound(e.target.checked);
            }}
          />
          Listen to original clip sound
        </label>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
