// Offline DSP for the sampled instrument bank (node-only, tools/build-instruments.ts):
// windowed-sinc resampling, precise pitch, onset trimming, envelope flattening, crossfade loops,
// K-weighted loudness of mono samples, loop/seam metrics. Pure functions over Float32Arrays.

import { readWav } from '../wav.ts';
import { estimatePitch } from '../../src/audio/analysis.ts';
import { Biquad } from '../../src/audio/synth/util.ts';

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const ftom = (f: number) => 69 + 12 * Math.log2(f / 440);
export const db = (x: number) => 20 * Math.log10(Math.max(1e-12, x));
export const fromDb = (d: number) => Math.pow(10, d / 20);

// ---------------------------------------------------------------------------------------------
// I/O

export interface Src {
  data: Float32Array;
  sr: number;
  /** L/R correlation of the source (1 = mono-compatible), NaN for mono files */
  corr: number;
  path: string;
}

/**
 * Read a WAV as mono. Stereo files are summed (L+R)/2 — the tracker plays mono samples, so the
 * library's stereo image collapses the way it would on a 90s sample CD. Spaced pairs whose
 * channels are anti-correlated (corr < −0.1: the sum would comb-filter / thin the bass) use the
 * louder channel alone instead.
 */
export function readMono(path: string): Src {
  const w = readWav(path);
  const ch = w.channels;
  if (ch.length === 1) return { data: ch[0], sr: w.sampleRate, corr: NaN, path };
  const n = ch[0].length, out = new Float32Array(n);
  let sl = 0, sr2 = 0, slr = 0;
  for (let i = 0; i < n; i++) {
    const l = ch[0][i], r = ch[1][i];
    out[i] = 0.5 * (l + r);
    sl += l * l;
    sr2 += r * r;
    slr += l * r;
  }
  const corr = slr / Math.sqrt(sl * sr2 + 1e-30);
  if (corr < -0.1) return { data: (sl >= sr2 ? ch[0] : ch[1]).slice(), sr: w.sampleRate, corr, path };
  return { data: out, sr: w.sampleRate, corr, path };
}

// ---------------------------------------------------------------------------------------------
// resampling: Kaiser-windowed sinc, table-driven

const ZC = 48; // zero crossings per side
const PHASES = 1024;
let kernel: Float64Array | null = null;
function besselI0(x: number): number {
  let s = 1, t = 1;
  for (let k = 1; k < 40; k++) {
    t *= (x / (2 * k)) ** 2;
    s += t;
    if (t < 1e-12 * s) break;
  }
  return s;
}
function getKernel(): Float64Array {
  if (kernel) return kernel;
  const beta = 9.5;
  const n = ZC * PHASES;
  kernel = new Float64Array(n + 2);
  const i0b = besselI0(beta);
  for (let i = 0; i <= n + 1; i++) {
    const t = i / PHASES; // in zero crossings
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const u = t / ZC;
    const w = u >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - u * u)) / i0b;
    kernel[i] = sinc * w;
  }
  return kernel;
}

/**
 * Resample by `ratio` output samples per input sample (ratio > 1 = longer = lower pitch when played
 * at the same rate). Band-limited to 0.97 · min(1, ratio) of the input Nyquist (anti-aliasing when
 * shrinking). Kaiser β = 9.5, 48 zero crossings per side: stopband ≈ −95 dB.
 */
export function resample(x: Float32Array, ratio: number, outLen = Math.floor(x.length * ratio)): Float32Array {
  const k = getKernel();
  const fc = Math.min(1, ratio) * 0.97; // cutoff relative to the input Nyquist
  const out = new Float32Array(outLen);
  const half = ZC / fc; // kernel half-width in input samples
  const step = fc * PHASES; // table index per input sample of distance
  const n = x.length;
  for (let j = 0; j < outLen; j++) {
    const t = j / ratio;
    const i0 = Math.ceil(t - half), i1 = Math.floor(t + half);
    let s = 0;
    for (let i = Math.max(0, i0); i <= i1 && i < n; i++) {
      const d = Math.abs(t - i) * step;
      const di = Math.floor(d);
      if (di >= ZC * PHASES) continue;
      const fr = d - di;
      s += x[i] * (k[di] + (k[di + 1] - k[di]) * fr);
    }
    out[j] = s * fc;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// envelopes, onsets

/** RMS envelope with a window of `win` seconds, one value per `hop` samples */
export function rmsEnv(x: Float32Array, sr: number, win = 0.02, hop = 64): Float32Array {
  const w = Math.max(1, Math.round(win * sr));
  const n = Math.ceil(x.length / hop);
  const out = new Float32Array(n);
  // prefix sums of squares
  const ps = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) ps[i + 1] = ps[i] + x[i] * x[i];
  for (let k = 0; k < n; k++) {
    const c = k * hop;
    const a = Math.max(0, c - (w >> 1)), b = Math.min(x.length, c + (w >> 1) + 1);
    out[k] = Math.sqrt((ps[b] - ps[a]) / Math.max(1, b - a));
  }
  return out;
}

export function peakAbs(x: Float32Array, from = 0, to = x.length): number {
  let p = 0;
  for (let i = from; i < to; i++) {
    const v = Math.abs(x[i]);
    if (v > p) p = v;
  }
  return p;
}

/**
 * Onset: first sample whose |x| exceeds `thrDb` below the peak, then walk back to where the local
 * envelope falls below the noise floor (≤ `maxBack` s), so the attack is kept whole.
 */
export function onset(x: Float32Array, sr: number, thrDb = -30, maxBack = 0.004): number {
  const pk = peakAbs(x);
  const thr = pk * fromDb(thrDb);
  let i = 0;
  while (i < x.length && Math.abs(x[i]) < thr) i++;
  // walk back while the signal still rises out of the floor (−55 dB re peak)
  const floor = pk * fromDb(-55);
  const lim = Math.max(0, i - Math.round(maxBack * sr));
  let j = i;
  while (j > lim && Math.abs(x[j - 1]) > floor) j--;
  return j;
}

/** copy [from, to) with a raised-cosine fade-in of `fin` samples and fade-out of `fout` samples */
export function cut(x: Float32Array, from: number, to: number, fin = 0, fout = 0): Float32Array {
  const a = Math.max(0, from), b = Math.min(x.length, to);
  const out = x.slice(a, b);
  for (let i = 0; i < fin && i < out.length; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fin);
  for (let i = 0; i < fout && i < out.length; i++) out[out.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fout);
  return out;
}

export function removeDC(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i];
  s /= Math.max(1, to - from);
  for (let i = 0; i < x.length; i++) x[i] -= s;
  return s;
}

/** DC-blocking highpass (one-pole/zero), in place */
export function dcBlock(x: Float32Array, sr: number, fc = 12): Float32Array {
  const R = Math.exp((-2 * Math.PI * fc) / sr);
  let x1 = 0, y1 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = x[i] - x1 + R * y1;
    x1 = x[i];
    y1 = y;
    x[i] = y;
  }
  return x;
}

export function gain(x: Float32Array, g: number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

/** mix src·g into dst at offset (dst grows if needed — returns the result) */
export function mixAt(dst: Float32Array, src: Float32Array, g = 1, offset = 0): Float32Array {
  let out = dst;
  if (offset + src.length > dst.length) {
    out = new Float32Array(offset + src.length);
    out.set(dst);
  }
  for (let i = 0; i < src.length; i++) out[offset + i] += src[i] * g;
  return out;
}

/** apply a biquad chain in place (zero-phase if `zeroPhase`: forward + backward) */
export function biquad(x: Float32Array, sr: number, type: Parameters<typeof Biquad.make>[0], f: number, q = Math.SQRT1_2, gainDb = 0, zeroPhase = false): Float32Array {
  Biquad.make(type, sr, f, q, gainDb).process(x);
  if (zeroPhase) {
    x.reverse();
    Biquad.make(type, sr, f, q, gainDb).process(x);
    x.reverse();
  }
  return x;
}

/** exponential decay envelope applied from `from` (s) with T60 `t60` (s); 1 before */
export function decayFrom(x: Float32Array, sr: number, from: number, t60: number): Float32Array {
  const a = Math.round(from * sr);
  const k = Math.exp(-6.9078 / (t60 * sr));
  let g = 1;
  for (let i = a; i < x.length; i++) {
    x[i] *= g;
    g *= k;
  }
  return x;
}

// ---------------------------------------------------------------------------------------------
// pitch

/**
 * Median f0 over a range (YIN windows of `win` s every `hop` s), restricted to fmin..fmax, plus the
 * spread (IQR in cents) as a stability measure.
 */
export function pitchOf(x: Float32Array, sr: number, from: number, to: number, fmin: number, fmax: number, win = 0.08, hop = 0.03): { f: number; iqr: number; n: number } {
  const W = Math.round(win * sr);
  const fs: number[] = [];
  for (let a = Math.round(from * sr); a + W < Math.min(x.length, Math.round(to * sr)); a += Math.round(hop * sr)) {
    const f = estimatePitch(x, sr, a, W, fmin, fmax);
    if (f > 0) fs.push(f);
  }
  if (!fs.length) return { f: 0, iqr: Infinity, n: 0 };
  fs.sort((a, b) => a - b);
  const med = fs[fs.length >> 1];
  const q1 = fs[Math.floor(fs.length * 0.25)], q3 = fs[Math.floor(fs.length * 0.75)];
  return { f: med, iqr: 1200 * Math.log2(q3 / q1), n: fs.length };
}

/**
 * Precise pitch from the spectrum: harmonic-sum over a Hann-windowed FFT of a long stable range,
 * searched ±60 cents around `near` (Hz). Robust for ensembles (vibrato averages out) and for
 * inharmonic one-shots if `harmonics` = 1 (strongest partial near `near`).
 */
export function spectralPitch(x: Float32Array, sr: number, from: number, to: number, near: number, harmonics = 6, spanCents = 60): number {
  const a = Math.round(from * sr), b = Math.min(x.length, Math.round(to * sr));
  const N = b - a;
  if (N < 1024) return near;
  // Goertzel-style evaluation of |X(f)| on a fine grid (no FFT size constraints)
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = x[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const mag = (f: number) => {
    const c = Math.cos((2 * Math.PI * f) / sr), s = Math.sin((2 * Math.PI * f) / sr);
    // rotate a phasor
    let re = 0, im = 0, pr = 1, pi = 0;
    for (let i = 0; i < N; i++) {
      re += w[i] * pr;
      im += w[i] * pi;
      const nr = pr * c - pi * s;
      pi = pr * s + pi * c;
      pr = nr;
    }
    return Math.hypot(re, im);
  };
  const score = (f: number) => {
    let s = 0;
    for (let h = 1; h <= harmonics; h++) if (f * h < sr * 0.45) s += Math.log(1e-9 + mag(f * h)) * (h === 1 ? 1.5 : 1);
    return s;
  };
  let best = near, bs = -Infinity;
  for (let c = -spanCents; c <= spanCents; c += 4) {
    const f = near * Math.pow(2, c / 1200);
    const v = score(f);
    if (v > bs) (bs = v), (best = f);
  }
  // refine ±4 cents in 0.5 cent steps
  let fine = best;
  for (let c = -4; c <= 4; c += 0.5) {
    const f = best * Math.pow(2, c / 1200);
    const v = score(f);
    if (v > bs) (bs = v), (fine = f);
  }
  return fine;
}

// ---------------------------------------------------------------------------------------------
// loudness (BS.1770 K-weighting, mono)

function kCoeffs(sr: number): number[][] {
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const s1 = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sr);
  const a01 = 1 + K1 / Q1 + K1 * K1;
  const s2 = [1, -2, 1, (2 * (K1 * K1 - 1)) / a01, (1 - K1 / Q1 + K1 * K1) / a01];
  return [s1, s2];
}
export function kWeight(x: Float32Array, sr: number): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i];
  for (const [b0, b1, b2, a1, a2] of kCoeffs(sr)) {
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
const lufs = (ms: number) => -0.691 + 10 * Math.log10(Math.max(ms, 1e-12));

/** momentary (400 ms) K-weighted loudness max of a mono signal, LUFS (mono, one channel) */
export function momentaryMax(x: Float32Array, sr: number): number {
  const k = kWeight(x, sr);
  const W = Math.round(0.4 * sr), hop = Math.round(0.02 * sr);
  const ps = new Float64Array(k.length + 1);
  for (let i = 0; i < k.length; i++) ps[i + 1] = ps[i] + k[i] * k[i];
  let best = 0;
  for (let a = 0; a < Math.max(1, k.length - W + 1); a += hop) {
    const b = Math.min(k.length, a + W);
    best = Math.max(best, (ps[b] - ps[a]) / W);
  }
  return lufs(best);
}
/** K-weighted loudness of a range (s), LUFS */
export function rangeLufs(x: Float32Array, sr: number, from: number, to: number): number {
  const a = Math.max(0, Math.round(from * sr)), b = Math.min(x.length, Math.round(to * sr));
  const k = kWeight(x.subarray(Math.max(0, a - Math.round(0.2 * sr)), b), sr);
  const off = a - Math.max(0, a - Math.round(0.2 * sr));
  let s = 0;
  for (let i = off; i < k.length; i++) s += k[i] * k[i];
  return lufs(s / Math.max(1, k.length - off));
}

// ---------------------------------------------------------------------------------------------
// spectrum helpers

/** magnitude spectrum (dB) of a Hann window of 2^p samples at `from`, on `bands` log bands 50 Hz..16 kHz */
export function bandSpectrum(x: Float32Array, sr: number, from: number, n = 4096, bands = 32): Float64Array {
  const N = n;
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = (x[from + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const out = new Float64Array(bands);
  const cnt = new Float64Array(bands);
  const lo = Math.log(50), hi = Math.log(16000);
  // plain DFT on bins (N/2) — fast enough for a few windows
  const re = new Float64Array(N / 2), im = new Float64Array(N / 2);
  for (let kk = 1; kk < N / 2; kk++) {
    const f = (kk * sr) / N;
    if (f < 50 || f > 16000) continue;
    const c = Math.cos((2 * Math.PI * kk) / N), s = Math.sin((2 * Math.PI * kk) / N);
    let pr = 1, pi = 0, r = 0, ii = 0;
    for (let i = 0; i < N; i++) {
      r += w[i] * pr;
      ii += w[i] * pi;
      const nr = pr * c - pi * s;
      pi = pr * s + pi * c;
      pr = nr;
    }
    re[kk] = r;
    im[kk] = ii;
    const b = Math.min(bands - 1, Math.floor(((Math.log(f) - lo) / (hi - lo)) * bands));
    out[b] += r * r + ii * ii;
    cnt[b]++;
  }
  for (let b = 0; b < bands; b++) out[b] = 10 * Math.log10(1e-12 + out[b] / Math.max(1, cnt[b]));
  return out;
}

/** spectral centroid (Hz) of a range via the band spectrum */
export function centroid(x: Float32Array, sr: number, from: number, n = 4096): number {
  const N = n;
  let num = 0, den = 0;
  for (let kk = 1; kk < N / 2; kk += 1) {
    const f = (kk * sr) / N;
    if (f > 12000) break;
    const c = Math.cos((2 * Math.PI * kk) / N), s = Math.sin((2 * Math.PI * kk) / N);
    let pr = 1, pi = 0, r = 0, ii = 0;
    for (let i = 0; i < N; i++) {
      const v = (x[from + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      r += v * pr;
      ii += v * pi;
      const nr = pr * c - pi * s;
      pi = pr * s + pi * c;
      pr = nr;
    }
    const p = r * r + ii * ii;
    num += p * f;
    den += p;
  }
  return num / Math.max(1e-30, den);
}

// ---------------------------------------------------------------------------------------------
// loops

/**
 * Flatten the slow amplitude envelope of x over [from, to) (samples): divide by a heavily smoothed
 * RMS envelope (window `win` s) normalised to its value at `from`, blending in over `ramp` s, so the
 * sustain is stationary and a loop doesn't pump. Returns a new array (x is not modified).
 */
export function flatten(x: Float32Array, sr: number, from: number, to: number, win = 0.25, ramp = 0.15): Float32Array {
  const hop = 64;
  const env = rmsEnv(x, sr, win, hop);
  // smooth again (moving average over win)
  const m = Math.max(1, Math.round((win * sr) / hop));
  const sm = new Float32Array(env.length);
  let acc = 0;
  for (let i = 0; i < env.length; i++) {
    acc += env[i];
    if (i >= m) acc -= env[i - m];
    sm[Math.max(0, i - (m >> 1))] = acc / Math.min(i + 1, m);
  }
  for (let i = Math.max(0, env.length - (m >> 1)); i < env.length; i++) sm[i] = sm[Math.max(0, env.length - (m >> 1) - 1)];
  const ref = sm[Math.min(sm.length - 1, Math.floor(from / hop))] || 1e-9;
  const out = x.slice();
  const R = Math.max(1, Math.round(ramp * sr));
  for (let i = from; i < Math.min(to, x.length); i++) {
    const k = i / hop, k0 = Math.floor(k), fr = k - k0;
    const e = (sm[k0] ?? sm[sm.length - 1]) * (1 - fr) + (sm[k0 + 1] ?? sm[sm.length - 1]) * fr;
    const g = ref / Math.max(e, ref * 0.05);
    const blend = Math.min(1, (i - from) / R);
    out[i] = x[i] * (1 + (g - 1) * blend);
  }
  // after `to`: keep the gain reached at `to`
  if (to < x.length) {
    const k = Math.min(sm.length - 1, Math.floor(to / hop));
    const g = ref / Math.max(sm[k], ref * 0.05);
    for (let i = to; i < x.length; i++) out[i] = x[i] * g;
  }
  return out;
}

/** normalised cross-correlation of x[a..a+n) and x[b..b+n) */
export function ncc(x: Float32Array, a: number, b: number, n: number): number {
  let s = 0, ea = 0, eb = 0;
  for (let i = 0; i < n; i++) {
    const u = x[a + i], v = x[b + i];
    s += u * v;
    ea += u * u;
    eb += v * v;
  }
  return s / Math.sqrt(ea * eb + 1e-30);
}

export interface LoopResult {
  data: Float32Array; // truncated at the loop end
  loopStart: number;
  loopLength: number;
  /** correlation of the matched regions (1 = identical) */
  corr: number;
  xfade: number; // samples
}

/**
 * Crossfade loop. Picks the loop end e in [endLo, endHi] whose neighbourhood best matches the
 * neighbourhood of the loop start s (normalised cross-correlation over `matchWin` s, evaluated at
 * every sample of a ±period window, coarse-to-fine), then crossfades the `xfade` s before e with
 * the `xfade` s before s, so playback runs …x[e−1] → x[s] seamlessly. The fade curve morphs from
 * linear (correlated material) to equal-power (uncorrelated ensembles) by the measured correlation.
 */
export function crossfadeLoop(x: Float32Array, sr: number, s: number, endLo: number, endHi: number, period: number, xfadeSec: number, matchWin = 0.03): LoopResult {
  const X = Math.min(Math.round(xfadeSec * sr), s);
  const M = Math.max(64, Math.round(matchWin * sr));
  endHi = Math.min(endHi, x.length - 1);
  // the region that will follow the seam is x[s .. s+M); the region that precedes it after the
  // crossfade is x[s−M .. s) (because the fade ends on the material before s). We want x near e to
  // resemble x near s so the fade blends similar waveforms: compare x[e−M..e+M) with x[s−M..s+M).
  let best = endLo, bc = -Infinity;
  const coarse = Math.max(1, Math.round(period / 8));
  for (let e = endLo; e <= endHi; e += coarse) {
    const c = ncc(x, s - M, e - M, 2 * M);
    if (c > bc) (bc = c), (best = e);
  }
  for (let e = Math.max(endLo, best - coarse); e <= Math.min(endHi, best + coarse); e++) {
    const c = ncc(x, s - M, e - M, 2 * M);
    if (c > bc) (bc = c), (best = e);
  }
  const e = best;
  const out = x.slice(0, e);
  // correlation of the two crossfaded regions decides the curve
  const cx = Math.max(0, Math.min(1, ncc(x, e - X, s - X, X)));
  for (let i = 0; i < X; i++) {
    const t = (i + 0.5) / X;
    // linear (sum = 1) for correlated, equal-power (sum of squares = 1) for uncorrelated
    const lin = t, ep = Math.sin((t * Math.PI) / 2);
    const epOut = Math.cos((t * Math.PI) / 2);
    const gin = cx * lin + (1 - cx) * ep;
    const gout = cx * (1 - t) + (1 - cx) * epOut;
    out[e - X + i] = x[e - X + i] * gout + x[s - X + i] * gin;
  }
  return { data: out, loopStart: s, loopLength: e - s, corr: bc, xfade: X };
}

/**
 * Seam metrics of a forward loop [s, s+len): the playback stream wraps from x[s+len−1] to x[s].
 *  step     |x[s] − linear prediction from the two samples before the seam| / mean |2nd difference|
 *  levelDb  level jump across the seam (RMS of 50 ms before vs after, dB)
 *  specDb   RMS log-spectral distance (24 bands) between 2048-sample windows before / after the seam
 *  levelRef, specRef — the largest of the same two statistics at 64 positions inside the loop: a
 *  seam is inaudible when it is no worse than the material's own moment-to-moment variation.
 */
export function seamMetrics(x: Float32Array, sr: number, s: number, len: number): { step: number; levelDb: number; specDb: number; levelRef: number; specRef: number } {
  const e = s + len;
  const pred = 2 * x[e - 1] - x[e - 2];
  let d2 = 0;
  for (let i = s + 2; i < e; i++) d2 += Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]);
  d2 /= e - s - 2;
  const step = Math.abs(x[s] - pred) / Math.max(1e-9, d2);
  // the looped stream: index k ≥ 0 → x[s + (k mod len)], negative k → x[e + k] (just before the seam)
  const at = (k: number) => (k < 0 ? x[e + k] : x[s + (k % len)]);
  const W = Math.min(Math.round(0.05 * sr), len >> 3), N = Math.min(2048, 1 << Math.floor(Math.log2(len / 2)));
  const stats = (c: number) => {
    let a = 0, b = 0;
    for (let i = 0; i < W; i++) (a += at(c - W + i) ** 2), (b += at(c + i) ** 2);
    const lv = Math.abs(10 * Math.log10((a + 1e-20) / (b + 1e-20)));
    const A = new Float32Array(N), B = new Float32Array(N);
    for (let i = 0; i < N; i++) (A[i] = at(c - N + i)), (B[i] = at(c + i));
    const SA = bandSpectrum(A, sr, 0, N, 24), SB = bandSpectrum(B, sr, 0, N, 24);
    let sd = 0, nb = 0;
    for (let k = 0; k < 24; k++) if (SA[k] > -90 && SB[k] > -90) (sd += (SA[k] - SB[k]) ** 2), nb++;
    return { lv, sp: Math.sqrt(sd / Math.max(1, nb)) };
  };
  const seam = stats(0);
  const lvs: number[] = [], sps: number[] = [];
  for (let k = 1; k <= 64; k++) {
    const c = Math.round((k / 65) * len);
    if (c < N || c + N > len) continue; // both windows inside the loop (not across the seam)
    const st = stats(c);
    lvs.push(st.lv);
    sps.push(st.sp);
  }
  return { step, levelDb: seam.lv, specDb: seam.sp, levelRef: Math.max(0, ...lvs), specRef: Math.max(0, ...sps) };
}

/** time (s) from the onset until the RMS envelope first reaches `toDb` below its max over [0, within) */
export function attackTime(x: Float32Array, sr: number, toDb = -3, within = 1.5): number {
  const hop = 32;
  const env = rmsEnv(x.subarray(0, Math.min(x.length, Math.round(within * sr))), sr, 0.01, hop);
  let mx = 0;
  for (const v of env) mx = Math.max(mx, v);
  const thr = mx * fromDb(toDb);
  for (let k = 0; k < env.length; k++) if (env[k] >= thr) return (k * hop) / sr;
  return within;
}

// ---------------------------------------------------------------------------------------------
// reference loudness of a zone (the level calibration metric)

/**
 * Perceived level of one zone played at its root: looped zones → K-weighted loudness of the held
 * note from 0.5 s to 3.0 s (the loop unrolled); one-shots → momentary (400 ms) maximum. LUFS of the
 * mono sample (one channel); the same metric for every bank so levels compare directly.
 */
export function zoneLoudness(z: { data: Float32Array; loopStart: number; loopLength: number }, sr: number): number {
  if (z.loopLength > 0) {
    const n = Math.round(3.2 * sr);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let k = i;
      if (k >= z.loopStart + z.loopLength) k = z.loopStart + ((k - z.loopStart) % z.loopLength);
      y[i] = z.data[k] ?? 0;
    }
    return rangeLufs(y, sr, 0.5, 3.0);
  }
  return momentaryMax(z.data, sr);
}

/** memoryless soft clipper: identity below `knee`, smooth tanh knee above, |out| < 1 (seam-safe for loops) */
export function softClip(x: Float32Array, knee = 0.85): number {
  let n = 0;
  const room = 0.995 - knee;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > knee) {
      x[i] = Math.sign(x[i]) * (knee + room * Math.tanh((a - knee) / room));
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// attack shaping

/**
 * Tighten a slow bowed/blown attack. If the RMS envelope needs longer than `maxAtt` s (from the
 * start) to reach −3 dB of the sustain level `sus` (RMS), splice: keep the onset up to `keep` s
 * after the envelope first reaches −18 dB of `sus` (the bow bite / tongue), then crossfade
 * (equal-power, `xf` s) into the material where the envelope has reached −2 dB, phase-aligned by
 * cross-correlation. Returns the input unchanged when the attack is already fast enough.
 */
export function tightenAttack(x: Float32Array, sr: number, sus: number, maxAtt = 0.2, keep = 0.035, xf = 0.07): { data: Float32Array; spliced: boolean } {
  const hop = 32;
  const env = rmsEnv(x.subarray(0, Math.min(x.length, Math.round(3 * sr))), sr, 0.015, hop);
  const at = (dB: number) => {
    const thr = sus * fromDb(dB);
    for (let k = 0; k < env.length; k++) if (env[k] >= thr) return k * hop;
    return -1;
  };
  const t3 = at(-3);
  if (t3 >= 0 && t3 <= maxAtt * sr) return { data: x, spliced: false };
  const a = Math.max(0, at(-18));
  const b = at(-2);
  if (b < 0) return { data: x, spliced: false };
  const cutAt = a + Math.round(keep * sr);
  const X = Math.round(xf * sr);
  if (b <= cutAt + X) return { data: x, spliced: false };
  // align the incoming material: maximise correlation of x[cutAt..cutAt+X) and x[j..j+X)
  // around b (±10 ms) — they are the two sides of the crossfade
  let best = b, bc = -Infinity;
  const W = Math.round(0.01 * sr);
  for (let j = b - W; j <= b + W; j++) {
    if (j < cutAt + X || j + X >= x.length) continue;
    const c = ncc(x, cutAt, j, Math.min(X, 1024));
    if (c > bc) (bc = c), (best = j);
  }
  const out = new Float32Array(cutAt + (x.length - best));
  out.set(x.subarray(0, cutAt));
  for (let i = 0; i < X; i++) {
    const t = (i + 0.5) / X;
    out[cutAt + i] = x[cutAt + i] * Math.cos((t * Math.PI) / 2) + x[best + i] * Math.sin((t * Math.PI) / 2);
  }
  out.set(x.subarray(best + X), cutAt + X);
  return { data: out, spliced: true };
}

/** median RMS (20 ms windows) over [from, to) s — the sustain level */
export function sustainLevel(x: Float32Array, sr: number, from: number, to: number): number {
  const env = rmsEnv(x.subarray(Math.round(from * sr), Math.min(x.length, Math.round(to * sr))), sr, 0.02, 256);
  const a = Array.from(env).sort((p, q) => p - q);
  return a[a.length >> 1] ?? 0;
}

/**
 * Timpani pitch: the principal (1,1) mode f such that the spectrum (0.12–1.0 s after the onset)
 * has peaks at f, ≈1.5 f and ≈2 f (the air-loaded (2,1), (3,1) modes). Searched in [lo, hi] Hz.
 */
export function timpaniPitch(x: Float32Array, sr: number, lo: number, hi: number): number {
  const a = Math.round(0.12 * sr), N = Math.min(x.length - a, Math.round(0.9 * sr));
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = x[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const cache = new Map<number, number>();
  const mag = (f: number) => {
    const key = Math.round(f * 4);
    const c0 = cache.get(key);
    if (c0 !== undefined) return c0;
    const ff = key / 4;
    const c = Math.cos((2 * Math.PI * ff) / sr), s = Math.sin((2 * Math.PI * ff) / sr);
    let re = 0, im = 0, pr = 1, pi = 0;
    for (let i = 0; i < N; i++) {
      re += w[i] * pr;
      im += w[i] * pi;
      const nr = pr * c - pi * s;
      pi = pr * s + pi * c;
      pr = nr;
    }
    const m = Math.hypot(re, im);
    cache.set(key, m);
    return m;
  };
  const peakNear = (f: number, tol: number) => {
    let m = 0;
    for (let g = f * (1 - tol); g <= f * (1 + tol); g += 0.25) m = Math.max(m, mag(g));
    return m;
  };
  let best = lo, bs = -Infinity;
  for (let f = lo; f <= hi; f += 0.5) {
    const s = Math.log(1e-9 + peakNear(f, 0.006)) + 0.8 * Math.log(1e-9 + peakNear(1.5 * f, 0.025)) + 0.6 * Math.log(1e-9 + peakNear(1.98 * f, 0.03));
    if (s > bs) (bs = s), (best = f);
  }
  // refine: strongest bin within ±1 %
  let fm = best, mm = 0;
  for (let g = best * 0.99; g <= best * 1.01; g += 0.25) {
    const m = mag(g);
    if (m > mm) (mm = m), (fm = g);
  }
  return fm;
}

/** crest factor (dB): peak over K-weighted loudness of a range (s) */
export function crest(x: Float32Array, sr: number, from: number, to: number): number {
  return db(peakAbs(x, Math.round(from * sr), Math.min(x.length, Math.round(to * sr)))) - rangeLufs(x, sr, from, to);
}

/**
 * Phase rotator: a cascade of 2nd-order allpasses (RBJ) at `freqs`. Leaves the magnitude spectrum
 * untouched but disperses the phases of the harmonics, which lowers the crest factor of peaky,
 * pulse-like waveforms (brass lip buzz) — more loudness before full scale without clipping.
 * On a crossfade loop it stays seamless (the material before the loop end equals the material
 * before the loop start for longer than the allpass memory).
 */
export function phaseRotate(x: Float32Array, sr: number, freqs: number[], q = 0.7): Float32Array {
  for (const f of freqs) {
    const w = (2 * Math.PI * f) / sr, al = Math.sin(w) / (2 * q), cw = Math.cos(w), a0 = 1 + al;
    const b0 = (1 - al) / a0, b1 = (-2 * cw) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = b0 * v + b1 * x1 + x2 - b1 * y1 - b0 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      x[i] = y;
    }
  }
  return x;
}
export const ROTATIONS = [[300, 600, 1200], [200, 400, 800, 1600, 3200], [100, 200, 400, 800, 1600, 3200, 6400]];

/**
 * Lookahead peak limiter for one-shots (transients). Required gain r[i] = min(1, ceiling/|x[i]|);
 * m = forward minimum of r over `look` s; g = moving average of m over the past `look` s (so g ≤ r
 * everywhere and the gain ramps down smoothly before a peak), then an exponential release over
 * `release` s that never exceeds that average. Returns the maximum gain reduction (dB).
 */
export function limitPeaks(x: Float32Array, sr: number, ceiling = 0.97, look = 0.0015, release = 0.06): number {
  const n = x.length, L = Math.max(1, Math.round(look * sr));
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.abs(x[i]);
    r[i] = a > ceiling ? ceiling / a : 1;
  }
  const m = new Float64Array(n);
  const dq = new Int32Array(n);
  let h = 0, t = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (t > h && r[dq[t - 1]] >= r[i]) t--;
    dq[t++] = i;
    while (dq[h] > i + L) h++;
    m[i] = r[dq[h]];
  }
  const k = Math.exp(-1 / (release * sr));
  let acc = 0, g = 1, worst = 1;
  for (let i = 0; i < n; i++) {
    acc += m[i];
    if (i >= L) acc -= m[i - L];
    const avg = i >= L - 1 ? acc / L : Math.min(acc / (i + 1), m[i]);
    g = Math.min(avg, 1 - (1 - g) * k);
    x[i] *= g;
    if (g < worst) worst = g;
  }
  return -db(worst);
}

/**
 * Clean the head of a looped sustain zone (bank v1 repair, 2026-10-10): the recorded onset can
 * carry a bow/lip pitch scoop (strings −35 c, brass up to +180 c for 20–80 ms) and, where the
 * attack was spliced shorter, a level dip. The head is cut to the first moment where the pitch is
 * within `tol` cents of the sustain pitch and the level within `levelDb` of the sustain level
 * (held for 30 ms, at most `maxCut` s), the level from there to the loop start is evened out to
 * the sustain level (smooth gain, back to unity 30 ms before the loop start), and a raised-cosine
 * fade-in of `fade` s starts the note. The loop itself is untouched (seam unchanged); returns the
 * new data and the number of samples removed (loopStart −= cut).
 */
export function cleanHead(x: Float32Array, sr: number, rootHz: number, loopStart: number, loopLength: number, o: { tol: number; levelDb: number; fade: number; maxCut: number }): { data: Float32Array; cut: number; maxGainDb: number } {
  const fRef = pitchOf(x, sr, loopStart / sr, (loopStart + loopLength) / sr, rootHz / 1.3, rootHz * 1.3).f || rootHz;
  const sus = sustainLevel(x, sr, loopStart / sr, (loopStart + loopLength) / sr);
  const hop = Math.round(0.005 * sr), W = Math.round(0.03 * sr);
  const env = rmsEnv(x, sr, 0.02, hop);
  const limit = Math.min(Math.round(o.maxCut * sr), loopStart - Math.round(0.08 * sr));
  let t0 = limit, run = 0;
  for (let a = 0; a + W < limit; a += hop) {
    const f = estimatePitch(x, sr, a, W, fRef / 1.3, fRef * 1.3);
    const ok = f > 0 && Math.abs(1200 * Math.log2(f / fRef)) <= o.tol && (env[Math.round(a / hop)] ?? 0) >= sus * fromDb(o.levelDb);
    run = ok ? run + 1 : 0;
    if (run >= 6) {
      t0 = a - 5 * hop;
      break;
    }
  }
  t0 = Math.max(0, t0);
  // level: smooth gain toward the sustain level between t0 and loopStart − 30 ms
  const g1 = loopStart - Math.round(0.03 * sr), ramp = Math.round(0.05 * sr);
  const sm = rmsEnv(x, sr, 0.04, hop);
  const out = x.slice(t0);
  let maxG = 1;
  for (let i = t0; i < g1; i++) {
    const k = i / hop, k0 = Math.floor(k), fr = k - k0;
    const e = (sm[k0] ?? sus) * (1 - fr) + (sm[k0 + 1] ?? sus) * fr;
    let g = Math.min(2, Math.max(0.6, sus / Math.max(e, 1e-9)));
    const toEnd = g1 - i;
    if (toEnd < ramp) g = 1 + (g - 1) * (toEnd / ramp);
    maxG = Math.max(maxG, g);
    out[i - t0] *= g;
  }
  const F = Math.max(1, Math.round(o.fade * sr));
  for (let i = 0; i < F && i < out.length; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / F);
  return { data: out, cut: t0, maxGainDb: db(maxG) };
}
