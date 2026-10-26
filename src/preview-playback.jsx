import { useEffect, useRef, useState } from "react";
import { PreviewPlayback } from "../shared/preview-playback.mjs";
import { audioGain } from "../shared/studio.mjs";

export function usePreviewPlayback({
  video,
  clip,
  take,
  time,
  setPlaybackTime,
  playing,
  setPlaying,
  seekId,
  enabled,
  total,
  scope,
}) {
  const [status, setStatus] = useState({ state: "ready", message: "" });
  const callbacks = useRef();
  callbacks.current = { setPlaybackTime, setPlaying };
  const controller = useRef(null);
  if (!controller.current)
    controller.current = new PreviewPlayback({
      onTime: (value) => callbacks.current.setPlaybackTime(value),
      onStop: () => callbacks.current.setPlaying(false),
      onStatus: setStatus,
      requestFrame: (fn) => requestAnimationFrame(fn),
      cancelFrame: (id) => {
        if (id != null) cancelAnimationFrame(id);
      },
      now: () => performance.now(),
    });
  useEffect(() => {
    controller.current.update(video.current, {
      clip,
      take,
      time,
      playing,
      seekId,
      enabled,
      total,
      scope,
      gain: (at) => (clip ? audioGain(clip, at) : 0),
    });
  });
  useEffect(() => () => controller.current.destroy(), []);
  return status;
}
