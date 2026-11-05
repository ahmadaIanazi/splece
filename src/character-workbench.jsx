import { VoiceChoice } from "./voice-choice";
import { characterVoice } from "../shared/soundtrack-dialogue.mjs";
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Plus,
  Star,
  Trash2,
  AudioLines,
  ChevronRight,
  ArrowLeft,
  LoaderCircle,
} from "lucide-react";
import { AssetExchange } from "./asset-exchange";
import { VariantEditor } from "./advanced";
import { CharacterMedia } from "./character";
import { AssetUnderstanding } from "./asset-understanding";
import { AssetOrganizationEditor } from "./library-organization";
import { libraryAssetKey } from "../shared/library-organization.mjs";
import {
  characterLooks,
  lookDetails,
  editCharacterLook,
  promoteCharacterLook,
  removeCharacterLook,
} from "../shared/character-looks.mjs";
import { isProjectOnly, setAssetProjectOnly } from "../shared/asset-scope.mjs";
import "./character-workbench.css";
const AssetGenerator = lazy(() =>
  import("./asset-generator").then((m) => ({ default: m.AssetGenerator })),
);
export function CharacterWorkbench({
  asset,
  project,
  change: onChange,
  onImport,
  onAdopt,
  onStarted,
  organization,
  initialFolderId,
}) {
  const change = (value) =>
    onChange((current) => {
      const next = typeof value === "function" ? value(current) : value;
      return {
        ...next,
        characterProfile: {
          ...(next.visualBrief?.age ? { age: next.visualBrief.age } : {}),
          ...next.characterProfile,
        },
      };
    });
  const [view, setView] = useState(asset.media ? "looks" : "add"),
    [selectedId, setSelectedId] = useState(asset.media?.id),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [suggestion, setSuggestion] = useState(null),
    [pendingReference, setPendingReference] = useState(null);
  const alive = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const gallery = characterLooks(asset),
    selected = gallery.find((m) => m.id === selectedId) || gallery[0],
    look = lookDetails(asset, selected?.id),
    profile = asset.characterProfile || {};
  const patchProfile = (key, value) =>
    change((current) => ({
      ...current,
      characterProfile: { ...current.characterProfile, [key]: value },
    }));
  const patchLook = (patch) =>
    change((current) => editCharacterLook(current, selected?.id, patch));
  async function drop(event) {
    event.preventDefault();
    event.stopPropagation();
    if (lock.current) return;
    const files = [...event.dataTransfer.files].slice(0, 1);
    if (!files.length) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      for (const file of files) {
        if (!/\.(png|jpe?g|webp)$/i.test(file.name))
          throw Error("Choose JPG, PNG or WebP images.");
        const body = new FormData();
        body.append("file", file);
        const response = await fetch(`/api/projects/${project.id}/import`, {
          method: "POST",
          body,
        });
        const media = await response.json();
        if (!response.ok)
          throw Error(media.error || "Could not upload this image.");
        setPendingReference(media);
        setView("add");
      }
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const back = () => setView(gallery.length ? "looks" : "add");
  return (
    <div className="character-sheet" aria-label="Character details">
      <aside className="character-identity">
        <small>Character · all looks</small>
        <div className="character-identity-card">
          <label>
            Name
            <input
              aria-label="Character name"
              placeholder="Name"
              value={asset.name || ""}
              maxLength={100}
              onChange={(e) => change({ ...asset, name: e.target.value })}
            />
          </label>
          <div className="character-identity-pair">
            <label>
              Age
              <input
                aria-label="Character age"
                placeholder="Age or life stage"
                value={profile.age ?? asset.visualBrief?.age ?? ""}
                maxLength={100}
                onChange={(e) => patchProfile("age", e.target.value)}
              />
            </label>
            <label>
              Gender
              <select
                aria-label="Character gender"
                value={asset.gender || ""}
                onChange={(e) => change({ ...asset, gender: e.target.value })}
              >
                <option value="">Not set</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <label>
            Role
            <input
              aria-label="Character role"
              placeholder="Their role in the story"
              value={profile.role || ""}
              maxLength={200}
              onChange={(e) => patchProfile("role", e.target.value)}
            />
          </label>
          <label>
            Personality
            <input
              aria-label="Character personality"
              placeholder="Warm, curious, playful…"
              value={profile.personality || ""}
              maxLength={400}
              onChange={(e) => patchProfile("personality", e.target.value)}
            />
          </label>
          <details>
            <summary>Identity across looks</summary>
            <textarea
              aria-label="Character identity"
              rows={4}
              placeholder="What stays the same in every look?"
              value={profile.identity || ""}
              maxLength={2000}
              onChange={(e) => patchProfile("identity", e.target.value)}
            />
          </details>
        </div>
        <button
          type="button"
          className="character-voice-tile"
          aria-pressed={view === "voice"}
          onClick={() => setView(view === "voice" ? "looks" : "voice")}
        >
          <AudioLines size={20} />
          <span>
            <b>Voice</b>
            <small>
              {[asset.voice?.description, asset.voice?.language]
                .filter(Boolean)
                .join(" · ") || `${characterVoice(project,asset)} · ${project.production?.voiceAssignments?.[asset.id] ? "project override" : asset.voice?.providerVoice ? "default" : "automatic"}`}
            </small>
          </span>
          <ChevronRight size={16} />
        </button>
        <details className="character-organization">
          <summary>Organization</summary>
          <label className="character-scope">
            <input
              type="checkbox"
              checked={isProjectOnly(asset)}
              onChange={(e) =>
                change(setAssetProjectOnly({ ...asset }, e.target.checked))
              }
            />{" "}
            Project only
          </label>
          <AssetOrganizationEditor
            organization={organization}
            assetKey={libraryAssetKey(project.id, asset)}
            asset={asset}
            defaultFolderId={initialFolderId}
          />
        </details>
        <details className="character-organization">
          <summary>Advanced reference tools</summary>
          <AssetExchange asset={asset} project={project} change={change} />
          <VariantEditor
            asset={asset}
            change={change}
            mediaAssets={project.assets.filter(
              (item) => item.media?.kind === "image",
            )}
          />
        </details>
      </aside>
      <section
        className="character-looks-workspace"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDrop={drop}
      >
        {view === "voice" ? (
          <>
            <header>
              <button type="button" onClick={back}>
                <ArrowLeft size={15} /> Looks
              </button>
              <small>Voice · all looks</small>
            </header>
            <VoiceChoice project={project} asset={asset} value={asset.voice?.providerVoice || ""} onChange={providerVoice=>change({...asset,voice:{...asset.voice,providerVoice}})}/>
            {project.production?.voiceAssignments?.[asset.id] && <small>This project uses {project.production.voiceAssignments[asset.id]} as an override. Change it in Sound → Dialogue.</small>}
            <CharacterMedia asset={asset} change={change} voiceOnly />
          </>
        ) : (
          <>
            <header>
              <small>
                {["generate", "library", "add"].includes(view)
                  ? "Add a look"
                  : "Looks"}
              </small>
              {view !== "looks" && gallery.length > 0 && (
                <button type="button" onClick={back}>
                  <ArrowLeft size={14} /> Back to looks
                </button>
              )}
            </header>
            {!!gallery.length && view === "looks" && (
              <div
                className="character-looks-strip"
                aria-label="Character looks"
              >
                {gallery.map((media, index) => (
                  <button
                    type="button"
                    key={media.id}
                    aria-pressed={view === "looks" && selected?.id === media.id}
                    onClick={() => {
                      setSelectedId(media.id);
                      setView("looks");
                    }}
                  >
                    <span>
                      <img
                        src={
                          media.thumbnail ||
                          media.url ||
                          `/api/media/${media.id}/original`
                        }
                        alt=""
                      />
                      {asset.media?.id === media.id && <Star size={12} />}
                    </span>
                    <small>
                      {lookDetails(asset, media.id).name || `Look ${index + 1}`}
                    </small>
                  </button>
                ))}
                <button
                  type="button"
                  className="character-add-look"
                  aria-label="Add look"
                  onClick={() => {
                    setPendingReference(null);
                    setSuggestion(null);
                    setView("add");
                  }}
                >
                  <span>
                    <Plus size={22} />
                  </span>
                  <small>Add</small>
                </button>
              </div>
            )}
            {["add", "generate", "library"].includes(view) || !selected ? (
              <Suspense fallback={<p>Opening image creator…</p>}>
                <AssetGenerator
                  key={pendingReference?.id || suggestion?.id || "create"}
                  embedded
                  asset={asset}
                  project={project}
                  onStarted={onStarted}
                  onAdopt={onAdopt}
                  initialReference={pendingReference}
                  initialSourceMediaId={selected?.id}
                  initialDirection={suggestion?.prompt}
                  change={(next) => {
                    change(next);
                    const added = characterLooks(next).find(
                      (m) => !gallery.some((old) => old.id === m.id),
                    );
                    setSelectedId(added?.id || selected?.id || next.media?.id);
                    setPendingReference(null);
                    setView("looks");
                  }}
                  onReferenceAdded={change}
                />
              </Suspense>
            ) : (
              selected && (
                <article className="character-look-card">
                  <div className="character-look-image">
                    <img
                      src={`/api/media/${selected.id}/original`}
                      alt={look.name || asset.name}
                    />
                    <div>
                      <button
                        type="button"
                        aria-pressed={asset.media?.id === selected.id}
                        onClick={() =>
                          change((current) =>
                            promoteCharacterLook(current, selected.id),
                          )
                        }
                      >
                        <Star size={14} />
                        {asset.media?.id === selected.id ? "Main" : "Make main"}
                      </button>
                      <button
                        type="button"
                        aria-label="Remove this look"
                        onClick={() => {
                          change((current) =>
                            removeCharacterLook(current, selected.id),
                          );
                          setSelectedId(null);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="character-look-fields">
                    <header>
                      <input
                        aria-label="Look name"
                        value={look.name || ""}
                        maxLength={100}
                        placeholder="Name this look"
                        onChange={(e) => patchLook({ name: e.target.value })}
                      />
                      <small>This look only</small>
                    </header>
                    <AssetUnderstanding
                      key={selected.id}
                      asset={asset}
                      project={project}
                      change={change}
                      selectedMediaId={selected.id}
                      onVariation={(choice) => {
                        setSuggestion({ ...choice, id: Date.now() });
                        setView("generate");
                      }}
                    />
                    <label>
                      Appearance
                      <textarea
                        aria-label="Current look description"
                        rows={5}
                        maxLength={4000}
                        placeholder="Clothing, features, expression… Use Update description to read this image."
                        value={look.description || ""}
                        onChange={(e) =>
                          patchLook({
                            description: e.target.value,
                            visualBrief: {},
                          })
                        }
                      />
                    </label>
                    <label>
                      Movement & setting
                      <textarea
                        aria-label="Look movement and setting"
                        rows={3}
                        maxLength={600}
                        placeholder="Pose, action, setting and light…"
                        value={look.tags?.setting || ""}
                        onChange={(e) =>
                          patchLook({
                            tags: { ...look.tags, setting: e.target.value },
                          })
                        }
                      />
                    </label>
                    <label className="character-scope">
                      <input
                        type="checkbox"
                        checked={!!asset.contactSheets?.includes(selected.id)}
                        onChange={(e) =>
                          change({
                            ...asset,
                            contactSheets: e.target.checked
                              ? [
                                  ...new Set([
                                    ...(asset.contactSheets || []),
                                    selected.id,
                                  ]),
                                ]
                              : (asset.contactSheets || []).filter(
                                  (id) => id !== selected.id,
                                ),
                          })
                        }
                      />{" "}
                      Character reference sheet
                    </label>
                  </div>
                </article>
              )
            )}
          </>
        )}
        {busy && (
          <p role="status">
            <LoaderCircle className="spin" size={15} /> Saving images…
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
