import { supportsSoundReference, validSoundSource } from "./video-sound-continuity.mjs";
import { referenceRoleInstruction, referenceRoleErrors } from "./reference-roles.mjs";
// Explicit mappings from Venice's reference/video guides. Unknown families stay unavailable.
export function referenceCapabilities(id, type) {
  if (/^kling-o3-(pro|standard)-reference-to-video$/.test(id))
    return {
      referenceMode: "elements",
      frames: true,
      endFrame: true,
      maxReferences: 20,
      maxElements: 4,
      maxSceneImages: 4,
    };
  if (id === "grok-imagine-reference-to-video-private")
    return {
      referenceMode: "flat",
      frames: false,
      endFrame: false,
      maxReferences: 7,
    };
  if (/^seedance-2-(0|5)-(fast-)?reference-to-video-basic$/.test(id))
    return {
      referenceMode: "flat",
      frames: false,
      endFrame: false,
      maxReferences: id.startsWith("seedance-2-5") ? 30 : 9,
    };
  if (/^wan-3-0-(?:(?:prime-)?pro-|prime-)?reference-to-video$/.test(id))
    return {
      referenceMode: "flat",
      continuityAsReference: true,
      frames: false,
      endFrame: false,
      maxReferences: 30,
    };
  const image =
    type === "image-to-video" &&
    !/reference|multi-angle|keyframe|transition/.test(id);
  const end =
    image &&
    (/^seedance-2-(0|5)-(fast-)?image-to-video-basic$/.test(id) ||
      /^kling-(?:o3-(?:pro|standard)|v3-(?:pro|standard)|2\.6-pro|2\.5-turbo-pro)-image-to-video$/.test(
        id,
      ));
  if (id === "pixverse-v5.6-transition")
    return {
      referenceMode: "single",
      frames: true,
      endFrame: true,
      requiresEnd: true,
      maxReferences: 1,
    };
  return {
    referenceMode: image ? "single" : "none",
    frames: image,
    endFrame: !!end,
    maxReferences: image ? 1 : 0,
  };
}
export function referenceBindings(references, model) {
  const bindings = [];
  let element = 0,
    image = 0;
  for (const ref of references) {
    const media =
      ref.selectedMediaList || (ref.selectedMedia ? [ref.selectedMedia] : []);
    if (!media.length) continue;
    if (
      model?.referenceMode === "elements" &&
      ["character", "prop"].includes(ref.kind)
    )
      bindings.push({
        tag: `@Element${++element}`,
        assetId: ref.id,
        name: ref.name,
        role: ref.role,
        targetName: ref.targetName,
        kind: ref.kind,
        contactSheet: ref.contactSheets?.some(id => media.some(m => m.id === id)),
        field: "elements",
        media,
      });
    else if (["elements", "flat"].includes(model?.referenceMode))
      for (const m of media)
        bindings.push({
          tag: model.referenceTokenStyle === "xai" ? `<IMAGE_${image++}>` : `${model.referenceLabel || "@Image"}${++image}`,
          assetId: ref.id,
          name: ref.name,
          role: ref.role,
          targetName: ref.targetName,
          kind: ref.kind,
          contactSheet: ref.contactSheets?.includes(m.id),
          continuity: ref.kind === "continuity",
          boundaryKey: ref.boundaryKey,
          field:
            model.referenceMode === "elements"
              ? "scene_image_urls"
              : "reference_image_urls",
          media: [m],
        });
  }
  return bindings;
}
function boundaryInstruction(binding) {
  const closing = binding.boundaryKey === "end";
  const subject = closing
    ? "shows the desired closing state. CLOSING FRAME TARGET:"
    : binding.media[0]?.frameSource?.timelineCapture
      ? "shows the desired opening state. OPENING FRAME TARGET:"
      : "shows the previous clip's final visible moment. OPENING FRAME TARGET:";
  return `${binding.tag} ${subject} ${
    closing
      ? "End the clip on this composition at the final moment. Lead the requested action naturally into this framing, subject placement and visible action state; do not cut away afterward."
      : "Begin the clip on this composition at 0 seconds, matching its framing, subject placement and visible action state. Continue the requested action from that state without an introductory cut or still-image hold. Preserve the opening camera position and direction; character sheets are identity guides, not additional shots."
  } This image controls ${closing ? "closing" : "opening"} layout, environment, lighting and current wardrobe/prop state. Removed clothing stays removed unless an authored action changes it. Separately labeled character images control the identity, face and defining appearance of the named characters. Include only the scene's specified cast, not incidental people from this frame. Render a coherent video, not a collage or slideshow of the references.`;
}
export function bindReferencePrompt(compiled, model) {
  const bindings = referenceBindings(compiled.references, model);
  const lines = bindings.map((b) =>
    b.continuity
      ? boundaryInstruction(b)
      : referenceRoleInstruction(b) || (['palette','lighting','style'].includes(b.role) ? `${b.tag} controls ${b.role} only (${b.name}). ${b.role==='palette' ? 'Borrow color relationships only.' : b.role==='lighting' ? 'Borrow light direction, softness, contrast and color only.' : 'Borrow visual texture and rendering style only.'} Do not copy people, objects, wardrobe, text or scene composition from this style reference.`
      : `${b.tag} controls ${b.name} only (${b.role || "visual reference"}${b.contactSheet ? "; pose grid: multiple views of the same character, not separate people; do not reproduce the grid" : ""}).${b.kind === "character" ? " Use this image for this character's identity, facial features and defining appearance; use the opening frame's current clothing state and the scene's specified action; do not restore garments from this reference sheet. Do not copy its background, layout or other people into the shot." : ""}`),
  );
  const existing = compiled.text
    .split("\n")
    .filter((l) => /^(?:@(Image|Element)\d+|Image \d+)\b/.test(l));
  const missing = lines.filter(
    (line, i) => !existing.some((l) => l.startsWith(bindings[i].tag + " ")),
  );
  return {
    ...compiled,
    bindings,
    text: [
      ...existing,
      ...missing,
      compiled.text
        .split("\n")
        .filter((l) => !existing.includes(l))
        .join("\n"),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
export function referenceErrors(compiled, model) {
  if (!model?.referenceMode) return compiled.soundReferenceError ? [compiled.soundReferenceError] : compiled.soundReference ? ["This model cannot receive the saved sound reference."] : [];
  const issues = referenceRoleErrors(compiled.references),
    bindings = referenceBindings(compiled.references, model),
    start = compiled.boundaries.start,
    end = compiled.boundaries.end;
  if ((start && !model.frames) || (end && (!model.frames || model.endFrame === false))) issues.push("This model cannot accept the selected start or end frame. Remove that frame or choose a frame model.");
  const hasSound = supportsSoundReference(model) && validSoundSource(compiled.soundReference);
  if (compiled.soundReferenceError) issues.push(compiled.soundReferenceError);
  if (compiled.soundReference && !hasSound) issues.push("This model cannot receive the saved sound reference.");
  if (/@Video\s*\d+/i.test(compiled.text) || [...compiled.text.matchAll(/@?Audio\s*(\d+)\b/gi)].some(m => !hasSound || Number(m[1]) !== 1))
    issues.push("Audio/video reference tags are not attached to matching media for this workflow. Audio 1 requires an enabled sound continuity sample on Wan References.");
  const imageCount = compiled.references.reduce(
    (n, r) =>
      n +
      (r.selectedMediaList || (r.selectedMedia ? [r.selectedMedia] : []))
        .length,
    0,
  );
  if (imageCount > (model.maxReferences ?? Infinity))
    issues.push(
      "Too many reference images, including continuity frames, for this model.",
    );
  if (model.referenceMode === "elements") {
    const elements = bindings.filter((b) => b.field === "elements"),
      scenes = bindings.filter((b) => b.field === "scene_image_urls");
    if (elements.length > 4)
      issues.push("Kling O3 supports at most four characters/objects.");
    if (scenes.length > 4)
      issues.push("Kling O3 supports at most four scene images.");
    if (elements.some((b) => b.media.length > 4))
      issues.push(
        "Each character needs one frontal image and at most three additional views.",
      );
    if (!start && !bindings.length)
      issues.push(
        "Attach a character, scene image or start frame for this reference model.",
      );
  }
  if (model.referenceMode === "flat" && !bindings.length && !hasSound)
    issues.push("Attach at least one image reference for this model.");
  if (model.referenceMode === "single") {
    const refs = compiled.references.flatMap(
      (r) => r.selectedMediaList || (r.selectedMedia ? [r.selectedMedia] : []),
    );
    if (!start && !refs.length)
      issues.push("Choose a start frame or one reference image.");
    if (start && refs.length)
      issues.push(
        "This image model accepts a start frame or a reference image, not both. Use Kling O3 reference-to-video to combine characters with frames.",
      );
  }
  if (model.requiresEnd && !end)
    issues.push("This transition model requires an end frame.");
  for (const match of compiled.text.matchAll(/<IMAGE_\d+>|@(Image|Element)(\d+)\b/g))
    if (!bindings.some((b) => b.tag === match[0]))
      issues.push(`${match[0]} has no attached image for this model.`);
  return [...new Set(issues)];
}
