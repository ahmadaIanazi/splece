// Source recipes are display/copy data. Only these reviewed adaptations execute.
export const promptLibraryVersion = '2026-10-24.1';
export const promptCategories = [
  ['portrait-identity', 'Portrait / identity'], ['wardrobe', 'Wardrobe'],
  ['character-sheet', 'Character sheet'], ['location', 'Location'],
  ['cinematic-direction', 'Cinematic direction'], ['music-performance', 'Music / performance'],
].map(([id, label]) => ({ id, label }));
export const promptPresets = [
  { id: 'identity-portrait', title: 'Identity portrait', category: 'portrait-identity', sourceIds: ['face-director'], target: 'image', fields: ['Subject', 'Framing and light'], template: '{{Subject}}\n{{Framing and light}}\nPreserve the subject’s defining features and natural skin detail as described. Background and wardrobe follow the supplied direction.' },
  { id: 'wardrobe-study', title: 'Wardrobe study', category: 'wardrobe', sourceIds: ['character-sheet'], target: 'image', fields: ['Subject', 'Wardrobe'], template: '{{Subject}}\nWardrobe: {{Wardrobe}}\nUse the identity reference for identity and the wardrobe reference for clothing only; do not copy the clothing model’s identity.' },
  { id: 'character-views', title: 'Consistent character views', category: 'character-sheet', sourceIds: ['character-sheet'], target: 'image', fields: ['Subject', 'Wardrobe'], template: 'Character reference sheet: front view, rear view and face close-up of the same subject, not three people.\nIdentity: {{Subject}}\nWardrobe: {{Wardrobe}}\nKeep defining features, proportions and anatomical left/right consistent across views. Use a neutral background. Do not add beauty retouching or remove identity features.' },
  { id: 'location-study', title: 'Location study', category: 'location', sourceIds: ['red-set', 'white-set'], target: 'image', fields: ['Location', 'Light and atmosphere'], template: '{{Location}}\n{{Light and atmosphere}}\nPreserve the described spatial layout. Include only explicitly described people and objects.' },
  { id: 'continuous-action', title: 'Continuous action', category: 'cinematic-direction', sourceIds: ['dutch-angle'], target: 'video', fields: ['Subject and action'], template: '{{Subject and action}}', note: 'Camera direction stays in the existing camera controls. Each entered line keeps its authored timing.' },
  { id: 'performance', title: 'Music performance', category: 'music-performance', sourceIds: ['music-video'], target: 'video', fields: ['Performer and action'], template: '{{Performer and action}}', note: 'Use the separate soundtrack/lip-sync workflow for supplied audio. This preset does not attach or submit audio/video references.' },
];
export function renderPromptPreset(id, fields) {
  const preset = promptPresets.find(p => p.id === id);
  if (!preset) throw Error('Unknown prompt preset.');
  for (const key of preset.fields)
    if (typeof fields[key] !== 'string' || !fields[key].trim() || fields[key].length > 16000) throw Error(`Enter ${key.toLowerCase()} (up to 16000 characters).`);
  return { id, version: promptLibraryVersion, target: preset.target, text: preset.template.replace(/\{\{([^}]+)\}\}/g, (_, key) => fields[key]), sourceIds: [...preset.sourceIds] };
}
// Explicit user application creates a sibling draft; never replaces source writing.
export function applyPromptPreset(project, draftId, presetId, fields, makeId = () => crypto.randomUUID()) {
  const source = project.drafts.find(d => d.id === draftId);
  if (!source) throw Error('Select a prompt first.');
  const rendered = renderPromptPreset(presetId, fields);
  if (rendered.target !== 'video') throw Error('Image presets are copy-only in the video composer.');
  const draft = structuredClone(source);
  draft.id = makeId();
  draft.name = `${source.name || 'Prompt'} · ${promptPresets.find(p => p.id === presetId).title}`;
  draft.closed = false;
  // Additional authored action is placed after existing prose. Dialogue, camera,
  // reference choices, timing controls and all source shots remain untouched.
  const last = draft.scenes.at(-1);
  if (!last) throw Error('Add a shot before using a preset.');
  last.text = [last.text, rendered.text].filter(Boolean).join('\n');
  for (const key of ['smartAccepted', 'smartReviews', 'smartHistory', 'optimizationReceipt', 'sourceGenerationId']) delete draft[key];
  draft.promptPreset = { ...rendered, sourceDraftId: source.id };
  project.drafts.push(draft);
  project.activeDraftId = draft.id;
  return draft;
}
