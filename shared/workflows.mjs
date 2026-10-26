// This registry describes executable hooks, not arbitrary provider endpoints.
// App contracts and authored content cannot be replaced by workflow guidance.
export const workflowVersion = 1;
const node = (id, title, kind, detail, options = {}) => ({
  id,
  title,
  kind,
  detail,
  ...options,
});
export const workflows = [
  {
    id: "video",
    title: "Video prompt",
    description: "From your writing to a validated generation request.",
    color: "#8caaff",
    nodes: [
      node(
        "source",
        "Your clip",
        "input",
        "Shot writing, exact dialogue and selected references. Your original stays intact.",
      ),
      node(
        "camera",
        "Camera & style",
        "local",
        "Shot controls, project creative choices and timed Directions.",
        { editable: true, labels: ["Creative direction"] },
      ),
      node(
        "references",
        "Reference roles",
        "local",
        "Identity, wardrobe, location and opening / ending frame bindings.",
        {
          editable: true,
          labels: ["Characters & references", "Reference roles"],
        },
      ),
      node(
        "continuity",
        "Continuity",
        "local",
        "Opening-frame state and previous / next clip context. Plans are not visual evidence.",
        { editable: true, labels: ["Clip continuity"] },
      ),
      node(
        "assemble",
        "Assemble prompt",
        "local",
        "Combine instructions with your writing, without another AI call.",
        { editable: true },
      ),
      node(
        "validate",
        "Check requirements",
        "protected",
        "Keep exact dialogue, reference order, cast controls and model limits. Incompatible settings stop submission.",
      ),
      node(
        "provider",
        "Generate video",
        "provider",
        "Uses the model selected in the clip. Existing quote, hold-to-generate and durable job handling remain in charge.",
      ),
      node(
        "output",
        "Save a take",
        "output",
        "Save the original video and request snapshot; prepare a preview proxy. Never replace an earlier take.",
      ),
    ],
  },
  {
    id: "writing",
    title: "Writing & optimizer",
    description:
      "Improve prose while preserving the author’s words and choices.",
    color: "#ae9bf1",
    nodes: [
      node(
        "source",
        "Writing & context",
        "input",
        "Current shots, neighbouring clips, selected assets and the target video model.",
      ),
      node(
        "guidance",
        "Editorial guidance",
        "local",
        "Additional direction for writing enhancement and model optimization.",
        { editable: true },
      ),
      node(
        "provider",
        "Enhance writing",
        "provider",
        "Text connection selected in Connections; optimization uses DeepSeek.",
      ),
      node(
        "validate",
        "Preserve your intent",
        "protected",
        "Shot IDs, order, action boundaries, mentions and spoken words must survive validation. No extra cast or replacement injections.",
      ),
      node(
        "output",
        "New variation",
        "output",
        "Return editable shot prose. Original writing remains available.",
      ),
    ],
  },
  {
    id: "story",
    title: "Story development",
    description: "Develop structure using the latest edited timeline.",
    color: "#e4bb7c",
    nodes: [
      node(
        "source",
        "Story & current edit",
        "input",
        "Concept, nested groups, cast, current trims, active takes and clip prompts.",
      ),
      node(
        "guidance",
        "Story guidance",
        "local",
        "Additional instructions for developing characters, groups and clips.",
        { editable: true },
      ),
      node(
        "provider",
        "Develop structure",
        "provider",
        "DeepSeek text connection, with the existing story job queue.",
      ),
      node(
        "validate",
        "Protect the structure",
        "protected",
        "Stable identities, valid parents, no cycles, exact existing dialogue and current edit links. Required response format stays locked.",
      ),
      node(
        "output",
        "Story proposal",
        "output",
        "Existing review / apply flow and project revision protection.",
      ),
    ],
  },
  {
    id: "assistant",
    title: "Director decisions",
    description: "Small, contextual suggestions while you work.",
    color: "#79c7b1",
    nodes: [
      node(
        "source",
        "Current moment",
        "input",
        "Active writing, neighbouring clips, manual controls and known library identities.",
      ),
      node(
        "guidance",
        "Assistant guidance",
        "local",
        "Additional preferences for optional suggestions, not automatic rewrites.",
        { editable: true },
      ),
      node(
        "provider",
        "Suggest a decision",
        "provider",
        "Budgeted DeepSeek assistant. Its fast model and spending guard remain managed by Assistant settings.",
      ),
      node(
        "validate",
        "Check the evidence",
        "protected",
        "Suggestions need authored evidence and known IDs. Manual choices win. Never rewrite dialogue or claim to have seen footage.",
      ),
      node(
        "output",
        "Offer a suggestion",
        "output",
        "Physical controls show eligible changes; writing suggestions remain optional.",
      ),
    ],
  },
  {
    id: "sound",
    title: "Soundtrack",
    description:
      "Effects and ambience use the same picture in parallel, with separate spoken dialogue.",
    color: "#77caca",
    nodes: [
      node(
        "source",
        "Picture & script",
        "input",
        "Edited footage, successful take prompts, selected range and character voice identities.",
      ),
      node(
        "effects",
        "Effects direction",
        "local",
        "Acoustic cues for synchronized Foley; speech and music exclusions remain separate.",
        { editable: true },
      ),
      node(
        "ambience",
        "Ambience direction",
        "local",
        "Continuous environmental texture across cuts; no foreground effects.",
        { editable: true },
      ),
      node(
        "provider",
        "Generate sound",
        "provider",
        "Existing fal.ai effects, ambience and dialogue adapters. Speech uses the exact written script; lip-sync is a separate video job.",
      ),
      node(
        "validate",
        "Check & align",
        "protected",
        "Keep timing, speaker assignment, source footage and request receipts. Failed sections retry independently.",
      ),
      node(
        "output",
        "Separate audio lanes",
        "output",
        "Save effects, ambience and dialogue separately; preserve original clip audio.",
      ),
    ],
  },
  {
    id: "image",
    title: "Reference images",
    description:
      "Generate reusable asset images or variations through connected providers.",
    color: "#d99dbb",
    nodes: [
      node(
        "source",
        "Asset identity",
        "input",
        "Selected character, location, prop or style and its saved description.",
      ),
      node(
        "guidance",
        "Reference direction",
        "local",
        "Additional art direction for image generation and copied prompts.",
        { editable: true },
      ),
      node(
        "provider",
        "Generate image",
        "provider",
        "Venice or fal.ai selected in the asset creator. Text creates a reference; an existing image guides a variation. Offline mode makes a local sample without an API call.",
      ),
      node(
        "validate",
        "Import & describe",
        "protected",
        "Copy the returned image into managed storage. Metadata import uses the required asset format and validates IDs.",
      ),
      node(
        "output",
        "Reusable reference",
        "output",
        "An image and editable description, ready to attach with an explicit reference role.",
      ),
    ],
  },
];
const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
export function validateWorkflowSettings(value = {}) {
  if (!plain(value)) throw Error("Workflow settings must be an object.");
  if (value.version !== undefined && value.version !== workflowVersion)
    throw Error("Unsupported workflow version.");
  if (value.flows !== undefined && !plain(value.flows))
    throw Error("Invalid workflow collection.");
  const result = { version: workflowVersion, flows: {} };
  for (const [id, flow] of Object.entries(value.flows || {})) {
    const definition = workflows.find((w) => w.id === id);
    if (!definition || !plain(flow)) throw Error("Unknown workflow.");
    if (flow.nodes !== undefined && !plain(flow.nodes))
      throw Error("Invalid workflow layers.");
    const nodes = {};
    for (const [key, edit] of Object.entries(flow.nodes || {})) {
      if (!definition.nodes.find((n) => n.id === key)?.editable || !plain(edit))
        throw Error("This app requirement is protected.");
      if (Object.keys(edit).some((k) => !["text", "enabled"].includes(k)))
        throw Error("Unsupported layer setting.");
      if (
        typeof edit.text !== "string" ||
        edit.text.length > 3000 ||
        (edit.enabled !== undefined && typeof edit.enabled !== "boolean")
      )
        throw Error("Use at most 3,000 characters per layer.");
      nodes[key] = { text: edit.text, enabled: edit.enabled !== false };
    }
    if (
      flow.layers !== undefined &&
      (!Array.isArray(flow.layers) || flow.layers.length > 12)
    )
      throw Error("Use at most 12 additional layers per workflow.");
    const ids = new Set();
    const layers = (flow.layers || []).map((l) => {
      if (
        !plain(l) ||
        typeof l.id !== "string" ||
        !/^layer-[\w-]{1,80}$/.test(l.id) ||
        ids.has(l.id)
      )
        throw Error("Invalid or duplicate layer.");
      ids.add(l.id);
      if (
        typeof l.title !== "string" ||
        !l.title.trim() ||
        l.title.length > 80 ||
        typeof l.text !== "string" ||
        l.text.length > 3000
      )
        throw Error("A layer needs a name and at most 3,000 characters.");
      if (!definition.nodes.some((n) => n.id === l.after && n.editable))
        throw Error("Connect a new layer after an editable prompt step.");
      if (l.enabled !== undefined && typeof l.enabled !== "boolean")
        throw Error("Invalid layer switch.");
      return {
        id: l.id,
        title: l.title,
        text: l.text,
        after: l.after,
        enabled: l.enabled !== false,
      };
    });
    if (Object.keys(flow).some((k) => !["nodes", "layers"].includes(k)))
      throw Error("Unsupported workflow control.");
    result.flows[id] = { nodes, layers };
  }
  if (JSON.stringify(result).length > 48000)
    throw Error("Workflow guidance is too large. Shorten a few layers.");
  return result;
}
export function workflowNodes(settings, id) {
  const definition = workflows.find((w) => w.id === id);
  if (!definition) throw Error("Unknown workflow.");
  const saved = validateWorkflowSettings(settings?.workflows).flows[id] || {};
  return definition.nodes.flatMap((n) => [
    {
      ...n,
      text: saved.nodes?.[n.id]?.text || "",
      enabled: saved.nodes?.[n.id]?.enabled !== false,
    },
    ...(saved.layers || [])
      .filter((l) => l.after === n.id)
      .map((l) => ({
        ...l,
        kind: "local",
        editable: true,
        custom: true,
        detail: "Your additional prompt guidance. No separate AI request.",
      })),
  ]);
}
export function workflowGuidance(settings, id, nodeId) {
  return workflowNodes(settings, id)
    .filter(
      (n) =>
        n.editable &&
        n.enabled &&
        n.text.trim() &&
        (!nodeId || n.id === nodeId || n.after === nodeId),
    )
    .map((n) => ({
      label: n.title,
      text: n.text.trim(),
      source: "Workflow Canvas · " + id,
    }));
}
export const workflowText = (settings, id, nodeId) =>
  workflowGuidance(settings, id, nodeId)
    .map((s) => `${s.label}: ${s.text}`)
    .join("\n");
// Additions never replace authored text or schemas. Existing validators stay authoritative.
export function applyWorkflowRequest(request, settings, id) {
  const text = workflowText(settings, id);
  if (!text) return request;
  request.messages.unshift({
    role: "system",
    content:
      "Additional creative preferences (subordinate to the app response contract, exact dialogue, identity and preservation requirements):\n" +
      text,
  });
  return request;
}
