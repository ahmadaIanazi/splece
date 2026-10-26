import React from "react";
import { Palette, X, Plus } from "lucide-react";
import { CreativeDirection } from "./creative-direction";
import { effectiveCreativeDirection } from "../shared/creative-presets.mjs";
export function ProjectVisuals({ project, settings, change, global = false }) {
  const direction = global
    ? settings.creativeDirection || {}
    : effectiveCreativeDirection({ ...project, settings });
  const refs = settings.visualReferences || [];
  const setDirection = (value) =>
    change((p) => (p.settings.creativeDirection = value));
  const images = project.assets.filter((a) => a.media?.kind === "image");
  return (
    <section className="project-visuals" aria-label="Visual consistency">
      <h3>
        <Palette size={16} /> Visual consistency
      </h3>
      <CreativeDirection value={direction} onChange={setDirection} />
      <div className="custom-palette">
        <span>Custom palette</span>
        {(direction.customPalette || []).map((color, i) => (
          <label key={i}>
            <input
              type="color"
              aria-label={`Palette color ${i + 1}`}
              value={color}
              onChange={(e) =>
                setDirection({
                  ...direction,
                  palette: undefined,
                  customPalette: direction.customPalette.map((c, k) =>
                    k === i ? e.target.value : c,
                  ),
                })
              }
            />
            <button
              className="icon"
              aria-label={`Remove palette color ${i + 1}`}
              onClick={() =>
                setDirection({
                  ...direction,
                  customPalette: direction.customPalette.filter(
                    (_, k) => k !== i,
                  ),
                })
              }
            >
              <X size={10} />
            </button>
          </label>
        ))}
        <button
          className="icon"
          aria-label="Add palette color"
          disabled={(direction.customPalette?.length || 0) >= 8}
          onClick={() =>
            setDirection({
              ...direction,
              palette: undefined,
              customPalette: [...(direction.customPalette || []), "#8899bb"],
            })
          }
        >
          <Plus size={14} />
        </button>
      </div>
      {!global && (
        <>
          <p>
            Choose images from Assets to guide every clip. Each keeps its own
            role; model reference limits still apply.
          </p>
          <div className="project-look-assets">
            {images.map((a) => {
              const ref = refs.find((r) => r.assetId === a.id);
              return (
                <div key={a.id} data-selected={!!ref}>
                  <button
                    aria-pressed={!!ref}
                    aria-label={`Project reference ${a.name}`}
                    onClick={() =>
                      change(
                        (p) =>
                          (p.settings.visualReferences = ref
                            ? refs.filter((r) => r.assetId !== a.id)
                            : [...refs, { assetId: a.id, role: "style" }]),
                      )
                    }
                  >
                    <img
                      src={a.media.thumbnail || a.media.url}
                      alt=""
                      loading="lazy"
                    />
                    <span>{a.name}</span>
                  </button>
                  {ref && (
                    <select
                      aria-label={`${a.name} controls`}
                      value={ref.role}
                      onChange={(e) =>
                        change(
                          (p) =>
                            (p.settings.visualReferences = refs.map((r) =>
                              r.assetId === a.id
                                ? { ...r, role: e.target.value }
                                : r,
                            )),
                        )
                      }
                    >
                      <option value="style">Style</option>
                      <option value="palette">Palette</option>
                      <option value="lighting">Lighting</option>
                    </select>
                  )}
                </div>
              );
            })}
          </div>
          {!images.length && (
            <p>
              Add a palette or lighting image in Assets → Style to use it here.
            </p>
          )}
        </>
      )}
    </section>
  );
}
