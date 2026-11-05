import { supportsSoundReference } from "./video-sound-continuity.mjs";

// Project canonical inputs for each candidate, not the currently selected model.
export function videoModelInputs(compiled, model) {
  const source = compiled?.modelInputs || compiled || {};
  const references = (source.references || []).filter(
    (r) => r.kind !== "continuity",
  );
  const boundaries = { ...source.boundaries };
  if (!compiled?.modelInputs) {
    boundaries.start ||= compiled?.continuityReference;
    boundaries.end ||= compiled?.continuityEndReference;
  }
  for (const key of ["start", "end"]) {
    const frame = boundaries[key];
    if (
      !frame ||
      (model.frames && (key === "start" || model.endFrame !== false))
    )
      continue;
    if (
      frame.mode !== "pinned" &&
      model.continuityAsReference &&
      (frame.timelineCapture ||
        (frame.mode === "auto" &&
          key === "start" &&
          source.before?.takes?.some((t) => t.id === frame.takeId)))
    ) {
      references.push({
        kind: "continuity",
        selectedMedia: { id: `continuity-${key}` },
      });
      boundaries[key] = null;
    } else if (frame.mode === "auto") boundaries[key] = null;
  }
  return { ...compiled, references, boundaries };
}

// A deliberate choice stays selected; incompatible inputs are explained before submission.
export function selectedVideoModel(
  models,
  compatible,
  settings,
  favoriteId,
  manualId,
) {
  return (
    models.find(
      (m) =>
        m.id === manualId && m.id === settings.model && m.supported !== false,
    ) || preferredVideoModel(compatible, settings.model, favoriteId)
  );
}

export function compatibleVideoModels(models, compiled) {
  return models.filter((m) => {
    const candidate = videoModelInputs(compiled, m);
    const refs = candidate.references;
    const counts = refs.map((r) => ({
      ...r,
      count: (r.selectedMediaList || (r.selectedMedia ? [r.selectedMedia] : []))
        .length,
    }));
    const total = counts.reduce((n, r) => n + r.count, 0);
    // Automatic continuity is optional; explicit/pinned frames are requirements.
    const startFrame = candidate.boundaries?.start;
    const endFrame = candidate.boundaries?.end;
    const start = !!startFrame && (startFrame.mode !== "auto" || !!m.frames);
    const end =
      !!endFrame &&
      (endFrame.mode !== "auto" || (!!m.frames && m.endFrame !== false));
    if (m.supported === false || total > (m.maxReferences ?? 8)) return false;
    if ((start && !m.frames) || (end && (!m.frames || m.endFrame === false)))
      return false;
    if (m.requiresEnd && !end) return false;
    if (m.referenceMode === "none") return !total && !start && !end;
    if (m.referenceMode === "flat")
      return (
        (total > 0 ||
          ((compiled?.soundReferenceIntent || compiled?.soundReference) &&
            supportsSoundReference(m))) &&
        !start &&
        !end
      );
    if (m.referenceMode === "single") return start ? total === 0 : total === 1;
    if (m.referenceMode === "elements") {
      const elements = counts.filter(
        (r) => ["character", "prop"].includes(r.kind) && r.count,
      );
      return (
        (start || total > 0) &&
        elements.length <= 4 &&
        elements.every((r) => r.count <= 4) &&
        counts
          .filter((r) => !["character", "prop"].includes(r.kind))
          .reduce((n, r) => n + r.count, 0) <= 4
      );
    }
    return true; // Local simulator, with explicit limits above.
  });
}
export function fitVideoSettings(settings, model) {
  if (!model) return { ...settings };
  const next = { ...settings, model: model.id };
  for (const [key, choices] of Object.entries({
    duration: model.durations,
    resolution: model.resolutions,
    aspect: model.aspects,
  })) {
    if (!choices?.length) {
      delete next[key];
      continue;
    }
    if (!choices.includes(next[key]))
      next[key] =
        key === "duration"
          ? [...choices].sort(
              (a, b) =>
                Math.abs(a - Number(settings.duration || 0)) -
                  Math.abs(b - Number(settings.duration || 0)) || a - b,
            )[0]
          : key === "resolution"
            ? [...choices].sort(
                (a, b) =>
                  parseFloat(a) * (/k$/i.test(a) ? 1024 : 1) -
                  parseFloat(b) * (/k$/i.test(b) ? 1024 : 1),
              )[0]
            : choices[0];
  }
  next.audio = model.audioConfigurable
    ? (settings.audio ?? true)
    : !!model.audio;
  return next;
}
export function preferredVideoModel(models, currentId, favoriteId) {
  const family = (id) =>
    (id || "").replace(/(?:text|image|reference)-to-video$/, "");
  const ranked = [...models].sort(
    (a, b) =>
      Number(["flat", "elements"].includes(b.referenceMode)) -
      Number(["flat", "elements"].includes(a.referenceMode)),
  );
  return (
    models.find((m) => m.id === currentId) ||
    models.find((m) => m.id === favoriteId) ||
    ranked.find((m) => family(m.id) === family(currentId)) ||
    ranked.find((m) => family(m.id) === family(favoriteId)) ||
    models[0]
  );
}
