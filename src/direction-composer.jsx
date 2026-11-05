import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Sun,
  Camera,
  Palette,
  Plus,
  Link2,
  Trash2,
  SlidersHorizontal,
  Film,
  Check,
} from "lucide-react";
import { directionControls } from "../shared/timeline-direction.mjs";
import { tc } from "./state";

export const directionFamilies = [
  {
    id: "lighting",
    name: "Lighting",
    icon: Sun,
    controls: ["lighting"],
    color: "#edc281",
  },
  {
    id: "camera",
    name: "Camera",
    icon: Camera,
    controls: ["movement", "lens"],
    color: "#8bc5df",
  },
  {
    id: "style",
    name: "Style",
    icon: Palette,
    controls: ["look", "palette", "realism"],
    color: "#b9a0ea",
  },
];
export function directionFamily(record) {
  const matches = directionFamilies.filter((f) =>
    f.controls.some((key) => record.settings?.[key]),
  );
  return matches.length === 1
    ? matches[0]
    : { name: "Direction", icon: SlidersHorizontal, color: "#b9a0ea" };
}

export function DirectionComposer({
  selected,
  groups,
  coverage,
  patch,
  add,
  bind,
  adjusted,
  remove,
  onClose,
  hasRange,
  step,
}) {
  const [family, setFamily] = useState("lighting");
  useEffect(() => {
    const match = directionFamilies.find((f) =>
      f.controls.some((key) => selected?.settings?.[key]),
    );
    if (match) setFamily(match.id);
  }, [selected?.id]);
  const current = directionFamilies.find((f) => f.id === family);
  const changeSetting = (control, value) => {
    if (!selected) {
      add("", value ? { [control]: value } : {});
      return;
    }
    const settings = { ...selected.settings };
    if (value) settings[control] = value;
    else delete settings[control];
    if (control === "palette") delete settings.customPalette;
    patch(selected.id, { settings });
  };
  return (
    <section
      className="direction-composer"
      aria-label="Direction composer"
      style={{ "--direction-accent": current.color }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header className="direction-composer-header">
        <button
          className="direction-icon-button"
          aria-label="Close direction"
          onClick={onClose}
        >
          <ArrowLeft size={17} />
        </button>
        <div>
          <small>Visual direction</small>
          <strong>Direction</strong>
        </div>
        <button
          className="direction-icon-button"
          aria-label="New direction range"
          title={
            hasRange
              ? "New direction in selected range"
              : "New direction at playhead"
          }
          onClick={() => add()}
        >
          <Plus size={18} />
        </button>
      </header>
      <div className="direction-composer-scroll">
        <p className="studio-uplift-note">Guides future generations in this range. Existing footage stays as it is.</p>
        {selected ? (
          <div className="direction-selection">
            <div className="direction-name-row">
              <input
                aria-label="Direction title"
                key={`${selected.id}-${selected.title}`}
                defaultValue={selected.title}
                maxLength={100}
                placeholder="Name this direction"
                onBlur={(e) => {
                  const title = e.target.value.trim() || "Untitled direction";
                  if (title !== selected.title) patch(selected.id, { title });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <button
                role="switch"
                aria-label="Enable direction"
                aria-checked={selected.enabled !== false}
                className="direction-switch"
                onClick={() =>
                  patch(selected.id, { enabled: selected.enabled === false })
                }
              >
                <span />
              </button>
              <button
                className="direction-icon-button"
                aria-label="Delete direction"
                title="Delete direction"
                onClick={() => remove(selected.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <details className="direction-range-details">
              <summary>
                <SlidersHorizontal size={13} />
                <span>
                  {tc(selected.start)} <span aria-hidden="true">→</span>{" "}
                  {tc(selected.end)}
                </span>
                <small>
                  {selected.groupId ? "Follows group" : "Adjust range"}
                </small>
              </summary>
              <div className="direction-timing">
                <label className="direction-binding">
                  <Link2 size={13} />
                  <select
                    aria-label="Direction timing source"
                    value={selected.groupId || ""}
                    onChange={(e) => bind(selected, e.target.value)}
                  >
                    <option value="">Fixed time range</option>
                    {selected.groupId &&
                      !groups.some((g) => g.id === selected.groupId) && (
                        <option value={selected.groupId}>Missing group</option>
                      )}
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title}
                      </option>
                    ))}
                  </select>
                </label>
                {!selected.groupId &&
                  ["start", "end"].map((edge) => (
                    <label className="direction-time-field" key={edge}>
                      {edge === "start" ? "From" : "To"}
                      <input
                        key={`${selected.id}-${edge}-${selected[edge]}`}
                        aria-label={`Direction ${edge} in seconds`}
                        type="number"
                        min={edge === "start" ? 0 : selected.start + step}
                        max={edge === "start" ? selected.end - step : 86400}
                        step={step}
                        defaultValue={Number(selected[edge].toFixed(3))}
                        onBlur={(e) => {
                          const value = e.target.valueAsNumber;
                          if (Number.isFinite(value))
                            patch(
                              selected.id,
                              adjusted(selected, value - selected[edge], edge),
                            );
                          else
                            e.target.value = Number(selected[edge].toFixed(3));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                      <small>s</small>
                    </label>
                  ))}
              </div>
            </details>
            {!selected.resolved && (
              <p className="direction-warning">
                Group missing. Choose a group or use a fixed range.
              </p>
            )}
          </div>
        ) : (
          <p className="direction-intro">
            Choose a preset to begin at the playhead, or drag on the ruler to
            choose a range.
          </p>
        )}
        <nav className="direction-family-tabs" aria-label="Direction settings">
          {directionFamilies.map(({ id, name, icon: Icon, color }) => (
            <button
              key={id}
              aria-pressed={id === family}
              onClick={() => setFamily(id)}
              style={{ "--family-color": color }}
            >
              <Icon size={17} />
              {name}
            </button>
          ))}
        </nav>
        <div className="direction-choices">
          {current.controls.map((id) => {
            const control = directionControls.find((c) => c.id === id);
            return (
              <fieldset key={id}>
                <legend>{control.name}</legend>
                <div
                  className={`direction-choice-grid ${id === "palette" ? "palettes" : ""}`}
                >
                  {[
                    {
                      id: "",
                      name: "Follow project",
                      text: "Use the project defaults and any other overlapping direction.",
                    },
                    ...control.options,
                  ].map((option) => (
                    <button
                      key={option.id}
                      aria-pressed={
                        (selected?.settings?.[id] || "") === option.id
                      }
                      title={option.text}
                      onClick={() => changeSetting(id, option.id)}
                    >
                      {option.colors ? (
                        <span className="direction-swatches">
                          {option.colors.map((color) => (
                            <i key={color} style={{ background: color }} />
                          ))}
                        </span>
                      ) : id === "lighting" && option.id ? (
                        <span
                          className={`direction-light-sample light-${option.id}`}
                          aria-hidden="true"
                        />
                      ) : null}
                      <span>{option.name}</span>
                      {selected?.settings?.[id] === option.id && (
                        <Check size={12} />
                      )}
                    </button>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </div>
      <footer className="direction-composer-footer">
        <div>
          <Film size={14} />
          <strong>
            {coverage.length} {coverage.length === 1 ? "clip" : "clips"} in
            range
          </strong>
          <small>
            {selected?.enabled === false ? "Disabled" : "Next generations"}
          </small>
        </div>

        <p title="Where ranges overlap, the most recently added range wins for each setting. Explicit clip and shot choices take priority over these defaults.">
          Shot instructions take priority. Existing footage stays unchanged.
        </p>
      </footer>
    </section>
  );
}
