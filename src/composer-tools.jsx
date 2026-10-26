import { claimCamera } from "../shared/composer-assistant.mjs";
import { CameraDirection } from "./camera-direction";
import { cutDescriptions } from "../shared/camera-direction.mjs";
import { lockedCamera } from "../shared/shot-direction.mjs";
import { useLibraryOrganization } from "./library-organization";
import {
  libraryAssetKey,
  folderPath,
} from "../shared/library-organization.mjs";
import { useSharedLibrary } from "./shared-library";
import React, { useEffect, useRef, useState } from "react";
import {
  Images,
  UserRound,
  MapPin,
  Box,
  Palette,
  Star,
  Check,
  Plus,
  X,
  Search,
  SlidersHorizontal,
  Camera,
  PencilLine,
  Move,
  Film,
  Clock3,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Volume2,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import {
  modelTitle,
  modelFit,
  assetRole,
  referenceRoleLabels,
  completedHold,
  GENERATION_HOLD_MS,
} from "../shared/composer-presentation.mjs";
import { automationDefaults } from "../shared/studio.mjs";
import { ReferenceOptions } from "./advanced";

export function Toggle({ label, checked, onChange, children }) {
  return (
    <label className="composer-switch-row">
      <span>
        {label}
        {children}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}
export function HoldGenerate({
  enabled,
  disabled,
  busy,
  price,
  onGenerate,
  requestKey,
  label = "video",
  action = "generate",
}) {
  const [progress, setProgress] = useState(0),
    start = useRef(null),
    frame = useRef(null),
    button = useRef(null),
    source = useRef(null);
  const cancel = () => {
    start.current = null;
    source.current = null;
    cancelAnimationFrame(frame.current);
    setProgress(0);
  };
  useEffect(() => {
    cancel();
  }, [requestKey, disabled, enabled]);
  useEffect(() => {
    const reset = () => cancel();
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, []);
  const begin = (type) => {
    if (disabled || start.current !== null) return;
    source.current = type;
    start.current = performance.now();
    const tick = () => {
      if (start.current === null) return;
      setProgress(
        Math.min(1, (performance.now() - start.current) / GENERATION_HOLD_MS),
      );
      frame.current = requestAnimationFrame(tick);
    };
    tick();
  };
  const finish = (e, type) => {
    if (source.current !== type) return;
    const ready = completedHold(start.current, performance.now());
    cancel();
    if (ready && !disabled) {
      button.current?.blur();
      onGenerate(e);
    }
  };
  return (
    <button
      ref={button}
      type="button"
      className="creative-generate hold-generate"
      aria-label={enabled ? `Hold to ${action} ${label}` : `${action} ${label}`}
      title={
        enabled
          ? `Hold, then release to ${action} · hold Enter with keyboard · release early to cancel`
          : `${action} ${label}`
      }
      aria-busy={busy}
      disabled={disabled}
      style={{ "--hold-progress": `${progress * 100}%` }}
      onPointerDown={(e) => {
        if (!enabled || e.button !== 0) return;
        e.preventDefault();
        button.current.focus();
        begin("pointer");
      }}
      onPointerUp={(e) => enabled && finish(e, "pointer")}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onBlur={cancel}
      onKeyDown={(e) => {
        if (enabled && e.key === "Enter") {
          e.preventDefault();
          if (!e.repeat) begin("key");
        }
        if (e.key === "Escape") cancel();
      }}
      onKeyUp={(e) => {
        if (enabled && e.key === "Enter") {
          e.preventDefault();
          finish(e, "key");
        }
      }}
      onClick={(e) => {
        if (enabled) {
          e.preventDefault();
          return;
        }
        e.currentTarget.blur();
        onGenerate(e);
      }}
    >
      <Sparkles size={15} />
      <span>
        {busy
          ? "Submitting…"
          : progress >= 1
            ? `Release to ${action}`
            : enabled
              ? `Hold to ${action}`
              : action[0].toUpperCase() + action.slice(1)}
        <small>{price}</small>
      </span>
    </button>
  );
}

const categories = [
  ["all", Images, "All assets"],
  ["character", UserRound, "Characters"],
  ["location", MapPin, "Locations"],
  ["prop", Box, "Props"],
  ["style", Palette, "Style references"],
  ["attached", Check, "Attached references"],
  ["favorite", Star, "Favorites"],
];
export function ComposerAssets({
  project,
  draft,
  prepared,
  change,
  insert,
  openLibrary,
  adopt,
}) {
  const [category, setCategory] = useState("all"),
    [query, setQuery] = useState(""),
    [inspect, setInspect] = useState(null);
  const library = useSharedLibrary(project);
  const organization = useLibraryOrganization();
  const [libraryError, setLibraryError] = useState("");
  const assets = [
    ...project.assets,
    ...library.entries.map((e) => ({
      ...e.asset,
      id: "shared:" + e.id,
      _libraryId: e.id,
    })),
  ]
    .filter((a) => !["audio", "footage"].includes(a.kind))
    .map((a) => {
      const meta = organization.forAsset(
        a._libraryId || libraryAssetKey(project.id, a),
        a,
      );
      return {
        ...a,
        favorite: meta.favorite,
        libraryTags: meta.tags,
        libraryFolder: folderPath(organization.folders, meta.folderId),
      };
    });
  const listed = assets.filter(
    (a) =>
      (category === "all" ||
        category === a.kind ||
        (category === "attached" &&
          prepared.references.some((r) => r.id === a.id)) ||
        (category === "favorite" && a.favorite)) &&
      [a.name, ...a.libraryTags, a.libraryFolder]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selected = assets.find((a) => a.id === inspect);
  const projectRole = prepared.references.find(
    (r) => r.id === selected?.id,
  )?.projectVisualRole;
  return (
    <div className="asset-browser">
      <nav aria-label="Asset categories">
        {categories.map(([id, Icon, label]) => (
          <button
            key={id}
            title={label}
            aria-label={label}
            aria-pressed={category === id}
            onClick={() => {
              setCategory(id);
              setInspect(null);
            }}
          >
            <Icon size={18} />
          </button>
        ))}
      </nav>
      <div className="asset-browser-main">
        {(libraryError || library.error) && (
          <small role="alert">{libraryError || library.error}</small>
        )}
        <div className="asset-search">
          <Search size={14} />
          <input
            aria-label="Find composer assets"
            placeholder="Find an asset…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            title="Manage assets library"
            aria-label="Manage assets library"
            onClick={openLibrary}
          >
            <Plus size={16} />
          </button>
        </div>
        <small className="asset-browser-hint">
          Drag into a shot · click to insert
        </small>
        <div className="asset-thumbnail-grid" hidden={!!selected}>
          {listed.map((a) => {
            const ref = prepared.references.find((r) => r.id === a.id),
              attached = !!ref,
              thumbnail = ref?.selectedMedia?.thumbnail || a.media?.thumbnail,
              Icon = categories.find((c) => c[0] === a.kind)?.[1] || Images;
            const tags = prepared.bindings
              ?.filter((b) => b.assetId === a.id)
              .map((b) => b.tag)
              .join(", ");
            return (
              <article
                className={`asset-thumb-card ${attached ? "attached" : ""}`}
                key={a.id}
              >
                <button
                  className="asset-thumb-insert"
                  aria-label={`${ref?.projectVisualRole ? "Project reference" : "Insert"} ${a.name}`}
                  draggable={!ref?.projectVisualRole}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      a._libraryId ? "library-asset" : "asset",
                      a._libraryId || a.id,
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() =>
                    ref?.projectVisualRole
                      ? setInspect(a.id)
                      : a._libraryId
                        ? adopt(a._libraryId).catch((e) =>
                            setLibraryError(e.message),
                          )
                        : insert(a.id)
                  }
                >
                  <span className="asset-thumb-image">
                    {thumbnail ? (
                      <img src={thumbnail} alt={a.name} draggable={false} />
                    ) : (
                      <Icon size={32} />
                    )}
                    <i>{attached ? <Check size={13} /> : <Plus size={13} />}</i>
                    {a.favorite && (
                      <Star className="asset-favorite" size={12} />
                    )}
                  </span>
                  <b>{a.name}</b>
                </button>
                <button
                  className="asset-role-label"
                  aria-label={`Reference controls for ${a.name}`}
                  onClick={() => setInspect(inspect === a.id ? null : a.id)}
                >
                  <span>
                    {referenceRoleLabels[ref?.role || assetRole(a, draft)]}
                  </span>
                  <SlidersHorizontal size={12} />
                </button>
                <small>
                  {ref?.projectVisualRole
                    ? "Project default"
                    : attached
                      ? tags ||
                        (ref?.selectedMedia
                          ? "Image reference"
                          : "Description only")
                      : thumbnail
                        ? "Image available"
                        : "Description only"}
                </small>
              </article>
            );
          })}
        </div>
        {!listed.length && (
          <p className="companion-hint">
            No matching assets.{" "}
            <button onClick={openLibrary}>Add assets</button>
          </p>
        )}
        {selected && (
          <section className="asset-role-editor">
            <header>
              <b>{selected.name} controls</b>
              <button
                aria-label="Close reference controls"
                onClick={() => setInspect(null)}
              >
                <X size={14} />
              </button>
            </header>
            {(prepared.references.find((r) => r.id === selected.id)
              ?.selectedMedia?.thumbnail ||
              selected.media?.thumbnail) && (
              <img
                className="asset-inspector-image"
                alt={selected.name}
                src={
                  prepared.references.find((r) => r.id === selected.id)
                    ?.selectedMedia?.thumbnail || selected.media?.thumbnail
                }
              />
            )}
            <p>
              {referenceRoleLabels[projectRole || assetRole(selected, draft)]}{" "}
              only. Other references keep their own roles.
            </p>
            {projectRole ? (
              <p>
                Project default · change this role in Project settings →
                Prompting. Fine-tune can exclude project visuals for this clip.
              </p>
            ) : selected._libraryId ? (
              <button
                onClick={() =>
                  adopt(selected._libraryId)
                    .then(() => setInspect(null))
                    .catch((e) => setLibraryError(e.message))
                }
              >
                Use this reference
              </button>
            ) : (
              <ReferenceOptions
                project={project}
                asset={selected}
                draft={draft}
                change={change}
              />
            )}
            {draft.referenceIds.includes(selected.id) && (
              <button
                onClick={() =>
                  change((d) => {
                    d.referenceIds = d.referenceIds.filter(
                      (id) => id !== selected.id,
                    );
                  })
                }
              >
                <X size={12} />
                Detach reference
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export function ModelBrowser({
  models,
  draft,
  prepared,
  current,
  onSelect,
  favoriteId,
  favorites,
  onFavorite,
}) {
  const [provider, setProvider] = useState("all"),
    [query, setQuery] = useState(""),
    [starred, setStarred] = useState(false);
  const providers = [
    ...new Set(models.map((m) => m.provider || "Local simulator")),
  ];
  const rows = models
    .map((m) => ({ m, ...modelFit(m, prepared, draft.settings) }))
    .filter(
      ({ m }) =>
        (provider === "all" ||
          provider === (m.provider || "Local simulator")) &&
        (!starred || favorites.includes(m.id) || m.id === favoriteId) &&
        `${m.name} ${m.id}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.compatible) - Number(a.compatible) ||
        Number(b.m.id === favoriteId) - Number(a.m.id === favoriteId) ||
        Number(favorites.includes(b.m.id)) - Number(favorites.includes(a.m.id)),
    );
  const recommended =
    rows.find((r) => r.compatible && r.m.id === favoriteId)?.m.id ||
    rows.find((r) => r.compatible && !r.adjustments.length)?.m.id;
  return (
    <div className="model-browser">
      <div className="asset-search">
        <Search size={14} />
        <input
          aria-label="Find video model"
          placeholder="Find a model…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          aria-label="Favorite models only"
          aria-pressed={starred}
          onClick={() => setStarred(!starred)}
        >
          <Star size={16} />
        </button>
      </div>
      <nav className="provider-filters" aria-label="Generation provider">
        {["all", ...providers].map((v) => (
          <button
            key={v === "No movement" ? "Locked camera" : v}
            aria-pressed={provider === v}
            onClick={() => setProvider(v)}
          >
            {v === "all" ? "All providers" : v}
          </button>
        ))}
      </nav>
      <div className="model-cards">
        {rows.map(({ m, compatible, reason, adjustments }) => (
          <article
            key={m.id}
            className={`model-choice ${!compatible ? "incompatible" : ""} ${current?.id === m.id ? "selected" : ""}`}
          >
            <button
              className="model-pick"
              aria-label={`Use ${modelTitle(m)}`}
              disabled={!compatible}
              onClick={() => onSelect(m.id)}
            >
              <b>{modelTitle(m)}</b>
              <small>
                {m.provider || "Local simulator"} ·{" "}
                {m.referenceMode === "none"
                  ? "Text to video"
                  : m.referenceMode === "single"
                    ? "Image to video"
                    : ["flat", "elements"].includes(m.referenceMode)
                      ? "Reference to video"
                      : "Video"}
              </small>
              <span className="model-badges">
                {m.id === favoriteId && <em>Default</em>}
                {m.id === recommended && <em>Recommended for setup</em>}
                {compatible && !adjustments.length && <em>Matches setup</em>}
                {(m.resolutions || []).map((r) => (
                  <em key={r}>{r}</em>
                ))}
                {m.audio && (
                  <em>
                    <Volume2 size={11} />
                    Audio
                  </em>
                )}
                {m.metadata?.model_spec?.capabilities?.uncensored === true && (
                  <em>Uncensored</em>
                )}
                {m.privacy && (
                  <em>
                    <ShieldCheck size={11} />
                    {String(m.privacy)}
                  </em>
                )}
              </span>
              <small>
                {(m.durations || []).join(" / ")} seconds ·{" "}
                {m.promptLimit?.toLocaleString() || "—"} characters
              </small>
              {!compatible ? (
                <strong className="model-fit-reason">{reason}</strong>
              ) : adjustments.length > 0 ? (
                <small className="model-adjustments">
                  Adjusts {adjustments.join(" · ")}
                </small>
              ) : null}
            </button>
            <button
              className="model-star"
              title="Favorite model"
              aria-label={`Favorite ${modelTitle(m)}`}
              aria-pressed={favorites.includes(m.id) || m.id === favoriteId}
              onClick={() => onFavorite(m.id)}
            >
              <Star size={15} />
            </button>
            <details>
              <summary>Model details</summary>
              <code>{m.id}</code>
              <p>
                {m.privacy
                  ? "Privacy: " + String(m.privacy)
                  : "Privacy and content-policy labels are not supplied by this catalog."}
              </p>
              <p>
                Exact price is calculated after selection for your duration and
                settings.
              </p>
            </details>
          </article>
        ))}
      </div>
      {!rows.length && <p>No matching models.</p>}
    </div>
  );
}

const shotChoices = {
  camera: [
    "Auto",
    "Wide shot",
    "Medium shot",
    "Close-up",
    "Extreme close-up",
    "Over the shoulder",
    "Low angle",
    "High angle",
    "Aerial",
  ],
  movement: [
    "Auto",
    "No movement",
    "Slow push in",
    "Pull back",
    "Tracking",
    "Pan left",
    "Pan right",
    "Handheld",
  ],
  transition: [
    "Auto",
    "Cut",
    "Match cut",
    "Dissolve intention",
    "Continuous action",
  ],
};
export function ShotDirection({ scene, index, count, assets, change, move }) {
  const [tab, setTab] = useState(scene.cameraDirection ? "custom" : "camera");
  return (
    <div className="shot-director">
      <nav aria-label={`Shot ${index + 1} controls`}>
        {[
          ["camera", Camera, "Framing"],
          ["movement", Move, "Motion"],
          ["transition", Film, "Shot transition"],
          ["custom", PencilLine, "Write"],
          ["cast", UserRound, "Cast & place"],
          ["timing", Clock3, "Timing"],
        ].map(([id, Icon, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            aria-label={label}
            onClick={() => setTab(id)}
            title={label}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {tab === "camera" && (
        <CameraDirection scene={scene} index={index} change={change} />
      )}
      {tab === "transition" && (
        <div className="shot-cut-explanation">
          <div className="shot-cut-flow">
            {index > 0 ? (
              <>
                Shot {index} <span>→</span> <strong>Shot {index + 1}</strong>
              </>
            ) : (
              <strong>Opening shot</strong>
            )}
          </div>
          {index > 0
            ? cutDescriptions[scene.transition || "Auto"] || scene.transition
            : "This is the opening shot. Add another shot to direct a cut or continue the action."}
          <small>
            Shot direction guides the generated video; it does not add an editor
            transition.
          </small>
        </div>
      )}
      {tab !== "camera" && shotChoices[tab] && (
        <div className="shot-choice-grid">
          {[
            ...new Set(
              [
                ...shotChoices[tab],
                (["Static", "No movement"].includes(scene[tab]) &&
                  tab === "camera") ||
                (scene[tab] === "Cut to" && tab === "movement")
                  ? null
                  : scene[tab] === "Static"
                    ? "No movement"
                    : scene[tab],
              ].filter(Boolean),
            ),
          ].map((v) => (
            <button
              key={v === "No movement" ? "Locked camera" : v}
              className={
                tab === "movement" &&
                scene.movement === v &&
                Date.now() - (scene.assistant?.changed?.movement?.at || 0) <
                  4500
                  ? "assistant-changed-control"
                  : ""
              }
              disabled={
                (tab === "movement" && !!scene.cameraDirection) ||
                (tab === "transition" && index === 0)
              }
              title={
                tab === "movement" && scene.cameraDirection
                  ? "Written camera direction is active; edit it in Write"
                  : cutDescriptions[v]
              }
              aria-pressed={
                (scene[tab] === "Static"
                  ? "No movement"
                  : scene[tab] || "Auto") === v
              }
              onClick={() =>
                change((s) => {
                  s[tab] = v;
                  if (tab === "movement") claimCamera(s, ["movement"]);

                  if (v === "No movement") {
                    s.movement = "No movement";
                  } else if (tab === "movement" && s.camera === "No movement")
                    s.camera = "Auto";
                })
              }
            >
              {v === "Auto" && <Sparkles size={12} />}{" "}
              {v === "No movement" ? "Locked camera" : v}
            </button>
          ))}
        </div>
      )}
      {tab === "custom" && (
        <label className="shot-custom-direction">
          Camera & shot direction
          <textarea
            aria-label={`Shot ${index + 1} custom camera direction`}
            value={scene.cameraDirection || ""}
            maxLength={2000}
            rows={3}
            placeholder="e.g. Locked wide shot at eye level, 35mm lens. Keep both characters in frame."
            onChange={(e) =>
              change((s) => {
                s.cameraDirection = e.target.value;
              })
            }
          />
          <small>
            Your direction replaces the camera presets for this shot.
          </small>
        </label>
      )}
      {tab === "cast" && (
        <div className="shot-cast-place">
          <label>
            <MapPin size={13} />
            Place
            <select
              aria-label="Scene location"
              value={scene.locationId || ""}
              onChange={(e) => change((s) => (s.locationId = e.target.value))}
            >
              <option value="">Auto · from context</option>
              {assets
                .filter((a) => a.kind === "location")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <small>Cast · empty uses attached characters</small>
          <div className="shot-choice-grid">
            {assets
              .filter((a) => a.kind === "character")
              .map((a) => (
                <button
                  key={a.id}
                  aria-pressed={scene.characterIds?.includes(a.id) || false}
                  onClick={() =>
                    change((s) => {
                      s.characterIds = s.characterIds?.includes(a.id)
                        ? s.characterIds.filter((id) => id !== a.id)
                        : [...(s.characterIds || []), a.id];
                    })
                  }
                >
                  {a.media?.thumbnail && <img src={a.media.thumbnail} alt="" />}
                  {a.name}
                </button>
              ))}
          </div>
        </div>
      )}
      {tab === "timing" && (
        <div className="shot-timing">
          <label>
            Shot length
            <input
              aria-label={`Scene ${index + 1} duration`}
              type="number"
              min="0.1"
              step="0.1"
              placeholder="Auto"
              value={scene.duration ?? ""}
              onChange={(e) =>
                change(
                  (s) =>
                    (s.duration =
                      e.target.value === "" ? null : +e.target.value),
                )
              }
            />
          </label>
          <button
            disabled={index === 0}
            aria-label="Move shot earlier"
            onClick={() => move(-1)}
          >
            <ArrowUp size={14} />
          </button>
          <button
            disabled={index === count - 1}
            aria-label="Move shot later"
            onClick={() => move(1)}
          >
            <ArrowDown size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
export function InjectionSwitches({ draft, effective, change, labels }) {
  return (
    <div className="injection-switches">
      {Object.keys(automationDefaults).map((key) => (
        <div key={key}>
          <Toggle
            label={labels[key] || key}
            checked={!!effective[key]}
            onChange={(value) =>
              change((d) => {
                d.automation[key] = value;
              })
            }
          />
          {draft.automation[key] !== undefined && (
            <button
              title="Use project default"
              aria-label={`Reset ${labels[key] || key} to default`}
              onClick={() =>
                change((d) => {
                  delete d.automation[key];
                })
              }
            >
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
