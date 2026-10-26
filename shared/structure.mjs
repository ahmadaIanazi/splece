import { shotDefaults } from "./shot-direction.mjs";
// Canonical authoring nodes. `kind` is a legacy display hint, never a nesting rule.
export const isStructureClip = (node) =>
  node?.nodeType
    ? node.nodeType === "clip"
    : ["clip", "generation"].includes(node?.kind);
export const nodeType = (node) => (isStructureClip(node) ? "clip" : "group");
export function normalizeStructureNode(node) {
  const type =
    node.nodeType ||
    (["clip", "generation"].includes(node.kind) ? "clip" : "group");
  if (!["group", "clip"].includes(type))
    throw Error("Structure items must be groups or clips.");
  return {
    ...node,
    ...(!node.nodeType && ["act", "chapter", "scene"].includes(node.kind)
      ? { legacyLabel: node.kind[0].toUpperCase() + node.kind.slice(1) }
      : {}),
    nodeType: type,
    parentId: node.parentId || "",
    kind:
      type === "clip"
        ? "generation"
        : ["act", "chapter", "scene"].includes(node.kind)
          ? node.kind
          : "scene",
  };
}
export function normalizeStructurePlan(plan) {
  validateStructureNodes(plan.beats || []);
  plan.structureVersion = 1;
  plan.beats = (plan.beats || []).map(normalizeStructureNode);
  return plan;
}
export function structurePath(nodes, id) {
  const byId = new Map(nodes.map((n) => [n.id, n])),
    result = [],
    seen = new Set();
  let node = byId.get(id);
  while (node && !seen.has(node.id)) {
    result.unshift(node);
    seen.add(node.id);
    node = byId.get(node.parentId);
  }
  return result;
}
export function structureLabel(plan, node) {
  if (isStructureClip(node)) return "Clip";
  const depth = structurePath(plan.beats, node.id).length - 1;
  return (
    node.label ||
    plan.groupLabels?.[depth] ||
    (plan.groupLabels
      ? "Group"
      : node.legacyLabel ||
        (!node.nodeType
          ? { act: "Act", chapter: "Chapter", scene: "Scene" }[node.kind]
          : null) ||
        "Group")
  );
}
export function structureColor(plan, node) {
  if (isStructureClip(node)) return "#74A8FF";
  return ["#AD8AFF", "#FFB36A", "#43D9CC", "#F28BC8"][
    Math.max(0, structurePath(plan.beats, node.id).length - 1) % 4
  ];
}
export const groupTemplates = {
  Universal: ["Group"],
  Film: ["Act", "Chapter", "Scene"],
  "Music video": ["Song section", "Moment"],
  Tutorial: ["Stage", "Step"],
  Documentary: ["Chapter", "Segment"],
  Advertisement: ["Message", "Feature"],
  Social: ["Beat", "Moment"],
  Custom: ["Group"],
};
export function createStructureNode(plan, type = "group", parentId = "") {
  const parent = plan.beats.find((n) => n.id === parentId);
  if (parentId && (!parent || isStructureClip(parent)))
    throw Error("Only a group can contain structure items.");
  const node = normalizeStructureNode({
    id: crypto.randomUUID(),
    nodeType: type,
    parentId,
    title: type === "clip" ? "Untitled clip" : "Untitled group",
    start: parent?.start || 0,
    duration: type === "clip" ? 10 : 30,
    description: "",
    characterIds: [],
    assetIds: [],
    locationId: "",
    dialogue: [],
    ...shotDefaults,
  });
  node.title =
    "Untitled " +
    structureLabel(
      { ...plan, beats: [...plan.beats, node] },
      node,
    ).toLowerCase();
  if (type === "clip")
    node.title =
      "Clip #" +
      (Math.max(
        0,
        ...plan.beats.map((b) => +(b.title?.match(/^Clip #(\d+)$/i)?.[1] || 0)),
      ) +
        1);
  node.end = node.start + node.duration;
  return node;
}
export function upgradeStructure(project) {
  project.structureVersion = 1;
  for (const plan of Object.values(project.storyPlans || {}))
    normalizeStructurePlan(plan);
  // Future production operations use stable placement/node IDs; no effects are applied by migration.
  project.production ??= {
    schemaVersion: 1,
    transitions: [],
    effects: [],
    audioPlans: [],
    dependencies: [],
  };
  for (const episode of project.episodes || []) {
    for (const plan of Object.values(episode.storyPlans || {}))
      normalizeStructurePlan(plan);
  }
  return project;
}

export function validateStructureNodes(beats) {
  const nodes = new Map();
  for (const node of beats) {
    if (!node.id || nodes.has(node.id))
      throw Error("Structure IDs must be unique.");
    if (node.nodeType && !["group", "clip"].includes(node.nodeType))
      throw Error("Unknown structure node type.");
    if (
      !node.nodeType &&
      !["act", "chapter", "scene", "generation", "group", "clip"].includes(
        node.kind || "scene",
      )
    )
      throw Error("Unknown structure node type.");
    nodes.set(node.id, node);
  }
  const complete = new Set();
  for (const node of beats) {
    let current = node;
    const path = new Set();
    while (current && !complete.has(current.id)) {
      if (path.has(current.id))
        throw Error("A group cannot contain itself or one of its ancestors.");
      path.add(current.id);
      if (current.parentId) {
        const parent = nodes.get(current.parentId);
        if (!parent) throw Error("Parent group is missing.");
        if (isStructureClip(parent))
          throw Error("Clips cannot contain groups or clips.");
        current = parent;
      } else current = null;
    }
    for (const id of path) complete.add(id);
  }
  return beats;
}
