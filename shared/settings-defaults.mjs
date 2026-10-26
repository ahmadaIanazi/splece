import { validateWorkflowSettings } from "./workflows.mjs";
import { normalizeCreativeDirection } from "./creative-presets.mjs";
// Categories are inherited independently. Legacy projects remain explicit overrides.
export const settingGroups = {
  workflows: ["workflows"],
  prompting: ["systemPrompt", "automation", "templates", "deliveryPresets", "creativeDirection"],
  video: ["videoDefaults", "concurrency"],
  audio: ["audioDefaults"],
  exports: ["export"],
};
export function resolveProjectDefaults(settings, defaults) {
  const result = structuredClone(settings);
  for (const group of settings.inherit || [])
    for (const key of settingGroups[group] || [])
      if (defaults[key] !== undefined)
        result[key] = structuredClone(defaults[key]);
  return result;
}
export function validateDefaults(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Settings must be an object.");
  const result = {};
  for (const key of Object.values(settingGroups).flat())
    if (value[key] !== undefined) result[key] = structuredClone(value[key]);
  for (const key of [
    "automation",
    "templates",
    "audioDefaults",
    "export",
    "videoDefaults",
  ])
    if (
      result[key] !== undefined &&
      (!result[key] ||
        typeof result[key] !== "object" ||
        Array.isArray(result[key]))
    )
      throw Error(`Invalid ${key} settings.`);
  if (result.videoDefaults) {
    for (const [mode, settings] of Object.entries(result.videoDefaults)) {
      if (
        !["demo", "venice", "live", "test", "fal"].includes(mode) ||
        !settings ||
        typeof settings !== "object" ||
        Array.isArray(settings)
      )
        throw Error("Invalid video defaults.");
      result.videoDefaults[mode] = Object.fromEntries(
        Object.entries(settings).filter(([k]) =>
          ["model", "duration", "resolution", "aspect", "audio"].includes(k),
        ),
      );
      if (settings.model !== undefined && typeof settings.model !== "string")
        throw Error("Invalid model.");
      if (
        settings.duration !== undefined &&
        (!Number.isFinite(settings.duration) || settings.duration <= 0)
      )
        throw Error("Invalid duration.");
      if (settings.audio !== undefined && typeof settings.audio !== "boolean")
        throw Error("Invalid audio switch.");
    }
  }
  if (
    result.systemPrompt !== undefined &&
    typeof result.systemPrompt !== "string"
  )
    throw Error("System prompt must be text.");
  if (
    result.concurrency !== undefined &&
    (!Number.isInteger(result.concurrency) ||
      result.concurrency < 1 ||
      result.concurrency > 12)
  )
    throw Error("Concurrent jobs must be between 1 and 12.");
  if (
    result.export &&
    (!["16:9", "9:16", "1:1"].includes(result.export.aspect) ||
      !["480p", "720p", "1080p"].includes(result.export.resolution) ||
      ![24, 25, 30, 60].includes(result.export.fps))
  )
    throw Error("Unsupported export settings.");
  if (
    result.audioDefaults &&
    (!Number.isFinite(result.audioDefaults.volume) ||
      result.audioDefaults.volume < 0 ||
      result.audioDefaults.volume > 1 ||
      typeof result.audioDefaults.mute !== "boolean")
  )
    throw Error("Invalid audio defaults.");
  if (
    result.automation &&
    Object.values(result.automation).some((v) => typeof v !== "boolean")
  )
    throw Error("Automation settings must be switches.");
  if (
    result.templates &&
    Object.values(result.templates).some((v) => typeof v !== "string")
  )
    throw Error("Templates must contain text.");
  if (
    result.deliveryPresets &&
    (!Array.isArray(result.deliveryPresets) ||
      result.deliveryPresets.some((v) => typeof v !== "string"))
  )
    throw Error("Voice deliveries must be text.");
  if (result.creativeDirection !== undefined) result.creativeDirection = normalizeCreativeDirection(result.creativeDirection);
  if (result.workflows !== undefined) result.workflows = validateWorkflowSettings(result.workflows);
  return result;
}
// Editing inherited values anywhere (including the export dialog) creates an override.
export function markSettingsOverrides(before, after) {
  after.inherit = (after.inherit || []).filter(
    (group) =>
      !(before.inherit || []).includes(group) ||
      (settingGroups[group] || []).every(
        (key) => JSON.stringify(before[key]) === JSON.stringify(after[key]),
      ),
  );
}
