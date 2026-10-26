// Compare saved media at its own trim, never change the timeline selection.
export function comparisonChoices(project) {
  return project.clips.flatMap((clip) =>
    clip.takes
      .filter((t) => t.url)
      .map((take, i) => {
        const edit =
          take.id === clip.activeTake
            ? clip
            : clip.takeEdits?.[take.id] || {
                in: take.sourceIn || 0,
                duration: take.duration || clip.duration,
              };
        const audio = project.audioClips?.find(
          (a) => a.id === take.lipSync?.audioId,
        );
        return {
          key: clip.id + ":" + take.id,
          clipId: clip.id,
          takeId: take.id,
          mediaId: take.id,
          label:
            (project.drafts.find((d) => d.targetId === clip.id || d.id === clip.draftId)?.name ||
              take.name ||
              "Clip") + ` · Take ${i + 1}`,
          thumbnail: take.thumbnail,
          in: Math.max(0, edit.in || 0),
          duration: edit.duration || clip.duration,
          voice: audio
            ? { mediaId: audio.mediaId, in: (audio.in || 0) + (edit.in || 0) }
            : null,
        };
      }),
  );
}
