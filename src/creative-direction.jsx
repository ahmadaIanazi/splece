import React from "react";
import { Palette, RotateCcw } from "lucide-react";
import {
  creativeControls,
  normalizeCreativeDirection,
} from "../shared/creative-presets.mjs";
import "./project-templates.css";
export function CreativeDirection({ value = {}, onChange }) {
  const selected = normalizeCreativeDirection(value);
  const palette = creativeControls
    .find((c) => c.id === "palette")
    .options.find((o) => o.id === selected.palette);
  return (
    <details className="starter-direction">
      <summary>
        <Palette size={15} /> Creative direction{" "}
        <span>
          {Object.keys(selected).length
            ? `${Object.keys(selected).length} choices`
            : "Auto"}
        </span>
      </summary>
      <p>Set a starting look. Individual shot instructions take priority.</p>
      <div className="starter-direction-grid">
        {creativeControls.map((c) => (
          <label key={c.id}>
            <span>{c.name}</span>
            <select
              aria-label={`Creative ${c.name.toLowerCase()}`}
              value={selected[c.id] || ""}
              onChange={(e) =>
                onChange(
                  normalizeCreativeDirection({
                    ...selected,
                    [c.id]: e.target.value,
                    ...(c.id === "palette" ? { customPalette: undefined } : {}),
                  }),
                )
              }
            >
              <option value="">Auto</option>
              {c.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {palette && (
        <div className="starter-palette" aria-label={palette.name + " palette"}>
          {palette.colors.map((color) => (
            <span key={color} style={{ background: color }} />
          ))}
          <small>{palette.text}</small>
        </div>
      )}
      <div className="starter-direction-foot">
        <small>
          Pacing guides the edit. Presets add text direction; preview images are
          not attached.
        </small>
        <button
          type="button"
          disabled={!Object.keys(selected).length}
          onClick={() => onChange({})}
        >
          <RotateCcw size={13} /> All Auto
        </button>
      </div>
    </details>
  );
}
