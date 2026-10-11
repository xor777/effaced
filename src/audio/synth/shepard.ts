// Shepard tone: octave-spaced sine partials under a fixed gaussian envelope over log-frequency.
// A note only sets the pitch class; stepping up the white keys C-4 … B-4 → C-4 … sounds like an
// endless ascent (PLAN §4, MUSIC_BRIEF §7 positions 09–0A).

import { mtof, periodicLoop, rng } from './util.ts';
import type { Zone, P } from './synths.ts';

/**
 * 'shepard' — one looped zone per key of octave 4 (C-4 … B-4); the spectral envelope is the same
 * absolute curve for every zone, so the twelve samples differ only in pitch class.
 *  center  Hz      centre of the gaussian envelope
 *  sigma   octaves width of the envelope
 *  lowest  Hz      lowest partial allowed;  highest  Hz  highest partial
 *  loop    s       loop length
 */
export function shepardZones(p: P, rateFor: (root: number) => number): Zone[] {
  const zones: Zone[] = [];
  for (let m = 60; m < 72; m++) {
    const sr = rateFor(m);
    const fpc = mtof(m);
    let fLow = fpc;
    while (fLow / 2 >= p.lowest) fLow /= 2;
    const { L, f: fq } = periodicLoop(fLow, sr, p.loop);
    const r = rng('shepard', m);
    const partials: { f: number; a: number; ph: number }[] = [];
    for (let f = fq; f < Math.min(p.highest, sr * 0.45); f *= 2) {
      const x = (Math.log2(f) - Math.log2(p.center)) / p.sigma;
      partials.push({ f, a: Math.exp(-0.5 * x * x), ph: r() });
    }
    const data = new Float32Array(L + 1);
    for (const q of partials) {
      const w = (2 * Math.PI * q.f) / sr;
      // recursive sine (exact enough over one loop): s[n] = 2cos(w)s[n−1] − s[n−2]
      const c = 2 * Math.cos(w);
      let s1 = Math.sin(2 * Math.PI * q.ph - w), s0 = Math.sin(2 * Math.PI * q.ph - 2 * w);
      for (let i = 0; i < L + 1; i++) {
        const s = c * s1 - s0;
        s0 = s1;
        s1 = s;
        data[i] += q.a * s;
      }
    }
    // keys: every octave of this pitch class maps to this zone
    const keys: number[] = [];
    for (let k = m % 12; k < 128; k += 12) keys.push(k);
    zones.push({ data, rootMidi: m, lo: m, hi: m, keys, loopStart: 1, loopLength: L, loopType: 1 });
  }
  // common gain so all twelve match
  let pk = 0;
  for (const z of zones) for (let i = 0; i < z.data.length; i++) pk = Math.max(pk, Math.abs(z.data[i]));
  for (const z of zones) for (let i = 0; i < z.data.length; i++) z.data[i] *= 0.9 / pk;
  return zones;
}
