import { composerEvents } from "./composer-sequence.mjs";
import { actionTimingGuide } from "./shot-direction.mjs";
export const preservationGuide = `Rewrite the selected video model's prompt into clear, natural language while preserving the director's creative intent. Strengthen physical positioning, contact, clothing state, visible anatomy, object details, spatial relationships, realism, core action sequence, explicit camera direction, atmosphere and requested sound. Do not sanitize, generalize away or invent these details. Do not add characters or change the core action. Auto means unspecified: do not invent mandatory camera, movement or delivery instructions. Never mention missing inputs or unavailable start/end frames. Copy every Scene N cast control:, camera control:, speech control: and action control: line exactly. ${actionTimingGuide} Treat wider story context as planning information, never permission to add cast or dialogue. Copy the [Reference roles] section exactly. Copy the [Clip continuity] section exactly, preserving planned versus confirmed evidence. Copy every numbered reference role line (@Image, @Element, or Image N) exactly at the top. Preserve all spoken dialogue word-for-word and its speaker. Preserve every saved voice identity line exactly; do not change a character’s accent, language or voice profile. Copy the original Negative block exactly at the end. The prompt field contains only the enhanced prompt; explanations and asset decisions belong outside that field. If these requirements conflict with a model limit, report the conflict instead of deleting protected content.`;
export function sourceTexts(d) {
  return [
    d.general,
    ...d.scenes.flatMap((s) => [s.text, ...composerEvents(s).map(event => event.text)]),
    d.notes,
    d.repairInstructions,
  ].filter(Boolean);
}
export function protectedContent(d, compiledText = "") {
  const texts = sourceTexts(d);
  return {
    referenceRoles: compiledText.match(/(?:^|\n)(\[Reference roles\]\n[^]*?)(?=\n\n\[|$)/)?.[1]?.trimEnd() || "",
    continuity: compiledText.match(/(?:^|\n)(\[Clip continuity\]\n[^]*?)(?=\n\n\[|$)/)?.[1]?.trimEnd() || "",
    creative: compiledText.match(/(?:^|\n)(\[Creative direction\]\n[^]*?)(?=\n\n\[|$)/)?.[1]?.trimEnd() || "",
    controls: compiledText
      .split("\n")
      .filter((l) => /^Scene \d+ (cast|speech|camera|action) control:/.test(l)),
    voices: compiledText
      .split("\n")
      .filter((l) => l.includes(" — voice identity:")),
    roles: [
      ...new Set(
        compiledText
          .split("\n")
          .filter((l) => /^(?:@(Image|Element)\d+|Image \d+)\b/.test(l)),
      ),
    ],
    negatives: [
      ...new Set(
        texts.flatMap((t) => {
          const match = t.match(/^(?:Negative\s*:|\[Negative\])[^]*$/im);
          return match ? [match[0].trimEnd()] : [];
        }),
      ),
    ],
    dialogue: [
      ...new Set([
        ...d.scenes.flatMap((s) =>
          s.dialogue.map((l) => l.text).filter(Boolean),
        ),
        ...texts.flatMap((t) =>
          [...t.matchAll(/[“"]([^“”"\n]+)[”"]/g)].map((m) => m[1]),
        ),
      ]),
    ],
  };
}
export function orderProtectedPrompt(text, d) {
  const protectedParts = protectedContent(d, text);
  for (const line of protectedParts.roles)
    text = text
      .split("\n")
      .filter((l) => l !== line)
      .join("\n");
  for (const block of protectedParts.negatives) text = text.replace(block, "");
  return [...protectedParts.roles, text.trim(), ...protectedParts.negatives]
    .filter(Boolean)
    .join("\n");
}
export function assertProtectedPrompt(prompt, protectedParts) {
  if (protectedParts.referenceRoles && !prompt.includes(protectedParts.referenceRoles))
    throw Error("Enhanced prompt changed reference roles. Nothing applied.");
  if (protectedParts.continuity && !prompt.includes(protectedParts.continuity))
    throw Error("Enhanced prompt changed clip continuity. Nothing applied.");
  if (protectedParts.creative && !prompt.includes(protectedParts.creative))
    throw Error("Enhanced prompt changed project creative direction. Nothing applied.");
  for (const line of protectedParts.controls || [])
    if (!prompt.split("\n").includes(line))
      throw Error(
        "Enhanced prompt changed scene cast, camera or speech controls. Nothing applied.",
      );
  for (const line of protectedParts.voices || [])
    if (!prompt.includes(line))
      throw Error(
        "Enhanced prompt changed a saved character voice. Nothing applied.",
      );
  for (const line of protectedParts.dialogue)
    if (!prompt.includes(line))
      throw new Error(
        "Enhanced prompt changed or omitted dialogue. Your original is preserved.",
      );
  if (
    protectedParts.roles.length &&
    !prompt.startsWith(protectedParts.roles.join("\n"))
  )
    throw new Error("Reference role lines must remain unchanged at the top.");
  if (
    protectedParts.negatives.length &&
    !prompt.trimEnd().endsWith(protectedParts.negatives.join("\n"))
  )
    throw new Error(
      "The original Negative block must remain unchanged at the end.",
    );
}
