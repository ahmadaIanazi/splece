// Semantic roles describe image use, never new provider capabilities.
export const referenceRoles = [
  { id: 'identity', label: 'Identity', instruction: 'Use facial identity and defining appearance only. Do not copy wardrobe, background, pose or other people.' },
  { id: 'clothing', label: 'Wardrobe', instruction: 'Use garment design, materials, fit and accessories only for the named subject. Do not copy the clothing model’s identity, body, pose or background. An opening frame’s current clothing state takes priority unless an authored action changes it.' },
  { id: 'location', label: 'Location', instruction: 'Use environment and spatial layout only. Do not import people or their wardrobe.' },
  { id: 'prop', label: 'Prop', instruction: 'Use this object’s appearance only for its named owner or location. Do not duplicate the object or import people or background.' },
  { id: 'pose', label: 'Pose', instruction: 'Use body pose only for the named subject, subject to the authored action and opening state. Do not copy identity, wardrobe or background.' },
  { id: 'palette', label: 'Palette', instruction: 'Borrow color relationships only. Do not copy people, objects, wardrobe, text or scene composition.' },
  { id: 'lighting', label: 'Lighting', instruction: 'Borrow light direction, softness, contrast and color only. Do not copy people, objects, wardrobe, text or scene composition.' },
  { id: 'style', label: 'Visual style', instruction: 'Borrow visual texture and rendering style only. Do not copy people, objects, wardrobe, text or scene composition.' },
];
export function referenceRoleInstruction(binding) {
  const role = referenceRoles.find(r => r.id === binding.role);
  if (!role) return null; // Preserve legacy custom labels.
  const target = binding.targetName ? ` for ${binding.targetName}` : '';
  const label = ['palette', 'lighting', 'style'].includes(role.id) ? `${role.label.toLowerCase()} only${target} (${binding.name})` : `${binding.name} only (${role.label.toLowerCase()}${target})`;
  return `${binding.tag} controls ${label}. ${role.instruction}${binding.contactSheet ? ' A pose grid contains multiple views of the same character, not separate people; do not reproduce the grid.' : ''}${binding.role === 'identity' ? ' Identity does not add this person to the cast: include only the scene’s authored cast. The opening frame controls current wardrobe and prop state.' : ''}`;
}
export function referenceRoleErrors(references) {
  return references.flatMap(r => {
    const media = r.selectedMediaList || (r.selectedMedia ? [r.selectedMedia] : []);
    return media.some(m => m.kind && m.kind !== 'image')
      ? [`${r.name}: video/audio reference transport is not implemented for this image-reference workflow.`] : [];
  });
}
