// Instrument bank — the slots of MUSIC_BRIEF §9, as data (kind + params) plus the generators that
// turn a spec into XM-ready sample zones. The Lab (lab.html) tweaks these specs live.
//
// Bank v1 (tools/build-instruments.ts → music/instruments/): slots marked `sampled` are built from
// CC0 library recordings (tools/bank/sampled.ts); the spec here is only their synthetic Lab
// stand-in. The synthetic slots (choirs, warm pad, PM lead, bass, sub, Shepard, scope) are rendered
// from these specs. `sends` are the engine FX sends of the shipped instrument (read by
// src/audio/engine-core.ts) — they belong to the v1 sound, sampled or not.
//
// Param docs live next to each generator: synths.ts (synth, sub, fm, ks), drums.ts (kick, snare,
// metal, timpani), padsynth.ts + padZone below (pad), shepard.ts, scope.ts, orchHit below.

import type { XmEnvelope } from '../../music/xm/xm.ts';
import { padsynth, formantGain, vowel, rolloff } from './padsynth.ts';
import { type Zone, type P, synth, sub, fm, ks } from './synths.ts';
import { kick, snare, metalKit, timpani } from './drums.ts';
import { shepardZones } from './shepard.ts';
import { scopePreview } from './scope.ts';
import { mtof, normalize, Biquad, rng, fadeEdges, mixInto, removeDC } from './util.ts';

export type Kind = 'pad' | 'spiccato' | 'synth' | 'sub' | 'fm' | 'ks' | 'kick' | 'snare' | 'metal' | 'timpani' | 'orchhit' | 'shepard' | 'scope';

export interface InstrumentSpec {
  slot: number;
  /** short id, also the wav file stem */
  id: string;
  /** working name shown in the tracker (≤ 22 chars) */
  name: string;
  kind: Kind;
  /** zone roots (MIDI); one sample per root, key ranges split half-way between roots */
  roots: number[];
  params: P;
  /** XM instrument settings */
  volume: number;
  fadeout: number;
  volEnv?: XmEnvelope;
  unpitched?: boolean;
  chordTones?: number[];
  /** engine-side FX sends 0..1 */
  sends: { reverb: number; delay: number; chorus: number };
  /** one-line description for the composer */
  note: string;
  /** bank v1 builds this slot from library samples (tools/bank/sampled.ts); the spec is the Lab's synthetic stand-in */
  sampled?: string;
}

/** parameter ranges for the Lab UI: [min, max, step] */
export const PARAM_RANGES: Record<Kind, Record<string, [number, number, number?]>> = {
  pad: {
    profile: [0, 2, 1], vowel: [0, 1], tilt: [0, 3], lp: [300, 16000, 10], bw: [1, 150], bwScale: [0, 1.5],
    harmonics: [1, 128, 1], evenLvl: [0, 1], stretch: [0, 0.002, 0.0001], size: [14, 18, 1], top: [2000, 16000, 10], male: [0, 1], tries: [1, 12, 1],
  },
  spiccato: {
    bw: [2, 60], bwScale: [0, 1.5], tilt: [0.3, 2], lp: [1000, 14000, 10], attack: [0.001, 0.05], hold: [0, 0.2], decay: [0.05, 1.5],
    scratch: [0, 1], scratchHz: [800, 8000], close: [0, 1], len: [0.2, 2],
  },
  synth: {
    voices: [1, 9, 1], detune: [0, 80], side: [0, 1], pulse: [0, 1], pw: [0.05, 0.5], sub: [0, 1], start: [40, 8000],
    peak: [100, 16000], cutoff: [60, 12000], fa: [0.001, 1], fd: [0.01, 2], res: [0, 0.95], keytrack: [0, 1],
    scoop: [-200, 200, 1], scoopT: [0.005, 0.3], attack: [0.001, 0.3], drive: [1, 8], head: [0.1, 2], loop: [0.2, 3],
  },
  sub: { h2: [0, 0.5], h3: [0, 0.3], loop: [0.1, 2] },
  fm: {
    c1: [0.5, 8, 0.01], m1: [0.25, 16, 0.01], i1: [0, 12], i1e: [0, 6], i1t: [0.005, 4], c2: [0.5, 8, 0.01], m2: [0.25, 20, 0.01],
    i2: [0, 12], i2e: [0, 6], i2t: [0.002, 2], l2: [0, 1], det2: [-30, 30], decay: [0.1, 12], decay2: [0.05, 12],
    attack: [0.0005, 0.2], len: [0.3, 10], fb: [0, 1],
  },
  ks: { decay: [0.2, 12], damp: [0, 0.5], bright: [300, 16000], pick: [0.02, 0.5], body: [0, 1], len: [0.3, 8] },
  kick: { f0: [60, 400], f1: [25, 90], sweep: [0.005, 0.15], decay: [0.1, 1.5], hold: [0, 0.1], click: [0, 1], clickHz: [500, 8000], drive: [1, 6], len: [0.2, 1.5] },
  snare: {
    body: [100, 300], body2: [1.2, 2.5], bodyLvl: [0, 1.5], bodyDecay: [0.03, 0.6], noise: [0, 1.5], noiseDecay: [0.05, 1],
    bp: [500, 6000], snap: [0, 1.5], drop: [1, 2], len: [0.15, 1.2],
  },
  metal: { closed: [0.02, 0.3], pedal: [0.01, 0.2], open: [0.1, 1.5], crash: [0.5, 5], ride: [0.5, 5], tone: [3000, 14000], hpf: [2000, 12000], noise: [0, 1], rev: [0.5, 4] },
  timpani: { decay: [0.5, 8], dk: [0, 3], pos: [0.05, 0.9], air: [0, 1], mallet: [100, 5000], thump: [0, 1], glide: [-60, 60], len: [0.5, 8] },
  orchhit: { strings: [0, 1.5], brass: [0, 1.5], timp: [0, 1.5], snap: [0, 1], decay: [0.2, 3], close: [0.05, 2], len: [0.3, 3] },
  shepard: { center: [100, 2000], sigma: [0.4, 3], lowest: [10, 80], highest: [2000, 18000], loop: [0.5, 3] },
  scope: { loop: [0.1, 2] },
};

// XM envelope helpers (x in ticks; 1 tick = 20 ms at speed 6 / BPM 125)
const T = (s: number) => Math.max(1, Math.round(s / 0.02));
/** attack → hold at 64 (sustain) → release to 0 after key-off */
const asr = (a: number, r: number): XmEnvelope => ({ points: [[0, 0], [T(a), 64], [T(a) + T(r), 0]], sustain: 1 });
/** full level until key-off, then release */
const rel = (r: number): XmEnvelope => ({ points: [[0, 64], [T(r), 0]], sustain: 0 });
/**
 * "ring" instruments (bell, e-piano, harp in bank v1): the sample holds `head` s of natural attack
 * and decay and then a short constant-level loop; this envelope keeps full level over the head and
 * then decays exponentially with T60 `t60` (no sustain point: it rings out by itself; key-off adds
 * the instrument's fadeout).
 */
export const ringEnv = (head: number, t60: number): XmEnvelope => {
  // 9 exponential steps down to −42 dB, then 0 (12 points max; the last one must be 0 or the
  // looped tail would hold at the last value forever)
  const end = (t60 * 42) / 60, n = 9;
  const points: [number, number][] = [[0, 64], [T(head), 64]];
  for (let k = 1; k <= n; k++) points.push([T(head + (k * end) / (n + 1)), Math.max(1, Math.round(64 * Math.pow(10, (-3 * ((k * end) / (n + 1))) / t60)))]);
  points.push([T(head + end), 0]);
  return { points };
};
/** XM fadeout value for a key-off release of `s` seconds (FT2: 65536 / fadeout ticks) */
const fade = (s: number) => Math.min(0xfff, Math.round(65536 / T(s)));

export const BANK: InstrumentSpec[] = [
  {
    slot: 1, id: 'aah', name: 'choir aah', kind: 'pad', roots: [57, 66, 80],
    params: { profile: 0, vowel: 0, tilt: 0.9, lp: 5200, bw: 40, bwScale: 1.12, harmonics: 96, evenLvl: 1, stretch: 0, size: 16, top: 9500, male: 0.5, tries: 8 },
    volume: 48, fadeout: 0x200, volEnv: asr(0.35, 0.7), sends: { reverb: 0.5, delay: 0, chorus: 0.3 },
    note: 'PADsynth mixed choir "aah" (male + female formant sets), 3 zones A3/F#4/G#5 (placed so the score\'s 3xx legato chains stay within ±7 semitones), 22 kHz, 3 s loops, slow attack',
  },
  {
    slot: 2, id: 'ooh', name: 'choir ooh', kind: 'pad', roots: [52, 64],
    params: { profile: 0, vowel: 1, tilt: 1.1, lp: 3600, bw: 38, bwScale: 1.1, harmonics: 96, evenLvl: 1, stretch: 0, size: 15, top: 8000, male: 0.5, tries: 8 },
    volume: 50, fadeout: 0x200, volEnv: asr(0.4, 0.8), sends: { reverb: 0.55, delay: 0, chorus: 0.3 },
    note: 'PADsynth mixed choir "ooh", darker and rounder, 2 zones E3/E4, 22 kHz, 1.5 s loops',
  },
  {
    slot: 3, id: 'strings', name: 'strings', kind: 'pad', roots: [43, 55, 67, 79, 91],
    params: { profile: 1, vowel: 0, tilt: 1, lp: 7000, bw: 22, bwScale: 0.9, harmonics: 128, evenLvl: 1, stretch: 0, size: 17 },
    // starts at −14 dB (not from silence: re-attacked line notes no longer dip to nothing), −4 dB at
    // 80 ms, full at 0.2 s; 0.5 s release after key-off
    volume: 46, fadeout: 0x300, volEnv: { points: [[0, 12], [4, 40], [10, 64], [35, 0]], sustain: 2 }, sends: { reverb: 0.35, delay: 0, chorus: 0.12 },
    note: 'section strings (cello / viola / violin ensembles layered in unison), 5 zones G2…G5, 28 kHz, 1.1 s loops; envelope −14 dB → full in 0.2 s over a clean 40 ms onset (start 1 row early as in v0)',
    sampled: 'VSCO 2 CE Strings: Cello / Viola / Violin Section susvib',
  },
  {
    slot: 4, id: 'pad', name: 'warm pad', kind: 'pad', roots: [48, 72],
    params: { profile: 2, vowel: 0, tilt: 1.4, lp: 2500, bw: 34, bwScale: 1.1, harmonics: 64, evenLvl: 0.45, stretch: 0, size: 14, top: 7000, male: 0, tries: 8 },
    volume: 46, fadeout: 0x100, volEnv: asr(0.7, 1.2), sends: { reverb: 0.55, delay: 0.1, chorus: 0.4 },
    note: 'PADsynth warm hollow pad, 2 zones C3/C5, 22 kHz, 0.74 s loops, very slow attack, no LFO; spectrum ends at 7 kHz so ±10 semitone glides stay alias-free',
  },
  {
    slot: 5, id: 'brass', name: 'brass section', kind: 'synth', roots: [55, 69],
    params: {
      voices: 5, detune: 14, side: 0.75, pulse: 0, pw: 0.5, sub: 0, start: 260, peak: 3200, cutoff: 1500, fa: 0.07, fd: 0.35,
      res: 0.18, keytrack: 0.5, scoop: -35, scoopT: 0.06, attack: 0.012, drive: 1.6, head: 0.6, loop: 1.0,
    },
    volume: 48, fadeout: 0x400, volEnv: rel(0.22), sends: { reverb: 0.25, delay: 0.05, chorus: 0 },
    note: 'brass section: horns + trombones (low), + trumpets (mid/high), 5 zones D#2…F5, 28 kHz, 0.8 s loops',
    sampled: 'VSCO 2 CE Brass: F Horn, Tenor Trombone, Trumpet sus',
  },
  {
    slot: 6, id: 'lead', name: 'pm lead', kind: 'synth', roots: [64, 76],
    params: {
      voices: 3, detune: 10, side: 0.65, pulse: 0.55, pw: 0.38, sub: 0, start: 1800, peak: 4200, cutoff: 2600, fa: 0.015, fd: 0.3,
      res: 0.12, keytrack: 0.5, scoop: 0, scoopT: 0.05, attack: 0.004, drive: 1.15, head: 0.33, loop: 0.25,
    },
    volume: 46, fadeout: 0x400, volEnv: rel(0.12), sends: { reverb: 0.28, delay: 0.25, chorus: 0.12 },
    note: 'PM-style lead: 3 detuned saw/pulse oscillators, warm 2-stage lowpass (bright, not buzzy; add vibrato with 4xy)',
  },
  {
    slot: 7, id: 'bell', name: 'bell', kind: 'fm', roots: [72, 88],
    params: { c1: 1, m1: 3.5, i1: 4, i1e: 0.4, i1t: 0.8, c2: 1, m2: 1.4, i2: 1.5, i2e: 0, i2t: 0.4, l2: 0.25, det2: 4, decay: 6, decay2: 3, attack: 0.001, len: 6, fb: 0 },
    volume: 44, fadeout: fade(0.8), volEnv: ringEnv(0.8, 4.5), sends: { reverb: 0.45, delay: 0.25, chorus: 0 },
    note: 'soft-mallet bell: vibraphone + hand chimes + a quiet FM bell layer; 8 ms soft attack, dark top (≤ 7 kHz); 4 zones E4…C6 at 22 kHz; the ring after 0.8 s is the envelope (T60 4.5 s); 0.8 s key-off release',
    sampled: 'VCSL Vibraphone soft mallets + Hand Chimes, FM layer from this spec',
  },
  {
    slot: 8, id: 'epiano', name: 'fm e-piano', kind: 'fm', roots: [48, 60, 72],
    params: { c1: 1, m1: 1, i1: 1.6, i1e: 0.25, i1t: 0.6, c2: 1, m2: 14, i2: 2.2, i2e: 0, i2t: 0.03, l2: 0.35, det2: 3, decay: 3.5, decay2: 1.2, attack: 0.001, len: 4.5, fb: 0.1 },
    volume: 50, fadeout: fade(0.3), volEnv: ringEnv(0.5, 2.5), sends: { reverb: 0.3, delay: 0.12, chorus: 0.45 },
    note: 'Yamaha TX81Z "FM Piano" (real FM hardware), 3 zones G#3/E4/C5 at 22 kHz, 6 ms soft attack, ≈3 s decay (envelope after 0.5 s)',
    sampled: 'VCSL Electrophones/TX81Z FM Piano',
  },
  {
    slot: 9, id: 'harp', name: 'harp', kind: 'ks', roots: [36, 48, 60, 72, 84],
    params: { decay: 3.5, damp: 0.22, bright: 5000, pick: 0.18, body: 0.4, len: 4 },
    volume: 50, fadeout: fade(0.6), volEnv: ringEnv(0.32, 2.2), sends: { reverb: 0.38, delay: 0.12, chorus: 0 },
    note: 'concert harp, 5 zones A2/G3/F4/E5/D6 at 26 kHz; the ring after 0.3 s is the envelope (T60 2.2 s)',
    sampled: 'VSCO 2 CE Strings/Harp mf',
  },
  {
    slot: 10, id: 'bass', name: 'bass', kind: 'synth', roots: [38, 47, 57],
    params: {
      voices: 1, detune: 0, side: 0, pulse: 0.35, pw: 0.45, sub: 0, start: 3600, peak: 3600, cutoff: 1000, fa: 0.001, fd: 0.2,
      res: 0.28, keytrack: 0.5, scoop: 0, scoopT: 0.05, attack: 0.002, drive: 2.6, head: 0.3, loop: 0.12,
    },
    volume: 54, fadeout: 0x800, volEnv: rel(0.08), sends: { reverb: 0.03, delay: 0, chorus: 0 },
    note: 'saw/pulse bass, filter pluck, drive: strong harmonics 2–10 carry it on laptop speakers and when the engine removes the fundamental (0D–0E); 3 zones D2/B2/A3, 22 kHz',
  },
  {
    slot: 11, id: 'sub', name: 'sub', kind: 'sub', roots: [36],
    params: { h2: 0.12, h3: 0.04, loop: 0.5 },
    volume: 52, fadeout: 0x800, volEnv: rel(0.08), sends: { reverb: 0, delay: 0, chorus: 0 },
    note: 'sine sub (removed by the engine in 0D–0E)',
  },
  {
    slot: 12, id: 'kick', name: 'kick', kind: 'kick', roots: [60], unpitched: true,
    params: { f0: 150, f1: 45, sweep: 0.035, decay: 0.45, hold: 0.02, click: 0.35, clickHz: 1800, drive: 1.8, len: 0.6 },
    volume: 64, fadeout: 0, sends: { reverb: 0.04, delay: 0, chorus: 0 },
    note: 'sine-sweep body + damped concert bass drum (skin, boom), saturated; natural on C-4',
    sampled: 'synth body + VSCO 2 CE BDrumNewhit',
  },
  {
    slot: 13, id: 'snare', name: 'snare', kind: 'snare', roots: [60], unpitched: true,
    params: { body: 180, body2: 1.83, bodyLvl: 0.8, bodyDecay: 0.16, noise: 0.9, noiseDecay: 0.32, bp: 1800, snap: 0.6, drop: 1.35, len: 0.5 },
    volume: 56, fadeout: 0, sends: { reverb: 0.22, delay: 0, chorus: 0 },
    note: 'acoustic snare (snares on) + rimshot crack + a touch of hand clap; natural on C-4',
    sampled: 'VSCO 2 CE Snare2 HitSN + VCSL rimshot + VCSL claps',
  },
  {
    slot: 14, id: 'metal', name: 'hats/cymbals', kind: 'metal', roots: [60, 62, 64, 65, 67, 69], unpitched: true,
    params: { closed: 0.07, pedal: 0.04, open: 0.5, crash: 2.6, ride: 1.8, tone: 9500, hpf: 6500, noise: 0.55, rev: 1.92 },
    volume: 40, fadeout: 0x400, volEnv: rel(0.06), sends: { reverb: 0.12, delay: 0.04, chorus: 0 },
    note: 'real cymbals: C-4 closed hat, D-4 pedal hat, E-4 open hat, F-4 crash (stick + clash cymbals), G-4 ride (stick + bell), A-4 reverse crash (1.92 s = 16 rows)',
    sampled: 'VCSL Hi-Hat, VSCO 2 CE suspended / crash cymbals, VCSL clash cymbals',
  },
  {
    slot: 15, id: 'timpani', name: 'timpani', kind: 'timpani', roots: [40, 47, 54],
    params: { decay: 2.8, dk: 1.2, pos: 0.28, air: 0.7, mallet: 900, thump: 0.25, glide: -18, len: 3.5 },
    volume: 56, fadeout: 0x100, volEnv: rel(0.5), sends: { reverb: 0.28, delay: 0, chorus: 0 },
    note: 'concert timpani, 4 zones E2 (the A2 drum a fourth down) / A2 / C3 / F3 at 22 kHz (pitch = principal mode), 0.95 s; tight onsets for R03 rolls',
    sampled: 'VCSL Timpani 2 hits',
  },
  {
    slot: 16, id: 'orchhit', name: 'orchestra hit', kind: 'orchhit', roots: [60], chordTones: [0, 12],
    params: { strings: 1, brass: 0.8, timp: 0.7, snap: 0.4, decay: 1.1, close: 0.5, len: 1.4 },
    volume: 56, fadeout: 0x200, volEnv: rel(0.3), sends: { reverb: 0.35, delay: 0.06, chorus: 0 },
    note: 'tutti hit: spiccato strings + brass staccato (root and octave) + timpani + clash cymbal + bass drum, 2 zones F3/A3, 28 kHz, 0.7 s',
    sampled: 'VSCO 2 CE spiccato strings + brass staccato, VCSL timpani / clash cymbals',
  },
  {
    slot: 17, id: 'shepard', name: 'shepard', kind: 'shepard', roots: [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71],
    params: { center: 420, sigma: 1.15, lowest: 18, highest: 10000, loop: 0.17 },
    volume: 44, fadeout: 0x200, volEnv: asr(0.25, 0.6), sends: { reverb: 0.6, delay: 0, chorus: 0.2 },
    note: 'Shepard tone: the note sets the pitch class only (play it in octave 4: C-4…B-4 then C-4 again rises forever)',
  },
  {
    slot: 18, id: 'scope', name: 'scope', kind: 'scope', roots: [60],
    params: { loop: 0.25 },
    volume: 24, fadeout: 0x200, volEnv: rel(0.2), sends: { reverb: 0.2, delay: 0, chorus: 0 },
    note: 'oscilloscope voice for channel 17 (mono preview; the engine renders true XY)',
  },
  {
    slot: 19, id: 'spiccato', name: 'spiccato strings', kind: 'spiccato', roots: [43, 55, 67, 79, 91],
    params: { bw: 14, bwScale: 0.9, tilt: 0.95, lp: 7500, attack: 0.006, hold: 0.025, decay: 0.32, scratch: 0.3, scratchHz: 2800, close: 0.5, len: 0.8 },
    volume: 50, fadeout: 0x400, volEnv: rel(0.08), sends: { reverb: 0.3, delay: 0.04, chorus: 0.06 },
    note: 'section spiccato (cello / viola / violin, two round robins stacked) for ostinati, 5 zones E2…G5, 28 kHz, one-shot ≈0.35 s',
    sampled: 'VSCO 2 CE Strings section spic',
  },
];

export const bankBySlot = (slot: number) => BANK.find((b) => b.slot === slot);

// ---------------------------------------------------------------------------------------------

/**
 * 'pad' — PADsynth with three harmonic profiles:
 *  profile   0 choir (formants), 1 strings (saw-like + body), 2 warm pad (hollow, soft)
 *  vowel     0..1  choir vowel: 0 "aah" → 1 "ooh"
 *  tilt      harmonic amplitude ∝ h^−tilt
 *  lp        Hz    spectral rolloff corner
 *  bw        cents bandwidth of the fundamental (ensemble width)
 *  bwScale   bandwidth growth with harmonic number (bw · h^bwScale)
 *  harmonics max harmonics;  evenLvl  level of even harmonics (pad);  stretch  inharmonicity
 *  size      log2 table length (17 = 131072 samples ≈ 3 s loop at 44.1 kHz, 18 ≈ 6 s)
 *  top       Hz    no partials above this (raised-cosine fade over the last 15 %): keeps
 *                  upward transpositions / 3xx glides alias-free
 *  male      0..1  choir: weight of a male formant set (×0.86 in frequency) mixed with the
 *                  female one — low zones lean male, high zones female (a mixed choir)
 *  tries     n     render n random-phase tables, keep the lowest crest factor
 */
export function padZone(p: P, sr: number, root: number, seed: string): Zone {
  const f0 = mtof(root);
  const fmts = vowel(p.vowel);
  const male = fmts.map(([F, A, B]) => [F * 0.86, A, B * 0.9] as [number, number, number]);
  const wm = p.profile === 0 && p.male ? Math.min(1, 2 * p.male * Math.min(0.9, Math.max(0.1, (70 - root) / 30 + 0.5))) : 0;
  const top = p.top || Infinity;
  const amp = (h: number, f: number) => {
    if (f > top) return 0;
    let a = Math.pow(h, -p.tilt) * rolloff(f, p.lp);
    if (f > 0.85 * top) a *= 0.5 + 0.5 * Math.cos((Math.PI * (f - 0.85 * top)) / (0.15 * top));
    if (p.profile === 0) a *= (1 - wm) * formantGain(f, fmts) + wm * formantGain(f, male);
    else if (p.profile === 1) a *= 1 + 0.6 * Math.exp(-0.5 * ((f - 480) / 160) ** 2) + 0.4 * Math.exp(-0.5 * ((f - 1400) / 400) ** 2) + 0.25 * Math.exp(-0.5 * ((f - 3100) / 700) ** 2);
    else if (h % 2 === 0) a *= p.evenLvl;
    return a;
  };
  // PADsynth phases are random: render `tries` tables and keep the one with the lowest crest factor
  // (more level before full scale, no clipping needed)
  let data: Float32Array = new Float32Array(0), best = Infinity;
  for (let k = 0; k < Math.max(1, p.tries ?? 1); k++) {
    const d = padsynth({ sr, f0, size: p.size, amp, harmonics: p.harmonics, bw: p.bw, bwScale: p.bwScale, stretch: p.stretch, seed: k ? `${seed}-${root}-${k}` : `${seed}-${root}` });
    let pk = 0;
    for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    if (pk < best) (best = pk), (data = d);
  }
  normalize(data, 0.9);
  return { data, rootMidi: root, lo: 0, hi: 127, loopStart: 0, loopLength: data.length, loopType: 1 };
}

/**
 * 'spiccato' — a short-bowed string section: a PADsynth ensemble table (narrow bandwidth, saw-like
 * spectrum with body resonances) under a bowed envelope, a band-passed bow "scratch" at the
 * start, and a lowpass that closes as the bow lifts. A one-shot.
 *  bw bwScale tilt lp   PADsynth spectrum (see 'pad', strings profile)
 *  attack s   bow attack;  hold s  time at full level;  decay s  T60 after the hold
 *  scratch 0..1 / scratchHz   bow noise level / band centre
 *  close  0..1  how much the brightness drops during the decay;  len  s
 */
export function spiccatoZone(p: P, sr: number, root: number, seed: string): Zone {
  const table = padZone({ profile: 1, vowel: 0, tilt: p.tilt, lp: p.lp, bw: p.bw, bwScale: p.bwScale, harmonics: 128, evenLvl: 1, stretch: 0, size: 16 }, sr, root, seed).data;
  const n = Math.round(p.len * sr);
  const out = new Float32Array(n);
  const r = rng('spiccato', seed, root);
  const bp = Biquad.make('bp', sr, p.scratchHz, 1.2);
  const lp = Biquad.make('lp', sr, 16000, 0.7);
  const att = Math.max(1, Math.round(p.attack * sr)), hold = Math.round(p.hold * sr);
  const k = Math.exp(-6.9078 / (p.decay * sr));
  const off = Math.floor(r() * table.length);
  let a = 1;
  for (let i = 0; i < n; i++) {
    let env: number;
    if (i < att) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / att);
    else if (i < att + hold) env = 1;
    else env = a *= k;
    if ((i & 63) === 0) lp.design('lp', sr, 16000 * (1 - p.close) + 16000 * p.close * Math.max(0.12, env), 0.7);
    const scratch = bp.tick(r() * 2 - 1) * Math.exp(-i / (0.012 * sr)) * p.scratch * 3;
    out[i] = lp.tick(table[(off + i) % table.length] * env + scratch);
  }
  removeDC(out);
  fadeEdges(out, 0, Math.round(0.02 * sr));
  normalize(out, 0.9);
  return { data: out, rootMidi: root, lo: 0, hi: 127, loopStart: 0, loopLength: 0, loopType: 0 };
}

/**
 * 'orchhit' — the classic orchestra hit, pre-rendered: PADsynth strings (root + octave), brass
 * (supersaw with a snapping filter), timpani an octave below and a noise snap; the whole layer
 * decays and darkens together.
 *  strings brass timp snap   layer levels
 *  decay   s   T60 of the hit;  close  s  time constant of the darkening lowpass;  len  s
 */
export function orchHit(p: P, sr: number, root: number): Zone {
  const n = Math.round(p.len * sr);
  const out = new Float32Array(n);
  const strP = BANK[2].params;
  for (const k of [0, 12]) {
    const z = padZone({ ...strP, size: 15, bw: 30 }, sr, root + k, 'orchhit');
    const g = (k ? 0.6 : 1) * p.strings;
    for (let i = 0; i < n; i++) out[i] += z.data[i % z.data.length] * g;
  }
  const brassP = { ...BANK[4].params, start: 900, peak: 5000, cutoff: 2000, fa: 0.01, fd: 0.2, scoop: 0, head: p.len, loop: 0.2 };
  for (const k of [0, 12]) mixInto(out, synth(brassP, sr, root + k, 'orchhit').data, (k ? 0.5 : 0.8) * p.brass);
  mixInto(out, timpani({ ...BANK[14].params, len: p.len }, sr, root - 12).data, p.timp);
  const r = rng('orchhit');
  const hp = Biquad.make('hp', sr, 2500, 0.7);
  for (let i = 0; i < Math.min(n, sr * 0.05); i++) out[i] += hp.tick(r() * 2 - 1) * Math.exp(-i / (0.008 * sr)) * p.snap * 2;
  // decay + darkening
  const k = Math.exp(-6.9078 / (p.decay * sr));
  const lp = Biquad.make('lp', sr, 12000, 0.7);
  let a = 1;
  for (let i = 0; i < n; i++) {
    if ((i & 63) === 0) lp.design('lp', sr, 400 + 11000 * Math.exp(-i / (p.close * sr)), 0.7);
    out[i] = lp.tick(out[i]) * a * Math.min(1, i / (0.002 * sr));
    a *= k;
  }
  removeDC(out);
  fadeEdges(out, 0, Math.round(0.05 * sr));
  normalize(out, 0.95);
  return { data: out, rootMidi: root, lo: 0, hi: 127, loopStart: 0, loopLength: 0, loopType: 0 };
}

/** key ranges split half-way between consecutive roots */
function splitRanges<Z extends Zone>(zones: Z[]): Z[] {
  const zs = zones.filter((z) => !z.keys).sort((a, b) => a.rootMidi - b.rootMidi);
  zs.forEach((z, i) => {
    z.lo = i === 0 ? 0 : Math.floor((zs[i - 1].rootMidi + z.rootMidi) / 2) + 1;
    z.hi = i === zs.length - 1 ? 127 : Math.floor((z.rootMidi + zs[i + 1].rootMidi) / 2);
  });
  return zones;
}

/**
 * Sample rate for a zone so that its XM tuning is exact: FT2 (and libopenmpt) quantize finetune
 * to 1/16 semitone, so the rate is nudged (≤ ±0.2 %) until relativeNote + finetune/128 is a
 * multiple of 1/16 for the zone's root.
 */
export function xmExactRate(target: number, root: number): number {
  const s = 12 * Math.log2(target / 8363) - (root - 60);
  const q = Math.round(s * 16) / 16;
  return 8363 * Math.pow(2, (q + root - 60) / 12);
}

/**
 * Render every zone of an instrument. Each pitched zone is rendered at its own xmExactRate()
 * near `sr` (the zone's `rate` field); unpitched kits use `sr` as is.
 */
export function renderInstrument(spec: InstrumentSpec, sr: number): (Zone & { rate: number })[] {
  const p = spec.params;
  const at = (root: number) => xmExactRate(sr, root);
  const each = (fn: (rate: number, root: number) => Zone) => splitRanges(spec.roots.map((r) => ({ ...fn(at(r), r), rate: at(r) })));
  switch (spec.kind) {
    case 'pad':
      return each((rate, r) => padZone(p, rate, r, spec.id));
    case 'spiccato':
      return each((rate, r) => spiccatoZone(p, rate, r, spec.id));
    case 'synth':
      return each((rate, r) => synth(p, rate, r, spec.id));
    case 'sub':
      return each((rate, r) => sub(p, rate, r));
    case 'fm':
      return each((rate, r) => fm(p, rate, r));
    case 'ks':
      return each((rate, r) => ks(p, rate, r));
    case 'kick':
      return [{ ...kick(p, sr, spec.roots[0]), rate: sr }];
    case 'snare':
      return [{ ...snare(p, sr, spec.roots[0]), rate: sr }];
    case 'metal':
      return metalKit(p, sr).map((z) => ({ ...z, rate: sr }));
    case 'timpani':
      return each((rate, r) => timpani(p, rate, r));
    case 'orchhit':
      return each((rate, r) => orchHit(p, rate, r));
    case 'shepard':
      return shepardZones(p, at).map((z) => ({ ...z, rate: at(z.rootMidi) }));
    case 'scope':
      return each((rate, r) => scopePreview(p, rate, r));
  }
}

/** the zone a MIDI key plays */
export function zoneForKey(zones: Zone[], key: number): Zone {
  return zones.find((z) => (z.keys ? z.keys.includes(key) : key >= z.lo && key <= z.hi)) ?? zones[0];
}
