// Visual direction is serialized through the existing camera field. No migration
// or numerical camera parameters are implied for a provider.
export const framings = ['Auto', 'Wide shot', 'Medium shot', 'Close-up', 'Extreme close-up', 'Over the shoulder'];
export const elevations = ['Low angle', 'Eye level', 'High angle', 'Overhead'];
export const viewpoints = ['Left profile', 'Three-quarter left', 'Front view', 'Three-quarter right', 'Right profile'];
export function readCamera(value = 'Auto') {
  const parts = value.split(' · ');
  const known = [...framings, ...elevations, ...viewpoints];
  const legacy = value === 'Aerial' ? ['Overhead'] : ['Static', 'No movement'].includes(value) ? ['Auto'] : parts;
  return {
    framing: legacy.find(p => framings.includes(p)) || 'Auto',
    elevation: legacy.find(p => elevations.includes(p)) || null,
    viewpoint: legacy.find(p => viewpoints.includes(p)) || null,
    recognized: legacy.every(p => known.includes(p)),
  };
}
export function writeCamera(value, patch) {
  const next = { ...readCamera(value), ...patch };
  return [next.framing !== 'Auto' && next.framing, next.elevation, next.viewpoint].filter(Boolean).join(' · ') || 'Auto';
}
export function cameraAtPoint(x, y) {
  const clamp = v => Math.min(1, Math.max(0, v));
  return {
    viewpoint: viewpoints[Math.round(clamp(x) * (viewpoints.length - 1))],
    elevation: elevations[Math.round((1 - clamp(y)) * (elevations.length - 1))],
  };
}
export const cutDescriptions = {
  Auto: 'Let the model choose how this shot follows the previous one.',
  Cut: 'Switch directly to this shot. The action continues from a new view.',
  'Match cut': 'Connect a similar shape, pose or movement across the two shots.',
  'Dissolve intention': 'Ask for a gentle visual blend into this shot.',
  'Continuous action': 'Continue the action without requesting a cut.',
};
