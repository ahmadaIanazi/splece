// New writing defaults only. Never migrate or overwrite an existing direction.
export const shotDefaults = {
  assistantVersion: 1,
  camera: "Auto",
  movement: "No movement",
  transition: "Continuous action",
};
export const actionLines = (text) =>
  String(text || "")
    .replace(/^(?:Negative\s*:|\[Negative\])[^]*$/im, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
export const actionTimingGuide =
  "Actions on the same authored line happen concurrently, in the same moment. A new non-empty action line advances to the next beat: then, after the previous line. A new shot follows the previous shot. Preserve any explicit order or timing the writer states. Do not turn concurrent actions into a montage or separate shots. Preserve the number and order of action lines; visual text wrapping is not an action boundary.";
export function cameraDirection(scene) {
  if (scene.cameraDirection?.trim()) return scene.cameraDirection.trim();
  return [
    ...new Set([scene.camera, scene.movement].filter((v) => v && v !== "Auto")),
  ].join(". ");
}
export function lockedCamera(scene) {
  return (
    !scene.cameraDirection?.trim() &&
    [scene.camera, scene.movement].some((v) =>
      ["No movement", "Static"].includes(v),
    )
  );
}
export function shotActionControl(scene, index, compact = false) {
  const lines = actionLines(scene.text);
  if (!lines.length) return null;
  if (compact === true)
    return `Scene ${index + 1} action control: Same line together; new lines then. Explicit timing wins.`;
  const following = index ? "This shot follows the previous shot. " : "";
  return `Scene ${index + 1} action control: ${following}${
    lines.length > 1
      ? `There are ${lines.length} authored action lines. Follow them in order: each new line happens after the previous line; actions within the same line happen simultaneously.`
      : "All actions on this single authored line happen simultaneously, in the same moment."
  } Preserve explicitly written timing or sequence. Do not invent cuts or split simultaneous actions into separate shots.`;
}
