import React, { useEffect, useState } from "react";
import {
  Folder,
  FolderPlus,
  Star,
  Images,
  Inbox,
  Pencil,
  Trash2,
  Check,
  X,
  Tag,
} from "lucide-react";
import { api } from "./state";
import {
  assetOrganization,
  folderPath,
} from "../shared/library-organization.mjs";
const eventName = "splece-library-organization";
export function useLibraryOrganization() {
  const [state, setState] = useState({ folders: [], metadata: {} }),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true,
      changed = false;
    const received = (e) => {
      changed = true;
      setState(e.detail);
    };
    window.addEventListener(eventName, received);
    api("/library/organization")
      .then((v) => {
        if (live && !changed) setState(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      window.removeEventListener(eventName, received);
    };
  }, []);
  async function change(url, body, method) {
    setError("");
    try {
      const next = await api(url, body, method);
      window.dispatchEvent(new CustomEvent(eventName, { detail: next }));
      return next;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }
  return {
    ...state,
    error,
    forAsset: (key, asset) => assetOrganization(state.metadata, key, asset),
    organize: (id, patch) =>
      change("/library/organization", { id, patch }, "PATCH"),
    saveFolder: (value, id) =>
      change(
        "/library/folders" + (id ? "/" + id : ""),
        value,
        id ? "PATCH" : "POST",
      ),
    removeFolder: (id) => change("/library/folders/" + id, undefined, "DELETE"),
  };
}
export function LibraryFolders({
  active = true,
  organization,
  selected,
  onSelect,
  favorites,
  onFavorites,
  items,
  onMove,
}) {
  const [form, setForm] = useState(null),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState(false);
  const sorted = [...organization.folders].sort((a, b) =>
    folderPath(organization.folders, a.id).localeCompare(
      folderPath(organization.folders, b.id),
    ),
  );
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const next = await organization.saveFolder(
        { name: form.name, parentId: form.parentId },
        form.id,
      );
      const saved = next.folders.find(
        (f) =>
          f.id === form.id ||
          (!form.id &&
            f.name === form.name.trim() &&
            f.parentId === form.parentId),
      );
      if (saved) onSelect(saved.id);
      setForm(null);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="library-folders" aria-label="Library folders">
      <button
        aria-pressed={active && selected === "all" && !favorites}
        onClick={() => {
          onSelect("all");
          onFavorites(false);
        }}
      >
        <Images size={16} />
        All assets<span>{items.length}</span>
      </button>
      <button aria-pressed={active && favorites} onClick={() => onFavorites(!favorites)}>
        <Star size={16} />
        Favorites
        <span>{items.filter((i) => i.organization.favorite).length}</span>
      </button>
      <button
        aria-pressed={active && selected === "unfiled"}
        onClick={() => onSelect("unfiled")}
      >
        <Inbox size={16} />
        Unfiled
      </button>
      <div className="library-folder-heading">
        <b>Folders</b>
        <button
          aria-label="New library folder"
          onClick={() => {
            setForm({
              name: "",
              parentId: !["all", "unfiled"].includes(selected)
                ? selected
                : null,
            });
            setRemove(false);
          }}
        >
          <FolderPlus size={16} />
        </button>
      </div>
      {sorted.map((f) => (
        <div
          key={f.id}
          className="library-folder-row"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("library-organize"))
              e.preventDefault();
          }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData("library-organize");
            if (id) {
              e.preventDefault();
              e.stopPropagation();
              onMove(id, f.id);
            }
          }}
        >
          <button
            title={folderPath(organization.folders, f.id)}
            aria-pressed={active && selected === f.id}
            onClick={() => {
              onSelect(f.id);
              setRemove(false);
            }}
            style={{
              paddingLeft:
                10 +
                Math.min(
                  4,
                  folderPath(organization.folders, f.id).split(" / ").length -
                    1,
                ) *
                  10,
            }}
          >
            <Folder size={15} />
            <span>{f.name}</span>
          </button>
          {selected === f.id && (
            <button
              aria-label={"Edit folder " + f.name}
              onClick={() => {
                setForm({ ...f });
                setRemove(false);
              }}
            >
              <Pencil size={12} />
            </button>
          )}
        </div>
      ))}
      {form && (
        <form className="library-folder-form" onSubmit={save}>
          <input
            autoFocus
            aria-label="Folder name"
            placeholder="Folder name"
            value={form.name}
            maxLength={120}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            aria-label="Parent folder"
            value={form.parentId || ""}
            onChange={(e) =>
              setForm({ ...form, parentId: e.target.value || null })
            }
          >
            <option value="">Top level</option>
            {sorted
              .filter((f) => f.id !== form.id)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {folderPath(sorted, f.id)}
                </option>
              ))}
          </select>
          <div>
            <button
              disabled={busy || !form.name.trim()}
              aria-label="Save folder"
            >
              <Check size={15} />
            </button>
            <button
              type="button"
              aria-label="Cancel folder editing"
              onClick={() => setForm(null)}
            >
              <X size={15} />
            </button>
            {form.id && (
              <button
                type="button"
                aria-label="Remove folder"
                onClick={() => setRemove(true)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
          {remove && (
            <>
              <small>
                Remove this folder? Assets and subfolders move to its parent. No
                media is deleted.
              </small>
              <button
                disabled={busy}
                type="button"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await organization.removeFolder(form.id);
                    onSelect(form.parentId || "all");
                    setForm(null);
                  } catch {
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove folder only
              </button>
            </>
          )}
        </form>
      )}
      <small className="library-folder-help">
        Drag an asset’s folder icon onto a folder, or organize it in preview.
      </small>
    </aside>
  );
}
export function AssetOrganizationEditor({
  organization,
  assetKey,
  asset,
  defaultFolderId = null,
}) {
  const value = {
      ...organization.forAsset(assetKey, asset),
      folderId:
        organization.metadata[assetKey]?.folderId === undefined
          ? defaultFolderId
          : organization.metadata[assetKey].folderId,
    },
    [tagText, setTagText] = useState(""),
    [busy, setBusy] = useState(false);
  async function patch(p) {
    setBusy(true);
    try {
      await organization.organize(assetKey, p);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function addTags() {
    if (!tagText.trim()) return;
    if (await patch({ tags: [...value.tags, ...tagText.split(",")] }))
      setTagText("");
  }
  return (
    <section className="asset-organization" aria-label="Organize asset">
      <button
        className="favorite-action"
        type="button"
        aria-pressed={value.favorite}
        onClick={() => patch({ favorite: !value.favorite })}
        disabled={busy}
      >
        <Star size={15} fill={value.favorite ? "currentColor" : "none"} />
        {value.favorite ? "Favorited" : "Add to Favorites"}
      </button>
      <label>
        <Folder size={14} />
        Folder
        <select
          aria-label="Asset folder"
          disabled={busy}
          value={value.folderId || ""}
          onChange={(e) => patch({ folderId: e.target.value || null })}
        >
          <option value="">Unfiled</option>
          {[...organization.folders]
            .sort((a, b) =>
              folderPath(organization.folders, a.id).localeCompare(
                folderPath(organization.folders, b.id),
              ),
            )
            .map((f) => (
              <option key={f.id} value={f.id}>
                {folderPath(organization.folders, f.id)}
              </option>
            ))}
        </select>
      </label>
      <div className="library-tags">
        {value.tags.map((tag) => (
          <button
            type="button"
            key={tag}
            disabled={busy}
            aria-label={"Remove tag " + tag}
            onClick={() => patch({ tags: value.tags.filter((t) => t !== tag) })}
          >
            {tag}
            <X size={11} />
          </button>
        ))}
      </div>
      <div
        className="asset-tag-input"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            addTags();
          }
        }}
      >
        <Tag size={14} />
        <input
          aria-label="New asset tags"
          placeholder="Add tags, separated by commas"
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || !tagText.trim()}
          aria-label="Add asset tags"
          onClick={addTags}
        >
          <Check size={15} />
        </button>
      </div>
    </section>
  );
}
