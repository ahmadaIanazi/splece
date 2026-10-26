import { materialPaint } from "../shared/scene-paint.mjs";
import React, { memo, useMemo, useRef } from "react";
import { desiredView, vectorKey } from "../shared/scene-graph.mjs";
import {
  frameScene,
  stageCamera,
  projectNode,
  dragOnStage,
} from "../shared/scene-projection.mjs";

// Only application-created tags and validated attributes reach React/SVG.
const VectorDrawing = memo(
  function VectorDrawing({
    drawing,
    colors,
    skinColor,
    medium,
    node,
    manualPalette,
  }) {
    const paint = materialPaint(colors, { ...node, skinColor }, manualPalette);
    const outline = ["chalk", "ink"].includes(medium);
    return drawing.shapes.map(({ tag, fill, stroke, ...props }, i) =>
      React.createElement(tag, {
        ...props,
        key: i,
        fill: outline ? "none" : paint[fill],
        stroke:
          outline && stroke === "none"
            ? paint[fill === "none" ? "ink" : fill]
            : paint[stroke],
        ...(outline && !props.strokeWidth ? { strokeWidth: 2 } : {}),
      }),
    );
  },
  (a, b) =>
    a.drawing === b.drawing &&
    a.colors.join() === b.colors.join() &&
    a.skinColor === b.skinColor &&
    a.medium === b.medium &&
    a.node === b.node &&
    a.manualPalette === b.manualPalette,
);
export function SceneObjects({
  graph,
  desk,
  scene,
  mode,
  imageReferences = {},
  frameHeight = 450,
  selected,
  onSelect,
  onPreviewNode,
  onCommitNode,
  fallbackSubject,
  fallbackEnvironment,
}) {
  const camera = useMemo(
    () => stageCamera(desk),
    [desk.orbit, desk.angle, desk.lens],
  );
  const drag = useRef(null);
  const nodes = frameScene(graph.nodes, desk, 800, frameHeight).sort(
    (a, b) =>
      Number(b.node.role === "environment") -
        Number(a.node.role === "environment") || b.p.depth - a.p.depth,
  );
  return nodes
    .filter((n) => n.p.visible)
    .map(({ node, p }) => {
      const view = desiredView(desk, node);
      const exact = graph.assets[vectorKey(node.assetKey, view, mode)];
      const drawing =
        exact ||
        graph.assets[vectorKey(node.assetKey, "front", mode)] ||
        Object.entries(graph.assets).find(([key]) =>
          key.startsWith(`${node.assetKey}:${mode}:`),
         )?.[1] || (mode === "test" ? graph.assets[vectorKey(node.assetKey,"front","live")] : null);
      const colors = [...scene.colors];
      if (
        node.bodyColor &&
        (!desk.manualControls.includes("palette") ||
          node.locks.includes("bodyColor"))
      )
        colors[2] = node.bodyColor;
      if (
        node.accentColor &&
        (!desk.manualControls.includes("palette") ||
          node.locks.includes("accentColor"))
      )
        colors[3] = node.accentColor;
      const interactive = !!onSelect;
      const down = (e) => {
        if (!interactive) return;
        e.preventDefault();
        e.stopPropagation();
        onSelect(node.id);
        const bounds = e.currentTarget.ownerSVGElement.getBoundingClientRect();
        drag.current = {
          id: node.id,
          node,
          x: e.clientX,
          y: e.clientY,
          width: bounds.width,
          last: null,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      };
      return (
        <g
          key={node.id}
          data-scene-node={node.id}
          data-asset-key={node.assetKey}
          data-view={view}
          data-view-ready={!!exact}
          transform={`translate(${p.x} ${p.y}) scale(${p.scale})`}
          className={interactive ? "desk-living-object" : undefined}
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? 0 : undefined}
          aria-label={
            interactive
              ? `Move ${node.label}${node.locks.length ? ", manual choices kept" : ""}`
              : undefined
          }
          aria-pressed={interactive ? selected === node.id : undefined}
          onPointerDown={down}
          onPointerMove={(e) => {
            const moving = drag.current;
            if (moving?.id !== node.id) return;
            e.stopPropagation();
            const patch = dragOnStage(
              moving.node,
              ((e.clientX - moving.x) / moving.width) * 10,
              ((e.clientY - moving.y) / moving.width) * 10,
              desk,
            );
            moving.last = patch;
            onPreviewNode?.(node.id, patch);
          }}
          onPointerUp={(e) => {
            if (drag.current?.id !== node.id) return;
            e.stopPropagation();
            const last = drag.current.last;
            drag.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
            if (last) onCommitNode?.(node.id, last);
          }}
          onPointerCancel={() => {
            drag.current = null;
            onPreviewNode?.(null);
          }}
          onKeyDown={(e) => {
            if (!interactive) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(node.id);
            }
            const delta = {
              ArrowLeft: [-0.15, 0],
              ArrowRight: [0.15, 0],
              ArrowUp: [0, -0.15],
              ArrowDown: [0, 0.15],
            }[e.key];
            if (delta) {
              e.preventDefault();
              e.stopPropagation();
              onSelect(node.id);
              onCommitNode?.(node.id, dragOnStage(node, ...delta, desk));
            }
          }}
        >
          <ellipse
            cx={(50 - desk.sun) * 0.8}
            cy="2"
            rx={node.role === "environment" ? 180 : 55}
            ry={5 + desk.softness / 10}
            fill={scene.colors[0]}
            opacity=".25"
            pointerEvents="none"
          />
          <g
            style={{
              filter: `brightness(${desk.light === "silhouette" ? 0.25 : 0.75 + desk.softness / 350 + Math.cos(((desk.sun - 50) * Math.PI) / 100 - node.x / 3) * 0.15})`,
            }}
            pointerEvents="none"
          >
            {imageReferences[node.id] ? (
              <image
                href={imageReferences[node.id]}
                x={node.role === "environment" ? -250 : -65}
                y={node.role === "environment" ? -220 : -180}
                width={node.role === "environment" ? 500 : 130}
                height={node.role === "environment" ? 220 : 180}
                preserveAspectRatio="xMidYMid meet"
              />
            ) : drawing ? (
              <VectorDrawing
                drawing={drawing}
                colors={scene.colors}
                node={node}
                manualPalette={desk.manualControls.includes("palette")}
                skinColor={node.skinColor}
                medium={scene.medium}
              />
            ) : node.role === "environment" ? (
              <g transform="translate(-200 -160) scale(.5)">
                {fallbackEnvironment(node)}
              </g>
            ) : (
              fallbackSubject(node)
            )}
          </g>
          {interactive && (
            <rect
              x={node.role === "environment" ? -250 : -100}
              y="-225"
              width={node.role === "environment" ? 500 : 200}
              height="230"
              rx="12"
              fill="transparent"
              stroke={
                selected === node.id ? "var(--action-primary)" : "transparent"
              }
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      );
    });
}

export function SceneObjectThumbnail({ node, desk, mode = "test" }) {
  const drawing =
    desk.sceneGraph.assets[
      vectorKey(node.assetKey, desiredView(desk, node), mode)
    ] || desk.sceneGraph.assets[vectorKey(node.assetKey, "front", mode)] || (mode === "test" ? desk.sceneGraph.assets[vectorKey(node.assetKey,"front","live")] : null);
  if (!drawing) return null;
  return (
    <svg
      viewBox={
        node.role === "environment" ? "-260 -230 520 240" : "-80 -190 160 200"
      }
      role="img"
      aria-label={`${node.label} sketch`}
    >
      <VectorDrawing
        drawing={drawing}
        colors={
          desk.customColors.length
            ? desk.customColors
            : desk.scene?.colors || []
        }
        skinColor={node.skinColor}
        node={node}
        manualPalette={desk.manualControls.includes("palette")}
        medium={desk.scene?.medium}
      />
    </svg>
  );
}
