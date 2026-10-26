import { deskCreativeDefaults } from "./director-desk.mjs";
// Provider-neutral creative intent. IDs persist; descriptions are inspectable text,
// never invented API parameters or implicit image attachments.
const option = (id, name, text, colors) => ({
  id,
  name,
  text,
  ...(colors ? { colors } : {}),
});
export const CREATIVE_INJECTION_VERSION = 2;
export const creativeControls = [
  {
    id: "realism",
    name: "Realism",
    options: [
      option(
        "physical",
        "Physical realism",
        "Use coherent real-world gravity, momentum, weight, contact and material response. Bodies retain plausible anatomy and grounded motion; objects do not teleport, float or pass through solid surfaces. Lighting, reflections and shadows follow the scene geometry. Preserve authored actions; do not invent extra action to demonstrate physics.",
      ),
      option(
        "stylized",
        "Stylized",
        "Use a deliberately stylized visual treatment while preserving character identity and readable action continuity.",
      ),
    ],
  },
  {
    id: "look",
    name: "Look",
    options: [
      option(
        "cinematic",
        "Cinema",
        "Natural cinematic texture, gentle highlight roll-off and subtle grain.",
      ),
      option("clean", "Clean digital", "Clean digital detail and crisp edges."),
      option(
        "analog",
        "Home movie",
        "Soft analog texture, gentle grain and warm highlights.",
      ),
      option(
        "graphic",
        "Graphic",
        "Bold graphic shapes and clearly separated layers.",
      ),
    ],
  },
  {
    id: "lighting",
    name: "Lighting",
    options: [
      option("rim", "Rim light", "Soft edge light outlines the subject while a gentle front fill keeps the face visible."),
      option(
        "window",
        "Window light",
        "Soft directional daylight from a window, with gradual shadow falloff.",
      ),
      option(
        "golden",
        "Golden hour",
        "Low warm sunlight and long soft shadows.",
      ),
      option(
        "studio",
        "Soft studio",
        "Large diffused studio lights, soft shadows and controlled highlights.",
      ),
      option(
        "silhouette",
        "Silhouette",
        "Strong backlighting with a dark subject silhouette.",
      ),
      option(
        "practical",
        "Practical lights",
        "Visible practical light sources illuminate the scene.",
      ),
      option(
        "neon",
        "Neon",
        "Colored neon light with saturated highlights and deep shadows.",
      ),
    ],
  },
  {
    id: "palette",
    name: "Palette",
    options: [
      option(
        "dusk",
        "After hours",
        "Deep indigo shadows, muted violet midtones and warm peach highlights.",
        ["#222e52", "#6b6487", "#bf8f96", "#f6bf8a"],
      ),
      option(
        "earth",
        "Earth tones",
        "Forest green, muted olive, warm stone and cream tones.",
        ["#243e35", "#74816b", "#bcac8d", "#e9dfc8"],
      ),
      option(
        "citrus",
        "Citrus pop",
        "Bright lime and warm orange accents against deep charcoal.",
        ["#222832", "#a8c957", "#f4bf50", "#e76c48"],
      ),
      option(
        "pastel",
        "Soft pastel",
        "Muted lavender, soft rose, powder blue and creamy highlights.",
        ["#aca5c7", "#d6a9bb", "#a3c9d8", "#efe5d2"],
      ),
      option(
        "mono",
        "Monochrome",
        "Black-and-white tonal treatment with a broad range of grays.",
        ["#17191c", "#595c60", "#a7aaac", "#ecebe7"],
      ),
    ],
  },
  {
    id: "lens",
    name: "Lens",
    options: [
      option(
        "wide",
        "Wide",
        "Wide-angle perspective with clear spatial depth.",
      ),
      option(
        "natural",
        "Natural",
        "Natural perspective and restrained optical distortion.",
      ),
      option(
        "portrait",
        "Portrait",
        "Shallow depth of field with soft background separation.",
      ),
      option(
        "macro",
        "Macro",
        "Close macro detail with a narrow plane of focus.",
      ),
    ],
  },
  {
    id: "movement",
    name: "Camera",
    options: [
      option("static", "Locked off", "The camera stays entirely motionless."),
      option(
        "push",
        "Slow push in",
        "The camera slowly moves forward toward the subject.",
      ),
      option("pan", "Gentle pan", "The camera pans gently across the scene."),
      option("handheld", "Handheld", "Subtle handheld camera movement."),
      option(
        "orbit",
        "Orbit",
        "The camera makes a smooth partial orbit around the subject.",
      ),
    ],
  },
  {
    id: "pacing",
    name: "Pacing",
    planningOnly: true,
    options: [
      option("calm", "Unhurried", "Allow moments to breathe in the edit."),
      option(
        "balanced",
        "Balanced",
        "Balance establishing moments with close details.",
      ),
      option(
        "energetic",
        "Energetic",
        "Use a brisk editorial rhythm between clips.",
      ),
    ],
  },
];
export function normalizeCreativeDirection(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = Object.fromEntries(
    creativeControls.flatMap((c) =>
      c.options.some((o) => o.id === value[c.id]) ? [[c.id, value[c.id]]] : [],
    ),
  );
  if (value.timePeriod === "night") normalized.timePeriod="night";
  if (typeof value.spatialIntent === "string" && value.spatialIntent.trim()) normalized.spatialIntent=value.spatialIntent.trim().slice(0,1200);
  if (typeof value.styleIntent === "string" && value.styleIntent.trim()) normalized.styleIntent=value.styleIntent.trim().slice(0,1200);
  if (Array.isArray(value.customPalette))
    normalized.customPalette = value.customPalette
      .filter((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))
      .slice(0, 8);
  if (!normalized.customPalette?.length) delete normalized.customPalette;
  else delete normalized.palette;
  for (const key of ["lightSoftness", "timeOfDay", "colorVividness"]) if (typeof value[key] === "number" && Number.isFinite(value[key])) normalized[key] = Math.max(0,Math.min(100,value[key]));
  if (["above","below","eye"].includes(value.cameraAngle)) normalized.cameraAngle=value.cameraAngle;
  if (typeof value.cameraPosition === "number" && Number.isFinite(value.cameraPosition)) normalized.cameraPosition=Math.max(-180,Math.min(180,value.cameraPosition));
  if (Array.isArray(value.cameraPath) && value.cameraPath.length>1) normalized.cameraPath=value.cameraPath.filter(p=>p && Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0,40).map(p=>({x:Math.max(0,Math.min(100,p.x)),y:Math.max(0,Math.min(100,p.y))}));
  return normalized;
}
export function creativeDirectionText(value, { camera = true } = {}) {
  const selected = normalizeCreativeDirection(value);
  const text = creativeControls
    .filter(
      (c) =>
        !c.planningOnly && (camera || !["lens", "movement"].includes(c.id)),
    )
    .flatMap((c) => {
      const o = c.options.find((o) => o.id === selected[c.id]);
      return o ? [`${c.name}: ${o.text}`] : [];
    })
    .join("\n");
  return [
    text,
    ...(selected.spatialIntent ? [`User scene arrangement (stage coordinates, positive x right, positive depth towards front camera): ${selected.spatialIntent}. Use as composition guidance only; preserve the authored story, local direction and identities.`] : []),
    ...(selected.styleIntent ? [`Authored visual treatment (takes precedence over the base look): ${selected.styleIntent}`] : []),
    ...(selected.lightSoftness !== undefined ? [`Light softness: ${selected.lightSoftness}%, from crisp shadows (0) to diffuse light (100).`] : []),
    ...(selected.timePeriod === "night" ? ["Time: night; preserve the authored nocturnal setting."] : selected.timeOfDay !== undefined ? [`Daylight position: ${selected.timeOfDay < 25 ? 'morning' : selected.timeOfDay > 75 ? 'late afternoon' : 'midday'}.`] : []),
    ...(selected.colorVividness !== undefined ? [`Color intensity: ${selected.colorVividness}%, from muted pastel (0) to vivid (100). Preserve natural skin tones.`] : []),
    ...(camera && selected.cameraAngle ? [`Camera height: ${selected.cameraAngle === 'above' ? 'looking down toward the subject' : selected.cameraAngle === 'below' ? 'looking up toward the subject' : 'at eye level'}.`] : []),
    ...(camera && selected.cameraPosition !== undefined ? [`Camera position: ${selected.cameraPosition} degrees around the subject relative to a front view.`] : []),
    ...(camera && selected.cameraPath?.length>1 ? [`Camera path: ${selected.cameraPath.map(p=>`(${Math.round(p.x)},${Math.round(p.y)})`).join(' → ')} on a top-down 0–100 set, with the subject at (50,50) and top behind them. Follow one smooth move without scene cuts.`] : []),
    selected.customPalette?.length
      ? `Custom palette: ${selected.customPalette.join(", ")}. Use these as the dominant color relationships, preserving natural skin tones and scene readability.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
export function creativePlanningContext(value) {
  const choices = normalizeCreativeDirection(value);
  if (!Object.keys(choices).length) return null;
  const pacing = creativeControls
    .find((c) => c.id === "pacing")
    .options.find((o) => o.id === choices.pacing);
  return {
    choices,
    visualIntent: creativeDirectionText(choices),
    ...(pacing
      ? {
          editorialPacing:
            pacing.text +
            " This guides the edit between clips only; preserve authored action timing and never invent cuts inside a generation.",
        }
      : {}),
  };
}
export function projectCreativeSection(project, draft, automation, model) {
  if (
    !automation.specs ||
    draft.sectionOverrides?.["Creative direction"] === ""
  )
    return null;
  const manual = draft.sectionOverrides?.["Creative direction"] !== undefined;
  const direction = effectiveCreativeDirection(project, draft);
  const { lens, movement, cameraAngle, cameraPosition, cameraPath, ...visual } = direction;
  const lines = [creativeDirectionText(visual)].filter(Boolean);
  // A project choice is a fallback for each shot, never a competing global move.
  // Custom camera prose may contain optics too; do not try to parse/override it.
  if (automation.camera)
    (draft.scenes || []).forEach((scene, i) => {
      const custom = !!scene.cameraDirection?.trim();
      const framing = !!scene.camera && scene.camera !== "Auto";
      const motion = !!scene.movement && scene.movement !== "Auto";
      const fallback = creativeDirectionText({
        ...(!custom && !framing ? { lens, cameraAngle, cameraPosition } : {}),
        ...(!custom && !framing && !motion ? { movement, cameraPath } : {}),
      });
      if (fallback)
        lines.push(
          `Scene ${i + 1} camera intent: ${fallback.replaceAll("\n", " ")}`,
        );
    });
  if (!lines.length && !manual) return null;
  // Describe the selected workflow, not a brand or an assumed image attachment.
  const workflow = ["flat", "elements"].includes(model?.referenceMode)
    ? "reference-guided video"
    : model?.type === "image-to-video" || model?.operation === "image-to-video"
      ? "first-frame animation"
      : model?.type === "text-to-video" || model?.operation === "text-to-video"
        ? "text-to-video"
        : null;
  if (workflow && lines.length)
    lines.unshift(
      `Visual intent for ${workflow}; authored shot instructions and supplied frame/reference constraints take precedence.`,
    );
  return {
    label: "Creative direction",
    source:
      "Project creative choices · text intent only · shot instructions take precedence",
    text: lines.join("\n"),
  };
}

export function effectiveCreativeDirection(project, draft = {}) {
  const plan = project.storyPlans?.[draft.episodeId || project.episodeId];
  const base = {...(project.settings?.creativeDirection ?? plan?.creativeDirection ?? {})};
  const desk = deskCreativeDefaults(plan?.setup);
  if(desk.palette) delete base.customPalette;
  Object.assign(base,desk);
  const ancestry = []; const seen = new Set();
  let node = plan?.beats?.find(n => n.id === draft.storyBeatId);
  while (node && !seen.has(node.id)) { seen.add(node.id); ancestry.unshift(node.creativeDirection || {}); node = plan.beats.find(n => n.id === node.parentId); }
  const merged = {...base};
  for (const layer of [...ancestry, draft.creativeDirection || {}]) {
    if (layer.timeOfDay !== undefined && !layer.timePeriod) delete merged.timePeriod;
    if (layer.look && !layer.styleIntent) delete merged.styleIntent;
    if (layer.palette && !layer.customPalette) delete merged.customPalette;
    Object.assign(merged, layer);
  }
  return normalizeCreativeDirection(merged);
}
export function projectVisualReferences(project, draft = {}) {
  if (draft.useProjectVisuals === false) return [];
  const seen = new Set();
  return (project.settings?.visualReferences || []).filter((r) => {
    if (
      !r ||
      seen.has(r.assetId) ||
      !["palette", "lighting", "style"].includes(r.role)
    )
      return false;
    seen.add(r.assetId);
    return project.assets.some((a) => a.id === r.assetId);
  });
}
