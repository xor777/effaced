// Small DSP toolkit shared by the instrument generators (offline, pure functions over Float32Arrays).
// Everything random is seeded from 0xEFFACED so builds are bit-reproducible.

export const TAU = Math.PI * 2;
export const SEED = 0xeffaced;

/** mulberry32 → uniform [0, 1) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** deterministic RNG for a named purpose: rng('aah', 3) */
export function rng(...keys: (string | number)[]): () => number {
  let h = SEED ^ 0x9e3779b9;
  for (const k of keys) {
    const s = String(k);
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x85ebca6b);
      h ^= h >>> 13;
    }
    h = Math.imul(h ^ 0xff, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return mulberry32(h);
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const ftom = (f: number) => 69 + 12 * Math.log2(f / 440);
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/**
 * Loop length (samples) holding an integer number of cycles of f, about `sec` seconds long.
 * Returns the exact frequency that loops seamlessly (|error| < 0.5/L relative — far below a cent).
 */
export function periodicLoop(f: number, sr: number, sec: number): { L: number; cycles: number; f: number } {
  const cycles = Math.max(1, Math.round(f * sec));
  const L = Math.round((cycles * sr) / f);
  return { L, cycles, f: (cycles * sr) / L };
}

/** frequency quantized so that it completes an integer number of cycles in L samples */
export const quantizeToLoop = (f: number, sr: number, L: number) => (Math.max(1, Math.round((f * L) / sr)) * sr) / L;

export function peak(a: Float32Array): number {
  let p = 0;
  for (let i = 0; i < a.length; i++) {
    const v = Math.abs(a[i]);
    if (v > p) p = v;
  }
  return p;
}
export function rms(a: Float32Array, from = 0, to = a.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
}
/** scale in place so |peak| = p */
export function normalize(a: Float32Array, p = 0.95): Float32Array {
  const m = peak(a);
  if (m > 0) {
    const g = p / m;
    for (let i = 0; i < a.length; i++) a[i] *= g;
  }
  return a;
}
export function removeDC(a: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  s /= a.length;
  for (let i = 0; i < a.length; i++) a[i] -= s;
  return a;
}
/** raised-cosine fade over n samples at the end (and optional start) */
export function fadeEdges(a: Float32Array, inN: number, outN: number): Float32Array {
  for (let i = 0; i < inN && i < a.length; i++) a[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / inN);
  for (let i = 0; i < outN && i < a.length; i++) a[a.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / outN);
  return a;
}
export function mixInto(dst: Float32Array, src: Float32Array, gain = 1, offset = 0): Float32Array {
  const n = Math.min(src.length, dst.length - offset);
  for (let i = 0; i < n; i++) dst[offset + i] += src[i] * gain;
  return dst;
}
/** soft saturation, |out| < 1 */
export const tanhSat = (x: number) => Math.tanh(x);

/** PolyBLEP residual for a discontinuity at phase 0 (t in [0,1), dt = phase increment) */
export function blep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/**
 * Zero-delay-feedback state-variable filter (Cytomic / A. Simper). Per-sample cutoff allowed.
 * res 0..1 (1 ≈ self-oscillation).
 */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private g = 0;
  private k = 2;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  low = 0;
  band = 0;
  high = 0;
  private sr: number;
  constructor(sr: number) {
    this.sr = sr;
  }
  set(fc: number, res: number): void {
    const f = clamp(fc, 5, this.sr * 0.45);
    this.g = Math.tan((Math.PI * f) / this.sr);
    this.k = 2 - 2 * clamp(res, 0, 0.995);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }
  tick(v0: number): number {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = v0 - this.k * v1 - v2;
    return v2;
  }
}

/** biquad (RBJ cookbook), direct form I with doubles */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  static make(type: 'lp' | 'hp' | 'bp' | 'peak' | 'lowshelf' | 'highshelf', sr: number, f: number, q = Math.SQRT1_2, gainDb = 0): Biquad {
    const b = new Biquad();
    b.design(type, sr, f, q, gainDb);
    return b;
  }
  design(type: 'lp' | 'hp' | 'bp' | 'peak' | 'lowshelf' | 'highshelf', sr: number, f: number, q = Math.SQRT1_2, gainDb = 0): void {
    const w = (TAU * clamp(f, 1, sr * 0.49)) / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const alpha = sw / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    switch (type) {
      case 'lp':
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'hp':
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'bp':
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'peak':
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
        break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s;
        break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s;
        break;
      }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  tick(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  process(a: Float32Array): Float32Array {
    for (let i = 0; i < a.length; i++) a[i] = this.tick(a[i]);
    return a;
  }
  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/** apply a chain of filters in place */
export function filter(a: Float32Array, ...fs: Biquad[]): Float32Array {
  for (const f of fs) f.process(a);
  return a;
}

/** check how seamless a loop [start, start+len) is: max |jump| at the seam relative to the signal's typical step */
export function loopSeam(a: Float32Array, start: number, len: number): number {
  const end = start + len;
  const jump = Math.abs(a[start] - a[end - 1]);
  let typ = 0;
  for (let i = start + 1; i < end; i++) typ = Math.max(typ, Math.abs(a[i] - a[i - 1]));
  return typ > 0 ? jump / typ : 0;
}
