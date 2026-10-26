import {imageAssetPrompt, normalizeImageInput} from "../shared/asset-generation.mjs";
import { validateDefaults } from "../shared/settings-defaults.mjs";
import {
  workflows,
  workflowNodes,
  validateWorkflowSettings,
  workflowText,
} from "../shared/workflows.mjs";
import { newProject, newDraft, compilePrompt, models } from "./domain.mjs";
import { upgradeProject } from "../shared/studio.mjs";
import { assetImagePrompt } from "../shared/asset-exchange.mjs";
import { soundPrompt } from "../shared/soundtrack-ai.mjs";
import { buildOptimizerRequest } from "./prompt-optimizer.mjs";
// Deliberately has no provider, transport, credentials or job queue dependency.
// The canvas play control inspects local assembly; it can never spend credits.
export function previewWorkflow({
  project: original,
  settings,
  flowId,
  draftId,
  sample,
  model,
}) {
  const definition = workflows.find((w) => w.id === flowId);
  if (!definition) throw Error("Unknown workflow.");
  const project = upgradeProject(
    structuredClone(original || newProject("Workflow sample")),
  );
  const validated = validateWorkflowSettings(settings?.workflows);
  project.settings = {
    ...project.settings,
    ...validateDefaults(settings || {}),
    workflows: validated,
  };
  let draft =
    project.drafts.find((d) => d.id === draftId) ||
    project.drafts.find((d) => d.id === project.activeDraftId) ||
    newDraft();
  draft = structuredClone(draft);
  if (sample !== undefined) {
    if (typeof sample !== "string" || sample.length > 4000)
      throw Error("Use a sample under 4,000 characters.");
    const clipSettings = draft.settings;
    draft = newDraft("Sample clip");
    draft.settings = clipSettings;
    draft.scenes[0].text = sample;
    project.clips = [];
    project.assets = [];
    project.remarks = [];
    project.directionRanges = [];
    project.storyPlans = {};
  }
  const capabilities =
    model && typeof model.id === "string"
      ? Object.fromEntries(
          Object.entries(model).filter(([key]) =>
            [
              "id",
              "name",
              "promptLimit",
              "audio",
              "frames",
              "endFrame",
              "maxReferences",
              "continuityAsReference",
              "referenceRoles",
            ].includes(key),
          ),
        )
      : models.find((m) => m.id === draft.settings.model) || models[0];
  const compiled = compilePrompt(project, draft, capabilities);
  const writing = draft.scenes
    .map((s) => s.text)
    .filter(Boolean)
    .join("\n\n");
  const source =
    flowId === "story"
      ? project.storyPlans?.[project.episodeId]?.setup?.concept ||
        project.storyPlans?.[project.episodeId]?.brief ||
        writing
      : writing;
  let output = compiled.text;
  const stageOutputs = {};
  let requestGuide = "";
  if (flowId === "writing") {
    const request = buildOptimizerRequest(
      {
        draft,
        compiled,
        videoCapabilities: capabilities,
        projectContext: project,
      },
      { model: "Configured text model" },
    );
    requestGuide = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    output = writing;
  } else if (flowId === "image") {
    const asset = project.assets.find((a) =>
      draft.referenceIds?.includes(a.id),
    ) || {
      kind: "location",
      name: "Sample setting",
      description: source || "A quiet garden at dawn",
    };
    output = imageAssetPrompt(normalizeImageInput({assetId:asset.id||"sample",kind:["character","location","prop","style"].includes(asset.kind)?asset.kind:"location",name:asset.name||"Sample",description:asset.description||source||"A quiet garden at dawn",mode:"create",modelId:"venice-grok"}),project).prompt;
  } else if (flowId === "sound") {
    const duration = draft.settings.duration;
    const run = {
      workflowSettings: project.settings,
      direction: "",
      contexts: [{ clipId: "sample", scenes: draft.scenes }],
    };
    const unit = {
      start: 0,
      sources: [{ clipId: "sample", start: 0, duration }],
    };
    for (const [id, role] of [
      ["effects", "effect"],
      ["ambience", "ambience"],
    ]) {
      const sound = soundPrompt(run, { ...unit, role }, { start: 0, duration });
      stageOutputs[id] =
        sound.prompt + "\n\nExcluded sounds: " + sound.negative_prompt;
    }
    output = [
      "Effects",
      stageOutputs.effects,
      "\nAmbience",
      stageOutputs.ambience,
      "\nDialogue (unchanged)",
      draft.scenes
        .flatMap((s) => s.dialogue || [])
        .map((d) => d.text)
        .join("\n") || "No written dialogue.",
    ].join("\n");
  } else if (["story", "assistant"].includes(flowId))
    output = [
      source,
      workflowText(project.settings, flowId),
      "This preview does not generate AI content. Use the normal app controls for an Offline sample or a confirmed Online generation.",
    ]
      .filter(Boolean)
      .join("\n\n");
  const nodes = workflowNodes(project.settings, flowId).map((n) => {
    const guidance = n.enabled ? n.text : "";
    const sections =
      flowId === "video" && n.labels
        ? compiled.sections
            .filter((s) => n.labels.includes(s.label))
            .map((s) => `[${s.label}]\n${s.text}`)
            .join("\n\n")
        : "";
    return {
      id: n.id,
      title: n.title,
      state:
        n.enabled === false
          ? "bypassed"
          : ["provider", "external"].includes(n.kind)
            ? "not-called"
            : "inspected",
      input:
        n.kind === "input"
          ? "Saved project / sample input"
          : "Previous step and saved project context",
      output:
        stageOutputs[n.id] ||
        (n.kind === "input"
          ? source || "No writing yet. Try the sample."
          : n.kind === "output" || n.id === "assemble"
            ? output
            : n.kind === "provider"
              ? `${n.detail}\n\nNo provider called. No media generated.\n${requestGuide ? "\nPrepared instructions: " + requestGuide.length + " characters, including the protected response format.\n" + workflowText(project.settings, flowId) : ""}`
              : n.kind === "external"
                ? output
                : [
                    n.detail,
                    sections,
                    guidance && "Additional guidance:\n" + guidance,
                  ]
                    .filter(Boolean)
                    .join("\n\n")),
    };
  });
  return {
    mode: "test",
    cost: 0,
    externalRequests: 0,
    workflowId: flowId,
    draftName: draft.name,
    nodes,
    output,
    characters: output.length,
    promptLimit: capabilities.promptLimit || null,
    warnings:
      flowId === "video" &&
      output.length > (capabilities.promptLimit || Infinity)
        ? [
            "The assembled prompt exceeds this model’s character limit. Shorten guidance before generating.",
          ]
        : [],
    signature: JSON.stringify({
      workflows: validated,
      flowId,
      draftId,
      sample,
      model: capabilities.id,
    }),
    createdAt: Date.now(),
  };
}
export function installWorkflowRoutes(app, { getProject }) {
  app.post("/api/workflows/preview", (req, res) => {
    try {
      if (req.body.executionMode && req.body.executionMode !== "test")
        throw Error(
          "Canvas playback is Offline only. Use the normal generation controls for Online jobs.",
        );
      const project = req.body.projectId
        ? getProject(req.body.projectId).project
        : undefined;
      res.json(previewWorkflow({ ...req.body, project }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
