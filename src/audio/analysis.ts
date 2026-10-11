// Offline analysis helpers (Node + browser): pitch, loudness (approx. LUFS, ITU-R BS.1770 K-weighting
// with gating), true peak (4× oversampled), RMS envelopes.

/** YIN-style f0 estimate of x[from, from+len). Returns Hz (0 if unvoiced). */
export function estimatePitch(x: Float32Array, sr: number, from: number, len: number, fmin = 30, fmax = 4000): number {
  const maxLag = Math.min(Math.floor(sr / fmin), Math.floor(len / 2));
  const minLag = Math.max(2, Math.floor(sr / fmax));
  const W = len - maxLag;
  if (W <= 0) return 0;
  const d = new Float64Array(maxLag + 2);
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const v = x[from + i] - x[from + i + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  // cumulative mean normalized difference
  const cm = new Float64Array(maxLag + 2);
  cm[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    run += d[tau];
    cm[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let best = -1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cm[tau] < 0.15) {
      while (tau + 1 <= maxLag && cm[tau + 1] < cm[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    let mv = Infinity;
    for (let tau = minLag; tau <= maxLag; tau++) if (cm[tau] < mv) (mv = cm[tau]), (best = tau);
    if (mv > 0.5) return 0;
  }
  const a = cm[best - 1], b = cm[best], c = cm[best + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return sr / (best + shift);
}

export const centsOff = (f: number, ref: number) => 1200 * Math.log2(f / ref);

// --- BS.1770 K-weighting (pre-filter shelf + RLB highpass), coefficients re-derived for any sr
function kWeightCoeffs(sr: number): number[][] {
  // stage 1: high shelf (+4 dB @ ~1.5 kHz)
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const s1 = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  // stage 2: RLB highpass ~38 Hz
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sr);
  const a01 = 1 + K1 / Q1 + K1 * K1;
  const s2 = [1, -2, 1, (2 * (K1 * K1 - 1)) / a01, (1 - K1 / Q1 + K1 * K1) / a01];
  return [s1, s2];
}
function kFilter(x: Float32Array, sr: number): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i];
  for (const [b0, b1, b2, a1, a2] of kWeightCoeffs(sr)) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const v = out[i];
      const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      out[i] = y;
    }
  }
  return out;
}

/** mean-square of K-weighted stereo per 100 ms hop (400 ms blocks are built from 4 hops) */
function kHops(l: Float32Array, r: Float32Array, sr: number): Float64Array {
  const kl = kFilter(l, sr), kr = kFilter(r, sr);
  const hop = Math.round(sr * 0.1);
  const n = Math.floor(l.length / hop);
  const ms = new Float64Array(n);
  for (let h = 0; h < n; h++) {
    let s = 0;
    for (let i = h * hop; i < (h + 1) * hop; i++) s += kl[i] * kl[i] + kr[i] * kr[i];
    ms[h] = s / hop;
  }
  return ms;
}
const lufsOf = (ms: number) => -0.691 + 10 * Math.log10(Math.max(ms, 1e-12));

export interface Loudness {
  /** integrated loudness (gated), LUFS */
  integrated: number;
  /** short-term (3 s) loudness max */
  shortTermMax: number;
  /** momentary (400 ms) loudness per 100 ms hop */
  momentary: Float32Array;
}

/** ITU-R BS.1770-4 integrated loudness with absolute (−70) and relative (−10 LU) gates. */
export function loudness(l: Float32Array, r: Float32Array, sr: number): Loudness {
  const hops = kHops(l, r, sr);
  const blocks: number[] = [];
  const momentary = new Float32Array(hops.length);
  for (let h = 0; h < hops.length; h++) {
    const a = Math.max(0, h - 3);
    let s = 0;
    for (let k = a; k <= h; k++) s += hops[k];
    const ms = s / (h - a + 1);
    momentary[h] = lufsOf(ms);
    if (h >= 3) blocks.push(ms);
  }
  const abs = blocks.filter((m) => lufsOf(m) > -70);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const rel = lufsOf(mean(abs)) - 10;
  const gated = abs.filter((m) => lufsOf(m) > rel);
  let st = -Infinity;
  for (let h = 29; h < hops.length; h++) {
    let s = 0;
    for (let k = h - 29; k <= h; k++) s += hops[k];
    st = Math.max(st, lufsOf(s / 30));
  }
  return { integrated: gated.length ? lufsOf(mean(gated)) : -Infinity, shortTermMax: st, momentary };
}

/** loudness (LUFS, ungated mean square) of a time range */
export function rangeLoudness(l: Float32Array, r: Float32Array, sr: number, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from)), b = Math.min(l.length, Math.floor(to));
  if (b - a < sr * 0.4) return -Infinity;
  const kl = kFilter(l.subarray(a, b), sr), kr = kFilter(r.subarray(a, b), sr);
  let s = 0;
  for (let i = 0; i < kl.length; i++) s += kl[i] * kl[i] + kr[i] * kr[i];
  return lufsOf(s / kl.length);
}

/** 4× oversampled true peak (dBTP) of one channel — windowed-sinc interpolation */
export function truePeak(x: Float32Array): number {
  const taps = 12;
  const OS = 4;
  const h: number[][] = [];
  for (let p = 1; p < OS; p++) {
    const frac = p / OS;
    const row: number[] = [];
    for (let k = -taps + 1; k <= taps; k++) {
      const t = k - frac;
      const sinc = Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / taps);
      row.push(sinc * w);
    }
    h.push(row);
  }
  let pk = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > pk) pk = v;
  }
  // only examine the neighbourhood of loud samples (fast)
  const thr = pk * 0.5;
  for (let i = taps; i < x.length - taps; i++) {
    if (Math.abs(x[i]) < thr && Math.abs(x[i + 1]) < thr) continue;
    for (const row of h) {
      let s = 0;
      for (let k = 0; k < row.length; k++) s += row[k] * x[i - taps + 1 + k];
      const v = Math.abs(s);
      if (v > pk) pk = v;
    }
  }
  return 20 * Math.log10(Math.max(pk, 1e-12));
}

/** RMS envelope at `rate` Hz of (l, r) (r optional), scaled so a full-scale sine reads ≈ 1 */
export function rmsEnvelope(l: Float32Array, r: Float32Array | null, sr: number, rate: number, frames?: number): Float32Array {
  const n = frames ?? Math.ceil((l.length * rate) / sr);
  const env = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const a = Math.floor((f * sr) / rate), b = Math.min(l.length, Math.floor(((f + 1) * sr) / rate));
    if (b <= a) break;
    let s = 0;
    if (r) for (let i = a; i < b; i++) s += 0.5 * (l[i] * l[i] + r[i] * r[i]);
    else for (let i = a; i < b; i++) s += l[i] * l[i];
    env[f] = Math.sqrt((2 * s) / (b - a));
  }
  return env;
}
