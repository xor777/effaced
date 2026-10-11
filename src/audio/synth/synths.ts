// Tonal instrument generators: subtractive synth (supersaw brass, PM lead, bass), sine sub,
// 2-operator FM (bell, DX7-style e-piano), Karplus–Strong (harp).
// Each returns a Zone: a mono sample at a root note, with an optional seamless sustain loop.
// Sustained sounds loop seamlessly because every oscillator is quantized to complete an integer
// number of cycles inside the loop (detune error < 0.01 cent) and all envelopes have settled
// before the loop starts.

import { Svf, Biquad, blep, mtof, quantizeToLoop, periodicLoop, rng, normalize, removeDC, fadeEdges, TAU, clamp } from './util.ts';

export interface Zone {
  data: Float32Array;
  /** MIDI note the sample sounds at when played at its natural rate */
  rootMidi: number;
  /** key range this zone covers (MIDI, inclusive); a single-zone instrument covers 0..127 */
  lo: number;
  hi: number;
  /** explicit MIDI keys (overrides lo..hi), e.g. every C for a pitch-class zone */
  keys?: number[];
  loopStart: number;
  loopLength: number; // 0 = one-shot
  loopType: 0 | 1 | 2;
}

export type P = Record<string, number>;

export const oneShot = (data: Float32Array, rootMidi: number): Zone => ({ data, rootMidi, lo: 0, hi: 127, loopStart: 0, loopLength: 0, loopType: 0 });

// ---------------------------------------------------------------------------------------------
/**
 * 'synth' — subtractive: N detuned saws/pulses (supersaw), optional sub-octave, resonant
 * lowpass with an attack/decay envelope, pitch scoop, drive. Used for brass, the PM lead, bass.
 *  voices    1..9      number of oscillators
 *  detune    cents     total spread of the oscillators (± detune/2)
 *  side      0..1      level of the outer oscillators relative to the centre one
 *  pulse     0..1      0 = saw, 1 = pulse wave (width `pw`)
 *  pw        0.05..0.5 pulse width
 *  sub       0..1      square one octave below
 *  start     Hz        filter cutoff at the attack
 *  peak      Hz        filter cutoff at the top of the filter attack
 *  cutoff    Hz        sustain cutoff
 *  fa, fd    s         filter attack / decay times
 *  res       0..1      resonance
 *  keytrack  0..1      cutoff follows the root note (relative to C4)
 *  scoop     cents     pitch offset at note start, glides to 0 in `scoopT` s
 *  attack    s         amplitude attack
 *  drive     ≥1        tanh saturation
 *  head      s         length before the loop (all envelopes must have settled)
 *  loop      s         loop length
 */
export function synth(p: P, sr: number, root: number, seed: string): Zone {
  const f = mtof(root);
  const head = Math.round(p.head * sr);
  // loop length = an integer number of periods of the root, so the centre oscillator is exact
  const { L } = periodicLoop(f, sr, p.loop);
  const total = head + 2 * L;
  const nv = Math.max(1, Math.round(p.voices));
  const r = rng('synth', seed, root);
  const freqs: number[] = [];
  const gains: number[] = [];
  const phases: number[] = [];
  for (let v = 0; v < nv; v++) {
    const pos = nv === 1 ? 0 : (v / (nv - 1)) * 2 - 1; // -1..1
    const cents = (pos * p.detune) / 2 + (nv > 1 ? (r() - 0.5) * p.detune * 0.08 : 0);
    freqs.push(quantizeToLoop(f * Math.pow(2, cents / 1200), sr, L));
    gains.push(Math.abs(pos) < 1e-6 || nv === 1 ? 1 : p.side);
    phases.push(nv === 1 ? 0 : r());
  }
  const fSub = quantizeToLoop(f / 2, sr, L);
  let subPh = 0;
  const kt = Math.pow(2, ((root - 60) / 12) * clamp(p.keytrack ?? 0, 0, 1));
  const svf = new Svf(sr);
  const svf2 = new Svf(sr);
  const out = new Float32Array(total);
  const fa = Math.max(1e-3, p.fa), fd = Math.max(1e-3, p.fd);
  const scoopT = Math.max(1e-3, p.scoopT ?? 0.05);
  const att = Math.max(1, Math.round((p.attack ?? 0.005) * sr));
  const pw = clamp(p.pw ?? 0.5, 0.05, 0.5);
  const pulse = clamp(p.pulse ?? 0, 0, 1);
  const drive = Math.max(1, p.drive ?? 1);
  const dnorm = Math.tanh(drive);
  const gsum = gains.reduce((a, b) => a + b, 0);
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    if ((i & 15) === 0) {
      // filter envelope: start → peak (fa, exponential), → cutoff (fd, smooth), static afterwards
      let fc: number;
      if (t < fa) fc = p.start * Math.pow(p.peak / p.start, t / fa);
      else if (t < fa + fd) {
        const u = (t - fa) / fd;
        const s = u * u * (3 - 2 * u);
        fc = p.peak * Math.pow(p.cutoff / p.peak, s);
      } else fc = p.cutoff;
      fc *= kt;
      svf.set(fc, p.res);
      svf2.set(fc, p.res * 0.3);
    }
    const sc = t < scoopT ? Math.pow(2, ((p.scoop ?? 0) / 1200) * (1 - t / scoopT) * (1 - t / scoopT)) : 1;
    let s = 0;
    for (let v = 0; v < nv; v++) {
      const dt = (freqs[v] * sc) / sr;
      let ph = phases[v] + dt;
      if (ph >= 1) ph -= 1;
      phases[v] = ph;
      let saw = 2 * ph - 1 - blep(ph, dt);
      if (pulse > 0) {
        let ph2 = ph + pw;
        if (ph2 >= 1) ph2 -= 1;
        const saw2 = 2 * ph2 - 1 - blep(ph2, dt);
        saw = (1 - pulse) * saw + pulse * (saw - saw2);
      }
      s += saw * gains[v];
    }
    s /= gsum;
    if (p.sub) {
      const dt = (fSub * sc) / sr;
      subPh += dt;
      if (subPh >= 1) subPh -= 1;
      let sq = subPh < 0.5 ? 1 : -1;
      sq += blep(subPh, dt);
      let ph2 = subPh + 0.5;
      if (ph2 >= 1) ph2 -= 1;
      sq -= blep(ph2, dt);
      s += p.sub * sq * 0.7;
    }
    // 4-pole-ish: resonant SVF into a gentle second stage
    let y = svf2.tick(svf.tick(s));
    y = Math.tanh(y * drive) / dnorm;
    const a = i < att ? i / att : 1;
    out[i] = y * a;
  }
  removeDC(out);
  const data = out.slice(0, head + L);
  normalize(data, 0.9);
  // the seam: data[head] continues data[head+L-1] because the signal is L-periodic after `head`
  return { data, rootMidi: root, lo: 0, hi: 127, loopStart: head, loopLength: L, loopType: 1 };
}

// ---------------------------------------------------------------------------------------------
/**
 * 'sub' — sine with a touch of 2nd harmonic (audible on laptop speakers) and a click-free start.
 *  h2     0..0.5  2nd harmonic level
 *  h3     0..0.3  3rd harmonic level
 *  loop   s       loop length
 */
export function sub(p: P, sr: number, root: number): Zone {
  const { L, f } = periodicLoop(mtof(root), sr, p.loop);
  const data = new Float32Array(L + 1);
  for (let i = 0; i < L + 1; i++) {
    const ph = (f * i) / sr;
    data[i] = Math.sin(TAU * ph) + p.h2 * Math.sin(2 * TAU * ph) + (p.h3 ?? 0) * Math.sin(3 * TAU * ph);
  }
  normalize(data, 0.9);
  return { data, rootMidi: root, lo: 0, hi: 127, loopStart: 1, loopLength: L, loopType: 1 };
}

// ---------------------------------------------------------------------------------------------
/**
 * 'fm' — two 2-operator FM pairs (carrier ratio c, modulator ratio m, index i → iEnd with time
 * constant iT), each with its own amplitude decay. A one-shot.
 *  c1 m1 i1 i1e i1t     pair 1 (bell: 1 : 3.5 inharmonic; e-piano body: 1 : 1)
 *  c2 m2 i2 i2e i2t l2  pair 2 and its level (e-piano "tine": 1 : 14, fast index decay)
 *  det2   cents   detune of pair 2 (beating)
 *  decay  s       T60 of pair 1 at the root
 *  decay2 s       T60 of pair 2
 *  attack s
 *  len    s       sample length (a fade closes the end)
 *  fb     0..1    modulator self-feedback of pair 1 (adds grit)
 */
export function fm(p: P, sr: number, root: number): Zone {
  const f = mtof(root);
  const n = Math.round(p.len * sr);
  const out = new Float32Array(n);
  const k1 = Math.exp(-6.9078 / (p.decay * sr));
  const k2 = Math.exp(-6.9078 / (Math.max(0.01, p.decay2 ?? p.decay) * sr));
  const ki1 = Math.exp(-1 / (Math.max(1e-3, p.i1t) * sr));
  const ki2 = Math.exp(-1 / (Math.max(1e-3, p.i2t ?? 0.1) * sr));
  const f2 = f * Math.pow(2, (p.det2 ?? 0) / 1200);
  const att = Math.max(1, Math.round((p.attack ?? 0.001) * sr));
  let a1 = 1, a2 = 1, e1 = 1, e2 = 1;
  let pc1 = 0, pm1 = 0, pc2 = 0, pm2 = 0, fbv = 0;
  const l2 = p.l2 ?? 0;
  const fb = p.fb ?? 0;
  for (let i = 0; i < n; i++) {
    const idx1 = p.i1e + (p.i1 - p.i1e) * e1;
    const idx2 = (p.i2e ?? 0) + ((p.i2 ?? 0) - (p.i2e ?? 0)) * e2;
    const m1 = Math.sin(TAU * pm1 + fb * fbv);
    fbv = m1;
    const s1 = Math.sin(TAU * pc1 + idx1 * m1);
    let s = s1 * a1;
    if (l2) {
      const m2 = Math.sin(TAU * pm2);
      s += l2 * Math.sin(TAU * pc2 + idx2 * m2) * a2;
    }
    out[i] = s * (i < att ? i / att : 1);
    pc1 += (f * p.c1) / sr; pm1 += (f * p.m1) / sr;
    pc2 += (f2 * (p.c2 ?? 1)) / sr; pm2 += (f2 * (p.m2 ?? 1)) / sr;
    if (pc1 > 1) pc1 -= 1; if (pm1 > 1) pm1 -= 1; if (pc2 > 1) pc2 -= 1; if (pm2 > 1) pm2 -= 1;
    a1 *= k1; a2 *= k2; e1 *= ki1; e2 *= ki2;
  }
  fadeEdges(out, 0, Math.round(0.05 * sr));
  normalize(out, 0.9);
  return oneShot(out, root);
}

// ---------------------------------------------------------------------------------------------
/**
 * 'ks' — Karplus–Strong plucked string with damping (harp, plucks).
 *  decay   s      T60 at the root
 *  damp    0..0.5 loop lowpass (0 = bright/metallic, 0.5 = classic KS average)
 *  bright  Hz     lowpass of the noise excitation (finger vs nail)
 *  pick    0..0.5 pluck position (comb on the excitation)
 *  body    0..1   level of a soft body resonance (~ 220 Hz + 600 Hz)
 *  len     s
 */
export function ks(p: P, sr: number, root: number): Zone {
  const f = mtof(root);
  const n = Math.round(p.len * sr);
  const out = new Float32Array(n);
  const rho = clamp(p.damp, 0, 0.5);
  const D = sr / f - rho; // total loop delay = D + rho (one-zero lowpass group delay)
  const size = 1 << Math.ceil(Math.log2(D + 8));
  const mask = size - 1;
  const buf = new Float64Array(size);
  // excitation: one period of lowpassed noise with a pick-position comb
  const P = Math.round(sr / f);
  const r = rng('ks', root);
  const ex = new Float64Array(P);
  const lp = Biquad.make('lp', sr, p.bright, 0.6);
  for (let i = 0; i < P; i++) ex[i] = lp.tick(r() * 2 - 1);
  const pd = Math.max(1, Math.round(p.pick * P));
  const exc = new Float64Array(P);
  for (let i = 0; i < P; i++) exc[i] = ex[i] - (i >= pd ? ex[i - pd] : 0) * 0.9;
  const g = Math.pow(10, -3 / (p.decay * f)); // per pass through the loop
  let w = 0, prev = 0;
  const hp = Biquad.make('hp', sr, 30, 0.7);
  for (let i = 0; i < n; i++) {
    // read at fractional delay D with cubic (Hermite) interpolation
    const rp = w - D;
    const ri = Math.floor(rp);
    const fr = rp - ri;
    const xm1 = buf[(ri - 1) & mask], x0 = buf[ri & mask], x1 = buf[(ri + 1) & mask], x2 = buf[(ri + 2) & mask];
    const c1 = 0.5 * (x1 - xm1), c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    const y = ((c3 * fr + c2) * fr + c1) * fr + x0;
    const z = (1 - rho) * y + rho * prev;
    prev = y;
    const v = g * z + (i < P ? exc[i] : 0);
    buf[w & mask] = v;
    w++;
    out[i] = hp.tick(v);
  }
  if (p.body) {
    const b1 = Biquad.make('peak', sr, 220, 1.2, 6 * p.body), b2 = Biquad.make('peak', sr, 600, 1.0, 4 * p.body);
    b1.process(out);
    b2.process(out);
  }
  fadeEdges(out, 0, Math.round(0.08 * sr));
  normalize(out, 0.9);
  return oneShot(out, root);
}
