// Percussion generators: kick (sine sweep + click), snare (noise + body), 808-style metal
// (six detuned square oscillators → hats and cymbals, a multi-zone kit), timpani (modal membrane).

import { Biquad, mtof, rng, normalize, fadeEdges, TAU, clamp } from './util.ts';
import { type Zone, type P, oneShot } from './synths.ts';

/**
 * 'kick' — sine whose pitch sweeps f0 → f1 (exponential, time constant `sweep`), plus a click.
 *  f0, f1  Hz    start / end pitch (150 → 45)
 *  sweep   s     pitch time constant
 *  decay   s     amplitude T60
 *  hold    s     time before the decay starts (punch)
 *  click   0..1  noise click level;  clickHz  click highpass
 *  drive   ≥1    saturation
 *  len     s
 */
export function kick(p: P, sr: number, root: number): Zone {
  const n = Math.round(p.len * sr);
  const out = new Float32Array(n);
  const r = rng('kick');
  const hp = Biquad.make('hp', sr, p.clickHz, 0.7);
  const k = Math.exp(-6.9078 / (p.decay * sr));
  const hold = Math.round(p.hold * sr);
  let ph = 0, a = 1;
  const drive = Math.max(1, p.drive);
  const dn = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = p.f1 + (p.f0 - p.f1) * Math.exp(-t / p.sweep);
    ph += f / sr;
    if (i >= hold) a *= k;
    let s = Math.sin(TAU * ph) * a;
    const c = hp.tick(r() * 2 - 1) * Math.exp(-t / 0.0025) * p.click;
    s = Math.tanh((s + c) * drive) / dn;
    out[i] = s;
  }
  fadeEdges(out, 0, Math.round(0.01 * sr));
  normalize(out, 0.95);
  return oneShot(out, root);
}

/**
 * 'snare' — bandpassed noise + a pitched body (two modes ~180/330 Hz with a short pitch drop).
 *  body    Hz     first body mode;  body2  ratio of the second mode
 *  bodyLvl 0..1   body level;       bodyDecay s  T60 of the body
 *  noise   0..1   noise level;      noiseDecay s T60 of the noise
 *  bp      Hz     noise band centre; snap  0..1 extra high "snares" sizzle (>5 kHz)
 *  drop    ratio  body pitch at the hit relative to the end (1.4 → 1)
 *  len     s
 */
export function snare(p: P, sr: number, root: number): Zone {
  const n = Math.round(p.len * sr);
  const out = new Float32Array(n);
  const r = rng('snare');
  const bp = Biquad.make('bp', sr, p.bp, 0.8);
  const hp = Biquad.make('hp', sr, 5000, 0.7);
  const lpN = Biquad.make('lp', sr, 11000, 0.7);
  const kb = Math.exp(-6.9078 / (p.bodyDecay * sr));
  const kn = Math.exp(-6.9078 / (p.noiseDecay * sr));
  let ab = 1, an = 1, p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const drop = 1 + (p.drop - 1) * Math.exp(-t / 0.012);
    p1 += (p.body * drop) / sr;
    p2 += (p.body * p.body2 * drop) / sr;
    const body = (Math.sin(TAU * p1) + 0.6 * Math.sin(TAU * p2)) * ab * p.bodyLvl;
    const w = r() * 2 - 1;
    const nz = (bp.tick(w) * 1.6 + hp.tick(w) * p.snap) * an * p.noise;
    out[i] = lpN.tick(body + nz) * (i < 8 ? i / 8 : 1);
    ab *= kb;
    an *= kn;
  }
  fadeEdges(out, 0, Math.round(0.01 * sr));
  normalize(out, 0.95);
  return oneShot(out, root);
}

// TR-808 cymbal/hat oscillator frequencies
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

/** six square oscillators (naive squares alias into metallic noise — like the 808's CMOS) */
function metal(n: number, sr: number, scale: number, seedPh: () => number): Float64Array {
  const out = new Float64Array(n);
  const ph = METAL.map(() => seedPh());
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < 6; k++) {
      let x = ph[k] + (METAL[k] * scale) / sr;
      if (x >= 1) x -= 1;
      ph[k] = x;
      s += x < 0.5 ? 1 : -1;
    }
    out[i] = s / 6;
  }
  return out;
}

/**
 * 'metal' — an 808-style hats & cymbals kit, one zone per key (MUSIC_BRIEF slot 14):
 *   C-4 closed hat · D-4 pedal hat · E-4 open hat · F-4 crash · G-4 ride · A-4 reverse crash (riser)
 *  closed, pedal, open   s   T60 of the hats
 *  crash, ride           s   T60 of the cymbals
 *  tone   Hz   hat bandpass centre;  hpf  Hz  hat highpass
 *  noise  0..1 white noise mixed into the cymbals (wash)
 *  rev    s    length of the reverse crash
 */
export function metalKit(p: P, sr: number): Zone[] {
  const r = rng('metal');
  const zone = (data: Float32Array, root: number, lo: number, hi: number): Zone => ({ data, rootMidi: root, lo, hi, loopStart: 0, loopLength: 0, loopType: 0 });
  const hat = (t60: number, len: number, scale: number, tone: number, chick: number) => {
    const n = Math.round(len * sr);
    const m = metal(n, sr, scale, r);
    const out = new Float32Array(n);
    const bp = Biquad.make('bp', sr, tone, 1.1), hp1 = Biquad.make('hp', sr, p.hpf, 0.7), hp2 = Biquad.make('hp', sr, p.hpf, 0.7);
    const k = Math.exp(-6.9078 / (t60 * sr));
    let a = 1;
    for (let i = 0; i < n; i++) {
      const s = hp2.tick(hp1.tick(bp.tick(m[i] + 0.15 * (r() * 2 - 1))));
      const env = a * (1 + chick * Math.exp(-i / (0.004 * sr)));
      out[i] = s * env * (i < 4 ? i / 4 : 1);
      a *= k;
    }
    return normalize(fadeEdges(out, 0, Math.round(0.005 * sr)), 0.9);
  };
  const cymbal = (t60: number, len: number, scale: number, wash: number, ping: number) => {
    const n = Math.round(len * sr);
    const m1 = metal(n, sr, scale, r), m2 = metal(n, sr, scale * 1.4983, r);
    const out = new Float32Array(n);
    const bp = Biquad.make('bp', sr, 7000, 0.5), hp = Biquad.make('hp', sr, 2800, 0.6), hp2 = Biquad.make('hp', sr, 1500, 0.6);
    const shelf = Biquad.make('highshelf', sr, 9000, 0.7, 3);
    const k = Math.exp(-6.9078 / (t60 * sr));
    const kp = Math.exp(-6.9078 / (t60 * 0.6 * sr));
    let a = 1, ap = 1;
    let q1 = 0, q2 = 0, q3 = 0;
    for (let i = 0; i < n; i++) {
      const noise = r() * 2 - 1;
      let s = hp.tick(bp.tick(m1[i] + 0.7 * m2[i])) + wash * hp2.tick(noise) * 0.6;
      // ride "ping": a few inharmonic partials
      q1 += 3213 / sr; q2 += 4871 / sr; q3 += 6271 / sr;
      s += ping * ap * (Math.sin(TAU * q1) + 0.6 * Math.sin(TAU * q2) + 0.35 * Math.sin(TAU * q3)) * 0.25;
      const att = Math.min(1, i / (0.0015 * sr));
      out[i] = shelf.tick(s) * a * att;
      a *= k;
      ap *= kp;
    }
    return normalize(fadeEdges(out, 0, Math.round(0.05 * sr)), 0.9);
  };
  const closed = hat(p.closed, Math.min(1, p.closed * 1.2), 1, p.tone, 0.6);
  const pedal = hat(p.pedal, Math.min(1, p.pedal * 1.2), 0.94, p.tone * 0.8, 1.2);
  const open = hat(p.open, Math.min(2, p.open * 1.1), 1, p.tone, 0.3);
  const crash = cymbal(p.crash, p.crash * 1.05, 1.31, p.noise, 0);
  const ride = cymbal(p.ride, p.ride * 1.05, 1.07, p.noise * 0.35, 1);
  // reverse crash: the crash's first `rev` seconds backwards, ending on a hard stop (a riser)
  const rn = Math.round(p.rev * sr);
  const rev = new Float32Array(rn);
  for (let i = 0; i < rn; i++) rev[i] = crash[rn - 1 - i] ?? 0;
  fadeEdges(rev, Math.round(0.2 * sr), Math.round(0.004 * sr));
  normalize(rev, 0.9);
  // key ranges: each sample sounds natural on its own key; neighbours transpose it
  return [
    zone(closed, 60, 0, 61),
    zone(pedal, 62, 62, 63),
    zone(open, 64, 64, 64),
    zone(crash, 65, 65, 66),
    zone(ride, 67, 67, 68),
    zone(rev, 69, 69, 127),
  ];
}

// ---------------------------------------------------------------------------------------------
// modal membrane: ideal circular membrane mode ratios = Bessel zeros j_mn / j_01
const MODES: [number, number, number][] = [
  // [m (angular), n (radial), j_mn]
  [0, 1, 2.4048], [1, 1, 3.8317], [2, 1, 5.1356], [0, 2, 5.5201], [3, 1, 6.3802], [1, 2, 7.0156],
  [4, 1, 7.5883], [2, 2, 8.4172], [0, 3, 8.6537], [5, 1, 8.7715], [3, 2, 9.761], [6, 1, 9.9361],
  [1, 3, 10.1735], [4, 2, 11.0647], [7, 1, 11.0864], [2, 3, 11.6198],
];
function besselJ(m: number, x: number): number {
  let s = 0, term = Math.pow(x / 2, m);
  for (let k = 1; k <= m; k++) term /= k;
  for (let k = 0; k < 40; k++) {
    s += term;
    term *= (-(x * x) / 4) / ((k + 1) * (k + 1 + m));
  }
  return s;
}

/**
 * 'timpani' — modal synthesis of a struck circular membrane: mode frequencies follow the Bessel
 * zeros (1 : 1.594 : 2.136 : 2.296 : 2.653 …), amplitudes follow J_m at the strike radius,
 * higher modes decay faster. The note is the (1,1) mode (the timpani's perceived pitch); `air`
 * pulls the (m,1) modes toward the harmonic 1 : 1.5 : 2 : 2.5 series of real, air-loaded kettles.
 *  decay   s      T60 of the principal mode
 *  dk      ≥0     decay falloff with mode frequency (T60 ∝ ratio^−dk)
 *  pos     0..0.9 strike radius (fraction of the head; timpani ≈ 0.25)
 *  air     0..1   0 = ideal membrane, 1 = harmonic (1,1),(2,1),(3,1)…
 *  mallet  Hz     mallet softness (mode amplitude rolloff)
 *  thump   0..1   low noise thump of the mallet
 *  glide   cents  pitch drop right after the hit (head tension), settles in 0.15 s
 *  len     s
 */
export function timpani(p: P, sr: number, root: number): Zone {
  const n = Math.round(p.len * sr);
  const out = new Float32Array(n);
  const fNote = mtof(root);
  const ref = MODES[1][2]; // (1,1)
  const modes = MODES.map(([m, nn, j]) => {
    let ratio = j / ref; // relative to the (1,1) mode
    if (nn === 1 && m >= 1) ratio = ratio + ((1 + (m - 1) * 0.5) - ratio) * clamp(p.air, 0, 1);
    const f = fNote * ratio;
    let a = Math.abs(besselJ(m, j * clamp(p.pos, 0, 0.95)));
    if (m === 0) a *= 0.35; // axisymmetric modes radiate and die quickly
    a *= 1 / (1 + Math.pow(f / p.mallet, 2));
    const t60 = p.decay * Math.pow(Math.max(ratio, 0.5), -p.dk) * (m === 0 ? 0.25 : 1);
    return { f, a, k: Math.exp(-6.9078 / (t60 * sr)), ph: 0 };
  }).filter((md) => md.f < sr * 0.45);
  const r = rng('timpani', root);
  const lp = Biquad.make('lp', sr, 300, 0.7);
  const amps = modes.map((md) => md.a);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const gl = Math.pow(2, ((p.glide ?? 0) / 1200) * Math.exp(-t / 0.05));
    let s = 0;
    for (let k = 0; k < modes.length; k++) {
      const md = modes[k];
      md.ph += (md.f * gl) / sr;
      s += Math.sin(TAU * md.ph) * amps[k];
      amps[k] *= md.k;
    }
    const thump = lp.tick(r() * 2 - 1) * Math.exp(-t / 0.03) * p.thump * 4;
    const att = Math.min(1, i / (0.0015 * sr));
    out[i] = (s + thump) * att;
  }
  fadeEdges(out, 0, Math.round(0.1 * sr));
  normalize(out, 0.95);
  return oneShot(out, root);
}
