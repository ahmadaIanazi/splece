// Script and voice intent: no provider IO. Descriptions guide delivery; they are not voice clones.
export const DIALOGUE_MODEL = "fal-ai/elevenlabs/tts/eleven-v3";
export const DIALOGUE_RATE = {
  rate: 0.0001,
  currency: "USD",
  unit: "character",
  source: "https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3",
  checkedAt: "2026-10-23",
  basis: "published",
};
export const dialogueVoices = [
  "Rachel",
  "Aria",
  "Roger",
  "Sarah",
  "Laura",
  "Charlie",
  "George",
  "Callum",
  "River",
  "Liam",
  "Charlotte",
  "Alice",
  "Matilda",
  "Will",
  "Jessica",
  "Eric",
  "Chris",
  "Brian",
  "Daniel",
  "Lily",
  "Bill",
];
const fields = [
  "tone",
  "timbre",
  "pitch",
  "pace",
  "accent",
  "language",
  "description",
  "direction",
];
export function dialogueDraft(project, clip) {
  // Exact associations win over another variation linked to the same story beat.
  return (
    project.drafts?.find((d) => d.id === clip.draftId) ||
    project.drafts?.find((d) => d.id === clip.sourceDraftId) ||
    project.drafts?.find((d) => d.targetId === clip.id) ||
    project.drafts?.find(
      (d) => clip.storyBeatId && d.storyBeatId === clip.storyBeatId,
    )
  );
}
export function characterVoice(project, asset) {
  const chosen = project.production?.voiceAssignments?.[asset?.id];
  if (dialogueVoices.includes(chosen)) return chosen;
  const identity = fields.map((f) => asset?.voice?.[f] || "").join(" ");
  if (/gravel|rough|raspy/i.test(identity))
    return asset?.gender === "female"
      ? "Laura"
      : asset?.gender === "male"
        ? "Bill"
        : "River";
  if (/narrat|resonant|authoritative/i.test(identity))
    return asset?.gender === "female"
      ? "Charlotte"
      : asset?.gender === "male"
        ? "Brian"
        : "River";
  if (asset?.gender === "female") return "Sarah";
  if (asset?.gender === "male") return "George";
  return "River";
}
const languageCodes = {
  arabic: "ar",
  العربية: "ar",
  english: "en",
  french: "fr",
  spanish: "es",
  german: "de",
  hindi: "hi",
  urdu: "ur",
  japanese: "ja",
  chinese: "zh",
  korean: "ko",
  portuguese: "pt",
  russian: "ru",
  italian: "it",
  turkish: "tr",
};
export function dialogueScript(project, clip) {
  const scenes = dialogueDraft(project, clip)?.scenes || [];
  const weights = scenes.map((s) =>
    Number(s.duration) > 0 ? Number(s.duration) : 1,
  );
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let at = 0;
  const lines = [];
  scenes.forEach((scene, i) => {
    const span = (clip.duration * weights[i]) / total;
    const spoken = (scene.dialogue || []).filter(
      (l) => typeof l.text === "string" && l.text.trim(),
    );
    const words = spoken.map((l) =>
      Math.max(1, l.text.trim().split(/\s+/u).length),
    );
    const wordTotal = words.reduce((a, b) => a + b, 0) || 1;
    let offset = at;
    spoken.forEach((line, j) => {
      const asset = project.assets?.find(
        (a) => a.id === line.speaker && a.kind === "character",
      );
      const voice = Object.fromEntries(
        fields.map((f) => [f, String(asset?.voice?.[f] || "")]),
      );
      const duration = (span * words[j]) / wordTotal;
      lines.push({
        text: line.text,
        speaker: line.speaker || "",
        name: asset?.name || "Unassigned speaker",
        missing: !asset,
        voice,
        providerVoice: characterVoice(project, asset),
        delivery: String(line.delivery || ""),
        direction: String(line.direction || ""),
        start: offset,
        duration,
      });
      offset += duration;
    });
    at += span;
  });
  return lines;
}
export function dialogueSignature(project, clip) {
  return JSON.stringify(dialogueScript(project, clip));
}
export function dialogueInput(line) {
  // All prose instructions stay in direction tags, never appended as spoken narration.
  const tag = (value) =>
    String(value || "")
      .replace(/[\[\]\r\n]/g, " ")
      .trim()
      .slice(0, 240);
  const directions = [
    line.voice.tone,
    line.voice.timbre,
    line.voice.pitch,
    line.voice.pace,
    line.voice.accent && `${line.voice.accent} accent`,
    line.voice.description,
    line.voice.direction,
    line.delivery === "auto" ? "" : line.delivery,
    line.direction,
  ]
    .map(tag)
    .filter(Boolean);
  const language = line.voice.language.trim().toLowerCase();
  const code =
    languageCodes[language] || (/^[a-z]{2}$/.test(language) ? language : null);
  const text =
    [...new Set(directions)].map((d) => `[${d}]`).join(" ") +
    (directions.length ? " " : "") +
    line.text;
  return {
    text,
    voice: line.providerVoice,
    stability: 0.5,
    timestamps: true,
    apply_text_normalization: "off",
    ...(code ? { language_code: code } : {}),
  };
}
