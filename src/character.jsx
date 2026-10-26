import React from "react";
import { voicePresets, applyVoicePreset } from "../shared/voice-presets.mjs";
export function CharacterMedia({ asset, change, voiceOnly = false }) {
  const images = [asset.media, ...(asset.mediaList || [])]
    .filter(Boolean)
    .filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i);
  return (
    <section className="character-profile">
      {!voiceOnly && (
        <>
          {asset.media && (
            <img
              className="character-main"
              alt={asset.name || "Character reference"}
              src={
                asset.media.kind === "image"
                  ? `/api/media/${asset.media.id}/original`
                  : asset.media.thumbnail
              }
            />
          )}
          <div className="character-gallery">
            {images.map((m) => (
              <article key={m.id}>
                <button
                  type="button"
                  title="Set default reference"
                  aria-pressed={asset.media?.id === m.id}
                  onClick={() =>
                    change({ ...asset, media: m, mediaList: images })
                  }
                >
                  <img src={m.thumbnail} alt={m.name || "Reference"} />
                  <span>
                    {asset.media?.id === m.id ? "Default" : "Set default"}
                  </span>
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={!!asset.contactSheets?.includes(m.id)}
                    onChange={(e) =>
                      change({
                        ...asset,
                        contactSheets: e.target.checked
                          ? [...(asset.contactSheets || []), m.id]
                          : (asset.contactSheets || []).filter(
                              (id) => id !== m.id,
                            ),
                      })
                    }
                  />{" "}
                  {asset.kind === "character" ? "Pose grid" : "Reference grid"}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const remaining = images.filter((x) => x.id !== m.id);
                    change({
                      ...asset,
                      media:
                        asset.media?.id === m.id
                          ? remaining[0] || null
                          : asset.media,
                      mediaList: remaining,
                    });
                  }}
                >
                  Remove
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      {voiceOnly && asset.kind === "character" && (
        <>
          <fieldset className="character-gender">
            <legend>Character gender</legend>
            {[
              ["male", "♂", "Male"],
              ["female", "♀", "Female"],
              ["other", "⚧", "Other"],
            ].map(([value, icon, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={asset.gender === value}
                onClick={() => change({ ...asset, gender: value })}
              >
                <span aria-hidden="true">{icon}</span> {label}
              </button>
            ))}
          </fieldset>
          <h3>Voice identity</h3>
          <p className="muted">
            Reused for this character’s spoken lines. Descriptions guide
            delivery; they do not lock or clone a voice.
          </p>
          <label className="field">
            <span>Voice preset</span>
            <select
              aria-label="Voice preset"
              value={asset.voice?.preset || ""}
              onChange={(e) =>
                change({
                  ...asset,
                  voice: applyVoicePreset(asset.voice, e.target.value),
                })
              }
            >
              <option value="">Custom voice…</option>
              {[...new Set(voicePresets.map((p) => p.group))].map((group) => (
                <optgroup key={group} label={group}>
                  {voicePresets
                    .filter((p) => p.group === group)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="details-grid">
            {["tone", "timbre", "pitch", "pace", "accent", "language"].map(
              (k) => (
                <label className="field" key={k}>
                  <span>{k}</span>
                  <input
                    aria-label={"Character voice " + k}
                    value={asset.voice?.[k] || ""}
                    placeholder="Auto"
                    list={"voice-choices-" + k}
                    onChange={(e) =>
                      change({
                        ...asset,
                        voice: {
                          ...asset.voice,
                          preset: "",
                          [k]: e.target.value,
                        },
                      })
                    }
                  />
                  <datalist id={"voice-choices-" + k}>
                    {(
                      {
                        pitch: [
                          "Very low",
                          "Low",
                          "Mid-range",
                          "High",
                          "Very high",
                        ],
                        pace: [
                          "Slow",
                          "Measured",
                          "Natural",
                          "Quick",
                          "Variable",
                        ],
                        tone: [
                          "Warm",
                          "Neutral",
                          "Confident",
                          "Gentle",
                          "Playful",
                          "Dramatic",
                        ],
                        timbre: [
                          "Smooth",
                          "Breathy",
                          "Resonant",
                          "Raspy",
                          "Metallic",
                          "Clear",
                        ],
                        accent: [
                          "Najdi",
                          "Hijazi",
                          "Khaliji",
                          "Egyptian",
                          "Levantine",
                          "American",
                          "British",
                        ],
                        language: [
                          "Arabic",
                          "English",
                          "French",
                          "Spanish",
                          "Hindi",
                          "Japanese",
                        ],
                      }[k] || []
                    ).map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </label>
              ),
            )}
          </div>
          <label className="field">
            <span>Voice direction</span>
            <textarea
              value={asset.voice?.description || ""}
              placeholder="Warm, low register; a measured cadence with soft consonants…"
              onChange={(e) =>
                change({
                  ...asset,
                  voice: { ...asset.voice, description: e.target.value },
                })
              }
            />
          </label>
        </>
      )}
    </section>
  );
}
export function appendCharacterImage(old, media) {
  return {
    ...old,
    media: old.media || media,
    mediaList: [old.media, ...(old.mediaList || []), media]
      .filter(Boolean)
      .filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i),
  };
}
