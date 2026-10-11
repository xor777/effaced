// The only clock in the demo is the audio clock (PLAN §5.7).
// Song time = the time of the sample currently leaving the speakers. With getOutputTimestamp()
// we get (contextTime, performanceTime) pairs and extrapolate with performance.now(); the result
// is smoothed so frames advance evenly, and snapped on seeks or big drifts.
// Without audio (dev, silent) the clock runs on performance.now().

export class Clock {
  ctx: AudioContext | null = null;
  buffer: AudioBuffer | null = null;
  gain: GainNode | null = null;
  src: AudioBufferSourceNode | null = null;
  playing = false;
  duration: number;
  /** song time at the moment playback (re)started */
  private offset = 0;
  /** context time / performance time at which `offset` was audible */
  private startCtx = 0;
  private startPerf = 0;
  /** smoothed estimate */
  private smooth = 0;
  private lastPerf = 0;
  /** set by seek(); consumed by the frame loop */
  jumped = true;
  loop: [number, number] | null = null;
  rate = 1;

  constructor(duration: number) {
    this.duration = duration;
  }

  attach(ctx: AudioContext, buffer: AudioBuffer | null) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.gain = ctx.createGain();
    this.gain.connect(ctx.destination);
  }

  setBuffer(buffer: AudioBuffer | null) {
    const was = this.playing;
    const t = this.time();
    if (was) this.pause();
    this.buffer = buffer;
    this.offset = t;
    if (was) this.play();
  }

  /** raw (unsmoothed) song time */
  private raw(nowPerf: number): number {
    if (!this.playing) return this.offset;
    if (this.ctx && this.src) {
      const ts = this.ctx.getOutputTimestamp?.();
      if (ts && ts.contextTime !== undefined && ts.performanceTime && ts.contextTime > 0) {
        const ctxNow = ts.contextTime + (nowPerf - ts.performanceTime) / 1000;
        return this.offset + (ctxNow - this.startCtx) * this.rate;
      }
      const lat = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
      return this.offset + (this.ctx.currentTime - lat - this.startCtx) * this.rate;
    }
    return this.offset + ((nowPerf - this.startPerf) / 1000) * this.rate;
  }

  /** smoothed song time for this frame; call once per frame */
  time(): number {
    const now = performance.now();
    const r = this.raw(now);
    if (!this.playing) {
      this.smooth = r;
    } else {
      const pred = this.smooth + ((now - this.lastPerf) / 1000) * this.rate;
      const err = r - pred;
      // snap on big errors (seek, tab switch), otherwise ease towards the audio clock
      this.smooth = Math.abs(err) > 0.05 ? r : pred + err * 0.08;
    }
    this.lastPerf = now;
    if (this.loop && this.playing && this.smooth >= this.loop[1]) {
      this.seek(this.loop[0]);
      return this.loop[0];
    }
    if (this.playing && this.smooth >= this.duration) {
      this.pause();
      this.offset = this.duration;
      this.smooth = this.duration;
    }
    return this.smooth;
  }

  play() {
    if (this.playing) return;
    if (this.offset >= this.duration) this.offset = 0;
    this.playing = true;
    this.startPerf = performance.now();
    if (this.ctx && this.buffer && this.gain) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.playbackRate.value = this.rate;
      src.connect(this.gain);
      // schedule the start ahead of the output latency (~30 ms here) so nothing is dropped; the
      // clock takes t0 from this scheduled time
      this.startCtx = this.ctx.currentTime + 0.08;
      src.start(this.startCtx, Math.max(0, this.offset));
      this.src = src;
    }
    this.smooth = this.offset;
    this.lastPerf = performance.now();
    this.jumped = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.raw(performance.now());
    this.playing = false;
    if (this.src) {
      this.src.stop();
      this.src.disconnect();
      this.src = null;
    }
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(t: number) {
    t = Math.max(0, Math.min(this.duration, t));
    const was = this.playing;
    if (was) this.pause();
    this.offset = t;
    this.smooth = t;
    this.jumped = true;
    if (was) this.play();
  }

  setVolume(v: number) {
    if (this.gain) this.gain.gain.value = v;
  }
}
