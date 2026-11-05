import { CharacterWorkbench } from "./character-workbench";
import React, { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  Upload,
  Sparkles,
  Images,
  ImagePlus,
  Check,
  Star,
  Trash2,
  WandSparkles,
  SlidersHorizontal,
  UserRound,
  AudioLines,
  ChevronDown,
  LoaderCircle,
} from "lucide-react";
import { CharacterMedia, appendCharacterImage } from "./character";
import { AssetExchange } from "./asset-exchange";
import { VariantEditor } from "./advanced";
import { AssetOrganizationEditor } from "./library-organization";
import {
  isProjectOnly,
  needsReferenceApproval,
  hasReferenceImage,
  setAssetProjectOnly,
} from "../shared/asset-scope.mjs";
import {
  libraryAssetKey,
  assetTypes,
} from "../shared/library-organization.mjs";
import { assetTagFields } from "../shared/asset-exchange.mjs";
import "./asset-workbench.css";
const AssetGenerator = lazy(() =>
  import("./asset-generator").then((module) => ({
    default: module.AssetGenerator,
  })),
);
const AssetUnderstanding = lazy(() =>
  import("./asset-understanding").then((module) => ({
    default: module.AssetUnderstanding,
  })),
);

export function AssetWorkbench(props) {
  return props.asset.kind === "character" ? (
    <CharacterWorkbench {...props} />
  ) : (
    <VisualAssetWorkbench {...props} />
  );
}
function VisualAssetWorkbench({
  asset,
  project,
  change,
  onImport,
  onAdopt,
  onStarted,
  organization,
  initialFolderId,
}) {
  const [source, setSource] = useState(asset.media ? "looks" : "generate"),
    [tab, setTab] = useState("look"),
    [selectedId, setSelectedId] = useState(asset.media?.id || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [suggestion, setSuggestion] = useState(null),
    [pendingReference, setPendingReference] = useState(null);
  const alive = useRef(true),
    sourceLock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const gallery = [
    asset.media,
    ...(asset.mediaList || []),
    ...(asset.variants || []).map((variant) => variant.media),
  ]
    .filter(Boolean)
    .filter(
      (media, index, list) =>
        list.findIndex((other) => other.id === media.id) === index,
    );
  const selected =
    gallery.find((media) => media.id === selectedId) ||
    asset.media ||
    gallery[0];
  const variant =
    selected?.id !== asset.media?.id
      ? asset.variants?.find((item) => item.media?.id === selected?.id)
      : null;
  const attach = (media) => {
    if (!alive.current) return;
    change((current) =>
      current?.id === asset.id ? appendCharacterImage(current, media) : current,
    );
    setSelectedId(media.id);
    setSource("looks");
  };
  async function dropImage(event) {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0];
    if (!file || sourceLock.current) return;
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
      setError("Choose a JPG, PNG or WebP image.");
      return;
    }
    sourceLock.current = true;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/projects/${project.id}/import`, {
        method: "POST",
        body: form,
      });
      const media = await response.json();
      if (!response.ok) throw Error(media.error || "Import failed.");
      if (media.kind !== "image") throw Error("Choose an image.");
      setPendingReference(media);
      setSource("generate");
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      sourceLock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const setLook = (field, value) =>
    change({
      ...asset,
      ...(variant
        ? {
            variants: asset.variants.map((item) =>
              item.id === variant.id ? { ...item, [field]: value } : item,
            ),
          }
        : { [field === "description" ? "variant" : field]: value }),
    });
  const setLookTag = (key, value) => {
    if (variant) setLook("tags", { ...variant.tags, [key]: value });
    else change({ ...asset, lookTags: { ...asset.lookTags, [key]: value } });
  };
  const removeLook = () => {
    if (!selected) return;
    const remaining = gallery.filter((media) => media.id !== selected.id);
    change({
      ...asset,
      media:
        asset.media?.id === selected.id ? remaining[0] || null : asset.media,
      mediaList: (asset.mediaList || []).filter(
        (media) => media.id !== selected.id,
      ),
      variants: (asset.variants || []).filter(
        (item) => item.media?.id !== selected.id,
      ),
      contactSheets: (asset.contactSheets || []).filter(
        (id) => id !== selected.id,
      ),
    });
    setSelectedId(remaining[0]?.id || "");
    if (!remaining.length) setSource("generate");
  };
  const generatorChange = (next) => {
    change(next);
    const added = [
      ...(next.variants || []).map((v) => v.media),
      ...(next.mediaList || []),
    ].find((m) => m && !gallery.some((old) => old.id === m.id));
    setSelectedId(
      added?.id ||
        (next.media?.id !== asset.media?.id ? next.media?.id : selectedId) ||
        next.media?.id ||
        "",
    );
    setPendingReference(null);
    setSource("looks");
  };
  const matching = project.assets.filter(
    (item) => item.id !== asset.id && item.media?.kind === "image",
  );
  return (
    <div
      className={`asset-workbench ${source === "generate" ? "is-generating" : ""}`}
    >
      <section className="asset-visual-workspace" aria-label="Asset images">
        <nav className="asset-source-tabs" aria-label="Add an asset image">
          {!!gallery.length && (
            <button
              type="button"
              aria-pressed={source === "looks"}
              onClick={() => setSource("looks")}
            >
              <Images size={15} />
              Versions <small>{gallery.length}</small>
            </button>
          )}
          <button
            type="button"
            aria-pressed={source === "generate"}
            onClick={() => setSource("generate")}
          >
            <Sparkles size={15} />
            Add image
          </button>
        </nav>
        {source === "generate" ? (
          <Suspense
            fallback={
              <div className="asset-workbench-loading">
                <LoaderCircle size={23} />
                Opening image creator…
              </div>
            }
          >
            <AssetGenerator
              key={`${asset.id}:${pendingReference?.id || suggestion?.id || "default"}`}
              embedded
              asset={asset}
              project={project}
              change={generatorChange}
              onReferenceAdded={(next) => {
                change(next);
                const added = next.mediaList?.find(
                  (m) => !gallery.some((old) => old.id === m.id),
                );
                if (added) setSelectedId(added.id);
              }}
              onStarted={onStarted}
              onAdopt={onAdopt}
              initialReference={pendingReference}
              initialDirection={suggestion?.prompt}
              initialSourceMediaId={selected?.id}
            />
          </Suspense>
        ) : source === "library" ? (
          <div className="asset-source-library">
            {matching.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => attach(item.media)}
              >
                <img src={item.media.thumbnail} alt="" />
                <span>{item.name}</span>
              </button>
            ))}
            {!matching.length && (
              <p>No other image references in this project yet.</p>
            )}
          </div>
        ) : source === "upload" ? (
          <button
            type="button"
            className="asset-upload-surface"
            disabled={busy}
            onClick={() => onImport(asset.kind, attach)}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={dropImage}
          >
            {busy ? (
              <LoaderCircle size={35} />
            ) : (
              <Upload size={35} strokeWidth={1.2} />
            )}
            <b>{busy ? "Saving your image…" : "Drop an image here"}</b>
            <span>or choose a file</span>
            <small>JPG · PNG · WebP</small>
          </button>
        ) : (
          <>
            <div
              className="asset-main-look"
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDrop={dropImage}
            >
              {selected ? (
                <img
                  src={`/api/media/${selected.id}/original`}
                  alt={variant?.name || asset.name || "Asset reference"}
                />
              ) : (
                <ImagePlus size={42} />
              )}
              {selected && (
                <div className="asset-look-overlay">
                  <span>
                    {asset.media?.id === selected.id ? (
                      <>
                        <Star size={12} />
                        Main reference
                      </>
                    ) : (
                      variant?.name || "Reference image"
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove this version"
                    title="Remove this version from the asset draft"
                    onClick={removeLook}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
            <div className="asset-look-carousel" aria-label="Asset versions">
              {gallery.map((media) => (
                <button
                  type="button"
                  key={media.id}
                  aria-pressed={selected?.id === media.id}
                  aria-label={`View ${asset.variants?.find((item) => item.media?.id === media.id)?.name || media.name || "look"}`}
                  onClick={() => setSelectedId(media.id)}
                >
                  <img
                    src={media.thumbnail || `/api/media/${media.id}/original`}
                    alt=""
                  />
                  {asset.media?.id === media.id && <Star size={10} />}
                </button>
              ))}
              <button
                type="button"
                className="asset-look-add"
                aria-label="Add a version"
                onClick={() => {
                  setSuggestion(null);
                  setSource("generate");
                }}
              >
                <Sparkles size={21} />
              </button>
            </div>
            {selected && selected.id !== asset.media?.id && (
              <button
                type="button"
                className="asset-main-reference"
                onClick={() =>
                  change({
                    ...asset,
                    media: selected,
                    mediaList: gallery,
                    ...(variant
                      ? {
                          description: variant.description || asset.description,
                          variant: "",
                          visualBrief: variant.visualBrief || {},
                        }
                      : {}),
                  })
                }
              >
                <Star size={13} />
                Use as main reference
              </button>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      <section className="asset-profile-workspace" aria-label="Asset details">
        <div className="asset-profile-eyebrow">
          <select
            aria-label="Asset type"
            value={asset.kind}
            onChange={(event) => change({ ...asset, kind: event.target.value })}
          >
            {assetTypes
              .filter((type) => !["footage", "audio"].includes(type.id))
              .map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
          </select>
          <label title="Keep this asset in this project only">
            <input
              type="checkbox"
              role="switch"
              aria-label="Project only"
              checked={isProjectOnly(asset)}
              disabled={
                needsReferenceApproval(asset) && !hasReferenceImage(asset)
              }
              onChange={(event) =>
                change(setAssetProjectOnly({ ...asset }, event.target.checked))
              }
            />
            <span>Project only</span>
          </label>
        </div>
        <input
          className="asset-title-input"
          aria-label="Asset name"
          placeholder={`Name this ${asset.kind === "location" ? "place" : asset.kind}`}
          value={asset.name}
          maxLength={100}
          onChange={(event) => change({ ...asset, name: event.target.value })}
        />
        <div
          className="asset-profile-tabs"
          role="tablist"
          aria-label="Asset profile sections"
        >
          {[
            ["look", "This version", SlidersHorizontal],
            [
              "details",
              asset.kind === "character" ? "Character" : "Details",
              UserRound,
            ],
            ...(asset.kind === "character"
              ? [["voice", "Voice", AudioLines]]
              : []),
          ].map(([id, label, Icon]) => (
            <button
              type="button"
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        {tab === "look" ? (
          <div className="asset-profile-fields">
            {variant && (
              <label>
                Version name
                <input
                  aria-label="Version name"
                  value={variant.name || ""}
                  onChange={(event) => setLook("name", event.target.value)}
                />
              </label>
            )}
            <label>
              {!selected && !asset.variant
                ? asset.kind === "character"
                  ? "Character brief"
                  : "Visual brief"
                : asset.kind === "character"
                  ? "Appearance & clothing"
                  : asset.kind === "location"
                    ? "Light, atmosphere & details"
                    : "Visual details"}
              <textarea
                aria-label="Current version description"
                placeholder={
                  asset.kind === "character"
                    ? "Outfit, expression, pose…"
                    : "Materials, light, colors…"
                }
                rows={4}
                value={
                  variant?.description ??
                  (selected && selected.id !== asset.media?.id
                    ? ""
                    : asset.variant || asset.description || "")
                }
                onChange={(event) => {
                  const description = event.target.value;
                  if (!selected || selected.id === asset.media?.id)
                    change({
                      ...asset,
                      description,
                      variant: "",
                      visualBrief: {},
                    });
                  else if (variant)
                    change({
                      ...asset,
                      variants: asset.variants.map((v) =>
                        v.id === variant.id
                          ? { ...v, description, visualBrief: {} }
                          : v,
                      ),
                    });
                  else
                    change({
                      ...asset,
                      variants: [
                        ...(asset.variants || []),
                        {
                          id: `look:${selected.id}`,
                          name: selected.name || "New look",
                          media: selected,
                          description,
                          visualBrief: {},
                          tags: {},
                        },
                      ],
                    });
                }}
              />
            </label>
            {!!variant?.keywords?.length && (
              <div className="asset-keywords">
                {variant.keywords.map((word) => (
                  <span key={word}>{word}</span>
                ))}
              </div>
            )}
            {variant && (
              <details className="asset-workbench-more">
                <summary>
                  <ChevronDown size={13} />
                  Version details
                </summary>
                <div className="asset-look-tags">
                  {assetTagFields(asset.kind).map((key) => (
                    <label key={key}>
                      {key.replace(/([A-Z])/g, " $1")}
                      <input
                        aria-label={`Look ${key}`}
                        value={variant.tags?.[key] || ""}
                        placeholder="Auto"
                        onChange={(event) =>
                          setLookTag(key, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
            )}
            <label className="asset-reference-grid">
              <input
                type="checkbox"
                checked={!!asset.contactSheets?.includes(selected?.id)}
                disabled={!selected}
                onChange={(event) =>
                  change({
                    ...asset,
                    contactSheets: event.target.checked
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
              />
              {asset.kind === "character"
                ? "Character reference sheet"
                : "Multiple views in this image"}
            </label>
            <button
              type="button"
              className="asset-explore-look"
              onClick={() => setSource("generate")}
            >
              <WandSparkles size={16} />
              Add a version
            </button>
          </div>
        ) : tab === "voice" && asset.kind === "character" ? (
          <CharacterMedia asset={asset} change={change} voiceOnly />
        ) : (
          <div className="asset-profile-fields">
            <label>
              {asset.kind === "character"
                ? "Identity & personality"
                : asset.kind === "location"
                  ? "Environment & atmosphere"
                  : "Description & purpose"}
              <textarea
                aria-label="Asset description"
                rows={7}
                value={asset.description || ""}
                placeholder="What stays true across every look?"
                onChange={(event) =>
                  change({
                    ...asset,
                    description: event.target.value,
                    variant: "",
                    visualBrief: {},
                  })
                }
              />
            </label>
            {asset.kind === "character" && (
              <label>
                Delivery direction
                <input
                  aria-label="Default delivery direction"
                  value={asset.delivery || ""}
                  placeholder="How they express themselves…"
                  onChange={(event) =>
                    change({ ...asset, delivery: event.target.value })
                  }
                />
              </label>
            )}
          </div>
        )}
        {asset.imageAnalysis && (
          <p className="muted" role="status">
            {asset.imageAnalysis}
          </p>
        )}
        <Suspense fallback={null}>
          <AssetUnderstanding
            asset={asset}
            project={project}
            change={change}
            selectedMediaId={selected?.id}
            organization={organization}
            onVariation={(choice) => {
              setSuggestion({ ...choice, id: Date.now() });
              setSource("generate");
            }}
          />
        </Suspense>
        <details className="asset-workbench-more">
          <summary>
            <ChevronDown size={13} />
            Organization
          </summary>
          <AssetOrganizationEditor
            organization={organization}
            assetKey={libraryAssetKey(project.id, asset)}
            asset={asset}
            defaultFolderId={initialFolderId}
          />
        </details>
        <details className="asset-workbench-more">
          <summary>
            <ChevronDown size={13} />
            Advanced reference tools
          </summary>
          <AssetExchange asset={asset} project={project} change={change} />
          <VariantEditor
            asset={asset}
            change={change}
            mediaAssets={project.assets.filter(
              (item) => item.media?.kind === "image",
            )}
          />
        </details>
      </section>
    </div>
  );
}

export function MediaAssetWorkbench({asset,project,change,onImport,organization,initialFolderId}) {
 const audio=asset.kind==='audio';
 return <div className="media-asset-workbench">
   <section className="media-asset-preview">
     {asset.media ? audio ? <audio controls src={asset.media.url} aria-label="Asset audio preview"/> : <video controls src={asset.media.url} poster={asset.media.thumbnail} aria-label="Asset footage preview"/> : <div><Upload size={32}/><p>Add {audio?'sound':'footage'} to preview it here.</p></div>}
     <button type="button" onClick={()=>onImport(asset.kind,m=>change({...asset,media:m,kind:m.kind==='image'?'image':asset.kind,name:asset.name||m.name}))}><Upload size={16}/>{asset.media?'Replace media':'Upload media'}</button>
   </section>
   <section className="media-asset-details">
     <small>{audio?'Audio':'Footage'}</small>
     <label className="field"><span>Name</span><input required value={asset.name} onChange={e=>change({...asset,name:e.target.value})}/></label>
     <label className="field"><span>Description & search keywords</span><textarea rows={5} value={asset.description||''} onChange={e=>change({...asset,description:e.target.value})}/></label>
     {(asset.media?.attribution || asset.attribution)?.attribution && <div className="media-asset-credit"><strong>Recording credit</strong><p>{(asset.media?.attribution || asset.attribution).attribution}</p><p>Include the creator, source and license when publishing.</p>{['source','licenseUrl'].map(key=>{const value=(asset.media?.attribution || asset.attribution)[key];return /^https?:\/\//i.test(value || '') ? <a key={key} href={value} target="_blank" rel="noreferrer">{key==='source'?'Original recording':'License'} ↗ </a> : null;})}</div>}
     {asset.media && <p className="muted">{asset.media.duration?.toFixed(2)}s{asset.media.width?` · ${asset.media.width} × ${asset.media.height}`:''}</p>}
     <details><summary>Media & organization</summary>
       <label className="field"><span>Use existing media</span><select value={asset.media?.id||''} onChange={e=>change({...asset,media:project.assets.find(a=>a.media?.id===e.target.value)?.media||null})}><option value="">No media attached</option>{project.assets.filter(a=>a.media&&(audio?a.media.kind==='audio':!a.media.kind||a.media.kind==='video')).map(a=><option key={a.id} value={a.media.id}>{a.name}</option>)}</select></label>
       <label className="asset-scope-toggle"><input type="checkbox" checked={isProjectOnly(asset)} onChange={e=>change(setAssetProjectOnly({...asset},e.target.checked))}/>Project only</label>
       <AssetOrganizationEditor organization={organization} assetKey={libraryAssetKey(project.id,asset)} asset={asset} defaultFolderId={initialFolderId}/>
     </details>
   </section>
 </div>;
}
