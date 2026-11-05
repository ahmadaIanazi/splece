import { characterLooks } from "../shared/character-looks.mjs";
import {
  isProjectOnly,
  needsReferenceApproval,
  hasReferenceImage,
} from "../shared/asset-scope.mjs";
import { AssetTypePicker } from "./asset-type-picker";
import {
  useLibraryOrganization,
  LibraryFolders,
  AssetOrganizationEditor,
} from "./library-organization";
import {
  libraryItemKey,
  libraryAssetKind,
  matchesLibraryItem,
  folderPath,
} from "../shared/library-organization.mjs";
import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  Film,
  UserRound,
  MapPin,
  Package,
  Palette,
  AudioLines,
  Sparkles,
  Search,
  Plus,
  Images,
  Archive,
  ChevronDown,
  Upload,
  Play,
  Globe,
  Lock,
  Settings2,
  Folder,
  Star,
  X,
  Check,
  CheckSquare2,
  EyeOff,
  Eye,
} from "lucide-react";
import { generationPool } from "../shared/generation-pool.mjs";
import { tc } from "./state";
import { useSharedLibrary } from "./shared-library";
import "./media-library-redesign.css";
function LibraryThumbnail({ media, name = "", ...props }) {
  const [failed, setFailed] = useState(false), [unavailable, setUnavailable] = useState(false);
  useEffect(() => { setFailed(false); setUnavailable(false); }, [media?.id, media?.thumbnail]);
  const original = media?.kind === "image" ? (media.id ? `/api/media/${media.id}/original` : media.url) : null;
  const src = failed ? original : media?.thumbnail || original;
  return src && !unavailable ? <img src={src} alt={name} draggable={false} onError={() => failed ? setUnavailable(true) : setFailed(true)} {...props}/> : <Images size={38}/>;
}

const filters = [
  ["all", "All types", Images],
  ["footage", "Footage", Film],
  ["image", "Images", Images],
  ["character", "Characters", UserRound],
  ["location", "Locations", MapPin],
  ["prop", "Props", Package],
  ["style", "Style references", Palette],
  ["audio", "Audio", AudioLines],
];
export function MediaDock({
  project,
  jobs,
  onClose,
  onManage,
  onCreate,
  onEdit,
  onOpenDetails,
  onUseStartFrame,
  onDrag,
  onUse,
  onImport,
  onScope,
  initialFilter = "all",
}) {
  const [filter, setFilter] = useState(initialFilter),
    [query, setQuery] = useState(""),
    [unused, setUnused] = useState(false),
    [previewSelection, setPreview] = useState(null),
    [folder, setFolder] = useState("all"),
    [favorites, setFavorites] = useState(false),
    [tags, setTags] = useState([]),
    [adding, setAdding] = useState(false),
    [scope, setScope] = useState("project"),
    [hiddenCollection, setHiddenCollection] = useState(false),
    [selectedKeys, setSelectedKeys] = useState([]);
  const selectionAnchor = useRef(null);
  const organization = useLibraryOrganization();
  const dragged = useRef(false),
    library = useSharedLibrary(project);
  const items = useMemo(() => {
    const pool = generationPool(project, jobs).map((e) => ({
      ...e,
      kind: libraryAssetKind(project.assets.find(a => a.media?.id === e.media.id) || {kind:"footage", media:e.media}),
      ai: !!e.job,
      asset: project.assets.find((a) => a.media?.id === e.media.id),
    }));
    const mediaIds = new Set(
      pool.flatMap((e) => [
        e.media.id,
        ...(e.clip?.takes || []).map((t) => t.id),
      ]),
    );
    const local = project.assets
      .filter((a) => !mediaIds.has(a.media?.id))
      .map((a) => ({
        key: "asset:" + a.id,
        asset: a,
        media: a.media,
        name: a.name,
        ai: !!a.generated,
        onTimeline:
          project.clips.some((c) =>
            c.takes.some((t) => t.id === a.media?.id),
          ) || project.audioClips?.some((c) => c.mediaId === a.media?.id),
        kind: libraryAssetKind(a),
      }));
    const shared = library.entries.map((entry) => ({
      key: "shared:" + entry.id,
      entry,
      asset: entry.asset,
      media: entry.asset.media,
      name: entry.asset.name,
      kind: libraryAssetKind(entry.asset),
      ai: !!entry.asset.generated,
    }));
    return [
      ...new Map(
        [...pool, ...local, ...shared].map((item) => [item.key, item]),
      ).values(),
    ];
  }, [project, jobs, library.entries]);
  const organized = items.map((item) => ({
    ...item,
    versionIndex: project.clips.find(c=>c.takes.some(t=>t.id===item.media?.id))?.takes.findIndex(t=>t.id===item.media?.id),
    organizationKey: libraryItemKey(project.id, item),
    organization: organization.forAsset(
      libraryItemKey(project.id, item),
      item.asset,
    ),
  }));
  const scoped = organized.filter((item) =>
    scope === "project"
      ? !item.entry
      : item.entry || !isProjectOnly(item.asset),
  );
  const visible = scoped.filter(
    (item) =>
      !!item.organization.hidden === hiddenCollection &&
      matchesLibraryItem(
        item,
        item.organization,
        { query, folder, tags, favorites, kind: filter, unused },
        organization.folders,
      ),
  );
  const preview = visible.find(item => item.key === previewSelection?.key) || null;
  useEffect(() => { setPreview(null); setSelectedKeys([]); selectionAnchor.current = null; }, [filter, scope, folder, favorites, hiddenCollection, query, unused, tags]);
  const openDetails = item => onOpenDetails ? onOpenDetails(item) : item.asset && onEdit(item.asset.id);
  const allTags = [
    ...new Map(
      scoped
        .flatMap((item) => item.organization.tags)
        .map((tag) => [tag.toLowerCase(), tag]),
    ).values(),
  ].sort();
  const organize = (id, patch) =>
    organization.organize(id, patch).catch(() => {});
  const selectedItems = visible.filter((item) =>
    selectedKeys.includes(item.key),
  );
  const selectItem = (item, event = {}) => {
    if (event.shiftKey && selectionAnchor.current) {
      const a = visible.findIndex((row) => row.key === selectionAnchor.current),
        b = visible.findIndex((row) => row.key === item.key);
      if (a >= 0 && b >= 0)
        setSelectedKeys((old) => [
          ...new Set([
            ...old,
            ...visible
              .slice(Math.min(a, b), Math.max(a, b) + 1)
              .map((row) => row.key),
          ]),
        ]);
      else setSelectedKeys([item.key]);
    } else if (event.metaKey || event.ctrlKey)
      setSelectedKeys((old) =>
        old.includes(item.key)
          ? old.filter((key) => key !== item.key)
          : [...old, item.key],
      );
    else setSelectedKeys([item.key]);
    selectionAnchor.current = item.key;
    setPreview(item);
  };
  const bulkOrganize = (patch) =>
    Promise.all(
      selectedItems.map((item) => organize(item.organizationKey, patch)),
    );
  const hideItem = (item) => {
    organize(item.organizationKey, { hidden: !item.organization.hidden });
    setSelectedKeys((keys) => keys.filter((key) => key !== item.key));
    if (preview?.key === item.key) setPreview(null);
  };
  return (
    <aside
      className="media-dock library-redesign"
      aria-label="Library"
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "a" &&
          !event.target.closest("input,textarea,select")
        ) {
          event.preventDefault();
          event.stopPropagation();
          setSelectedKeys(visible.map((item) => item.key));
        }
        if (event.key === "Escape" && selectedKeys.length) {
          event.stopPropagation();
          setSelectedKeys([]);
          setPreview(null);
        }
      }}
    >
      <header>
        <div className="library-heading">
          <Images size={20} />
          <b>Library</b>
          <div className="library-scope-tabs" aria-label="Library scope">
            {[
              ["project", "This project", Folder],
              ["shared", "Shared library", Globe],
            ].map(([id, label, Icon]) => (
              <button
                type="button"
                key={id}
                aria-pressed={scope === id}
                onClick={() => {
                  setScope(id);
                  setSelectedKeys([]);
                  setPreview(null);
                }}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="dock-search">
          <Search size={15} />
          <input
            aria-label="Search timeline assets"
            placeholder="Search names, tags, places…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          aria-label="Add asset"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          <Plus size={16} />
          Add asset
        </button>
        <button
          className="library-return"
          aria-label="Back to studio"
          title="Back to studio"
          onClick={onClose}
        >
          <ChevronDown size={16} /> <span>Back to studio</span>
        </button>
      </header>
      {adding && (
        <div className="library-add-panel">
          <header>
            <b>What are you adding?</b>
            <button
              aria-label="Close add asset"
              onClick={() => setAdding(false)}
            >
              <X size={16} />
            </button>
          </header>
          <AssetTypePicker
            onChoose={(kind) => {
              setAdding(false);
              setFilter(kind);
              setQuery("");
              setFavorites(false);
              setTags([]);
              const folderId = ["all", "unfiled"].includes(folder)
                ? null
                : folder;
              if (["footage", "audio", "image"].includes(kind)) onImport(kind, folderId);
              else onCreate(kind, folderId);
            }}
          />
        </div>
      )}
      <nav aria-label="Asset categories">
        {filters.map(([id, label, Icon]) => (
          <button
            key={id}
            aria-label={label}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            <Icon size={16} />
            <span>{label}</span>
            <small>
              {scoped.filter((item) => !!item.organization.hidden === hiddenCollection && (id === "all" || item.kind === id)).length}
            </small>
          </button>
        ))}
        <button
          className="unused-filter"
          aria-label="Only assets off timeline"
          aria-pressed={unused}
          onClick={() => setUnused(!unused)}
        >
          <Archive size={15} />
          <span>Off timeline</span>
        </button>
      </nav>
      {(library.error || organization.error) && (
        <p role="status" className="error">
          {library.error || organization.error}
        </p>
      )}
      {allTags.length > 0 && (
        <div className="library-tag-filter" aria-label="Filter by tags">
          {allTags.map((tag) => (
            <button
              key={tag}
              aria-pressed={tags.includes(tag)}
              onClick={() =>
                setTags(
                  tags.includes(tag)
                    ? tags.filter((t) => t !== tag)
                    : [...tags, tag],
                )
              }
            >
              #{tag}
            </button>
          ))}
          {tags.length > 0 && (
            <button onClick={() => setTags([])}>Clear tags</button>
          )}
        </div>
      )}
      <div
        className={`library-workspace-content ${preview || selectedItems.length > 1 ? "has-preview" : ""}`}
      >
        <div className="library-collections">
          <LibraryFolders
            active={!hiddenCollection}
            organization={organization}
            selected={folder}
            onSelect={(value) => {
              setFolder(value);
              setHiddenCollection(false);
            }}
            favorites={favorites}
            onFavorites={(value) => {
              setFavorites(value);
              setHiddenCollection(false);
            }}
            items={scoped.filter((item) => !item.organization.hidden)}
            onMove={(id, folderId) => organize(id, { folderId })}
          />
          <button
            type="button"
            className="library-hidden-collection"
            aria-pressed={hiddenCollection}
            onClick={() => {
              setHiddenCollection(!hiddenCollection);
              setFavorites(false);
              setFolder("all");
              setSelectedKeys([]);
              setPreview(null);
            }}
          >
            <EyeOff size={15} />
            Hidden
            <span>
              {scoped.filter((item) => item.organization.hidden).length}
            </span>
          </button>
        </div>
        <div className="library-grid-region">
          <div className="library-results-heading">
            <span>
              {hiddenCollection
                ? "Hidden"
                : favorites
                  ? "Favorites"
                  : folderPath(organization.folders, folder) ||
                    (filter === "all"
                      ? "Your collection"
                      : filters.find((row) => row[0] === filter)?.[1])}
            </span>
            <small>{visible.length} assets</small>
          </div>
          <div className="media-dock-items">
            {visible.map((item) => (
              <article
                className={`media-dock-card ${selectedKeys.includes(item.key) ? "is-selected" : ""}`}
                key={item.key}
                onDoubleClick={event => { if (!event.target.closest("button,input,select")) openDetails(item); }}
              >
                <button
                  type="button"
                  className="library-card-select"
                  aria-label={`${selectedKeys.includes(item.key) ? "Deselect" : "Select"} ${item.name}`}
                  aria-pressed={selectedKeys.includes(item.key)}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectItem(item, { ctrlKey: true });
                  }}
                >
                  <Check size={13} />
                </button>
                <button
                  className="library-card-favorite"
                  aria-label={
                    (item.organization.favorite ? "Unfavorite " : "Favorite ") +
                    item.name
                  }
                  aria-pressed={item.organization.favorite}
                  onClick={() =>
                    organize(item.organizationKey, {
                      favorite: !item.organization.favorite,
                    })
                  }
                >
                  <Star
                    size={15}
                    fill={item.organization.favorite ? "currentColor" : "none"}
                  />
                </button>
                <button
                  className="library-card-image"
                  title="Click to preview · double-click for details · drag to timeline"
                  onDoubleClick={() => openDetails(item)}
                  aria-label={"Preview " + item.name}
                  onPointerDown={(e) => {
                    dragged.current = false;
                    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                    onDrag(
                      e,
                      item.key,
                      () => {
                        dragged.current = true;
                      },
                      item,
                    );
                  }}
                  aria-pressed={selectedKeys.includes(item.key)}
                  onClick={(event) => {
                    if (!dragged.current) selectItem(item, event);
                  }}
                >
                  {item.media?.thumbnail && item.media.kind !== "audio" ? (
                    <LibraryThumbnail
                      key={item.media.thumbnail}
                      media={item.media}
                    />
                  ) : item.kind === "audio" ? (
                    <AudioLines size={38} />
                  ) : (
                    <Images size={38} />
                  )}
                  {item.ai && (
                    <i className="ai-media-mark" title="AI generated">
                      <Sparkles size={12} />
                    </i>
                  )}
                  {["footage", "audio"].includes(item.kind) && (
                    <small>
                      {tc(item.clip?.duration || item.media?.duration)}
                    </small>
                  )}
                  {["footage", "audio"].includes(item.kind) && (
                    <span className="library-play-mark">
                      <Play size={20} />
                    </span>
                  )}
                </button>
                <small className="library-used">{[
                  item.versionIndex>=0 && `Version ${item.versionIndex+1}`,
                  (item.createdAt || item.media?.createdAt) && Number.isFinite(new Date(item.createdAt || item.media?.createdAt).getTime()) && new Date(item.createdAt || item.media?.createdAt).toLocaleDateString(undefined,{month:"short",day:"numeric"}),
                  project.clips.some(c=>c.activeTake===item.media?.id) && "Used in edit",
                ].filter(Boolean).join(" · ")}</small>
                <div className="library-card-caption">
                  <span title={item.name}>{item.name}</span>
                  <button
                    aria-label={"Add " + item.name + " to timeline or prompt"}
                    title="Use at playhead"
                    onClick={() => onUse(item)}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <div className="library-card-tags">
                  {item.organization.tags.slice(0, 3).map((tag) => (
                    <button key={tag} onClick={() => setTags([tag])}>
                      #{tag}
                    </button>
                  ))}
                </div>
                <div className="library-card-scope">
                  <button
                    type="button"
                    className="library-card-hide"
                    aria-label={`${item.organization.hidden ? "Unhide" : "Hide"} ${item.name}`}
                    title={
                      item.organization.hidden
                        ? "Restore to library"
                        : "Hide from library"
                    }
                    onClick={() => hideItem(item)}
                  >
                    {item.organization.hidden ? (
                      <Eye size={12} />
                    ) : (
                      <EyeOff size={12} />
                    )}
                  </button>
                  <button
                    className="library-folder-handle"
                    draggable
                    aria-label={"Organize " + item.name}
                    title={
                      folderPath(
                        organization.folders,
                        item.organization.folderId,
                      ) || "Move to a folder"
                    }
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "library-organize",
                        item.organizationKey,
                      );
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => selectItem(item)}
                  >
                    <Folder size={12} />
                    {folderPath(
                      organization.folders,
                      item.organization.folderId,
                    )
                      .split(" / ")
                      .at(-1)}
                  </button>
                  {item.entry ? (
                    <>
                      <Globe size={11} />
                      Shared library
                    </>
                  ) : (
                    <button
                      aria-label={
                        (isProjectOnly(item.asset)
                          ? "Share "
                          : "Keep project only: ") + item.name
                      }
                      title={
                        isProjectOnly(item.asset)
                          ? needsReferenceApproval(item.asset)
                            ? hasReferenceImage(item.asset)
                              ? "Approve reference and share across projects"
                              : "Add an image reference before sharing"
                            : "Share across all projects"
                          : "Keep in this project only"
                      }
                      disabled={
                        needsReferenceApproval(item.asset) &&
                        !hasReferenceImage(item.asset)
                      }
                      onClick={() => onScope(item)}
                    >
                      {isProjectOnly(item.asset) ? (
                        <Lock size={11} />
                      ) : (
                        <Globe size={11} />
                      )}{" "}
                      {isProjectOnly(item.asset) ? "Project only" : "Shared"}
                    </button>
                  )}
                </div>
              </article>
            ))}
            {!visible.length && (
              <p className="library-empty">
                {library.loading
                  ? "Opening your library…"
                  : query ||
                      favorites ||
                      tags.length ||
                      folder !== "all" ||
                      filter !== "all" ||
                      unused
                    ? "No assets match these filters."
                    : "Add footage, audio, and reference images to your library."}
                {!library.loading && (
                  <button
                    className="text-action"
                    onClick={() => {
                      setFolder("all");
                      setFavorites(false);
                      setTags([]);
                      setFilter("all");
                      setUnused(false);
                      setQuery("");
                      setHiddenCollection(false);
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </p>
            )}
          </div>
          {selectedItems.length > 1 && (
            <div
              className="library-bulk-bar"
              aria-label="Selected asset actions"
            >
              <CheckSquare2 size={15} />
              <b>{selectedItems.length} selected</b>
              <button
                type="button"
                onClick={() => {
                  bulkOrganize({ hidden: !hiddenCollection });
                  setSelectedKeys([]);
                  setPreview(null);
                }}
              >
                {hiddenCollection ? <Eye size={14} /> : <EyeOff size={14} />}
                {hiddenCollection ? "Unhide" : "Hide"}
              </button>
              <button
                type="button"
                onClick={() => bulkOrganize({ favorite: true })}
              >
                <Star size={14} />
                Favorite
              </button>
              <select
                aria-label="Move selected assets to folder"
                value=""
                onChange={(event) => {
                  bulkOrganize({
                    folderId:
                      event.target.value === "unfiled"
                        ? null
                        : event.target.value,
                  });
                }}
              >
                <option value="" disabled>
                  Move to…
                </option>
                <option value="unfiled">Unfiled</option>
                {organization.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folderPath(organization.folders, folder.id)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Clear selection"
                onClick={() => setSelectedKeys([])}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
        {selectedItems.length > 1 ? (
          <section
            className="library-preview library-selection-preview"
            aria-label="Selection details"
          >
            <div className="library-selection-mosaic">
              {selectedItems.slice(0, 4).map((item) => (
                <LibraryThumbnail key={item.key} media={item.media} />
              ))}
            </div>
            <h3>{selectedItems.length} assets</h3>
            <p>Organize this selection together.</p>
            <button
              type="button"
              onClick={() => bulkOrganize({ favorite: true })}
            >
              <Star size={15} />
              Add to Favorites
            </button>
            <button
              type="button"
              onClick={() => bulkOrganize({ favorite: false })}
            >
              Remove from Favorites
            </button>
          </section>
        ) : (
          preview && (
            <section key={preview.key} className="library-preview library-single-preview" aria-label="Asset preview">
              <header>
                <div>
                  <small>{preview.kind}</small>
                  <b>{preview.name}</b>
                </div>
                <button
                  aria-label="Close asset preview"
                  onClick={() => {
                    setPreview(null);
                    setSelectedKeys([]);
                  }}
                >
                  <ChevronDown size={16} />
                </button>
              </header>
              <button type="button" className="library-open-details" onClick={() => openDetails(preview)}><Settings2 size={15}/> Open details</button>
              <div className="library-preview-body">
              {preview.media?.kind === "video" ? (
                <video
                  key={preview.key}
                  src={preview.media.url}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label="Footage preview"
                />
              ) : preview.media?.kind === "audio" ? (
                <audio
                  key={preview.key}
                  src={preview.media.url}
                  controls
                  preload="metadata"
                  aria-label="Audio preview"
                />
              ) : (
                <LibraryThumbnail
                  key={preview.key}
                  media={preview.media}
                  name={preview.name}
                />
              )}
              <p>
                {preview.asset?.description ||
                  "Add a description to guide future clips."}
              </p>
              {!!preview.asset?.variants?.length && (
                <div className="library-inspector-looks">
                  <small>{characterLooks(preview.asset).length} looks</small>
                  <div>
                    {characterLooks(preview.asset)
                      .map((media) => (
                        <LibraryThumbnail key={media.id} media={media} />
                      ))}
                  </div>
                </div>
              )}
              <AssetOrganizationEditor
                key={preview.key}
                organization={organization}
                assetKey={libraryItemKey(project.id, preview)}
                asset={preview.asset}
              />
              <button type="button" onClick={() => hideItem(preview)}>
                {preview.organization.hidden ? (
                  <Eye size={15} />
                ) : (
                  <EyeOff size={15} />
                )}
                {preview.organization.hidden
                  ? "Restore to library"
                  : "Hide from library"}
              </button>
              </div>
              {preview.media?.kind === "image" && onUseStartFrame && <button className="library-preview-use" onClick={() => onUseStartFrame(preview)}>Use as start frame</button>}
              <button className="library-preview-use" onClick={() => onUse(preview)}>
                <Plus size={16} />
                Use at playhead
              </button>
            </section>
          )
        )}
      </div>
    </aside>
  );
}
