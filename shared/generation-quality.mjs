// Presets choose a supported resolution; they never choose a different model.
export const qualityDefaults = { draft: '480p', final: '1080p' };
export const qualityPixels = value => /k$/i.test(value) ? parseFloat(value) * 1024 : parseInt(value, 10);
export function qualityResolution(presets, model, quality = 'draft') {
  const wanted = presets?.models?.[model?.id]?.[quality] || presets?.[quality] || qualityDefaults[quality];
  const supported = model?.resolutions || [];
  if (!supported.length) return undefined;
  if (supported.includes(wanted)) return wanted;
  const sorted = [...supported].sort((a,b) => qualityPixels(a)-qualityPixels(b));
  // Draft falls back to the cheapest size, Final to the closest supported size.
  return quality === 'draft' ? sorted[0] : sorted.reduce((best,v) => Math.abs(qualityPixels(v)-qualityPixels(wanted)) < Math.abs(qualityPixels(best)-qualityPixels(wanted)) ? v : best, sorted[0]);
}
export function validateQualityPresets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid generation presets.');
  const pair = (v, fallback = qualityDefaults) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid generation preset.');
    const out = {};
    for (const key of ['draft','final']) if (v[key] !== undefined) {
      if (typeof v[key] !== 'string' || !/^(?:[1-9]\d{1,3}p|[124]K)$/.test(v[key])) throw Error('Choose a supported preset resolution.');
      out[key] = v[key];
    }
    if (qualityPixels(out.draft || fallback.draft)>qualityPixels(out.final || fallback.final)) throw Error('Draft resolution must not exceed Final.');
    return out;
  };
  const result = pair(value);
  if (value.models !== undefined) {
    if (!value.models || typeof value.models !== 'object' || Array.isArray(value.models) || Object.keys(value.models).length>250) throw Error('Invalid model presets.');
    result.models = Object.fromEntries(Object.entries(value.models).map(([id,v])=>[id,pair(v,{...qualityDefaults,...result})]));
  }
  return result;
}
