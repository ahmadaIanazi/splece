// Persistent, renderer-owned objects. AI proposes data; it never owns a canvas.
import { normalizeScene, subjects, settings } from "./scene-sketch.mjs";
export const sceneViews = ["front", "side", "back", "high", "low"];
export const paintSlots = [
  "body",
  "secondary",
  "accent",
  "ink",
  "skin",
  "paper",
  "none",
];
const str = (v, n = 240) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const num = (v, fallback, min, max) =>
  Number.isFinite(Number(v))
    ? Math.max(min, Math.min(max, Number(v)))
    : fallback;
const color = (v) => (/^#[a-f\d]{6}$/i.test(v || "") ? v : "");
const id = (v) => (/^[a-zA-Z0-9_-]{1,64}$/.test(v || "") ? v : "");
export function graphHash(value) {
  let a = 2166136261,
    b = 5381;
  for (const c of JSON.stringify(value)) {
    a = Math.imul(a ^ c.charCodeAt(0), 16777619);
    b = Math.imul(b, 33) ^ c.charCodeAt(0);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}
export function normalizeEntity(raw, index = 0) {
  const role = raw?.role === "environment" ? "environment" : "subject";
  const kinds = role === "environment" ? settings : subjects;
  return {
    id: id(raw?.id) || `item-${index + 1}`,
    role,
    kind: kinds.includes(raw?.kind)
      ? raw.kind
      : role === "environment"
        ? "abstract"
        : "object",
    label: str(raw?.label, 80) || "Scene object",
    bodyColor: color(raw?.bodyColor),
    accentColor: color(raw?.accentColor),
    skinColor: color(raw?.skinColor),
    // Geometry brief excludes mutable color, light, position and camera.
    design: str(raw?.design, 600) || str(raw?.kind, 80) || "abstract object",
    x: num(raw?.x, 0, -4, 4),
    y: num(raw?.y, 0, 0, 3),
    z: num(raw?.z, 0, -4, 4),
    scale: num(raw?.scale, 1, 0.3, 2.5),
    turn: num(raw?.turn, 0, -180, 180),
  };
}
export function fallbackEntities(sceneValue) {
  const scene = normalizeScene(sceneValue),
    entities = [];
  if (scene.setting !== "abstract")
    entities.push({
      id: "setting",
      role: "environment",
      kind: scene.setting,
      label: scene.setting[0].toUpperCase() + scene.setting.slice(1),
      design: `${scene.setting} setting, simple layered silhouettes`,
      x: 0,
      y: 0,
      z: -2.5,
      scale: 2.5,
    });
  const count = ["group", "zombie"].includes(scene.subject) ? scene.count : 1;
  if (scene.subject !== "abstract" || !entities.length)
    for (let i = 0; i < count; i++)
      entities.push({
        id: `subject-${i + 1}`,
        role: "subject",
        kind: scene.subject,
        label: `${scene.subject[0].toUpperCase() + scene.subject.slice(1)}${count > 1 ? ` ${i + 1}` : ""}`,
        design: `${scene.subject}${scene.covered ? ", wearing a hijab" : ""}, clear abstract silhouette`,
        x: (i - (count - 1) / 2) * 1.25,
        y: 0,
        z: i % 2 ? 0.3 : 0,
        scale: 1,
      });
  return entities.map(normalizeEntity);
}
export function validateEntities(raw, scene) {
  if (!Array.isArray(raw) || !raw.length) return fallbackEntities(scene);
  const seen = new Set();
  return raw
    .slice(0, 8)
    .map(normalizeEntity)
    .filter((n) => !seen.has(n.id) && seen.add(n.id));
}
export const geometryKey = (node) =>
  `g-${graphHash([node.role, node.kind, node.design])}`;
export const vectorKey = (assetKey, view, mode) =>
  `${assetKey}:${mode}:${view}`;
const fields = [
  "x",
  "y",
  "z",
  "scale",
  "turn",
  "bodyColor",
  "accentColor",
  "skinColor",
];
// An allow-list of SVG geometry, not an HTML sanitizer. No DOM, URLs, handlers,
// arbitrary styles, references, filters, scripts, text or external resources.
const validatedDrawings = new WeakMap();
export function validateVector(raw) {
  if (raw && validatedDrawings.has(raw)) return validatedDrawings.get(raw);
  if (
    !raw ||
    !Array.isArray(raw.shapes) ||
    !raw.shapes.length ||
    raw.shapes.length > 64 ||
    JSON.stringify(raw).length > 16000
  )
    throw Error("This sketch was too complex. The existing drawing is safe.");
  const attrs = {
    path: ["d"],
    rect: ["x", "y", "width", "height", "rx"],
    circle: ["cx", "cy", "r"],
    ellipse: ["cx", "cy", "rx", "ry"],
    polygon: ["points"],
    polyline: ["points"],
  };
  const shapes = raw.shapes.map((s) => {
    if (!s || !Object.hasOwn(attrs, s.tag))
      throw Error("Unsupported sketch shape.");
    const allowed = new Set([
      "tag",
      "fill",
      "stroke",
      "strokeWidth",
      "opacity",
      ...attrs[s.tag],
    ]);
    if (Object.keys(s).some((k) => !allowed.has(k)))
      throw Error("Unsupported sketch property.");
    const out = {
      tag: s.tag,
      fill: s.fill ?? "body",
      stroke: s.stroke ?? "none",
    };
    if (!paintSlots.includes(out.fill) || !paintSlots.includes(out.stroke))
      throw Error("Sketch colors must use the shared palette.");
    for (const [key, rawValue] of Object.entries(s)) {
      const value = !["tag", "fill", "stroke", "d", "points"].includes(key) && typeof rawValue === "string" && /^-?(?:\d+\.?\d*|\.\d+)$/.test(rawValue) ? Number(rawValue) : rawValue;
      if (["tag", "fill", "stroke"].includes(key)) continue;
      if (key === "d" || key === "points") {
        const pattern =
          key === "d"
            ? /^[MmZzLlHhVvCcSsQqTtAaEe\d\s.,+\-]+$/
            : /^[\d\s.,+\-]+$/;
        if (
          typeof value !== "string" ||
          value.length > 4000 ||
          !pattern.test(value)
        )
          throw Error("Invalid sketch geometry.");
        const nums =
          value.match(/[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g) || [];
        if (nums.some((n) => !Number.isFinite(+n) || Math.abs(+n) > 2000))
          throw Error("Sketch coordinates out of bounds.");
        out[key] = value;
      } else {
        if (typeof value !== "number" || !Number.isFinite(value))
          throw Error("Invalid sketch coordinate.");
        const min = ["x", "y", "cx", "cy"].includes(key) ? -500 : 0;
        const max = key === "opacity" ? 1 : key === "strokeWidth" ? 16 : 1000;
        if (value < min || value > max)
          throw Error("Sketch coordinate out of bounds.");
        out[key] = value;
      }
    }
    if (
      (s.tag === "path" && !out.d) ||
      (["polygon", "polyline"].includes(s.tag) && !out.points)
    )
      return null; // An empty decorative path draws nothing; never discard the useful shapes.
    return out;
  });
  const visibleShapes = shapes.filter(Boolean);
  if (!visibleShapes.length) throw Error("Missing sketch geometry.");
  const drawing = Object.freeze({
    version: 1,
    shapes: Object.freeze(visibleShapes.map((s) => Object.freeze(s))),
  });
  validatedDrawings.set(raw, drawing);
  validatedDrawings.set(drawing, drawing);
  return drawing;
}
export function normalizeGraph(raw) {
  const seen = new Set();
  const nodes = (Array.isArray(raw?.nodes) ? raw.nodes : [])
    .slice(0, 8)
    .map((n, i) => {
      const clean = normalizeEntity(n, i);
      return {
        ...clean,
        assetKey: geometryKey(clean),
        locks: fields.filter((k) => n.locks?.includes(k)),
      };
    })
    .filter((n) => !seen.has(n.id) && seen.add(n.id));
  const assets = {};
  for (const [key, value] of Object.entries(raw?.assets || {}).slice(-40)) {
    if (!/^g-[a-z0-9]+:(test|live):(front|side|back|high|low)$/.test(key))
      continue;
    try {
      assets[key] = validateVector(value);
    } catch {
      /* Legacy or unsafe geometry cannot reach the renderer. */
    }
  }
  return { version: 1, revision: num(raw?.revision, 0, 0, 1e9), nodes, assets };
}
export function reconcileGraph(raw, proposed) {
  const graph = normalizeGraph(raw);
  const incoming = proposed.slice(0, 8).map(normalizeEntity);
  const claimed = new Set();
  const nodes = incoming.map((n) => {
    const old =
      graph.nodes.find((o) => o.id === n.id && !claimed.has(o.id)) ||
      graph.nodes.find(
        (o) =>
          !claimed.has(o.id) &&
          o.role === n.role &&
          ((o.label === n.label && o.kind === n.kind) ||
            o.assetKey === geometryKey(n)),
      );
    if (old) {
      claimed.add(old.id);
      n = { ...n, id: old.id };
    }
    const merged = { ...n, locks: old?.locks || [] };
    for (const key of merged.locks) merged[key] = old[key];
    merged.assetKey = geometryKey(merged);
    return JSON.stringify(old) === JSON.stringify(merged) ? old : merged;
  });
  // Moving an object is not consent to discard it on a later creative suggestion.
  for (const old of graph.nodes)
    if (
      old.locks.length &&
      !nodes.some((n) => n.id === old.id) &&
      nodes.length < 8
    )
      nodes.push(old);
  const changed = JSON.stringify(nodes) !== JSON.stringify(graph.nodes);
  return { ...graph, revision: graph.revision + Number(changed), nodes };
}
export function patchSceneNode(raw, nodeId, patch, unlock = false) {
  const graph = normalizeGraph(raw),
    node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return graph;
  const changed = Object.fromEntries(
    fields.filter((k) => Object.hasOwn(patch, k)).map((k) => [k, patch[k]]),
  );
  const next = normalizeEntity({ ...node, ...changed });
  const locks = unlock
    ? []
    : [...new Set([...node.locks, ...Object.keys(changed)])];
  if (
    JSON.stringify({ ...next, assetKey: node.assetKey, locks }) ===
    JSON.stringify(node)
  )
    return graph;
  return {
    ...graph,
    revision: graph.revision + 1,
    nodes: graph.nodes.map((n) =>
      n.id === nodeId ? { ...next, assetKey: node.assetKey, locks } : n,
    ),
  };
}
export function desiredView(desk, node = {}) {
  if (desk.angle < 25) return "high";
  if (desk.angle > 75) return "low";
  const a = Math.abs(
    (((desk.orbit - 50) * 3.6 - (node.turn || 0) + 540) % 360) - 180,
  );
  return a > 130 ? "back" : a > 40 ? "side" : "front";
}
export function pendingSketches(desk, mode = "test") {
  const graph = normalizeGraph(desk.sceneGraph),
    seen = new Set();
  return graph.nodes.flatMap((node) => {
    const view = desiredView(desk, node),
      key = vectorKey(node.assetKey, view, mode);
    if (graph.assets[key] || seen.has(key)) return [];
    seen.add(key);
    return [{ assetKey: node.assetKey, view, key, label: node.label }];
  });
}
export function mergeSketch(raw, task, result, mode) {
  const graph = normalizeGraph(raw);
  if (
    !graph.nodes.some((n) => n.assetKey === task.assetKey) ||
    !sceneViews.includes(task.view)
  )
    return graph;
  const key = vectorKey(task.assetKey, task.view, mode);
  const assets = { ...graph.assets, [key]: validateVector(result) };
  // Bounded cache, evict unused identities first, keep active scene views.
  const active = new Set(graph.nodes.map((n) => n.assetKey));
  const entries = Object.entries(assets).sort(
    ([a], [b]) =>
      Number(active.has(a.split(":")[0])) - Number(active.has(b.split(":")[0])),
  );
  return { ...graph, assets: Object.fromEntries(entries.slice(-40)) };
}
export function sceneAssetContext(project, assetKey, view) {
  const desk = project.storyPlans?.[project.episodeId]?.setup?.directorDesk;
  const graph = normalizeGraph(desk?.sceneGraph),
    node = graph.nodes.find((n) => n.assetKey === assetKey);
  if (!node || !sceneViews.includes(view))
    throw Error("This scene object is no longer available.");
  return {
    workspace: "scene-asset",
    schema: 1,
    episodeId: project.episodeId,
    assetKey,
    view,
    role: node.role,
    kind: node.kind,
    design: node.design,
  };
}
// Test fixtures stand in for workers, with the exact same validation and cache.
export function simulateVector(context) {
  const side = context.view === "side",
    back = context.view === "back";
  const shapes =
    context.role === "environment"
      ? Array.from({ length: 5 }, (_, i) => ({
          tag: "rect",
          x: -120 + i * 50,
          y: -100 - (i % 3) * 35,
          width: 42,
          height: 100 + (i % 3) * 35,
          fill: "secondary",
          opacity: 0.7,
        }))
      : context.kind === "bottle"
        ? [
            {
              tag: "rect",
              x: side ? -20 : -40,
              y: -150,
              width: side ? 40 : 80,
              height: 145,
              rx: 12,
              fill: "body",
            },
            {
              tag: "rect",
              x: -20,
              y: -180,
              width: 40,
              height: 30,
              rx: 3,
              fill: "secondary",
            },
            ...(!back
              ? [
                  {
                    tag: "rect",
                    x: -20,
                    y: -105,
                    width: 40,
                    height: 45,
                    fill: "accent",
                  },
                ]
              : []),
          ]
        : ["person", "group", "zombie", "robot"].includes(context.kind)
          ? [
              {
                tag: "circle",
                cx: 0,
                cy: -155,
                r: side ? 21 : 25,
                fill: context.kind === "zombie" ? "secondary" : "skin",
              },
              {
                tag: "path",
                d: `M-${side ? 18 : 30} -120 L${side ? 18 : 30} -120 L25 -45 L-25 -45Z`,
                fill: "body",
              },
              {
                tag: "path",
                d: "M-15-45L-22 0M15-45L22 0M-24-110L-50-65M24-110L50-65",
                fill: "none",
                stroke: "body",
                strokeWidth: 12,
              },
              ...(!back
                ? [
                    {
                      tag: "path",
                      d: side ? "M10-155h8" : "M-13-155h7m12 0h7",
                      fill: "none",
                      stroke: "accent",
                      strokeWidth: 4,
                    },
                  ]
                : []),
            ]
          : [
              {
                tag: "path",
                d:
                  context.view === "high"
                    ? "M0-180L85-110L0-40L-85-110Z"
                    : side
                      ? "M-35-170H35V-10H-35Z"
                      : "M0-180L70-135V-45L0 0L-70-45V-135Z",
                fill: "body",
              },
              {
                tag: "path",
                d: "M0-180V-90L70-135M0-90L-70-135M0-90V0",
                fill: "none",
                stroke: "accent",
                strokeWidth: 3,
              },
            ];
  return validateVector({ shapes });
}

export function sceneArrangement(graph) {
  return normalizeGraph(graph)
    .nodes.filter((n) => n.role === "subject" && n.locks.length)
    .map(
      (n) =>
        `${n.label}: world x ${n.x.toFixed(1)}, depth ${n.z.toFixed(1)}, relative size ${n.scale.toFixed(1)}${n.bodyColor ? `, main color ${n.bodyColor}` : ""}`,
    )
    .join("; ");
}
// Render geometry is local/cache data, never story-planning input.
export function withoutSketchGeometry(input) {
  const clean = structuredClone(input);
  if (clean.plan?.setup?.directorDesk?.sceneGraph)
    delete clean.plan.setup.directorDesk.sceneGraph.assets;
  return clean;
}
