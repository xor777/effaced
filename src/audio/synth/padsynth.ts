// PADsynth (Nasca Octavian Paul): every harmonic is a gaussian band in the frequency domain,
// phases are random, one big inverse FFT gives a perfectly seamless loop with built-in
// "ensemble" chorus. FFT: npm fft.js (radix-4).

import FFT from 'fft.js';
import { rng } from './util.ts';

export interface PadOptions {
  sr: number;
  /** fundamental (Hz) of the table */
  f0: number;
  /** log2 of the table length (17 → 131072 samples ≈ 3 s at 44.1 kHz) */
  size: number;
  /** amplitude of harmonic h (1-based) at frequency fh (Hz) */
  amp: (h: number, fh: number) => number;
  /** max harmonics */
  harmonics: number;
  /** bandwidth of the fundamental in cents */
  bw: number;
  /** bandwidth growth: bw_h = bw · h^bwScale */
  bwScale: number;
  /** inharmonic stretch: f_h = f0 · h · (1 + stretch·(h−1)) */
  stretch?: number;
  seed: string;
}

const ffts = new Map<number, FFT>();

/** Build one PADsynth loop (RMS-normalized to 0.25). */
export function padsynth(o: PadOptions): Float32Array {
  const N = 1 << o.size;
  const half = N >> 1;
  const amp = new Float64Array(half);
  const fmax = o.sr * 0.47;
  for (let h = 1; h <= o.harmonics; h++) {
    const fh = o.f0 * h * (1 + (o.stretch ?? 0) * (h - 1));
    if (fh >= fmax) break;
    const a = o.amp(h, fh);
    if (!(a > 1e-7)) continue;
    const bwHz = (Math.pow(2, o.bw / 1200) - 1) * o.f0 * Math.pow(h, o.bwScale);
    const sigma = Math.max(0.5, (bwHz / o.sr) * N); // in bins
    const center = (fh / o.sr) * N;
    const lo = Math.max(1, Math.floor(center - 4 * sigma));
    const hi = Math.min(half - 1, Math.ceil(center + 4 * sigma));
    // energy-preserving: total power of the band ∝ a² whatever its width
    const g = a / Math.sqrt(sigma);
    for (let i = lo; i <= hi; i++) {
      const x = (i - center) / sigma;
      amp[i] += g * Math.exp(-x * x);
    }
  }
  const r = rng('padsynth', o.seed);
  let fft = ffts.get(N);
  if (!fft) ffts.set(N, (fft = new FFT(N)));
  const spec = new Float64Array(2 * N);
  for (let i = 1; i < half; i++) {
    const ph = r() * Math.PI * 2;
    const re = amp[i] * Math.cos(ph), im = amp[i] * Math.sin(ph);
    spec[2 * i] = re;
    spec[2 * i + 1] = im;
    spec[2 * (N - i)] = re;
    spec[2 * (N - i) + 1] = -im;
  }
  const out = new Float64Array(2 * N);
  fft.inverseTransform(out, spec);
  const res = new Float32Array(N);
  let s2 = 0;
  for (let i = 0; i < N; i++) s2 += out[2 * i] * out[2 * i];
  const g = s2 > 0 ? 0.25 / Math.sqrt(s2 / N) : 0;
  for (let i = 0; i < N; i++) res[i] = out[2 * i] * g;
  return res;
}

// ---------------------------------------------------------------------------------------------
// harmonic profiles

/** formant table entry: [frequency Hz, amplitude, bandwidth Hz] */
type Formant = [number, number, number];
// alto/soprano blends from the classic Csound formant tables, bandwidths widened for an ensemble
export const VOWEL_A: Formant[] = [
  [800, 1, 110],
  [1150, 0.5, 120],
  [2900, 0.16, 160],
  [3900, 0.09, 180],
  [4950, 0.02, 220],
];
export const VOWEL_U: Formant[] = [
  [350, 1, 90],
  [650, 0.22, 100],
  [2700, 0.03, 180],
  [3800, 0.02, 200],
  [4950, 0.006, 220],
];

export function formantGain(f: number, fs: Formant[], floor = 0.02): number {
  let s = floor;
  for (const [F, A, B] of fs) {
    const x = (f - F) / B;
    s += A * Math.exp(-0.5 * x * x) + (0.15 * A) / (1 + x * x); // gaussian core + lorentzian skirt
  }
  return s;
}

/** blend of two vowels (0 = a, 1 = u) */
export function vowel(t: number): Formant[] {
  return VOWEL_A.map((a, i) => {
    const u = VOWEL_U[i];
    return [a[0] + (u[0] - a[0]) * t, a[1] + (u[1] - a[1]) * t, a[2] + (u[2] - a[2]) * t] as Formant;
  });
}

/** gentle 2nd-order rolloff above fc */
export const rolloff = (f: number, fc: number) => 1 / (1 + (f / fc) * (f / fc));
