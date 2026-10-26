import { cameraIntent } from "../shared/director-desk.mjs";
import { SceneObjectThumbnail } from "./director-scene-objects.jsx";
import React, { lazy, Suspense, useState } from "react";
import {
  ImagePlus,
  Users,
  MapPin,
  Box,
  Sparkles,
  Check,
  LoaderCircle,
} from "lucide-react";
import { Modal } from "./components";
const AssetGenerator = lazy(() =>
  import("./asset-generator").then((m) => ({ default: m.AssetGenerator })),
);
export const canvasImage = (asset) =>
  asset?.media?.kind === "image"
    ? `/api/media/${asset.media.id}/original`
    : null;
export function canvasBindingImage(desk, assets, id) {
  const node = desk.sceneGraph.nodes.find((n) => n.id === id);
  if (
    node &&
    desk.referenceDesigns[id] &&
    desk.referenceDesigns[id] !== node.assetKey
  )
    return null;
  const asset = assets.find((a) => a.id === desk.referenceBindings[id]);
  const media =
    [
      asset?.media,
      ...(asset?.mediaList || []),
      ...(asset?.variants || []).map((v) => v.media),
    ].find((m) => m?.id === desk.referenceMediaIds[id]) || asset?.media;
  return canvasImage({ media });
}
export function CanvasReferences({
  desk,
  concept,
  project,
  update,
  flush,
  mode,
  commit,
  onOpenChange,
}) {
  const [editing, setEditing] = useState(null),
    [error, setError] = useState("");
  const nodes = desk.sceneGraph.nodes;
  const duplicateNames = new Map();
  for (const n of nodes)
    duplicateNames.set(n.label, (duplicateNames.get(n.label) || 0) + 1);
  const numbered = new Map();
  const displayNodes = nodes.map((n) => {
    const count = (numbered.get(n.label) || 0) + 1;
    numbered.set(n.label, count);
    return {
      ...n,
      label: duplicateNames.get(n.label) > 1 ? `${n.label} ${count}` : n.label,
    };
  });
  const rows = [
    ...(nodes.length
      ? [
          {
            id: "$scene",
            label: "Overall scene",
            role: "scene",
            design: concept,
          },
        ]
      : []),
    ...displayNodes,
  ];
  const close = () => {
    setEditing(null);
    onOpenChange?.(false);
  };
  const create = async (node) => {
    setError("");
    const bound = project.assets.find(
      (a) => a.id === desk.referenceBindings[node.id],
    );
    const kind =
      node.role === "scene"
        ? "style"
        : node.role === "environment"
          ? "location"
          : /person|group|zombie|robot|animal/.test(node.kind)
            ? "character"
            : "prop";
    const description = node.role === "scene" ? concept : node.design;
    const asset = bound || {
      id: crypto.randomUUID(),
      kind,
      name: node.label,
      description,
      version: 1,
      variants: [],
      history: [],
      scope: "project",
      referenceStatus: "draft",
    };
    update((p) => {
      if (!p.assets.some((a) => a.id === asset.id)) p.assets.push(asset);
      const s = p.storyPlans[p.episodeId].setup;
      s.directorDesk.referenceBindings = {
        ...s.directorDesk.referenceBindings,
        [node.id]: asset.id,
      };
      const key = kind === "character" ? "castIds" : "assetIds";
      s[key] = [...new Set([...(s[key] || []), asset.id])];
    });
    const direction = [
      description,
      ...(node.role === "scene"
        ? [
            "The following physical camera choices override conflicting camera wording above:",
            cameraIntent(desk),
          ]
        : []),
      `Visual treatment: ${desk.lookText || desk.scene?.style || ""}. ${desk.light} light. Palette: ${(desk.customColors.length ? desk.customColors : desk.scene?.colors || []).join(", ")}.`,
      node.role === "scene"
        ? "Create one composed scene with all the described people and setting."
        : "Keep this exact identity and defining details.",
    ].join("\n");
    setEditing({
      id: asset.id,
      nodeId: node.id,
      designKey: node.assetKey,
      asset,
      direction,
    });
    onOpenChange?.(true);
  };
  return (
    <section className="canvas-references" aria-label="Scene references">
      <header>
        <b>Make it real</b>
        <small>Sketch → reference</small>
      </header>
      {!rows.length && (
        <p className="desk-hint">
          People, places and objects appear here as your idea takes shape.
        </p>
      )}
      {rows.map((node) => {
        const asset = project.assets.find(
            (a) => a.id === desk.referenceBindings[node.id],
          ),
          image = canvasBindingImage(desk, project.assets, node.id);
        const Icon =
          node.role === "scene"
            ? Sparkles
            : node.role === "environment"
              ? MapPin
              : /person|group|zombie|robot|animal/.test(node.kind)
                ? Users
                : Box;
        return (
          <div className="canvas-reference" key={node.id}>
            <div className="canvas-reference-thumb">
              {image ? (
                <img src={image} alt={node.label} />
              ) : (
                <>
                  {node.assetKey ? (
                    <SceneObjectThumbnail node={node} desk={desk} mode={mode} />
                  ) : (
                    <Icon size={20} />
                  )}
                </>
              )}
            </div>
            <div>
              <strong>{node.label}</strong>
              <small>
                {image
                  ? "Reference ready"
                  : node.role === "scene"
                    ? "Bring the whole scene to life"
                    : node.role === "environment"
                      ? "Place"
                      : asset?.kind ||
                        (/person|group|zombie|robot|animal/.test(node.kind)
                          ? "Character"
                          : "Object")}
              </small>
            </div>
            <button
              type="button"
              onClick={() => create(node)}
              aria-label={`${image ? "Edit" : "Create"} ${node.label}`}
              title={`${image ? "Edit" : "Create"} ${node.label}`}
            >
              {image ? <Check size={16} /> : <ImagePlus size={16} />}
              <span>{image ? "Edit" : "Create"}</span>
            </button>
          </div>
        );
      })}
      {error && <p role="alert">{error}</p>}
      {editing && (
        <Modal title={`Create ${editing.asset.name}`} wide onClose={close}>
          <Suspense fallback={<LoaderCircle />}>
            <AssetGenerator
              embedded
              asset={
                project.assets.find((a) => a.id === editing.id) || editing.asset
              }
              project={project}
              initialDirection={editing.direction}
              initialRatio={
                editing.nodeId === "$scene" ? desk.aspect : undefined
              }
              onStarted={() => flush?.()}
              change={(next) => {
                update((p) => {
                  const i = p.assets.findIndex((a) => a.id === next.id);
                  if (i >= 0) p.assets[i] = next;
                  const s = p.storyPlans[p.episodeId].setup;
                  s.directorDesk.referenceBindings = {
                    ...s.directorDesk.referenceBindings,
                    [editing.nodeId]: next.id,
                  };
                  if (editing.designKey)
                    s.directorDesk.referenceDesigns = {
                      ...s.directorDesk.referenceDesigns,
                      [editing.nodeId]: editing.designKey,
                    };
                  const added =
                    next.variants
                      ?.filter(
                        (v) =>
                          !editing.asset.variants?.some(
                            (old) => old.id === v.id,
                          ),
                      )
                      .at(-1)?.media || next.media;
                  if (added)
                    s.directorDesk.referenceMediaIds = {
                      ...s.directorDesk.referenceMediaIds,
                      [editing.nodeId]: added.id,
                    };
                  if (editing.nodeId === "$scene")
                    s.directorDesk.showSceneImage = true;
                });
                close();
              }}
            />
          </Suspense>
        </Modal>
      )}
    </section>
  );
}
