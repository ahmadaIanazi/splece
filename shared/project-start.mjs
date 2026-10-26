import { findProjectTemplate } from "./project-templates.mjs";
import { normalizeCreativeDirection } from "./creative-presets.mjs";
import { createStructureNode, groupTemplates } from "./structure.mjs";
export const projectFormats = [
  { id: "blank", name: "Start blank", template: "Universal", duration: 60 },
  { id: "movie", name: "Movie", template: "Film", duration: 1800 },
  { id: "reel", name: "Reel", template: "Social", duration: 30 },
  { id: "tiktok", name: "TikTok", template: "Social", duration: 30 },
  { id: "music", name: "Music video", template: "Music video", duration: 180 },
  { id: "ad", name: "Advertisement", template: "Advertisement", duration: 30 },
  {
    id: "documentary",
    name: "Documentary",
    template: "Documentary",
    duration: 600,
  },
  { id: "education", name: "Educational", template: "Tutorial", duration: 300 },
  { id: "podcast", name: "Podcast", template: "Universal", duration: 1200 },
];
export function initializeProjectConcept(p, input) {
  const template = findProjectTemplate(input.templateId);
  if (input.templateId && !template)
    throw Error("Choose an available project template.");
  if (input.aspect && !["16:9", "9:16", "1:1"].includes(input.aspect))
    throw Error("Choose a supported project shape.");
  const format =
    projectFormats.find((f) => f.id === (template?.format || input.format)) ||
    projectFormats[0];
  const concept = String(input.concept || "").slice(0, 80000);
  p.storyPlans ??= {};
  const characters = p.assets
    .filter((a) => a.kind === "character")
    .map((a) => a.id);
  p.storyPlans[p.episodeId] = {
    title: p.name,
    brief: concept,
    synopsis: "",
    beats: [],
    structureVersion: 1,
    namingTemplate: format.template,
    groupLabels: groupTemplates[format.template],
    setup: {
      format: format.name,
      targetDuration: template?.duration || format.duration,
      concept,
      castIds: characters,
      heroIds: [],
      castCount: Math.max(1, characters.length),
      grouping: "chapter",
      complete: false,
    },
  };
  const plan = p.storyPlans[p.episodeId];
  const direction = normalizeCreativeDirection(
    input.creativeDirection ?? template?.direction,
  );
  if (Object.keys(direction).length) plan.creativeDirection = direction;
  if (template) {
    plan.starterTemplate = {
      id: template.id,
      version: template.version,
      name: template.name,
    };
    plan.setup.complete = true;
    let start = 0;
    for (
      let groupIndex = 0;
      groupIndex < template.groups.length;
      groupIndex++
    ) {
      const shots = template.shots.slice(groupIndex * 2, groupIndex * 2 + 2);
      const duration = shots.reduce((total, shot) => total + shot.duration, 0);
      const group = createStructureNode(plan, "group");
      Object.assign(group, {
        title: template.groups[groupIndex],
        start,
        duration,
        end: start + duration,
        description: "",
        order: groupIndex,
      });
      plan.beats.push(group);
      for (const shot of shots) {
        const clip = createStructureNode(plan, "clip", group.id);
        Object.assign(clip, {
          title: shot.title,
          description: shot.description,
          start,
          duration: shot.duration,
          end: start + shot.duration,
          ...(direction.movement ? { movement: "Auto" } : {}),
        });
        plan.beats.push(clip);
        start += shot.duration;
      }
    }
  }
  if (input.aspect || template) {
    p.settings.export = {
      ...p.settings.export,
      aspect: input.aspect || template.aspect,
    };
    p.settings.inherit = (p.settings.inherit || []).filter(
      (x) => x !== "exports",
    );
  }
  // New-project defaults only; existing projects never pass through this initializer.
  for (const draft of p.drafts) {
    if (input.aspect || template)
      draft.settings.aspect = input.aspect || template.aspect;
    if (direction.movement)
      for (const scene of draft.scenes) scene.movement = "Auto";
  }
  p.conceptAssets = p.assets.map((a) => a.id);
  return p;
}
