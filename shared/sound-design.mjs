// Acoustic captions only. Story dialogue, identity prose and technical injections
// are not audio instructions. Rules are intentionally conservative; visuals still
// provide event timing to the Foley model.
const clean = (text) =>
  String(text || "")
    .replace(/(?:Negative\s*:|\[Negative\])[^]*$/im, "")
    .replace(/@(?:Image|Element)\d+[^\n]*/gi, "")
    .replace(/\"[^\"]*\"|“[^”]*”|«[^»]*»/g, "")
    .replace(
      /[^.!?\n]*(?:\bsays?\b|\bspeaks?\b|\bdialogue\b|\bwhispers?\b|\bsinging\b|\bvoice\b|\baccent\b)[^.!?\n]*/gi,
      "",
    );
const effectRules = [
  [/\b(hop|hops|jump|jumps|bounce|bounces)\b/i, "Light landing taps synchronized with visible feet"],
  [/\b(flaps?|flutter|flutters|wings?)\b/i, "Soft wing flutter at visible movement"],

  [
    /\b(pebbles?|stones?|gravel)\b/i,
    "Pebble and stone contacts against the visible surface",
  ],
  [
    /\b(walk|walks|walking|footstep|steps? into|steps? closer|run|runs|running)\b/i,
    "Footfalls on the visible surface, aligned with foot contact",
  ],
  [
    /\b(cloth|fabric|sleeve|shirt|dress|coat|abaya|jacket)\b/i,
    "Light fabric rustle with visible body movement",
  ],
  [
    /\b(lantern|metal|iron|latch|hinge)\b/i,
    "Small metal clicks and handling sounds at visible contact",
  ],
  [/\b(glass|bottle|cup)\b/i, "Soft glass handling and contact"],
  [
    /\b(match|strikes? a match|strikes? match|ignite)\b/i,
    "A brief match scrape and ignition at the visible strike",
  ],
  [
    /\b(door|gate)\b/i,
    "Hinge movement and a latch click when the visible door moves",
  ],
  [
    /\b(wipe|wipes|wiping|rub|rubs)\b/i,
    "Soft rubbing against the contacted surface",
  ],
  [
    /\b(keyboard|typing|types)\b/i,
    "Distinct key taps synchronized with fingers",
  ],
  [
    /\b(splash|splashes|pour|pours)\b/i,
    "Water movement and splashes at visible contact",
  ],
];
const ambienceRules = [
  [
    /\b(wind|breeze|rooftop|desert|outdoor)\b/i,
    "Soft steady outdoor air and distant wind",
  ],
  [/\b(rain|rainfall|storm)\b/i, "Continuous rainfall texture"],
  [/\b(ocean|beach|seaside|waves)\b/i, "Distant surf washing evenly"],
  [
    /\b(forest|woods|trees|garden)\b/i,
    "Gentle leaf movement and distant natural air",
  ],
  [/\b(city|street|urban|traffic)\b/i, "Low distant city traffic wash"],
  [/\b(room|classroom|school|kindergarten|indoor|interior|office|hallway)\b/i, "Quiet interior room tone"],
  [/\b(fireplace|campfire)\b/i, "Soft continuous fire crackle"],
];
export function acousticCues(text, role) {
  const source = clean(text);
  return [
    ...new Set(
      (role === "ambience" ? ambienceRules : effectRules)
        .filter(([pattern]) => pattern.test(source))
        .map(([, cue]) => cue),
    ),
  ];
}
export function acousticDirection(text) {
  return clean(text).trim().slice(0, 600);
}
export const AMBIENCE_MODEL = "fal-ai/elevenlabs/sound-effects/v2";
export const AMBIENCE_RATE = {
  rate: 0.002,
  currency: "USD",
  unit: "second",
  source: "https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2",
  checkedAt: "2026-10-24",
  basis: "published",
};
export function ambienceInput(prompt, part) {
  return {
    text: prompt.slice(0, 450),
    duration_seconds: part.modelDuration,
    loop: true,
    prompt_influence: 0.7,
    output_format: "mp3_44100_192",
  };
}
