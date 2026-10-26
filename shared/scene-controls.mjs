// Deterministic shot constraints. These are derived from the draft, never invented by the enhancer.
export function sceneControls(draft, references, automation = {}) {
  const characters = references.filter((r) => r.kind === "character");
  return draft.scenes.flatMap((scene, index) => {
    const lines =
      automation.dialogue === false
        ? []
        : (scene.dialogue || []).filter((l) => l.text?.trim());
    const explicit = [
      ...new Set([
        ...(scene.characterIds || []),
        ...lines.map((l) => l.speaker).filter(Boolean),
        ...(scene.sequence || []).filter(event => event.kind !== "speak").map(event => event.speaker).filter(Boolean),
      ]),
    ];
    const cast = explicit.length
      ? characters.filter((c) => explicit.includes(c.id))
      : characters;
    const missing = explicit.filter(
      (id) => !characters.some((c) => c.id === id),
    );
    const names = cast.map((c) => c.name);
    const castRule =
      names.length && !missing.length
        ? `Exactly ${names.length} distinct character${names.length === 1 ? "" : "s"} in this scene: ${names.join(", ")}. Only this cast may appear. No additional people, background extras, crowds, duplicate characters, or characters from other story sections. Multiple views or images of one character represent one identity, not additional people. People visible in location or continuity references are not authorized cast.`
        : "Only depict subjects explicitly described in this scene. Do not introduce characters from other story sections or incidental people from reference backgrounds.";
    // Preserve explicitly quoted inline performance, as well as structured dialogue.
    const inline = /[“"]([^“”"\n]+)[”"]/.test(scene.text || "");
    const speechRule =
      lines.length || inline
        ? "Speak only the exact authored dialogue for this scene, attributed to its specified speaker. No added dialogue, narration, voice-over, invented words, gibberish or extra speakers. Characters without assigned lines do not speak. Language and accent describe delivery only; they do not authorize new lines."
        : "No dialogue. No spoken words, narration, voice-over, gibberish or improvised speech. Do not animate talking or lip-sync speech. Requested breathing, gasps and other nonverbal sounds are allowed; environmental sound remains allowed. Language, region, accent and voice metadata do not authorize speech.";
    if (draft.nativeMultiShot)
      return [
        `Scene ${index + 1} cast control: ${names.length ? "Only " + names.length + " characters: " + names.join(", ") : "Only scene subjects"}. No extra people or duplicates.`,
        `Scene ${index + 1} speech control: ${lines.length || inline ? "Only exact scripted lines; no added speech." : "No dialogue, narration or gibberish. Requested nonverbal sounds allowed."}`,
      ];
    return [
      `Scene ${index + 1} cast control: ${castRule}`,
      `Scene ${index + 1} speech control: ${speechRule}`,
    ];
  });
}
export function hasAuthoredSpeech(draft, automation = {}) {
  return (
    automation.dialogue !== false &&
    draft.scenes.some(
      (s) =>
        (s.dialogue || []).some((l) => l.text?.trim()) ||
        /[“"]([^“”"\n]+)[”"]/.test(s.text || ""),
    )
  );
}
export function notesForSubmission(notes, speech) {
  if (speech) return notes || "";
  // Remove only the studio-generated language metadata line; retain the original draft verbatim.
  return (notes || "")
    .split("\n")
    .filter(
      (line) =>
        !/^Spoken language: .*\. Region: .*\. Default accent: .*\s*$/.test(
          line,
        ),
    )
    .join("\n")
    .trim();
}
