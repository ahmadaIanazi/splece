import { audioClip, freeAudioLane } from "./audio-editing.mjs";
import { newElement } from "./elements.mjs";

export function localSourceKey(clip) {
  return JSON.stringify([
    clip.id,
    clip.activeTake,
    clip.in || 0,
    clip.start,
    clip.duration,
  ]);
}
const groups = [
  [
    "bird",
    "birds",
    "chirp",
    "chirping",
    "sparrow",
    "عصفور",
    "عصافير",
    "طيور",
    "طائر",
    "صوص",
    "زقزقة",
  ],
  ["wing", "wings", "flap", "flutter", "جناح", "جناحيه", "يرفرف", "رفرفة"],
  ["rain", "rainfall", "raining", "مطر", "امطار", "المطر"],
  ["footsteps", "footstep", "walking", "walks", "walk", "خطوات", "يمشي", "مشي"],
  ["door", "doors", "latch", "باب", "الباب", "يغلق"],
  ["wind", "breeze", "رياح", "ريح", "نسيم"],
  ["ocean", "sea", "waves", "beach", "بحر", "امواج", "شاطئ"],
  ["classroom", "room", "interior", "indoor", "فصل", "الفصل", "غرفة", "صف"],
  ["jump", "jumps", "landing", "hop", "يقفز", "قفز", "هبوط"],
  ["water", "splash", "splashes", "ماء", "مياه", "رذاذ"],
  ["speech", "speaking", "talking", "dialogue", "كلام", "حديث", "تتحدث", "يتحدث", "حوار"],
  ["woman", "female", "امرأة", "امراة", "معلمة", "المعلمة"],
  ["children", "kids", "اطفال", "الاطفال"],
];
const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا");
export function soundWords(text) {
  const words = new Set(normalize(text).match(/[\p{L}\p{N}]+/gu) || []);
  for (const group of groups)
    if (group.some((w) => words.has(w))) for (const w of group) words.add(w);
  return words;
}
// CLAP is English-oriented. Translate only our supported acoustic vocabulary;
// keep English descriptions intact and never send the query to a cloud translator.
export function localSoundQuery(text) {
  if (!/[\u0600-\u06ff]/.test(text)) return String(text || "").slice(0, 1500);
  const words = new Set(normalize(text).match(/[\p{L}\p{N}]+/gu) || []);
  const terms = groups.filter((g) => g.some((w) => words.has(normalize(w))))
    .map((g) => g[0]);
  const english = String(text).match(/[a-z]+/gi) || [];
  return [...new Set([...english, ...terms])].join(" ").slice(0, 1500) || String(text).slice(0, 1500);
}
export function localClipName(project, clip) {
  return clip.name || project.drafts?.find((d) => d.id === (clip.draftId || clip.sourceDraftId))?.name || "Clip";
}
export function rankLocalSounds(assets, query) {
  const queryWords = soundWords(query);
  return assets
    .map((asset) => {
      const words = soundWords(
        [asset.name, asset.description, ...(asset.tags || [])].join(" "),
      );
      return {
        asset,
        score: [...words].filter((w) => queryWords.has(w)).length,
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}
export function localClipDescription(project, clip) {
  const draft = project.drafts?.find(
    (d) => d.id === (clip.draftId || clip.sourceDraftId),
  );
  return [
    clip.name,
    draft?.name,
    draft?.prompt,
    draft?.description,
    draft?.notes,
    ...(draft?.scenes || []).map((s) => s.text),
  ]
    .filter(Boolean)
    .join(". ");
}

// Reviewed results append only. Never change gains, takes, or manually chosen media.
export function applyLocalResult(project, job) {
  if (
    job.state !== "ready" ||
    job.projectId !== project.id ||
    job.episodeId !== project.episodeId
  )
    throw Error("This result belongs to a different edit.");
  for (const source of job.sources || []) {
    const clip = project.clips.find((c) => c.id === source.id);
    if (!clip || localSourceKey(clip) !== source.key)
      throw Error(
        "The footage changed since analysis. Analyze it again before applying.",
      );
  }
  const result = job.result || {};
  const additions = (result.sounds || []).filter(
    (s) => !project.audioClips.some((a) => a.id === s.id),
  );
  if (project.audioClips.length + additions.length > 256)
    throw Error("This edit would exceed 256 audio clips.");
  const captions = (result.captions || []).filter(
    (s) => !(project.elements || []).some((e) => e.id === s.id),
  );
  if ((project.elements || []).length + captions.length > 100)
    throw Error(
      "This edit would exceed 100 text elements. Use a shorter selection.",
    );
  for (const sound of additions) {
    const asset = project.assets.find((a) => a.id === sound.assetId);
    if (!asset?.media || asset.media.id !== sound.mediaId)
      throw Error("A selected sound was removed. Analyze again.");
  }
  for (const sound of additions) {
    const asset = project.assets.find((a) => a.id === sound.assetId);
    const lane = freeAudioLane(project.audioClips, sound.start, sound.duration);
    project.audioClips.push({
      ...audioClip(asset.media, sound.id, sound.start, lane),
      name: asset.name || asset.media.name,
      in: sound.in || 0,
      duration: sound.duration,
      fadeIn: Math.min(0.03, sound.duration / 4),
      fadeOut: Math.min(0.15, sound.duration / 4),
      volume: sound.volume ?? 0.5,
      localAnalysisId: job.id,
    });
    project.audioLanes = Math.max(project.audioLanes || 1, lane + 1);
  }
  if (captions.length) project.elements ??= [];
  for (const caption of captions)
    project.elements.push({
      ...newElement("text", caption.start, project.episodeId),
      id: caption.id,
      duration: caption.duration,
      text: caption.text,
      x: 0.5,
      y: 0.86,
      w: 0.85,
      h: 0.18,
      fontSize: 0.045,
      font: /[\u0600-\u06ff]/.test(caption.text)
        ? "Noto Sans Arabic"
        : "Noto Sans",
      localAnalysisId: job.id,
    });
  return additions.length + captions.length;
}
