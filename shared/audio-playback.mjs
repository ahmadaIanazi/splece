import { audioGain } from "./studio.mjs";

// The video clock is authoritative. Never seek on every display update.
export class AudioTransport {
  constructor(audio, report = () => {}) {
    this.audio = audio;
    this.report = report;
    this.pending = false;
    this.lastCorrection = -Infinity;
    this.ready = () => this.update(this.state);
    this.started = () => {
      if (this.startSync) {
        this.startSync = false;
        this.needsSeek = true;
        this.update(this.state);
      }
    };
    this.error = () =>
      report(
        "An audio source could not play. Check the file in the audio mixer.",
      );
    audio.addEventListener("canplay", this.ready);
    audio.addEventListener("loadedmetadata", this.ready);
    audio.addEventListener("playing", this.started);
    audio.addEventListener("error", this.error);
  }
  update(state) {
    if (!state || this.destroyed) return;
    const previous = this.state;
    this.state = state;
    const { clip, playing, seekId } = state,
      time = state.readTime ? state.readTime() : state.time,
      a = this.audio;
    const active = time >= clip.start && time < clip.start + clip.duration;
    const position = Math.max(0, clip.in + time - clip.start);
    const explicit =
      !previous ||
      previous.seekId !== seekId ||
      previous.clip.in !== clip.in ||
      previous.clip.start !== clip.start;
    const entering = active && !this.active;
    this.active = active;
    a.volume = Math.min(1, audioGain(clip, time));
    if (explicit || entering || (playing && !previous?.playing)) {
      this.needsSeek = true;
      this.startSync = true;
      this.blocked = false;
    }
    const now = performance.now();
    const drift = Math.abs(a.currentTime - position);
    if (
      active &&
      a.readyState >= 1 &&
      (this.needsSeek ||
        (!a.seeking &&
          a.readyState >= 3 &&
          drift > 0.08 &&
          now - this.lastCorrection > 1500))
    ) {
      if (drift > 0.02) a.currentTime = position;
      this.needsSeek = false;
      this.lastCorrection = now;
    }
    if (!active || !playing || clip.mute) {
      a.pause();
      return;
    }
    if (
      a.paused &&
      !this.pending &&
      !this.blocked &&
      a.readyState >= 2 &&
      !a.error
    ) {
      this.pending = true;
      Promise.resolve(a.play())
        .catch((e) => {
          if (e.name !== "AbortError" && !this.destroyed) {
            this.blocked = true;
            this.report("Audio playback was blocked. Press Play again.");
          }
        })
        .finally(() => {
          this.pending = false;
        });
    }
  }
  destroy() {
    this.destroyed = true;
    this.audio.pause();
    this.audio.removeEventListener("canplay", this.ready);
    this.audio.removeEventListener("loadedmetadata", this.ready);
    this.audio.removeEventListener("playing", this.started);
    this.audio.removeEventListener("error", this.error);
  }
}
