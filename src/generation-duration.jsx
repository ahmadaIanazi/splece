import React from "react";
import { supportedComposerDuration } from "../shared/composer-writing.mjs";

export function GenerationDuration({
  value,
  durations,
  onChange,
  disabled = false,
  label = "Clip generation duration",
}) {
  const max = durations.at(-1) || value;
  return (
    <div
      className="creative-ruler"
      style={{
        "--trim": `${Math.min(100, (100 * value) / max)}%`,
      }}
    >
      <div className="creative-ruler-band" />
      <div className="creative-ruler-ticks" />
      {[
        0,
        ...durations.filter(
          (v) =>
            durations.length <= 8 ||
            v === max ||
            Math.abs(v / (max / 6) - Math.round(v / (max / 6))) < 0.01,
        ),
      ]
        .filter((v, i, a) => a.indexOf(v) === i)
        .map((v) => (
          <span
            key={v}
            className="creative-ruler-label"
            style={{ left: `${(100 * v) / max}%` }}
          >
            {v}
            {v === max ? "s" : ""}
          </span>
        ))}
      <i />
      <input
        type="range"
        aria-label={label}
        onKeyDown={(e) => {
          if (
            ![
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
            ].includes(e.key)
          )
            return;
          e.preventDefault();
          const i = durations.indexOf(value);
          const next =
            e.key === "Home"
              ? durations[0]
              : e.key === "End"
                ? durations.at(-1)
                : durations[
                    Math.max(
                      0,
                      Math.min(
                        durations.length - 1,
                        i +
                          (["ArrowLeft", "ArrowDown"].includes(e.key) ? -1 : 1),
                      ),
                    )
                  ];
          if (next != null && next !== value) onChange(next);
        }}
        aria-valuetext={`${value} seconds`}
        min={0}
        max={max}
        step="0.1"
        value={value}
        disabled={durations.length < 2 || disabled}
        onChange={(e) => {
          const n = supportedComposerDuration(+e.target.value, durations);
          if (n !== null && n !== value) onChange(n);
        }}
      />
    </div>
  );
}
