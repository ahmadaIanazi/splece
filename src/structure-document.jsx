import { useSharedLibrary } from "./shared-library";
import { useLibraryOrganization } from "./library-organization";
import {
  libraryAssetKey,
  folderPath,
} from "../shared/library-organization.mjs";
import {
  isProjectOnly,
  hasReferenceImage,
  needsReferenceApproval,
} from "../shared/asset-scope.mjs";
import React, { useRef, useState } from "react";
import {
  BookOpen,
  FolderOpen,
  Clapperboard,
  Images,
  Package,
  MapPin,
  Users,
  Search,
  Plus,
  X,
  GripVertical,
  ChevronRight,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Sparkles,
  CornerUpLeft,
} from "lucide-react";
import {
  isStructureClip,
  structureColor,
  structureLabel,
} from "../shared/structure.mjs";
import { storyDepth } from "../shared/story-tree.mjs";
import { structureReferences } from "../shared/structure-document.mjs";

export const structureDragType = "application/x-splece-structure";
export const referenceDragType = "application/x-splece-reference";

export function StructureOutline({ plan, nodes, current, navigate }) {
  const nav = useRef(null);
  function revealCurrent() {
    requestAnimationFrame(() => {
      const active = nav.current?.querySelector("[aria-current]");
      if (active)
        nav.current.scrollTop = active.offsetTop - nav.current.clientHeight / 2;
    });
  }
  return (
    <nav
      className="structure-outline"
      aria-label="Structure outline"
      ref={nav}
      onMouseEnter={revealCurrent}
      onFocus={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) revealCurrent();
      }}
    >
      {[{ id: "main-story", title: "Main story" }, ...nodes].map(
        (node, index) => {
          const main = node.id === "main-story";
          const Icon = main
            ? BookOpen
            : isStructureClip(node)
              ? Clapperboard
              : FolderOpen;
          return (
            <button
              key={node.id}
              className="structure-indicator"
              aria-label={node.title}
              title={node.title}
              aria-current={current === node.id ? "location" : undefined}
              style={{
                "--depth": main ? 0 : Math.min(6, storyDepth(plan.beats, node)),
                "--story-kind-color": main
                  ? "#b9a2ed"
                  : structureColor(plan, node),
              }}
              onClick={() => navigate(node.id)}
            >
              <i aria-hidden="true" />
              <Icon size={15} />
              <span>
                {node.title}
                <small>
                  {main ? "Concept & direction" : structureLabel(plan, node)}
                </small>
              </span>
              <em>{String(index + 1).padStart(2, "0")}</em>
            </button>
          );
        },
      )}
    </nav>
  );
}

export function ReferenceBadges({ node, assets, onOpen }) {
  const attached = structureReferences(node, assets);
  if (!attached.length) return null;
  return (
    <div
      className="structure-reference-badges"
      aria-label="Attached references"
    >
      {attached.map((asset) => (
        <button
          key={asset.id}
          title={asset.name + " · " + asset.kind}
          aria-label={"Reference: " + asset.name}
          onClick={() => onOpen(asset.id)}
        >
          {asset.media?.thumbnail ? (
            <img src={asset.media.thumbnail} alt="" />
          ) : asset.kind === "character" ? (
            <Users size={14} />
          ) : asset.kind === "location" ? (
            <MapPin size={14} />
          ) : (
            <Package size={14} />
          )}
          <span>{asset.name}</span>
        </button>
      ))}
    </div>
  );
}

export function ReferenceDrawer({
  project,
  selected,
  attach,
  detach,
  onAssets,
  onSuggest,
  onScope,
  busy,
  proposalAssets = [],
  onProjectAttach,
  onReview,
}) {
  const library = useSharedLibrary(project);
  const organization = useLibraryOrganization();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(null);
  const assets = [
    ...project.assets,
    ...library.entries.map((entry) => ({
      ...entry.asset,
      id: "shared:" + entry.id,
      _libraryId: entry.id,
      _origin: entry.originName,
    })),
    ...proposalAssets
      .filter((a) => !project.assets.some((local) => local.id === a.id))
      .map((a) => ({
        ...a,
        id: "proposal:" + a.id,
        scope: "project",
        _proposal: true,
      })),
  ];
  const results = assets.filter((asset) => {
    const meta = organization.forAsset(
      asset._libraryId || libraryAssetKey(project.id, asset),
      asset,
    );
    return (
      (filter === "all" ||
        (filter === "project"
          ? isProjectOnly(asset)
          : !isProjectOnly(asset))) &&
      [
        asset.name,
        asset.kind,
        ...meta.tags,
        folderPath(organization.folders, meta.folderId),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  });
  async function run(id, action) {
    setWorking(id);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(null);
    }
  }
  return (
    <>
      <p className="structure-drawer-hint">
        {onProjectAttach ? "Choose a reference to use in this story." : "Choose your cast before planning. Use + to add a reference to the project, or select a section to attach it there."}
      </p>
      <label className="structure-search">
        <Search size={15} />
        <input
          aria-label="Search references"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search assets, tags, folders…"
        />
      </label>
      <div
        className="structure-segments"
        role="group"
        aria-label="Library scope"
      >
        {[
          ["all", "All assets"],
          ["project", "Project only"],
          ["shared", "Shared"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {(error || library.error) && (
        <p className="error" role="alert">
          {error || library.error}
        </p>
      )}
      {library.loading && (
        <p role="status" className="structure-drawer-hint">
          Opening shared library…
        </p>
      )}
      <div className="structure-library">
        {results.map((asset) => {
          const attached =
            selected && structureReferences(selected, [asset]).length > 0;
          const draft = needsReferenceApproval(asset);
          const canApprove = !draft || hasReferenceImage(asset);
          return (
            <div
              className="structure-library-item"
              key={asset.id}
              draggable={!asset._proposal}
              onDragStart={(e) => {
                e.dataTransfer.setData(referenceDragType, asset.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
            >
              <button
                className="structure-library-open"
                disabled={working === asset.id}
                title={
                  asset._proposal
                    ? "View saved suggestion"
                    : "Edit " + asset.name
                }
                onClick={() =>
                  asset._proposal
                    ? onReview()
                    : run(asset.id, () => onAssets(asset.id))
                }
              >
                {asset.media?.thumbnail ? (
                  <img src={asset.media.thumbnail} alt="" draggable={false} />
                ) : (
                  <span>
                    <Package size={22} />
                  </span>
                )}
                <span>
                  <b>{asset.name}</b>
                  <small>
                    {asset.kind}
                    {asset._proposal
                      ? " · saved suggestion"
                      : asset._origin
                        ? " · " + asset._origin
                        : draft
                          ? " · awaiting approval"
                          : ""}
                  </small>
                </span>
              </button>
              <button
                className="icon"
                aria-label={(attached ? "Detach " : "Attach ") + asset.name}
                title={
                  onProjectAttach ? "Use in this story" : asset._proposal
                    ? "Available when this saved result is added to the story"
                    : selected
                      ? (attached ? "Remove from " : "Attach to ") +
                        selected.title
                      : "Select a section first"
                }
                disabled={(!selected && !onProjectAttach) || asset._proposal || working === asset.id}
                onClick={() =>
                  run(asset.id, () =>
                    onProjectAttach ? onProjectAttach(asset) : attached
                      ? detach(selected.id, asset.id)
                      : attach(selected.id, asset.id),
                  )
                }
              >
                {attached ? <X size={16} /> : <Plus size={16} />}
              </button>
              <div className="structure-library-scope">
                {asset._libraryId ? (
                  <small>Shared library</small>
                ) : (
                  <label>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={"Project only: " + asset.name}
                      checked={isProjectOnly(asset)}
                      disabled={asset._proposal || !canApprove}
                      onChange={(e) =>
                        run(asset.id, () => onScope(asset.id, e.target.checked))
                      }
                    />
                    <span>Project only</span>
                  </label>
                )}
                {asset._proposal ? (
                  <button onClick={onReview}>View saved result</button>
                ) : (
                  draft && (
                    <small>
                      {canApprove
                        ? "Turn off to approve & share"
                        : "Add an image to approve"}
                    </small>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!results.length && !library.loading && (
        <p className="structure-drawer-hint">No assets match this view.</p>
      )}
      <button className="text-action" onClick={() => onAssets()}>
        <Images size={16} /> Manage assets
      </button>
      <button className="text-action" disabled={busy} onClick={onSuggest}>
        <Sparkles size={15} /> Suggest locations &amp; props
      </button>
    </>
  );
}

export function StructureItemHeading({
  node,
  plan,
  selected,
  folded,
  select,
  toggle,
  move,
  startDrag,
  endDrag,
}) {
  const group = !isStructureClip(node);
  return (
    <header className="structure-item-heading">
      <button
        className="structure-drag-handle icon"
        draggable
        onDragStart={startDrag}
        onDragEnd={endDrag}
        aria-label={"Drag " + node.title}
        title="Drag to reorder; drop in a group to nest"
      >
        <GripVertical size={15} />
      </button>
      {group && (
        <button
          className="structure-folder-toggle icon"
          aria-label={(folded ? "Expand " : "Collapse ") + node.title}
          aria-expanded={!folded}
          onClick={toggle}
        >
          {folded ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
      )}
      <button
        className="structure-title"
        aria-label={"Edit " + node.title}
        aria-expanded={selected}
        onClick={select}
      >
        {group && <FolderOpen size={17} />}
        <h2>{node.title}</h2>
        {group && (
          <small>
            {plan.beats.filter((b) => b.parentId === node.id).length}
          </small>
        )}
      </button>
      {selected && (
        <div className="structure-move-actions">
          <button
            className="icon"
            title="Move up"
            aria-label={"Move " + node.title + " up"}
            onClick={() => move("up")}
          >
            <ArrowUp size={14} />
          </button>
          <button
            className="icon"
            title="Move down"
            aria-label={"Move " + node.title + " down"}
            onClick={() => move("down")}
          >
            <ArrowDown size={14} />
          </button>
          {node.parentId && (
            <button
              className="icon"
              title="Move out of group"
              aria-label={"Move " + node.title + " out of group"}
              onClick={() => move("out")}
            >
              <CornerUpLeft size={14} />
            </button>
          )}
          <button
            className="icon"
            title="Finish editing"
            aria-label={"Finish editing " + node.title}
            onClick={select}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </header>
  );
}
