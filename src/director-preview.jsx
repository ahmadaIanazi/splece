import { dragOnStage } from "../shared/scene-projection.mjs";
import React, { Component, lazy, Suspense, useRef, useState } from "react";
import { sceneForDesk } from "../shared/scene-sketch.mjs";
import { SceneArt } from "./director-scene-art.jsx";
import {
  Camera,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  normalizeGraph,
  patchSceneNode,
  desiredView,
  vectorKey,
} from "../shared/scene-graph.mjs";
const VirtualSet = lazy(() => import("./director-set.jsx"));
class SetBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="desk-hint">
        3D is unavailable. All controls work in the 2D view below.
      </p>
    ) : (
      this.props.children
    );
  }
}
export function Sketch({ desk, concept = "", reference, scene }) {
  return (
    <SceneArt
      desk={desk}
      concept={concept}
      reference={reference}
      scene={scene}
    />
  );
}
function OrbitControl({ desk, onPreview, onCommit }) {
  const moving = useRef(null);
  const value = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return (
      50 +
      (Math.atan2(
        e.clientX - r.left - r.width / 2,
        e.clientY - r.top - r.height / 2,
      ) /
        Math.PI) *
        50
    );
  };
  return (
    <div className="desk-orbit-control">
      <svg
        viewBox="0 0 100 100"
        role="slider"
        aria-label="Camera orbit"
        aria-valuemin={-180}
        aria-valuemax={180}
        aria-valuenow={Math.round((desk.orbit - 50) * 3.6)}
        tabIndex="0"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          moving.current = value(e);
          onPreview({ orbit: moving.current, path: [] });
        }}
        onPointerMove={(e) => {
          if (moving.current === null) return;
          moving.current = value(e);
          onPreview({ orbit: moving.current, path: [] });
        }}
        onPointerUp={(e) => {
          if (moving.current !== null) {
            onCommit({ orbit: moving.current, path: [] });
            moving.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          moving.current = null;
          onPreview({});
        }}
        onKeyDown={(e) => {
          const delta = {
            ArrowLeft: -3,
            ArrowDown: -3,
            ArrowRight: 3,
            ArrowUp: 3,
          }[e.key];
          if (delta) {
            e.preventDefault();
            onCommit({
              orbit: Math.max(0, Math.min(100, desk.orbit + delta)),
              path: [],
            });
          }
        }}
      >
        <ellipse
          cx="50"
          cy="50"
          rx="35"
          ry="35"
          fill="none"
          stroke="currentColor"
          opacity=".35"
          strokeDasharray="2 4"
        />
        <path
          d="M43 56V43L50 38L57 43V56L50 61Z"
          fill="currentColor"
          opacity=".4"
        />
        <g
          transform={`translate(${50 + Math.sin(((desk.orbit - 50) * Math.PI) / 50) * 35} ${50 + Math.cos(((desk.orbit - 50) * Math.PI) / 50) * 35})`}
        >
          <circle r="11" fill="var(--action-primary)" />
          <path
            d="M-5-3H2V3H-5ZM2-1L6-4V4L2 1"
            fill="var(--action-on-primary,white)"
          />
        </g>
      </svg>
      <span>Orbit · {Math.round((desk.orbit - 50) * 3.6)}°</span>
    </div>
  );
}
export function Storyboard({
  desk,
  concept,
  updating,
  workers,
  onPreview,
  onCommit,
  imageReferences = {},
  sceneImage,
}) {
  const scene = sceneForDesk(desk, concept),
    graph = normalizeGraph(desk.sceneGraph);
  const drag = useRef(null),
    [orbiting, setOrbiting] = useState(false);
  const fixedImage = sceneImage && desk.showSceneImage;
  const clamp = (n) => Math.max(0, Math.min(100, n));
  const change = (dx, dy) => ({
    orbit: (((drag.current.orbit + dx * 0.14) % 100) + 100) % 100,
    angle: clamp(drag.current.angle + dy * 0.18),
    path: [],
  });
  const cameraLocked = ["orbit", "angle", "lens"].some((k) =>
    desk.manualControls.includes(k),
  );
  return (
    <section
      className="desk-storyboard desk-single-scene"
      aria-label="Live scene preview"
    >
      <header>
        <span>{fixedImage ? "SCENE REFERENCE" : "LIVING SKETCH"}</span>
        <small className="canvas-loading" role="status" aria-live="polite">
          {(updating || workers?.working) && <LoaderCircle size={13} aria-hidden="true" />}
          {updating
            ? "Following your idea…"
            : workers?.working
              ? `Sketching ${workers.label}…`
              : ""}
        </small>
      </header>
      <figure
        className="desk-orbit-stage"
        data-orbiting={orbiting}
        style={{ aspectRatio: desk.aspect.replace(":", " / ") }}
        tabIndex={fixedImage ? undefined : 0}
        role={fixedImage ? undefined : "group"}
        aria-label={fixedImage ? undefined : "Orbit scene camera"}
        onPointerDown={(e) => {
          if (fixedImage || e.target.closest("button")) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            orbit: desk.orbit,
            angle: desk.angle,
            last: null,
          };
          setOrbiting(true);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const patch = change(
            e.clientX - drag.current.x,
            e.clientY - drag.current.y,
          );
          drag.current.last = patch;
          onPreview(patch);
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          const last = drag.current.last;
          drag.current = null;
          setOrbiting(false);
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
          if (last) onCommit(last);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setOrbiting(false);
          onPreview({});
        }}
        onKeyDown={(e) => {
          if (fixedImage) return;
          const delta = {
            ArrowLeft: [-3, 0],
            ArrowRight: [3, 0],
            ArrowUp: [0, -3],
            ArrowDown: [0, 3],
          }[e.key];
          if (delta) {
            e.preventDefault();
            onCommit({
              orbit: clamp(desk.orbit + delta[0]),
              angle: clamp(desk.angle + delta[1]),
              path: [],
            });
          }
        }}
      >
        {fixedImage ? (
          <img
            className="desk-scene-photo"
            src={sceneImage}
            alt={scene.label || "Created scene reference"}
          />
        ) : (
          <SceneArt
            desk={desk}
            concept={concept}
            scene={scene}
            graph={graph}
            imageReferences={imageReferences}
            mode={workers?.mode || "test"}
          />
        )}
        <figcaption>
          <b>{scene.label || "Your scene"}</b>
          <span>
            {fixedImage
              ? "Saved image · switch to sketch to orbit"
              : "Drag to orbit · arrow keys work too"}
          </span>
        </figcaption>
      </figure>
      <div className="canvas-camera-strip">
        {sceneImage && (
          <button
            type="button"
            aria-pressed={!!fixedImage}
            onClick={() =>
              onCommit({ showSceneImage: !fixedImage }, true, false)
            }
          >
            {fixedImage ? "Show sketch" : "Show created scene"}
          </button>
        )}
        {!fixedImage && (
          <>
            <Camera size={15} />
            <small aria-label="Camera orbit position">
              {Math.round((desk.orbit - 50) * 3.6)}°
            </small>
            {[
              [85, "Low"],
              [50, "Eye level"],
              [15, "Above"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={label}
                aria-pressed={Math.abs(desk.angle - value) < 15}
                onClick={() => onCommit({ angle: value })}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              aria-label="Reset camera"
              onClick={() =>
                onCommit({ orbit: 50, angle: 50, lens: 35, path: [] })
              }
            >
              <RotateCcw size={14} />
            </button>
          </>
        )}
        {cameraLocked && (
          <button
            className="canvas-kept"
            type="button"
            onClick={() =>
              onCommit(
                {
                  manualControls: desk.manualControls.filter(
                    (k) => !["orbit", "angle", "lens"].includes(k),
                  ),
                },
                true,
                false,
              )
            }
          >
            <LockKeyhole size={12} /> Camera kept
          </button>
        )}
      </div>
      {workers?.error && (
        <div className="desk-idea-status" role="status">
          <span>{workers.error}</span>
          <button type="button" onClick={workers.retry}>
            Retry sketches
          </button>
        </div>
      )}
    </section>
  );
}
export function SetPreview(props) {
  return (
    <SetBoundary>
      <Suspense
        fallback={<p className="desk-hint">Opening the miniature set…</p>}
      >
        <VirtualSet {...props} />
      </Suspense>
    </SetBoundary>
  );
}
