import React from "react";
import { Plus, LockKeyhole, Unlock } from "lucide-react";
import { directShot, directorStyles } from "../shared/reel-director.mjs";

export function ReelDirection({
  shot,
  source,
  project,
  disabled,
  picking,
  onPick,
  onChange,
  onAnalyze,
}) {
  const subjects = shot.subjects || [],
    director = {
      mode: "dialogue",
      style: "natural",
      lines: [],
      ...shot.director,
    };
  const characters = project.assets.filter((a) => a.kind === "character");
  const apply = (patch) =>
    onChange(
      directShot(
        {
          ...shot,
          subjects,
          director: { ...director, ...patch, locked: false },
        },
        source,
      ),
    );
  return (
    <div className="reel-direction">
      <div className="reel-direction-controls">
        <label>
          Direction
          <select
            aria-label="Direction style"
            disabled={disabled}
            value={director.style}
            onChange={(e) => apply({ style: e.target.value })}
          >
            {directorStyles.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Framing
          <select
            aria-label="Camera framing"
            disabled={disabled}
            value={
              director.mode === "subject" ? director.subjectId : director.mode
            }
            onChange={(e) =>
              apply(
                ["wide", "dialogue"].includes(e.target.value)
                  ? { mode: e.target.value }
                  : { mode: "subject", subjectId: e.target.value },
              )
            }
          >
            <option value="dialogue">Follow dialogue</option>
            <option value="wide">Keep everyone · wide</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                Follow {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={disabled}
          aria-pressed={!!director.locked}
          onClick={() =>
            onChange({ director: { ...director, locked: !director.locked } })
          }
        >
          {director.locked ? <LockKeyhole size={14} /> : <Unlock size={14} />}{" "}
          {director.locked ? "Framing locked" : "Lock framing"}
        </button>
      </div>
      <details open={subjects.length === 0 || undefined} className="reel-cast">
        <summary>Subjects & dialogue · {subjects.length} in this shot</summary>
        <div className="reel-subjects">
          {subjects.map((s, i) => (
            <div className="reel-subject" key={s.id}>
              {s.thumbnail ? (
                <img src={s.thumbnail} alt={s.name} />
              ) : (
                <span className="reel-subject-placeholder">{i + 1}</span>
              )}
              <div>
                <input
                  aria-label={`Subject ${i + 1} name`}
                  value={s.name}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({
                      subjects: subjects.map((x) =>
                        x.id === s.id ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
                <select
                  aria-label={`Subject ${i + 1} character`}
                  value={s.characterId || ""}
                  disabled={disabled}
                  onChange={(e) => {
                    const character = characters.find(
                      (c) => c.id === e.target.value,
                    );
                    const next = subjects.map((x) =>
                      x.id === s.id
                        ? {
                            ...x,
                            characterId: e.target.value,
                            name: character?.name || x.name,
                          }
                        : x,
                    );
                    const lines = director.lines.map((l) =>
                      !l.manual && l.characterId === e.target.value && e.target.value
                        ? { ...l, subjectId: s.id }
                        : l,
                    );
                    onChange(
                      directShot(
                        {
                          ...shot,
                          subjects: next,
                          director: { ...director, lines },
                        },
                        source,
                      ),
                    );
                  }}
                >
                  <option value="">Choose character…</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <small>
                  {s.kind === "selected" ? "Selected subject" : "Detected face"}
                  {s.points.length < 3 ? " · check tracking" : ""}
                </small>
              </div>
              <button
                aria-label={`Remove ${s.name}`}
                disabled={disabled}
                onClick={() => {
                  const next = subjects.filter((x) => x.id !== s.id),
                    lines = director.lines.map((l) =>
                      l.subjectId === s.id ? { ...l, subjectId: "" } : l,
                    );
                  onChange(
                    directShot(
                      {
                        ...shot,
                        subjects: next,
                        director: {
                          ...director,
                          lines,
                          subjectId:
                            director.subjectId === s.id
                              ? ""
                              : director.subjectId,
                          mode:
                            director.subjectId === s.id
                              ? "wide"
                              : director.mode,
                          locked: false,
                        },
                      },
                      source,
                    ),
                  );
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          disabled={disabled || subjects.length >= 6}
          aria-pressed={picking}
          onClick={onPick}
        >
          <Plus size={14} />{" "}
          {picking ? "Cancel selection" : "Select a character in footage"}
        </button>
        {picking && (
          <p role="status">
            Pause on a clear frame, then click the character or draw around
            them. Works with birds and creatures too; check the track afterward.
          </p>
        )}
        {subjects.some((s) => s.kind === "selected") && (
          <button disabled={disabled || director.locked} onClick={onAnalyze}>
            Refresh subject tracking
          </button>
        )}
        {!!director.lines.length && (
          <div className="reel-speaker-lines">
            <small>
              {director.lines.every((l) => l.timing === "recorded")
                ? "Recorded dialogue timing. Assign each speaker once."
                : "Caption timing. Choose who speaks; captions alone cannot identify the speaker."}
            </small>
            {director.lines.map((l, i) => (
              <label key={i}>
                <span>
                  <small>
                    {l.start.toFixed(1)}–{l.end.toFixed(1)}s
                  </small>
                  <span dir="auto">{l.text || l.name || "Dialogue"}</span>
                </span>
                <select
                  aria-label={`Dialogue ${i + 1} subject`}
                  disabled={disabled}
                  value={l.subjectId || ""}
                  onChange={(e) =>
                    apply({
                      lines: director.lines.map((x, k) =>
                        k === i ? { ...x, subjectId: e.target.value, manual: true } : x,
                      ),
                    })
                  }
                >
                  <option value="">Keep context</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        {!director.lines.length && (
          <small>
            No timed dialogue in this shot. Choose a subject to follow or keep
            everyone in view.
          </small>
        )}
      </details>
    </div>
  );
}
