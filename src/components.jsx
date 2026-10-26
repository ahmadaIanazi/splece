import { saveAssetEdit } from "../shared/asset-edit.mjs";
import { AssetWorkbench } from "./asset-workbench";
import { saveLocalDraft } from "../shared/local-draft.mjs";
import {
  isProjectOnly,
  hasReferenceImage,
  needsReferenceApproval,
  setAssetProjectOnly,
} from "../shared/asset-scope.mjs";
import { ProjectStart } from "./project-start";
import { AssetTypePicker } from "./asset-type-picker";
import {
  assetTypes,
  libraryAssetKey,
} from "../shared/library-organization.mjs";
import {
  useLibraryOrganization,
  AssetOrganizationEditor,
} from "./library-organization";

import { AssetExchange } from "./asset-exchange";
import { CharacterMedia, appendCharacterImage } from "./character";
import { MentionInput } from "./mentions";
import { VariantEditor, SceneExtras } from "./advanced";
import { editAsset } from "../shared/studio.mjs";
import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import {
  Star,
  AudioLines,
  ArrowLeft,
  Package,
  Palette,
  Film,
  LayoutGrid,
  Plus,
  X,
  FolderOpen,
  Download,
  Upload,
  Copy,
  Trash2,
  ChevronDown,
  ArrowUpRight,
  ArrowRight,
  Image,
  UserRound,
  MapPin,
  Paperclip,
  Settings2,
  Play,
  RotateCcw,
  FileText,
  HardDrive,
  Sparkles,
  Speech,
  LoaderCircle,
  Folder,
  Search,
  Check,
} from "lucide-react";
import { api, uid, tc } from "./state";
const AssetGenerator = lazy(() =>
  import("./asset-generator").then((m) => ({ default: m.AssetGenerator })),
);
const takeOf = (c) => c?.takes.find((t) => t.id === c.activeTake);
function Icon({
  icon: Component,
  label,
  onClick,
  active,
  disabled,
  className = "",
  ...rest
}) {
  return (
    <button
      type="button"
      className={`icon ${active ? "active" : ""} ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      <Component size={17} />
    </button>
  );
}
function Modal({ title, onClose, children, wide, className = "" }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const el = ref.current;
    const focusable = () => {
      const collapsed = [...el.querySelectorAll("details:not([open])")];
      return [
        ...el.querySelectorAll(
          'button,input,textarea,select,summary,a[href],[tabindex="0"]',
        ),
      ].filter(
        (node) =>
          !node.matches(":disabled") &&
          !node.closest("[inert]") &&
          node.getClientRects().length &&
          !collapsed.some(
            (details) =>
              details.contains(node) &&
              !details.querySelector(":scope > summary")?.contains(node),
          ),
      );
    };
    if (!el.contains(document.activeElement)) focusable()[0]?.focus();
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const nodes = focusable();
        if (!nodes.length) return;
        const first = nodes[0],
          last = nodes.at(-1);
        if (!el.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="veil"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""} ${className}`}
      >
        <header>
          <h2>{title}</h2>
          <Icon icon={X} label="Close dialog" onClick={onClose} />
        </header>
        {children}
      </section>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
const automationLabels = {
  specs: "General specifications",
  characters: "Character descriptions",
  background: "Story continuity",
  remarks: "Timeline notes",
  frames: "Start & end frames",
  camera: "Camera instructions",
  dialogue: "Dialogue formatting",
  startFrame: "Automatic start frame",
  endFrame: "Automatic end frame",
  enhance: "Reviewed preparation",
};
function AutoTag() {
  return (
    <span className="auto-tag">
      <Sparkles size={10} /> AUTO
    </span>
  );
}
function BoundaryFrames({ prepared, model, enabled, onToggle }) {
  return (
    <div className="boundary-section">
      <div className="boundary-heading">
        <span>CONTINUITY</span>
        <button onClick={onToggle} className={enabled ? "on" : ""}>
          <Sparkles size={11} />
          {enabled ? "Auto" : "Off"}
        </button>
      </div>
      <div className="boundary-grid">
        {[
          [
            "Start frame",
            prepared.boundaries.start || prepared.continuityReference,
            true,
          ],
          [
            "End frame",
            prepared.boundaries.end || prepared.continuityEndReference,
            false,
          ],
        ].map(([label, c, start]) => {
          const m = c?.takeId ? { id: c.takeId } : null;
          return (
            <div className="boundary" key={label}>
              {m && enabled ? (
                <img
                  src={`/api/media/${m.id}/frame?time=${Math.max(0, c.time)}`}
                />
              ) : (
                <div>
                  <Image size={19} />
                </div>
              )}
              <span>
                {label}
                <small>
                  {!enabled
                    ? "Disabled"
                    : (
                          start
                            ? prepared.continuityReference
                            : prepared.continuityEndReference
                        )
                      ? "Prompt-guided target · " + tc(c.time)
                      : !model?.frames || (!start && model.endFrame === false)
                        ? "Optional · capture in References"
                        : m
                          ? `${c.origin || "Source frame"} · ${tc(c.time)}`
                          : "No adjacent frame"}
                </small>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function SceneCard({
  scene,
  index,
  assets,
  change,
  remove,
  move,
  count,
  presets,
  mentionAssets,
  onMention,
}) {
  const speakers = assets.filter(
    (a) =>
      a.kind === "character" &&
      (!scene.characterIds?.length || scene.characterIds.includes(a.id)),
  );
  return (
    <article className="scene-card">
      <header>
        <span className="scene-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span>Scene</span>
        <div />
        <Icon
          icon={Speech}
          label="Add spoken dialogue"
          onClick={() =>
            change((s) =>
              s.dialogue.push({
                id: uid(),
                speaker: speakers[0]?.id || "",
                delivery: speakers[0]?.delivery || "Auto",
                text: "",
              }),
            )
          }
        />
        <Icon icon={Trash2} label="Remove scene" onClick={remove} />
      </header>
      <MentionInput
        assets={mentionAssets || assets}
        onMention={onMention}
        aria-label={`Scene ${index + 1} description`}
        placeholder="Describe what happens in this scene…"
        value={scene.text}
        onChange={(e) => change((s) => (s.text = e.target.value))}
      />
      <div className="camera-controls">
        <select
          aria-label={`Scene ${index + 1} framing`}
          value={scene.camera}
          onChange={(e) => change((s) => (s.camera = e.target.value))}
        >
          {[
            "Auto",
            "Wide shot",
            "Medium shot",
            "Close-up",
            "Extreme close-up",
            "Over the shoulder",
            "Low angle",
            "High angle",
            "Aerial",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label={`Scene ${index + 1} camera movement`}
          value={scene.movement}
          onChange={(e) => change((s) => (s.movement = e.target.value))}
        >
          {[
            "Auto",
            "Static",
            "Slow push in",
            "Pull back",
            "Tracking",
            "Pan left",
            "Pan right",
            "Handheld",
            "Cut to",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <SceneExtras
        scene={scene}
        index={index}
        count={count}
        assets={assets}
        change={change}
        move={move}
      />
      {scene.dialogue.map((d) => (
        <div className="dialogue" key={d.id}>
          <div>
            <Speech size={14} />
            <select
              aria-label="Dialogue speaker"
              value={d.speaker}
              onChange={(e) =>
                change((s) => {
                  const line = s.dialogue.find((x) => x.id === d.id);
                  line.speaker = e.target.value;
                  line.delivery =
                    speakers.find((a) => a.id === line.speaker)?.delivery ||
                    "Softly";
                })
              }
            >
              <option value="">Choose character</option>
              {speakers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Dialogue delivery"
              value={d.delivery}
              onChange={(e) =>
                change(
                  (s) =>
                    (s.dialogue.find((x) => x.id === d.id).delivery =
                      e.target.value),
                )
              }
            >
              {[...new Set(["Auto", ...(presets || []), d.delivery])].map(
                (v) => (
                  <option key={v}>{v}</option>
                ),
              )}
            </select>
            <Icon
              icon={X}
              label="Remove dialogue"
              onClick={() =>
                change(
                  (s) => (s.dialogue = s.dialogue.filter((x) => x.id !== d.id)),
                )
              }
            />
          </div>
          <input
            aria-label="Custom dialogue direction"
            placeholder="Custom delivery direction…"
            value={d.direction || ""}
            onChange={(e) =>
              change(
                (s) =>
                  (s.dialogue.find((x) => x.id === d.id).direction =
                    e.target.value),
              )
            }
          />
          <textarea
            aria-label="Dialogue words"
            placeholder="Exact spoken words…"
            value={d.text}
            onChange={(e) =>
              change(
                (s) =>
                  (s.dialogue.find((x) => x.id === d.id).text = e.target.value),
              )
            }
          />
        </div>
      ))}
    </article>
  );
}
function CreateProject(props) {
  return <ProjectStart {...props} />;
}
function ProjectList({ onOpen }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    api("/projects").then(setList);
  }, []);
  return (
    <div className="project-list">
      {list.map((p) => (
        <button key={p.id} onClick={() => onOpen(p.id)}>
          <Folder size={18} />
          {p.name}
          <ArrowUpRight size={15} />
        </button>
      ))}
    </div>
  );
}
function RemarkModal({ value, lanes, onClose, onSave, onDelete }) {
  const [r, setR] = useState(structuredClone(value));
  return (
    <Modal title="Timeline note" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (r.end > r.start) onSave(r);
        }}
      >
        <Field label="Timeline note">
          <input
            autoFocus
            required
            value={r.text}
            onChange={(e) => setR({ ...r, text: e.target.value })}
            placeholder="Opening, hook, character introduction…"
          />
        </Field>
        <div className="details-grid">
          <Field label="Start · seconds">
            <input
              type="number"
              min="0"
              step="0.1"
              required
              value={r.start}
              onChange={(e) => setR({ ...r, start: +e.target.value })}
            />
          </Field>
          <Field label="End · seconds">
            <input
              type="number"
              min={r.start + 0.1}
              step="0.1"
              required
              value={r.end}
              onChange={(e) => setR({ ...r, end: +e.target.value })}
            />
          </Field>
        </div>
        <Field label="Timeline notes layer">
          <select
            value={r.lane}
            onChange={(e) => setR({ ...r, lane: +e.target.value })}
          >
            {Array.from({ length: lanes }, (_, i) => (
              <option value={i} key={i}>
                Layer {i + 1}
              </option>
            ))}
          </select>
        </Field>
        <p className="muted">
          These times stay fixed when you move or edit clips.
        </p>
        <div className="detail-actions">
          <button className="primary">Save remark</button>
          <button type="button" onClick={onDelete}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </form>
    </Modal>
  );
}
function AssetLibrary({
  initialAssetId,
  initialKind,
  initialFolderId,
  generated = [],
  onInspect,
  manageOnly = false,
  project: p,
  draft,
  update,
  onClose,
  onImport,
  onAddMedia,
  onDemo,
}) {
  const organization = useLibraryOrganization();
  const blank = (kind) => ({
    id: uid(),
    name: "",
    kind,
    description: "",
    variant: "",
    media: null,
    ...(kind === "character"
      ? { scope: "project", referenceStatus: "draft" }
      : {}),
  });
  const editableAsset = (asset) =>
    asset
      ? {
          ...structuredClone(asset),
          kind: asset.media?.kind === "audio" ? "audio" : asset.kind,
        }
      : null;
  const [choosing, setChoosing] = useState(false),
    [assetError, setAssetError] = useState("");
  const [filter, setFilter] = useState("all"),
    [favoritesOnly, setFavoritesOnly] = useState(false),
    [editing, setEditing] = useState(() => {
      if (initialAssetId)
        return editableAsset(p.assets.find((a) => a.id === initialAssetId));
      if (initialKind) return blank(initialKind);
      try {
        return (
          editableAsset(
            JSON.parse(localStorage.getItem("frame-asset-edit-" + p.id)),
          ) || null
        );
      } catch {
        return null;
      }
    }),
    [query, setQuery] = useState(""),
    [importKind, setImportKind] = useState("");
  useEffect(() => {
    saveLocalDraft(localStorage, "frame-asset-edit-" + p.id, editing);
  }, [editing, p.id]);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const pendingEdit = useRef(null),
    saveTimer = useRef(null),
    latestUpdate = useRef(update);
  latestUpdate.current = update;
  const [autoSaving, setAutoSaving] = useState(false);
  function flushAssetEdit() {
    clearTimeout(saveTimer.current);
    const pending = pendingEdit.current;
    if (!pending) return;
    pendingEdit.current = null;
    latestUpdate.current((project) => {
      if (project.id === pending.projectId)
        saveAssetEdit(project, pending.before, pending.after);
    });
  }
  useEffect(() => () => flushAssetEdit(), []);
  function changeEditing(value) {
    const before = editingRef.current;
    const next = typeof value === "function" ? value(before) : value;
    if (!next || next.id !== before?.id) return;
    editingRef.current = next;
    setEditing(next);
    pendingEdit.current = {
      projectId: p.id,
      before: pendingEdit.current?.before || before,
      after: next,
    };
    setAutoSaving(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      flushAssetEdit();
      setAutoSaving(false);
    }, 400);
  }
  const closeEditor = () => {
    flushAssetEdit();
    onClose();
  };
  const libraryAssets = [
    ...p.assets,
    ...generated.filter(
      (a) => !p.assets.some((saved) => saved.media?.id === a.media?.id),
    ),
  ];
  const assetKinds = assetTypes.map((type) => type.id);
  const visual = editing && !["footage", "audio"].includes(editing.kind);
  const type = assetTypes.find((type) => type.id === editing?.kind);
  return (
    <Modal
      title={editing ? editing.name || `New ${editing.kind}` : "Asset library"}
      onClose={closeEditor}
      wide
      className="asset-library-modal"
    >
      {editing ? (
        <div className="asset-edit-navigation">
          <button
            type="button"
            className="text-action"
            onClick={() => {
              flushAssetEdit();
              initialAssetId || initialKind ? onClose() : setEditing(null);
            }}
          >
            <ArrowLeft size={16} />
            {(initialAssetId || initialKind) && manageOnly
              ? "Back to story"
              : "Back to library"}
          </button>
          <span role="status">
            {visual
              ? autoSaving
                ? "Saving changes…"
                : "Changes save automatically"
              : `Editing ${editing.kind}`}
          </span>
        </div>
      ) : (
        <>
          <div className="asset-toolbar">
            <div>
              <Search size={15} />
              <input
                placeholder="Find an asset…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              aria-label="Import asset type"
              value={editing?.kind || importKind}
              onChange={(e) => setImportKind(e.target.value)}
            >
              <option value="">Choose asset type…</option>
              {assetKinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <button
              disabled={!importKind}
              onClick={() =>
                onImport(
                  editing?.kind || importKind,
                  editing
                    ? (m) => setEditing((old) => appendCharacterImage(old, m))
                    : null,
                )
              }
            >
              <Upload size={15} /> Import
            </button>
            <button
              className="primary"
              onClick={() => setChoosing(!choosing)}
              aria-expanded={choosing}
            >
              <Plus size={15} /> New asset
            </button>
          </div>
          {choosing && (
            <AssetTypePicker
              onChoose={(kind) => {
                setEditing(blank(kind));
                setChoosing(false);
              }}
            />
          )}
          <div className="asset-filters">
            <button
              className={favoritesOnly ? "active" : ""}
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly(!favoritesOnly)}
            >
              <Star size={14} /> Favorites
            </button>
            {[
              "all",
              "character",
              "location",
              "prop",
              "style",
              "footage",
              "audio",
            ].map((k) => (
              <button
                key={k}
                className={filter === k ? "active" : ""}
                onClick={() => {
                  setFilter(k);
                  setImportKind(k === "all" ? "" : k);
                }}
              >
                {React.createElement(
                  {
                    all: LayoutGrid,
                    character: UserRound,
                    location: MapPin,
                    prop: Package,
                    style: Palette,
                    footage: Film,
                    audio: AudioLines,
                  }[k],
                  { size: 14 },
                )}{" "}
                {k}
              </button>
            ))}
          </div>
        </>
      )}
      {assetError && (
        <p role="alert" className="error">
          {assetError}
        </p>
      )}
      {organization.error && (
        <p role="alert" className="error">
          {organization.error}
        </p>
      )}
      {editing ? (
        <form
          className="asset-editor"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              editing.media &&
              editing.media.kind !==
                (visual
                  ? "image"
                  : editing.kind === "audio"
                    ? "audio"
                    : "video")
            ) {
              setAssetError(
                "Attach " +
                  (visual
                    ? "an image"
                    : editing.kind === "audio"
                      ? "audio"
                      : "video") +
                  " for this asset type.",
              );
              return;
            }
            if (visual) flushAssetEdit();
            else
              update((n) => {
                editAsset(n, editing);
              });
            if (
              initialFolderId &&
              !p.assets.some((a) => a.id === editing.id) &&
              organization.metadata[libraryAssetKey(p.id, editing)]
                ?.folderId === undefined
            )
              organization
                .organize(libraryAssetKey(p.id, editing), {
                  folderId: initialFolderId,
                })
                .catch(() => {});
            if (initialAssetId || initialKind) onClose();
            else setEditing(null);
          }}
        >
          {visual ? (
            <AssetWorkbench
              key={editing.id + editing.kind}
              asset={editing}
              project={p}
              change={visual ? changeEditing : setEditing}
              onImport={onImport}
              organization={organization}
              initialFolderId={
                !p.assets.some((a) => a.id === editing.id)
                  ? initialFolderId
                  : null
              }
              onStarted={(input) =>
                update((n) => {
                  if (!n.assets.some((a) => a.id === editing.id))
                    editAsset(n, {
                      ...editing,
                      name: input.name || input.description.slice(0, 48),
                      description: editing.description || input.description,
                    });
                })
              }
            />
          ) : (
            <>
              <div className="asset-media-column">
                {visual ? (
                  <>
                    {!editing.media && (
                      <button
                        type="button"
                        className="asset-upload-empty"
                        onClick={() =>
                          onImport(editing.kind, (m) =>
                            setEditing((old) => appendCharacterImage(old, m)),
                          )
                        }
                      >
                        <Upload size={32} />
                        <b>Add {type?.name.toLowerCase()} reference</b>
                        <small>Upload an image · saved locally</small>
                      </button>
                    )}
                    <Suspense fallback={<small>Opening image creator…</small>}>
                      <AssetGenerator
                        key={editing.id + editing.kind}
                        asset={editing}
                        project={p}
                        change={visual ? changeEditing : setEditing}
                        onStarted={(input) =>
                          update((n) => {
                            if (!n.assets.some((a) => a.id === editing.id))
                              editAsset(n, {
                                ...editing,
                                name:
                                  input.name || input.description.slice(0, 48),
                                description:
                                  editing.description || input.description,
                              });
                          })
                        }
                      />
                    </Suspense>
                    <CharacterMedia
                      asset={editing}
                      change={visual ? changeEditing : setEditing}
                    />
                  </>
                ) : editing.media ? (
                  editing.kind === "audio" ? (
                    <audio
                      controls
                      src={editing.media.url}
                      aria-label="Asset audio preview"
                    />
                  ) : (
                    <video
                      controls
                      src={editing.media.url}
                      aria-label="Asset footage preview"
                    />
                  )
                ) : (
                  <div className="asset-upload-empty">
                    <Upload size={32} />
                    <p>
                      Upload{" "}
                      {editing.kind === "audio"
                        ? "music, voice or a sound effect"
                        : "a video clip"}{" "}
                      to preview it here.
                    </p>
                  </div>
                )}
              </div>
              <div className="asset-details-column">
                <AssetOrganizationEditor
                  key={editing.id}
                  organization={organization}
                  assetKey={libraryAssetKey(p.id, editing)}
                  asset={editing}
                  defaultFolderId={
                    !p.assets.some((a) => a.id === editing.id)
                      ? initialFolderId
                      : null
                  }
                />
                {visual && (
                  <AssetExchange
                    key={editing.id + editing.kind}
                    asset={editing}
                    project={p}
                    change={visual ? changeEditing : setEditing}
                  />
                )}
                <div className="details-grid">
                  <Field label="Name">
                    <input
                      required
                      value={editing.name}
                      onChange={(e) =>
                        setEditing({ ...editing, name: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Asset type">
                    <select
                      value={editing.kind}
                      onChange={(e) =>
                        setEditing({ ...editing, kind: e.target.value })
                      }
                    >
                      {assetKinds.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <label className="asset-scope-toggle">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="Project only"
                    checked={isProjectOnly(editing)}
                    disabled={
                      needsReferenceApproval(editing) &&
                      !hasReferenceImage(editing)
                    }
                    onChange={(e) =>
                      setEditing(
                        setAssetProjectOnly({ ...editing }, e.target.checked),
                      )
                    }
                  />
                  Project only{" "}
                  <small>
                    {needsReferenceApproval(editing)
                      ? hasReferenceImage(editing)
                        ? "Turn off to approve this reference and share across projects."
                        : "Add an image reference, then approve it for sharing."
                      : "Off: available in the shared library."}
                  </small>
                </label>
                <Field
                  label={
                    editing.kind === "character"
                      ? "Identity & personality"
                      : editing.kind === "location"
                        ? "Environment & atmosphere"
                        : editing.kind === "prop"
                          ? "Object details"
                          : editing.kind === "style"
                            ? "Visual direction"
                            : "Description & usage notes"
                  }
                >
                  <textarea
                    required={visual}
                    placeholder={type?.description}
                    rows={3}
                    value={editing.description || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, description: e.target.value })
                    }
                  />
                </Field>
                {visual && (
                  <Field
                    label={
                      editing.kind === "character"
                        ? "Appearance, clothing & pose"
                        : "Visual details & variations"
                    }
                  >
                    <textarea
                      rows={2}
                      value={editing.variant || ""}
                      onChange={(e) =>
                        setEditing({ ...editing, variant: e.target.value })
                      }
                    />
                  </Field>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onImport(editing.kind, (m) =>
                      setEditing((old) =>
                        visual
                          ? appendCharacterImage(old, m)
                          : { ...old, media: m, name: old.name || m.name },
                      ),
                    )
                  }
                >
                  <Upload size={14} />
                  Upload {editing.kind}
                  {visual ? " reference" : ""}
                </button>
                <Field
                  label={
                    visual
                      ? "Choose an existing reference"
                      : "Choose existing media"
                  }
                >
                  <select
                    value={editing.media?.id || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        media:
                          p.assets.find((a) => a.media?.id === e.target.value)
                            ?.media || null,
                      })
                    }
                  >
                    <option value="">No media attached</option>
                    {p.assets
                      .filter(
                        (a) =>
                          a.media &&
                          (visual
                            ? a.media.kind === "image"
                            : a.media.kind ===
                              (editing.kind === "audio" ? "audio" : "video")),
                      )
                      .map((a) => (
                        <option key={a.id} value={a.media.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <CharacterMedia
                  asset={editing}
                  change={visual ? changeEditing : setEditing}
                  voiceOnly
                />
                {visual && (
                  <VariantEditor
                    asset={editing}
                    change={visual ? changeEditing : setEditing}
                    mediaAssets={p.assets.filter(
                      (a) => a.media?.kind === "image",
                    )}
                  />
                )}
              </div>
            </>
          )}
          <div className="detail-actions">
            <button className="primary">
              <Check size={15} />
              {visual ? "Done" : "Save asset"}
            </button>
            <button
              type="button"
              onClick={() => {
                flushAssetEdit();
                initialAssetId || initialKind ? onClose() : setEditing(null);
              }}
            >
              {visual ? "Close" : "Cancel"}
            </button>
          </div>
        </form>
      ) : (
        <div className="library-grid">
          {libraryAssets
            .filter(
              (a) =>
                (!favoritesOnly ||
                  organization.forAsset(libraryAssetKey(p.id, a), a)
                    .favorite) &&
                (filter === "all" ||
                  (filter === "audio"
                    ? a.media?.kind === "audio"
                    : a.kind === filter)) &&
                [
                  a.name,
                  a.description,
                  ...organization.forAsset(libraryAssetKey(p.id, a), a).tags,
                ]
                  .join(" ")
                  .toLowerCase()
                  .includes(query.toLowerCase()),
            )
            .map((a) => (
              <article
                key={a.id}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    a.poolKey ? "studio-pool" : "asset",
                    a.poolKey || a.id,
                  )
                }
              >
                <button
                  className="asset-thumbnail-button"
                  title={
                    (a.poolKey ? "Generation details: " : "Edit ") + a.name
                  }
                  aria-label={"Open " + a.name}
                  onClick={() =>
                    a.poolKey ? onInspect?.(a) : setEditing(editableAsset(a))
                  }
                >
                  {a.media ? (
                    <img
                      src={a.media.thumbnail}
                      alt={a.name}
                      draggable={false}
                    />
                  ) : (
                    <div className="asset-placeholder">
                      {a.kind === "location" ? (
                        <MapPin size={32} />
                      ) : (
                        React.createElement(
                          {
                            character: UserRound,
                            prop: Package,
                            style: Palette,
                            footage: Film,
                            audio: AudioLines,
                          }[a.kind] || Image,
                          { size: 32 },
                        )
                      )}
                    </div>
                  )}
                </button>
                <b>{a.name}</b>
                {
                  <button
                    className="favorite-character"
                    aria-label={
                      (organization.forAsset(libraryAssetKey(p.id, a), a)
                        .favorite
                        ? "Unfavorite "
                        : "Favorite ") + a.name
                    }
                    aria-pressed={
                      organization.forAsset(libraryAssetKey(p.id, a), a)
                        .favorite
                    }
                    onClick={() =>
                      organization
                        .organize(libraryAssetKey(p.id, a), {
                          favorite: !organization.forAsset(
                            libraryAssetKey(p.id, a),
                            a,
                          ).favorite,
                        })
                        .catch(() => {})
                    }
                  >
                    <Star
                      size={16}
                      fill={
                        organization.forAsset(libraryAssetKey(p.id, a), a)
                          .favorite
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </button>
                }
                <small>
                  {a.kind}
                  {a.poolKey && (
                    <>
                      {" "}
                      · <Sparkles size={11} /> AI generated
                    </>
                  )}
                </small>
                <p>{a.description}</p>
                <div>
                  {!manageOnly &&
                    (["footage", "audio"].includes(a.kind) ||
                    a.media?.kind === "audio" ? (
                      <button onClick={() => onAddMedia(a.media)}>
                        <Plus size={13} /> Timeline
                      </button>
                    ) : (
                      <button
                        className={
                          draft.referenceIds.includes(a.id) ? "active" : ""
                        }
                        onClick={() =>
                          update((n) => {
                            const d = n.drafts.find((d) => d.id === draft.id);
                            d.referenceIds = d.referenceIds.includes(a.id)
                              ? d.referenceIds.filter((x) => x !== a.id)
                              : [...d.referenceIds, a.id];
                          })
                        }
                      >
                        {draft.referenceIds.includes(a.id) ? (
                          <Check size={13} />
                        ) : (
                          <Paperclip size={13} />
                        )}{" "}
                        {draft.referenceIds.includes(a.id)
                          ? "Attached"
                          : "Attach"}
                      </button>
                    ))}
                  <Icon
                    icon={a.poolKey ? FileText : Settings2}
                    label={
                      (a.poolKey ? "Generation details: " : "Edit ") + a.name
                    }
                    onClick={() =>
                      a.poolKey ? onInspect?.(a) : setEditing(editableAsset(a))
                    }
                  />
                </div>
              </article>
            ))}
        </div>
      )}
      {favoritesOnly &&
        !editing &&
        !libraryAssets.some(
          (a) => organization.forAsset(libraryAssetKey(p.id, a), a).favorite,
        ) && <p className="muted">Star any asset to keep it in Favorites.</p>}
      {!libraryAssets.length && !editing && (
        <div className="empty-library">
          <Image size={32} />
          <p>Characters, locations, props, styles, footage and audio.</p>
          <button onClick={onDemo}>
            <Play size={15} /> Load sample footage
          </button>
        </div>
      )}
    </Modal>
  );
}

export {
  Icon,
  Modal,
  Field,
  AutoTag,
  BoundaryFrames,
  SceneCard,
  CreateProject,
  ProjectList,
  RemarkModal,
  AssetLibrary,
  automationLabels,
};
