// Normalize only lossless provider formatting differences. The canonical
// project/import validator remains strict; objects and mixed lists still fail.
export function normalizeStoryResponse(value) {
  const result = structuredClone(value);
  const notes = result?.setup?.minorCharacters;
  if (Array.isArray(notes) && notes.every((entry) => typeof entry === "string"))
    result.setup.minorCharacters = notes.join("\n");
  return result;
}
