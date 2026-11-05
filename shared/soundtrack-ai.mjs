import { workflowText } from "./workflows.mjs";
import { acousticCues, acousticDirection, AMBIENCE_MODEL, AMBIENCE_RATE } from "./sound-design.mjs";
import {
  DIALOGUE_MODEL,
  DIALOGUE_RATE,
  dialogueInput,
} from "./soundtrack-dialogue.mjs";
// Verified against fal's MMAudio V2 schema, 2026-10-23. No provider IO here.
export const SOUND_MODEL = "fal-ai/mmaudio-v2";
export const SOUND_RATE = {
  rate: 0.001,
  currency: "USD",
  unit: "second",
  source: "https://fal.ai/models/fal-ai/mmaudio-v2",
  checkedAt: "2026-10-23",
  basis: "published",
};
const round = (n) => Math.round(n * 1e6) / 1e6;
export function soundParts(unit) {
  if (unit.role === "dialogue")
    return (unit.lines || []).map((line, index) => ({
      index,
      start: line.start,
      duration: line.duration,
      model: DIALOGUE_MODEL,
      characters: Array.from(dialogueInput(line).text).length,
      state: "queued",
    }));
  const maxDuration = unit.model === AMBIENCE_MODEL ? 22 : 30;
  const overlap = 1; // Shared picture context and a crossfade at model-window joins.
  const parts = [];
  for (let start = 0; start < unit.duration - 0.000001;) {
    const duration = round(Math.min(maxDuration, unit.duration - start));
    parts.push({
      index: parts.length,
      start: round(start),
      duration,
      modelDuration: Math.max(1, duration),
      model: unit.model || SOUND_MODEL,
      overlap: parts.length ? overlap : 0,
      state: "queued",
    });
    if (start + duration >= unit.duration - 0.000001) break;
    start += duration - overlap;
  }
  return parts;
}
export function soundEstimate(
  run,
  rate = SOUND_RATE,
  dialogueRate = DIALOGUE_RATE,
  ambienceRate = AMBIENCE_RATE,
) {
  const layers = ["effect", "ambience"].map((role) => {
    const parts = run.units.filter((u) => u.role === role).flatMap(soundParts);
    const seconds = round(parts.reduce((n, p) => n + p.modelDuration, 0));
    const selectedRate = parts.some(p => p.model === AMBIENCE_MODEL) ? ambienceRate : rate;
    const rates = Object.fromEntries(parts.map(p=>[p.model,p.model===AMBIENCE_MODEL ? ambienceRate.rate : rate.rate]));
    return {
      role,
      model: parts[0]?.model || SOUND_MODEL,
      rate: selectedRate.rate,
      rates,
      seconds,
      requests: parts.length,
      amount: round(parts.reduce((n,p)=>n+p.modelDuration*rates[p.model],0)),
    };
  });
  const speech = run.units
    .filter((u) => u.role === "dialogue")
    .flatMap(soundParts);
  if (speech.length)
    layers.push({
      role: "dialogue",
      model: DIALOGUE_MODEL,
      rate: dialogueRate.rate,
      basis: dialogueRate.basis,
      characters: speech.reduce((n, p) => n + p.characters, 0),
      seconds: 0,
      requests: speech.length,
      amount: round(
        speech.reduce((n, p) => n + p.characters, 0) * dialogueRate.rate,
      ),
    });
  return {
    ...rate,
    model: SOUND_MODEL,
    amount: round(layers.reduce((n, l) => n + l.amount, 0)),
    seconds: round(layers.reduce((n, l) => n + l.seconds, 0)),
    requests: layers.reduce((n, l) => n + l.requests, 0),
    layers,
  };
}
export function soundPrompt(run, unit, part) {
  const start = unit.start + part.start, end = start + part.duration;
  const contexts = new Map(run.contexts.map(c => [c.clipId, c]));
  const cues = unit.sources.filter(s => s.start < end && s.start + s.duration > start).map(s => {
    const c = contexts.get(s.clipId) || {};
    const text = [c.description, c.environment, ...(c.scenes || []).map(v => v.text || v.description)].filter(Boolean).join(" ");
    return { at: Math.max(0, s.start - start), to: Math.min(part.duration, s.start + s.duration - start), cues: acousticCues(text, unit.role) };
  });
  const direction = acousticDirection([run.direction, workflowText(run.workflowSettings, "sound", unit.role === "ambience" ? "ambience" : "effects")].filter(Boolean).join(". "));
  const negative_prompt = "speech, talking, dialogue, narration, human voices, vocalizations, singing, humming, laughter, gibberish, music, melody, distortion, clipping";
  if (unit.role === "ambience") {
    const bed = [...new Set(cues.flatMap(c => c.cues))].join(". ") || "Neutral quiet environmental air";
    return {prompt: `${direction ? direction + ". " : ""}${bed}. Low, diffuse, even background texture, seamless and continuous across cuts. Environment only; no voices, music, footsteps or foreground impacts.`.slice(0,450), negative_prompt: negative_prompt + ", footsteps, foreground impacts, dramatic swell"};
  }
  if(unit.model === AMBIENCE_MODEL) {
    const events=[...new Set(cues.flatMap(c=>c.cues))].join(". ") || "Soft fabric movement and tiny surface taps";
    return {prompt: `Isolated physical sound effects only. No speech, vocals, singing or music. No continuous ambience. ${events}. Sparse individual contacts with silent gaps, dry close recording.${direction ? " "+direction : ""}`.slice(0,450),negative_prompt};
  }
  return {
    prompt: `Dry, close physical Foley synchronized with visible contact. Quiet gaps between events. ${cues.map(c => `${c.at.toFixed(1)}–${c.to.toFixed(1)}s: ${c.cues.join("; ") || "Subtle surface contacts matching visible motion"}`).join(". ")}${direction ? ". " + direction : ""}`.slice(0,2200),
    negative_prompt: negative_prompt + ", continuous ambience, wind bed, room tone, background noise",
  };
}
export function soundtrackCostRecords(run) {
  return run.units.flatMap((unit) => {
    const parts = unit.parts || [
      {
        index: 0,
        start: 0,
        duration: unit.duration,
        modelDuration: unit.duration,
        state: unit.state,
      },
    ];
    return parts
      .flatMap((part) => [...(part.attempts || []), part])
      .map((part) => {
        const test = run.executionMode !== "live";
        const submitted = !!part.providerJobId;
        const uncertain = ["submitting", "submission_uncertain"].includes(
          part.state,
        );
        const status = test
          ? "test"
          : uncertain
            ? "unknown"
            : submitted
              ? "estimated"
              : part.superseded || ["cancelled", "failed"].includes(run.state)
                ? "not-submitted"
                : "pending";
        return {
          key: `soundtrack:${run.id}:${unit.id}:${part.index}${part.attempt ? `:attempt${part.attempt}` : ""}`,
          id: run.id,
          kind: "soundtrack",
          provider: test ? "local-test" : "fal",
          model: part.model || SOUND_MODEL,
          test,
          state: part.state,
          title:
            unit.role === "effect"
              ? "Soundtrack · effects"
              : unit.role === "dialogue"
                ? "Soundtrack · dialogue"
                : "Soundtrack · ambience",
          episodeId: run.episodeId,
          targetId: unit.sources[0]?.clipId,
          start: unit.start + part.start,
          duration: part.duration,
          createdAt: part.acceptedAt || Date.parse(run.createdAt),
          amount:
            test || status === "not-submitted"
              ? 0
              : uncertain
                ? null
                : round(
                    unit.role === "dialogue"
                      ? part.characters *
                          (part.rate ??
                            run.estimate?.layers?.find(
                              (l) => l.role === "dialogue",
                            )?.rate ??
                            DIALOGUE_RATE.rate)
                      : part.modelDuration *
                          (part.rate ?? run.estimate?.rate ?? SOUND_RATE.rate),
                  ),
          status,
          charges: [],
          requestId: part.providerJobId,
        };
      });
  });
}
