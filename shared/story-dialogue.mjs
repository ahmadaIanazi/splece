// Only unmistakably marked spoken text is extracted. Ordinary quoted prose,
// titles and text on props are not automatically treated as dialogue.
export function suppliedSpokenLines(message = "") {
  const result = [];
  const marker =
    /(?:\bexact (?:spoken line|line|dialogue|introduction|greeting)(?: is)?\s*[:：]|\b(?:says?|speaks?)\s+(?:exactly|verbatim)\s*[:：]?|\bdice exactamente\s*[:：]?|(?:تقول|يقول)\s+بالضبط\s*[:：]?)\s*(?:"([^"\n]+)"|“([^”\n]+)”|「([^」\n]+)」|([^\n]+))/gi;
  for (const match of message.matchAll(marker)) {
    const line = (match[1] || match[2] || match[3] || match[4] || "").trim();
    if (line) result.push(line);
  }
  return [...new Set(result)];
}
export function joinSuppliedDialogue(value, lines) {
  const warnings = [];
  for (const original of lines) {
    const spoken = [...(value.beats || [])]
      .sort((a, b) => a.start - b.start)
      .flatMap((b) => (b.dialogue || []).map((line) => ({ beat: b, line })));
    if (spoken.some((s) => s.line.text === original)) continue;
    let done = false;
    for (let i = 0; i < spoken.length && !done; i++) {
      const parts = [];
      for (let j = i; j < spoken.length; j++) {
        if (spoken[j].line.speaker !== spoken[i].line.speaker) break;
        parts.push(spoken[j].line.text);
        if (
          parts.length > 1 &&
          (parts.join(" ") === original || parts.join("") === original)
        ) {
          spoken[i].line.text = original;
          for (let k = i + 1; k <= j; k++) {
            const { beat, line } = spoken[k];
            beat.dialogue = beat.dialogue.filter((l) => l !== line);
          }
          warnings.push(
            "Kept the supplied spoken line together in its first clip; its exact words and speaker are unchanged.",
          );
          done = true;
          break;
        }
        if (parts.join("").length > original.length) break;
      }
    }
  }
  return warnings;
}
export function assertSuppliedDialogue(proposal, lines) {
  if (!proposal.beats.length) return; // A clarifying reply has not drafted dialogue yet.
  const spoken = proposal.beats.flatMap((b) => b.dialogue || []);
  for (const line of lines)
    if (!spoken.some((l) => l.text === line))
      throw Error(
        "The response changed or omitted a supplied spoken line. Your writing is saved and the plan is unchanged.",
      );
}
