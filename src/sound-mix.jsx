import React, { useState, useEffect, useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";
import {
  mixRoles,
  mixState,
  setMixGain,
  setMixMute,
} from "../shared/sound-mix.mjs";
const names = {
  original: "Source audio",
  effect: "Effects",
  ambience: "Ambience",
  dialogue: "Dialogue & voice-over",
};
function Fader({ value, onCommit, label, disabled }) {
  const [gain, setGain] = useState(value);
  const committed = useRef(value);
  useEffect(() => {
    setGain(value);
    committed.current = value;
  }, [value]);
  const commit = () => {
    if (gain !== committed.current) {
      committed.current = gain;
      onCommit(gain);
    }
  };
  return (
    <input
      aria-label={label + " level"}
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={gain}
      disabled={disabled}
      onChange={(e) => setGain(Number(e.target.value))}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
    />
  );
}
export function SoundMix({ project, update }) {
  return (
    <div className="sound-mix" aria-label="Sound layer mixer">
      {mixRoles.map((role) => {
        const state = mixState(project, role);
        return (
          <div key={role} className={state.muted ? "muted" : ""}>
            <span>{names[role]}</span>
            <button
              className="icon"
              disabled={!state.count}
              aria-label={`${state.muted ? "Unmute" : "Mute"} ${names[role].toLowerCase()}`}
              aria-pressed={state.muted}
              onClick={() => update((p) => setMixMute(p, role, !state.muted))}
            >
              {state.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <Fader
              value={state.gain}
              disabled={!state.count}
              label={names[role]}
              onCommit={(v) => update((p) => setMixGain(p, role, v))}
            />
            <small>
              {state.count ? Math.round(state.gain * 100) + "%" : "—"}
            </small>
          </div>
        );
      })}
    </div>
  );
}
