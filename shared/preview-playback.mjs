// The video decoder owns playback time. The editor may seek only for an explicit
// transport action, a new source, or a changed trim — never to chase a wall clock.
export class PreviewPlayback {
  constructor({ onTime, onStop, onStatus, requestFrame, cancelFrame, now }) {
    Object.assign(this, {
      onTime,
      onStop,
      onStatus,
      requestFrame,
      cancelFrame,
      now,
    });
    this.cleanups = [];
    this.epoch = 0;
    this.lastPublish = -Infinity;
    this.position = 0;
  }
  status(state, message = "") {
    const key = state + message;
    if (key !== this.statusKey) {
      this.statusKey = key;
      this.onStatus({ state, message });
    }
  }
  update(element, config) {
    const previous = this.config;
    const identity = JSON.stringify([
      config.scope,
      config.clip?.id,
      config.take?.id,
      config.take?.url,
      config.clip?.start,
      config.clip?.in,
      config.clip?.duration,
      config.retry,
    ]);
    const changed = identity !== this.identity || element !== this.element;
    const seek =
      changed ||
      config.seekId !== previous?.seekId ||
      (config.enabled && !previous?.enabled);
    this.config = config;
    if (changed) {
      this.detach();
      this.identity = identity;
      this.element = element;
      this.failed = false;
      this.transitioning = false;
      if (element) this.attach();
      else this.status("ready");
    }
    if (seek) {
      this.transitioning = false;
      this.position = config.time;
      this.pendingSeek = config.clip
        ? Math.max(0, config.clip.in + config.time - config.clip.start)
        : null;
      this.lastNow = this.now();
    }
    if (config.playing && !previous?.playing && this.failed)
      this.failed = false;
    if (
      !config.playing &&
      previous?.playing &&
      !seek &&
      element &&
      config.clip &&
      !element.seeking &&
      element.readyState >= 2
    ) {
      this.publish(
        config.clip.start + Math.max(0, element.currentTime - config.clip.in),
        this.now(),
        true,
      );
    }
    if (!config.playing || !config.enabled) {
      element?.pause();
      this.playRequested = false;
      this.cancelFrame(this.frame);
      this.frame = null;
    }
    this.sync();
    if (config.playing && config.enabled && this.frame == null) {
      this.lastNow = this.now();
      this.frame = this.requestFrame((at) => this.tick(at));
    }
  }
  attach() {
    const el = this.element;
    const listen = (event, fn) => {
      el.addEventListener(event, fn);
      this.cleanups.push(() => el.removeEventListener(event, fn));
    };
    this.status(el.readyState < 2 ? "loading" : "ready");
    listen("loadedmetadata", () => this.sync());
    listen("canplay", () => {
      this.status("ready");
      this.sync();
    });
    listen("playing", () => this.status("ready"));
    listen("waiting", () => this.status("buffering"));
    listen("seeking", () => this.status("seeking"));
    listen("seeked", () => {
      this.status("ready");
      this.sync();
    });
    listen("ended", () => this.finishClip(true));
    listen("error", () =>
      this.fail(
        "This video could not be decoded. Try optimizing its playback copy.",
      ),
    );
  }
  sync() {
    const el = this.element,
      c = this.config;
    if (!el || !c.clip || this.failed) return;
    el.volume = Math.max(0, Math.min(1, c.gain(c.time)));
    if (this.pendingSeek != null && el.readyState >= 1) {
      // A paused playhead at the timeline end should still display the last frame.
      const end = Math.min(
        c.clip.in + c.clip.duration,
        Number.isFinite(el.duration) ? el.duration : Infinity,
      );
      const desired = Math.max(0, Math.min(this.pendingSeek, end - 0.001));
      this.pendingSeek = null;
      if (Math.abs(el.currentTime - desired) > 0.001) el.currentTime = desired;
    }
    if (
      !c.playing ||
      !c.enabled ||
      this.transitioning ||
      this.pendingSeek != null
    )
      return;
    if (!this.playRequested && el.paused) {
      this.playRequested = true;
      const epoch = this.epoch;
      Promise.resolve(el.play()).catch((error) => {
        if (
          epoch !== this.epoch ||
          !this.config.playing ||
          !this.config.enabled
        )
          return;
        this.playRequested = false;
        if (error.name !== "AbortError")
          this.fail(
            "Playback could not start. Press Play to retry, or optimize this clip.",
          );
      });
    }
  }
  publish(time, at, force = false) {
    this.position = Math.max(0, Math.min(this.config.total, time));
    // Keep large prompt/asset trees off the display's 60/120 Hz rendering path.
    if (force || at - this.lastPublish >= 50) {
      this.lastPublish = at;
      this.onTime(this.position);
    }
  }
  tick(at) {
    this.frame = null;
    const c = this.config,
      el = this.element;
    if (!c?.playing || !c.enabled) return;
    const elapsed = Math.max(0, (at - this.lastNow) / 1000);
    this.lastNow = at;
    if (!this.transitioning && !this.failed) {
      if (el && c.clip) {
        // A stalled decoder keeps the cursor still, including while seeking.
        if (this.pendingSeek == null && !el.seeking && el.readyState >= 2) {
          const end = c.clip.in + c.clip.duration;
          if (el.currentTime >= end - 0.003 || el.ended)
            this.finishClip(el.ended);
          else {
            const time = c.clip.start + Math.max(0, el.currentTime - c.clip.in);
            el.volume = Math.max(0, Math.min(1, c.gain(time)));
            this.publish(time, at);
          }
        }
      } else if (!c.clip || !c.take) {
        // Empty slots and audio-only tails have no video clock.
        this.publish(this.position + Math.min(elapsed, 0.1), at);
        if (this.position >= c.total) {
          this.publish(c.total, at, true);
          this.onStop();
        }
      }
    }
    this.frame = this.requestFrame((next) => this.tick(next));
  }
  finishClip(ended = false) {
    const c = this.config,
      el = this.element;
    if (!c?.playing || !c.enabled || this.transitioning || !c.clip) return;
    if (ended && el && el.currentTime < c.clip.in + c.clip.duration - 0.15) {
      this.publish(
        c.clip.start + Math.max(0, el.currentTime - c.clip.in),
        this.now(),
        true,
      );
      this.fail(
        "This take ends before its timeline trim. Shorten the clip or choose a longer take.",
      );
      return;
    }
    this.transitioning = true;
    el?.pause();
    const end = Math.min(c.total, c.clip.start + c.clip.duration);
    this.publish(end, this.now(), true);
    if (end >= c.total) this.onStop();
  }
  fail(message) {
    this.failed = true;
    this.element?.pause();
    this.status("error", message);
    this.onStop();
  }
  detach() {
    this.epoch++;
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.element?.pause();
    this.playRequested = false;
    this.pendingSeek = null;
  }
  destroy() {
    this.cancelFrame(this.frame);
    this.frame = null;
    this.detach();
    this.element = null;
  }
}
