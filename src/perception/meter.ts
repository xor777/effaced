// Timing measurement: rAF frame intervals and the frame → step mapping of the lilac chaser. A "step
// change" is the first frame whose `missing` disc differs from the previous frame — i.e. what actually
// reached the screen, quantised to the display's refresh (120 Hz ProMotion: 0.12 s = 14.4 frames).

export interface Stats {
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
}
export function stats(a: number[]): Stats {
  const n = a.length;
  if (!n) return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN };
  let s = 0, mn = Infinity, mx = -Infinity;
  for (const x of a) (s += x), (mn = Math.min(mn, x)), (mx = Math.max(mx, x));
  const mean = s / n;
  let v = 0;
  for (const x of a) v += (x - mean) ** 2;
  return { n, mean, sd: Math.sqrt(v / n), min: mn, max: mx };
}

export class Meter {
  frameMs: number[] = [];
  stepMs: number[] = [];
  framesPerStep: number[] = [];
  private lastTs = -1;
  private lastMissing = -2;
  private lastChange = -1;
  private framesInStep = 0;

  reset() {
    this.frameMs = [];
    this.stepMs = [];
    this.framesPerStep = [];
    this.lastTs = -1;
    this.lastMissing = -2;
    this.lastChange = -1;
    this.framesInStep = 0;
  }

  frame(ts: number) {
    if (this.lastTs >= 0) {
      this.frameMs.push(ts - this.lastTs);
      if (this.frameMs.length > 20000) this.frameMs.splice(0, 10000);
    }
    this.lastTs = ts;
  }

  /** call once per frame while the chase runs; `missing` = disc index gone in this frame (−1 = none) */
  step(ts: number, missing: number) {
    this.framesInStep++;
    if (missing === this.lastMissing) return;
    if (this.lastChange >= 0 && missing >= 0 && this.lastMissing >= 0) {
      this.stepMs.push(ts - this.lastChange);
      this.framesPerStep.push(this.framesInStep);
    }
    this.framesInStep = 0;
    this.lastChange = ts;
    this.lastMissing = missing;
  }

  hz() {
    const s = stats(this.frameMs.slice(-240));
    return s.n ? 1000 / s.mean : NaN;
  }

  histogram(): string {
    const h = new Map<number, number>();
    for (const f of this.framesPerStep) h.set(f, (h.get(f) ?? 0) + 1);
    return [...h.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}f×${v}`).join(' ');
  }

  summary(): Record<string, number | string> {
    const f = stats(this.frameMs), s = stats(this.stepMs);
    const dropped = this.frameMs.filter((x) => x > f.mean * 1.5).length;
    const r = (x: number) => Math.round(x * 1000) / 1000;
    return {
      frames: f.n, frameMeanMs: r(f.mean), frameSdMs: r(f.sd), frameMaxMs: r(f.max), droppedFrames: dropped,
      steps: s.n, stepMeanMs: r(s.mean), stepSdMs: r(s.sd), stepMinMs: r(s.min), stepMaxMs: r(s.max),
      framesPerStep: this.histogram(),
    };
  }
}
