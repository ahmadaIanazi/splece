import React from "react";
import {
  characterVoice,
  dialogueVoices,
} from "../shared/soundtrack-dialogue.mjs";
export function VoiceChoice({
  project,
  asset,
  value,
  onChange,
  disabled = false,
  allowDefault = false,
}) {
  const resolved =
    value || characterVoice({ ...project, production: {} }, asset);
  let sample;
  for (const audio of [...(project?.audioClips || [])].reverse()) {
    try {
      const lines = JSON.parse(audio.soundtrack?.scriptSignature || "[]");
      const index = lines.findIndex(
        (line) => line.speaker === asset.id && line.providerVoice === resolved,
      );
      if (index < 0) continue;
      const timing = audio.soundtrack?.lineTimings?.[index] || lines[index];
      sample = {
        url:
          audio.url || (audio.mediaId ? `/api/media/${audio.mediaId}` : null),
        start: timing.start || 0,
        end:
          (timing.start || 0) +
          (timing.duration || audio.sourceDuration || audio.duration),
      };
      break;
    } catch {}
  }
  return (
    <div className="voice-choice">
      <label>
        {asset.name || "Character"}
        <select
          aria-label={`${asset.name || "Character"} voice`}
          value={value || ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">
            {allowDefault ? "Character default" : "Automatic"} ·{" "}
            {characterVoice({ ...project, production: {} }, asset)}
          </option>
          {dialogueVoices.map((voice) => (
            <option key={voice}>{voice}</option>
          ))}
        </select>
      </label>
      <small>
        {allowDefault
          ? value
            ? "Project override · character default is unchanged"
            : "Following character default"
          : value
            ? "Character default · used unless a project chooses another voice"
            : "Automatic voice · choose a voice to make the default explicit"}
      </small>
      {sample?.url ? (
        <>
          <small>Recorded line from this project</small>
          <audio
            key={`${sample.url}:${sample.start}`}
            controls
            preload="metadata"
            src={sample.url}
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = sample.start;
            }}
            onPlay={(e) => {
              if (
                e.currentTarget.currentTime < sample.start ||
                e.currentTarget.currentTime >= sample.end
              )
                e.currentTarget.currentTime = sample.start;
            }}
            onTimeUpdate={(e) => {
              if (e.currentTarget.currentTime >= sample.end)
                e.currentTarget.pause();
            }}
            aria-label={`${asset.name} voice preview`}
          />
        </>
      ) : (
        <small>Generate a spoken line to listen to this voice here.</small>
      )}
    </div>
  );
}
