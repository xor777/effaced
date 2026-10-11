// Sampled instrument recipes for bank v1 (node-only). Sources: Versilian Studios VSCO 2 Community
// Edition and VCSL (both CC0), downloaded into samples/ (gitignored; tools/bank/fetch-samples.ts).
// Every recipe turns a few library recordings into XM zones: onset-trimmed, pitch-measured and
// resampled to an "XM-exact" rate so tracker tuning is exact, layered, filtered, attack-shaped and
// (for sustains) crossfade-looped. Levels are calibrated later by tools/build-instruments.ts.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import type { Zone } from '../../src/audio/synth/synths.ts';
import { xmExactRate } from '../../src/audio/synth/bank.ts';
import {
  readMono, onset, pitchOf, timpaniPitch, resample, mtof, ftom, fromDb, db, dcBlock, biquad, gain, sustainLevel, momentaryMax, cleanHead,
  tightenAttack, rmsEnv, flatten, crossfadeLoop, cut, decayFrom, peakAbs, attackTime,
} from './dsp.ts';

export const LIB = resolve('samples');
export type RZone = Zone & { rate: number };

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m: number) => NOTE[m % 12] + (Math.floor(m / 12) - 1);

// ---------------------------------------------------------------------------------------------
// library index: articulation folder → notes

export interface Entry { midi: number; file: string }

/**
 * Index a folder: every wav whose name matches `re` and carries a note token (_C#3_, _A2., …).
 * `octShift` converts the library's octave naming to scientific (VSCO strings/brass name middle C
 * "C3": shift +1). Files are relative to samples/.
 */
export function index(dir: string, re: RegExp, octShift = 0): Entry[] {
  const abs = join(LIB, dir);
  if (!existsSync(abs)) throw new Error(`missing sample folder ${abs} — run: node tools/bank/fetch-samples.ts`);
  const out: Entry[] = [];
  for (const f of readdirSync(abs).sort()) {
    if (!f.endsWith('.wav') || !re.test(f)) continue;
    const m = f.match(/[_ ]([A-G]#?)(-?\d)(?=[_.])/);
    if (!m) continue;
    out.push({ midi: NOTE.indexOf(m[1]) + 12 * (+m[2] + 1 + octShift), file: join(dir, f) });
  }
  return out;
}
export function at(list: Entry[], midi: number): Entry {
  const e = list.find((x) => x.midi === midi);
  if (!e) throw new Error(`no sample at ${noteName(midi)} in ${list[0]?.file.replace(/\/[^/]*$/, '')}`);
  return e;
}
export function nearest(list: Entry[], midi: number): Entry {
  return list.reduce((a, b) => (Math.abs(b.midi - midi) < Math.abs(a.midi - midi) || (Math.abs(b.midi - midi) === Math.abs(a.midi - midi) && b.midi > a.midi) ? b : a));
}

// ---------------------------------------------------------------------------------------------
// loading + pitch

export type PitchMode = 'sustain' | 'decay' | 'short' | 'timpani' | 'none';
export interface Layer {
  file: string;
  /** nominal pitch of the recording (scientific MIDI) */
  midi: number;
  /** semitones relative to the zone root this layer sounds at (orchestra hit octaves) */
  transpose?: number;
  /** dB, applied after the layer is normalised (sustain level or momentary loudness) */
  gain?: number;
  pitch?: PitchMode;
  /** timpani search range (Hz) */
  range?: [number, number];
  /** onset threshold (dB re peak) and pre-roll (s) */
  onsetDb?: number;
  preroll?: number;
  /** delay in seconds when layering */
  delay?: number;
  /** play backwards (reverse cymbal) */
  reverse?: boolean;
}
export interface Tone { x: Float32Array; sr: number; f: number; cents: number; corr: number; file: string }

const cache = new Map<string, Tone>();
export const measured: { file: string; nominal: string; hz: number; cents: number; corr: number }[] = [];

// pitch measurements persist between builds (keyed by file size/mtime + analysis settings)
const PITCH_CACHE = resolve('out/instrument-cache/pitch.json');
const pitchCache: Record<string, number> = existsSync(PITCH_CACHE) ? JSON.parse(readFileSync(PITCH_CACHE, 'utf8')) : {};
export function savePitchCache(): void {
  if (!Object.keys(pitchCache).length) return;
  mkdirSync(dirname(PITCH_CACHE), { recursive: true });
  writeFileSync(PITCH_CACHE, JSON.stringify(pitchCache, null, 0));
}

/** every library file a recipe read (relative to samples/) — for SOURCES.md / fetch-samples */
export const used = new Set<string>();

export function load(l: Layer): Tone {
  used.add(l.file);
  const key = `${l.file}|${l.pitch}|${l.onsetDb}|${l.preroll}|${l.range}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const st = statSync(join(LIB, l.file));
  const pkey = `${key}|${l.midi}|${st.size}|${Math.round(st.mtimeMs)}`;
  const s = readMono(join(LIB, l.file));
  const on = onset(s.data, s.sr, l.onsetDb ?? -30, l.preroll ?? 0.004);
  const x = s.data.slice(on);
  dcBlock(x, s.sr, 10);
  const nom = mtof(l.midi);
  let f = nom;
  const mode = l.pitch ?? 'sustain';
  const dur = x.length / s.sr;
  if (pitchCache[pkey] !== undefined) f = pitchCache[pkey];
  else if (mode === 'sustain') {
    const att = Math.min(attackTime(x, s.sr), 0.8);
    const from = Math.min(att + 0.15, dur * 0.3), to = Math.min(dur * 0.85, from + 2.5);
    f = pitchOf(x, s.sr, from, to, nom / 1.25, nom * 1.25).f;
  } else if (mode === 'decay') {
    f = pitchOf(x, s.sr, 0.04, Math.min(dur * 0.6, 1.0), nom / 1.25, nom * 1.25, 0.06, 0.02).f;
  } else if (mode === 'short') {
    // short bowed notes glide into pitch: weight the loud part the ear hears (30–200 ms)
    f = pitchOf(x, s.sr, 0.03, Math.min(dur * 0.8, 0.2), nom / 1.25, nom * 1.25, 0.05, 0.01).f;
  } else if (mode === 'timpani') {
    f = timpaniPitch(x, s.sr, l.range![0], l.range![1]);
  }
  pitchCache[pkey] = f;
  let cents = f > 0 ? 1200 * Math.log2(f / nom) : NaN;
  if (mode !== 'timpani' && mode !== 'none' && !(Math.abs(cents) < 70)) {
    console.warn(`[bank] ${l.file}: pitch ${f.toFixed(2)} Hz is ${cents.toFixed(0)} cents from ${noteName(l.midi)} — using the nominal pitch`);
    f = nom;
    cents = 0;
  }
  const t: Tone = { x, sr: s.sr, f, cents, corr: s.corr, file: l.file };
  if (mode !== 'none') measured.push({ file: l.file, nominal: noteName(l.midi), hz: f, cents: mode === 'timpani' ? ftom(f) : cents, corr: s.corr });
  cache.set(key, t);
  return t;
}

/** resample a tone so it sounds at MIDI `target` when played at `rate` (pitch 'none': rate change only) */
export function place(t: Tone, target: number, rate: number, keepPitch = false): Float32Array {
  const ratio = keepPitch ? rate / t.sr : (rate * t.f) / (t.sr * mtof(target));
  return resample(t.x, ratio);
}

export const xmRate = (root: number, base = 44100) => xmExactRate(base, root);

// ---------------------------------------------------------------------------------------------
// zone builders

export interface SusOpts {
  /** sample rate the zone is stored at (nudged to the XM-exact rate for its root) */
  base: number;
  /** lowpass (Hz, zero-phase 2-pole): keeps transposed playback alias-free and the top warm */
  lp?: number;
  hp?: number;
  /** high shelf (Hz, dB) */
  shelf?: [number, number];
  /** attack (−3 dB) must be reached within this (s), else the attack is spliced shorter */
  maxAtt?: number;
  loopSec: number;
  xfade: number;
  /** earliest loop start (s) */
  startMin?: number;
  /** clean the head after looping (dsp.ts cleanHead): onset pitch scoops and level dips go */
  clean?: { tol: number; levelDb: number; fade: number; maxCut: number };
}

/** time (samples) at which the 5 ms RMS envelope first reaches −6 dB of its maximum within `within` s */
function bite(y: Float32Array, rate: number, within = 0.3): number {
  const hop = 16;
  const env = rmsEnv(y.subarray(0, Math.min(y.length, Math.round(within * rate))), rate, 0.005, hop);
  let mx = 0;
  for (const v of env) mx = Math.max(mx, v);
  for (let k = 0; k < env.length; k++) if (env[k] >= mx * 0.5) return k * hop;
  return 0;
}

function sumLayers(root: number, rate: number, layers: Layer[], norm: (y: Float32Array) => number, align = false): Float32Array {
  let acc = new Float32Array(0);
  const ys = layers.map((l) => {
    const t = load(l);
    let y = place(t, root + (l.transpose ?? 0), rate, l.pitch === 'none');
    if (l.reverse) y = y.reverse();
    return y;
  });
  // align the attacks: every layer's "bite" (−6 dB point) lands where the earliest one does — the
  // slower layers lose part of their lead-in (with a 3 ms fade-in), nothing is delayed
  const bites = ys.map((y) => (align ? bite(y, rate) : 0));
  const first = Math.min(...bites);
  for (let li = 0; li < layers.length; li++) {
    const l = layers[li];
    let y = ys[li];
    if (bites[li] > first) {
      y = y.slice(bites[li] - first);
      const fi = Math.round(0.003 * rate);
      for (let i = 0; i < fi && i < y.length; i++) y[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
    }
    const lev = norm(y);
    gain(y, fromDb(l.gain ?? 0) / Math.max(lev, 1e-9));
    const off = Math.round((l.delay ?? 0) * rate);
    if (acc.length < y.length + off) {
      const n = new Float32Array(y.length + off);
      n.set(acc);
      acc = n;
    }
    for (let i = 0; i < y.length; i++) acc[off + i] += y[i];
  }
  return acc;
}

function filters(y: Float32Array, rate: number, o: { lp?: number; hp?: number; shelf?: [number, number] }) {
  dcBlock(y, rate, 12);
  if (o.hp) biquad(y, rate, 'hp', o.hp, Math.SQRT1_2, 0, true);
  if (o.lp) biquad(y, rate, 'lp', Math.min(o.lp, rate * 0.45), Math.SQRT1_2, 0, true);
  if (o.shelf) biquad(y, rate, 'highshelf', o.shelf[0], Math.SQRT1_2, o.shelf[1], true);
}

export interface ZoneInfo { root: number; sources: string; attack: number; loopCorr?: number; spliced?: boolean }
export const zoneInfo: ZoneInfo[] = [];

/** a looped sustain zone: attack (tightened if slow), then a crossfade loop of `loopSec` */
export function sustainZone(root: number, layers: Layer[], o: SusOpts): RZone {
  const rate = xmRate(root, o.base);
  let y = sumLayers(root, rate, layers, (z) => sustainLevel(z, rate, 0.6, 2.5) * 10);
  filters(y, rate, o);
  const sus = sustainLevel(y, rate, 0.6, 2.5);
  const tt = tightenAttack(y, rate, sus, o.maxAtt ?? 0.2);
  y = tt.data;
  // end of the attack: envelope within 1.5 dB of the sustain level
  const env = rmsEnv(y.subarray(0, Math.round(2 * rate)), rate, 0.02, 64);
  let attEnd = 0.3 * rate;
  for (let k = 0; k < env.length; k++)
    if (env[k] >= sus * fromDb(-1.5)) {
      attEnd = k * 64;
      break;
    }
  const X = Math.round(o.xfade * rate);
  const s = Math.max(Math.round((o.startMin ?? 0.3) * rate), attEnd + X + Math.round(0.04 * rate));
  let L = Math.round(o.loopSec * rate);
  const margin = Math.round(0.12 * rate);
  if (s + L + margin > y.length) L = y.length - margin - s;
  if (L < rate * 0.2) throw new Error(`zone ${noteName(root)}: source too short for a loop`);
  const flat = flatten(y, rate, attEnd, Math.min(y.length, s + L + margin));
  const d = Math.round(0.04 * rate);
  const lp = crossfadeLoop(flat, rate, s, s + L - d, s + L + d, rate / mtof(root), o.xfade);
  let data = lp.data, loopStart = lp.loopStart;
  if (o.clean) {
    const c = cleanHead(data, rate, mtof(root), loopStart, lp.loopLength, o.clean);
    data = c.data;
    loopStart -= c.cut;
  }
  for (let i = 0; i < 16 && i < data.length; i++) data[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / 16);
  zoneInfo.push({ root, sources: layers.map((l) => l.file).join(' + '), attack: attackTime(data, rate, -3, 1.5), loopCorr: lp.corr, spliced: tt.spliced });
  return { data, rootMidi: root, lo: 0, hi: 127, loopStart, loopLength: lp.loopLength, loopType: 1, rate };
}

export interface ShotOpts {
  base: number;
  lp?: number;
  hp?: number;
  shelf?: [number, number];
  /** extra decay: from (s), T60 (s) */
  decay?: [number, number];
  maxLen: number;
  fadeOut: number;
  /** raised-cosine fade-in (s) — 0 keeps the transient */
  fadeIn?: number;
  /** tanh drive (punch/glue), 1 = off */
  drive?: number;
  /** unpitched: keep the natural pitch (stored at `base`, no xm-exact nudge) */
  unpitched?: boolean;
  /** align the layers' attacks (−6 dB points) */
  align?: boolean;
  /**
   * "ring" one-shots (mallets, plucks, FM piano): keep `ring[0]` s of the natural attack and decay,
   * then a short crossfade loop of `ring[1]` s (xfade `ring[2]` s) at a constant level — the long
   * tail is the XM volume envelope's job (src/audio/synth/bank.ts `ringEnv`), as on 90s modules.
   */
  ring?: [number, number, number];
}

function shotCore(root: number, layers: Layer[], o: ShotOpts): { y: Float32Array; rate: number } {
  const rate = o.unpitched ? o.base : xmRate(root, o.base);
  let y = sumLayers(root, rate, layers, (z) => fromDb(momentaryMax(z, rate) + 20), o.align);
  const lead = Math.max(0, onset(y, rate, -40, 0.002));
  if (lead > 0) y = y.slice(lead);
  filters(y, rate, o);
  if (o.decay) decayFrom(y, rate, o.decay[0], o.decay[1]);
  if (o.drive && o.drive > 1) {
    const pk = peakAbs(y);
    const k = o.drive / pk;
    const n = Math.tanh(o.drive);
    for (let i = 0; i < y.length; i++) y[i] = (Math.tanh(y[i] * k) / n) * pk;
  }
  return { y, rate };
}

/** a one-shot zone (or a "ring" zone: natural head + short sustain loop, see ShotOpts.ring) */
export function shotZone(root: number, layers: Layer[], o: ShotOpts): RZone {
  const { y, rate } = shotCore(root, layers, o);
  const fi = Math.round((o.fadeIn ?? 0) * rate) || 8;
  const src = layers.map((l) => l.file + (l.transpose ? ` (${l.transpose > 0 ? '+' : ''}${l.transpose} st)` : '')).join(' + ');
  if (o.ring) {
    const zone = ringFrom(y, rate, root, o.ring[0], o.ring[1], o.ring[2], o.fadeIn ?? 0);
    zoneInfo.push({ root, sources: src, attack: attackTime(zone.data, rate, -3, 0.5) });
    return zone;
  }
  // end: where the envelope stays below −60 dB re peak, capped at maxLen
  const env = rmsEnv(y, rate, 0.02, 256);
  let mx = 0;
  for (const v of env) mx = Math.max(mx, v);
  let end = y.length;
  for (let k = env.length - 1; k >= 0; k--)
    if (env[k] > mx * fromDb(-60)) {
      end = Math.min(y.length, (k + 4) * 256);
      break;
    }
  end = Math.min(end, Math.round(o.maxLen * rate));
  const fo = Math.min(Math.round(o.fadeOut * rate), end >> 1);
  const data = cut(y, 0, end, fi, fo);
  zoneInfo.push({ root, sources: src, attack: attackTime(data, rate, -3, 0.5) });
  return { data, rootMidi: root, lo: 0, hi: 127, loopStart: 0, loopLength: 0, loopType: 0, rate };
}

/** explicit key splits: `firsts[i]` = the lowest key of zone i+1 (zones sorted by root) */
export function splitAt<Z extends Zone>(zones: Z[], firsts: number[]): Z[] {
  const zs = zones.slice().sort((a, b) => a.rootMidi - b.rootMidi);
  zs.forEach((z, i) => {
    z.lo = i === 0 ? 0 : firsts[i - 1];
    z.hi = i === zs.length - 1 ? 127 : firsts[i] - 1;
  });
  return zones;
}

/** key ranges split half-way between consecutive roots (zones without explicit keys) */
export function split<Z extends Zone>(zones: Z[]): Z[] {
  const zs = zones.filter((z) => !z.keys).sort((a, b) => a.rootMidi - b.rootMidi);
  zs.forEach((z, i) => {
    z.lo = i === 0 ? 0 : Math.floor((zs[i - 1].rootMidi + z.rootMidi) / 2) + 1;
    z.hi = i === zs.length - 1 ? 127 : Math.floor((z.rootMidi + zs[i + 1].rootMidi) / 2);
  });
  return zones;
}

// ---------------------------------------------------------------------------------------------
// library folders

const V = 'vsco2ce', C = 'vcsl';
const IDIO = `${C}/Idiophones/Struck Idiophones`, MEMB = `${C}/Membranophones/Struck Membranophones`;
const LIBS = {
  vlnSus: () => index(`${V}/Strings/Violin Section/susVib`, /_v2\.wav$/, 1),
  vlaSus: () => index(`${V}/Strings/Viola Section/susvib`, /_v2_1\.wav$/, 1),
  vcSus: () => index(`${V}/Strings/Cello Section/susvib`, /_v3_1\.wav$/, 1),
  vlnSpic: (rr = 1) => index(`${V}/Strings/Violin Section/Spic`, new RegExp(`_v2_rr${rr}\\.wav$`), 1),
  vlaSpic: (rr = 1) => index(`${V}/Strings/Viola Section/spic`, new RegExp(`_v2_rr${rr}\\.wav$`), 1),
  vcSpic: (rr = 1) => index(`${V}/Strings/Cello Section/spic`, new RegExp(`_v2_RR${rr}\\.wav$`), 1),
  hornSus: () => index(`${V}/Brass/F Horn/sus`, /_v3_1\.wav$/, 1),
  hornSusSoft: () => index(`${V}/Brass/F Horn/sus`, /_v1_1\.wav$/, 1),
  tbnSus: () => index(`${V}/Brass/Tenor Trombone/sus`, /_v3_1\.wav$/, 1),
  tptSus: () => index(`${V}/Brass/Trumpet/sus`, /_v3_rr1\.wav$/, 1),
  hornStac: () => index(`${V}/Brass/F Horn/stac`, /_v3_rr1\.wav$/, 1),
  tbnStac: () => index(`${V}/Brass/Tenor Trombone/stac`, /_v4_rr1\.wav$/, 1),
  tptStac: () => index(`${V}/Brass/Trumpet/stac`, /_v3_rr1\.wav$/, 1),
  harp: () => index(`${V}/Strings/Harp`, /_mf\.wav$/, 0),
  vibes: () => index(`${IDIO}/Vibraphone/Soft Mallets`, /_v1_rr\d_Main\.wav$/, 1),
  chimes: () => index(`${IDIO}/Hand Chimes`, /\.wav$/, 0),
  epiano: () => index(`${C}/Electrophones/TX81Z/FM Piano`, /_vl2\.wav$/, 0),
};
const TIMP = `${MEMB}/Timpani 2/Hit`;
/** VCSL "Timpani 2" drums (v5 = loudest hit) with the search range of their principal mode */
// (Timpani1C, the E2 drum, was dropped: its principal mode is split E2+26 c / F2+44 c — ambiguous
// pitch; the A2 drum covers the low keys)
const TIMPANI: { file: string; range: [number, number] }[] = [
  { file: `${TIMP}/Timpani7A_hit_v5_rr1_main.wav`, range: [100, 112] },
  { file: `${TIMP}/Timpani3B_hit_v5_rr1_main.wav`, range: [124, 138] },
  { file: `${TIMP}/Timpani4A_hit_v5_rr1_main.wav`, range: [168, 188] },
];
export function timpaniTones(): { layer: Layer; midi: number; hz: number }[] {
  return TIMPANI.map((t) => {
    const layer: Layer = { file: t.file, midi: 60, pitch: 'timpani', range: t.range, onsetDb: -24, preroll: 0.0008 };
    const tone = load(layer);
    const midi = Math.round(ftom(tone.f));
    return { layer: { ...layer, midi }, midi, hz: tone.f };
  });
}

// ---------------------------------------------------------------------------------------------
// recipes: slot → zones. Budget: the whole bank ≤ ≈3 MB of 16-bit mono (it is embedded in the
// .xm), so zones are few, rates 22–32 kHz, loops short and one-shot tails short.

export interface Recipe {
  zones: RZone[];
  sources: string[];
}

/** string zones: root → sections layered in unison (cello / viola / violin ensembles) */
const STR_ZONES: [number, ('vc' | 'vla' | 'vln')[]][] = [
  [43, ['vc']], [50, ['vc', 'vla']], [59, ['vla', 'vln']], [69, ['vla', 'vln']], [79, ['vla', 'vln']],
];

/** 03 — section strings: VSCO 2 CE susvib ensembles (loud layer), 5 zones G2…G5, 28 kHz, 1.1 s loops */
export function strings(): Recipe {
  const L = { vc: LIBS.vcSus(), vla: LIBS.vlaSus(), vln: LIBS.vlnSus() };
  const zones = STR_ZONES.map(([root, secs]) =>
    // no attack splice (it left a level dip in the A4 zone); cleanHead instead
    sustainZone(root, secs.map((s) => ({ file: nearest(L[s], root).file, midi: nearest(L[s], root).midi })), { base: 28000, lp: 12000, shelf: [5000, -3], maxAtt: 99, loopSec: 1.1, xfade: 0.25, startMin: 0.35, clean: { tol: 10, levelDb: -3, fade: 0.04, maxCut: 0.25 } }),
  );
  // splits chosen so the score's 3xx legato chains stay within ≈ ±5 semitones of their zone
  return { zones: splitAt(zones, [46, 54, 61, 73]), sources: ['VSCO 2 CE Strings: Cello Section susvib v3, Viola Section susvib v2, Violin Section susVib v2 (unison layers per zone)'] };
}

/** 19 — spiccato strings: VSCO 2 CE section spiccato (v2, round robins 1+2 stacked), 28 kHz */
export function spiccato(): Recipe {
  const L1 = { vc: LIBS.vcSpic(1), vla: LIBS.vlaSpic(1), vln: LIBS.vlnSpic(1) };
  const L2 = { vc: LIBS.vcSpic(2), vla: LIBS.vlaSpic(2), vln: LIBS.vlnSpic(2) };
  const plan: [number, ('vc' | 'vla' | 'vln')[]][] = [[40, ['vc']], [50, ['vc']], [59, ['vla', 'vln']], [69, ['vla', 'vln']], [79, ['vla', 'vln']]];
  const zones = plan.map(([root, secs]) => {
    const layers: Layer[] = [];
    for (const s of secs)
      for (const L of [L1, L2]) {
        const e = nearest(L[s], root);
        // onsets cut late (−14 dB re peak, 4 ms pre-roll): the slow bow approach goes, the bite stays
        layers.push({ file: e.file, midi: e.midi, pitch: 'short', onsetDb: -14, preroll: 0.004, gain: L === L2 ? -3 : 0 });
      }
    return shotZone(root, layers, { base: 28000, lp: 12000, hp: 45, shelf: [5000, -2], decay: [0.09, 0.45], maxLen: 0.36, fadeOut: 0.12, fadeIn: 0.004, align: true });
  });
  return { zones: split(zones), sources: ['VSCO 2 CE Strings: Cello / Viola / Violin Section spic v2, rr1 + rr2 stacked'] };
}

/** 05 — brass section: horns + trombones low, + trumpets mid/high; 5 zones, 28 kHz, 0.8 s loops */
export function brass(): Recipe {
  const H = LIBS.hornSus(), Hs = LIBS.hornSusSoft(), T = LIBS.tbnSus(), P = LIBS.tptSus();
  const h = (m: number, g = 0): Layer => ({ file: at(H, m).file, midi: m, gain: g });
  const hs = (m: number, g = 0): Layer => ({ file: at(Hs, m).file, midi: m, gain: g });
  const t = (m: number, g = -1): Layer => ({ file: at(T, m).file, midi: m, gain: g });
  const p = (m: number, g = -2): Layer => ({ file: at(P, m).file, midi: m, gain: g });
  const plan: [number, Layer[]][] = [
    [39, [h(39), t(39)]],
    [50, [h(50), t(50)]],
    [60, [h(60), t(60), p(60, -3)]],
    [67, [p(67, 0), t(65, -2)]],
    [77, [p(77, 0), hs(77, -3)]],
  ];
  const zones = plan.map(([root, layers]) => sustainZone(root, layers, { base: 28000, lp: 11500, shelf: [4500, -2], maxAtt: 0.15, loopSec: 0.8, xfade: 0.2, startMin: 0.3, clean: { tol: 20, levelDb: -8, fade: 0.012, maxCut: 0.15 } }));
  return { zones: split(zones), sources: ['VSCO 2 CE Brass: F Horn sus v3 (v1 at F5), Tenor Trombone sus v3, Trumpet sus v3'] };
}

/** 09 — concert harp, VSCO 2 CE Harp mf, 5 ring zones A2…D6 at 26 kHz */
export function harp(): Recipe {
  const Hp = LIBS.harp();
  const roots = [45, 55, 65, 76, 86];
  const zones = roots.map((r) => shotZone(r, [{ file: at(Hp, r).file, midi: r, pitch: 'decay', onsetDb: -30, preroll: 0.0008 }], { base: 26000, lp: 11000, hp: 30, maxLen: 0, fadeOut: 0, fadeIn: 0.0015, ring: [0.32, 0.16, 0.06] }));
  return { zones: split(zones), sources: ['VSCO 2 CE Strings/Harp (mf)'] };
}

/** 07 — bell: soft-mallet vibraphone + hand chimes (VCSL) + a soft FM bell layer; 4 ring zones, 22 kHz, dark top */
export function bell(fmZone: (root: number, rate: number) => Float32Array): Recipe {
  const Vb = LIBS.vibes(), Ch = LIBS.chimes();
  const plan: [number, number, number][] = [
    // root, vibes note, chime note
    [64, 64, 64], [71, 71, 72], [77, 77, 78], [84, 84, 84],
  ];
  const zones = plan.map(([root, vn, cn]) => {
    const layers: Layer[] = [
      { file: at(Vb, vn).file, midi: vn, pitch: 'decay', onsetDb: -30, preroll: 0.002, gain: 0 },
      { file: at(Ch, cn).file, midi: cn, pitch: 'decay', onsetDb: -30, preroll: 0.002, gain: -2 },
    ];
    const o: ShotOpts = { base: 22050, lp: 6500, shelf: [4000, -3], maxLen: 0, fadeOut: 0, fadeIn: 0.008 };
    // mix the FM layer into the raw head before looping
    const { y, rate } = shotCore(root, layers, o);
    const fm = fmZone(root, rate);
    const g = fromDb(momentaryMax(y, rate) - momentaryMax(fm, rate) - 9);
    for (let i = 0; i < Math.min(fm.length, y.length); i++) y[i] += fm[i] * g;
    biquad(y, rate, 'lp', 7000, Math.SQRT1_2, 0, true);
    const zone = ringFrom(y, rate, root, 0.8, 0.3, 0.15, 0.008);
    zoneInfo.push({ root, sources: layers.map((l) => l.file).join(' + ') + ' + FM layer', attack: attackTime(zone.data, rate, -3, 0.5), loopCorr: 0 });
    return zone;
  });
  return { zones: split(zones), sources: ['VCSL Vibraphone soft mallets (v1)', 'VCSL Hand Chimes', 'FM bell layer (bank v0 generator, soft index) at −9 dB'] };
}

/** natural head of `H` s + a crossfade loop of `L` s at constant level (the XM envelope decays it) */
function ringFrom(y: Float32Array, rate: number, root: number, H: number, Lsec: number, Xsec: number, fadeIn: number): RZone {
  const X = Math.round(Xsec * rate), s = Math.round(H * rate), L = Math.round(Lsec * rate);
  const margin = Math.round(0.05 * rate);
  const flat = flatten(y, rate, s - X - Math.round(0.05 * rate), s + L + margin, 0.08, 0.05);
  const lp = crossfadeLoop(flat, rate, s, s + L - Math.round(0.02 * rate), s + L + Math.round(0.02 * rate), rate / mtof(root), Xsec);
  const data = lp.data;
  const fi = Math.round(fadeIn * rate) || 8;
  for (let i = 0; i < fi && i < data.length; i++) data[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
  return { data, rootMidi: root, lo: 0, hi: 127, loopStart: lp.loopStart, loopLength: lp.loopLength, loopType: 1, rate };
}

/** 08 — e-piano: VCSL Yamaha TX81Z "FM Piano" (vl2), soft attack; 3 ring zones at 22 kHz (≈3 s decay = XM envelope) */
export function epiano(): Recipe {
  const E = LIBS.epiano();
  const roots = [56, 64, 72];
  const zones = roots.map((r) => shotZone(r, [{ file: at(E, r).file, midi: r, pitch: 'decay', onsetDb: -36, preroll: 0.001 }], { base: 22050, lp: 9500, maxLen: 0, fadeOut: 0, fadeIn: 0.006, ring: [0.5, 0.16, 0.07] }));
  return { zones: split(zones), sources: ['VCSL Electrophones/TX81Z FM Piano (vl2)'] };
}

/** 15 — timpani: VCSL Timpani 2 (loudest hits), 4 drum tunings, 22 kHz, 0.95 s with a faded tail */
export function timpani(): Recipe {
  const seen = new Set<number>();
  const zones: RZone[] = [];
  const tones = timpaniTones();
  for (const t of tones) {
    if (seen.has(t.midi)) continue;
    seen.add(t.midi);
    zones.push(shotZone(t.midi, [t.layer], { base: 22050, lp: 9000, hp: 28, decay: [0.35, 1.6], maxLen: 0.95, fadeOut: 0.45 }));
  }
  // the low keys: the A2 drum a fourth down (the dedicated low drum had an ambiguous split pitch)
  const a2 = tones.find((t) => t.midi === 45);
  if (a2) zones.push(shotZone(40, [{ ...a2.layer, transpose: 0 }], { base: 22050, lp: 9000, hp: 28, decay: [0.35, 1.6], maxLen: 0.95, fadeOut: 0.45 }));
  return { zones: split(zones), sources: ['VCSL Membranophones/Timpani 2 hits v5 (principal mode measured per drum)'] };
}

/** 16 — orchestra hit: spiccato strings (root + octave), brass staccato, timpani, clash cymbal, bass drum; 2 zones */
export function orchHit(): Recipe {
  const vc = LIBS.vcSpic(1), vla = LIBS.vlaSpic(1), vln = LIBS.vlnSpic(1);
  const hs = LIBS.hornStac(), ts = LIBS.tbnStac(), ps = LIBS.tptStac();
  const timp = timpaniTones();
  const roots = [53, 57];
  const zones = roots.map((R) => {
    const L = (list: Entry[], m: number, g: number, tr: number): Layer => {
      const e = nearest(list, m);
      return { file: e.file, midi: e.midi, transpose: tr, gain: g, pitch: 'short', onsetDb: -24, preroll: 0.001 };
    };
    const tp = timp.reduce((a, b) => (Math.abs(b.midi - (R - 12)) < Math.abs(a.midi - (R - 12)) ? b : a));
    const layers: Layer[] = [
      L(vc, R, 0, 0), L(vla, R + 12, -1, 12), L(vln, R + 12, -1, 12),
      L(hs, R, 0, 0), L(ts, R, -1, 0), L(ps, R + 12, -3, 12),
      { ...tp.layer, transpose: -12, gain: -1 },
      { file: `${IDIO}/Clash Cymbals 1/cymbal_crash1_short1.wav`, midi: 60, pitch: 'none', gain: -9, onsetDb: -24, preroll: 0.001 },
      { file: `${V}/Percussion/BDrumNewhit_v6_rr1_Sum.wav`, midi: 60, pitch: 'none', gain: -5, onsetDb: -24, preroll: 0.001 },
    ];
    return shotZone(R, layers, { base: 28000, lp: 12000, hp: 35, decay: [0.09, 1.0], maxLen: 0.7, fadeOut: 0.25, drive: 1.6, align: true });
  });
  return { zones: split(zones), sources: ['VSCO 2 CE spic strings (cello at root, violas + violins an octave up), F Horn / Tenor Trombone / Trumpet stac', 'VCSL Timpani 2 (an octave below)', 'VCSL Clash Cymbals 1 short', 'VSCO 2 CE concert bass drum'] };
}

/** 12 — kick: a synthetic sweep body + a damped concert bass drum (VSCO 2 CE) for skin and boom, 22 kHz */
export function kick(body: Float32Array, bodyRate: number, bdDb = -4, drive = 1.5): Recipe {
  const rate = 22050;
  const bd = load({ file: `${V}/Percussion/BDrumNewhit_v6_rr1_Sum.wav`, midi: 60, pitch: 'none', onsetDb: -30, preroll: 0.0005 });
  const b = resample(bd.x, rate / bd.sr);
  biquad(b, rate, 'lp', 9000, Math.SQRT1_2, 0, false);
  decayFrom(b, rate, 0.04, 0.42);
  const s = resample(body, rate / bodyRate);
  const gb = fromDb(momentaryMax(s, rate) - momentaryMax(b, rate) + bdDb);
  const n = Math.max(s.length, Math.round(0.6 * rate));
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = (s[i] ?? 0) + (b[i] ?? 0) * gb;
  dcBlock(y, rate, 18);
  const pk = peakAbs(y);
  for (let i = 0; i < n; i++) y[i] = (Math.tanh((drive * y[i]) / pk) / Math.tanh(drive)) * pk;
  const data = cut(y, 0, Math.round(0.36 * rate), 0, Math.round(0.08 * rate));
  zoneInfo.push({ root: 60, sources: `synthetic sweep body + ${V}/Percussion/BDrumNewhit_v6_rr1_Sum.wav`, attack: attackTime(data, rate, -3, 0.3) });
  return { zones: [{ data, rootMidi: 60, lo: 0, hi: 127, loopStart: 0, loopLength: 0, loopType: 0, rate }], sources: ['synthetic sine-sweep body (bank v0 kick generator)', 'VSCO 2 CE Percussion/BDrumNewhit v6 (damped)'] };
}

/** 13 — snare: VSCO 2 CE snare (snares on, hardest hit) + VCSL rimshot crack + a touch of VCSL clap, 32 kHz */
export function snare(): Recipe {
  const z = shotZone(
    60,
    [
      { file: `${V}/Percussion/Snare2-HitSN_v9_rr1_Sum.wav`, midi: 60, pitch: 'none', onsetDb: -30, preroll: 0.0005 },
      { file: `${MEMB}/Snare Drum, Modern 3/Snare4_rimshot_v4_rr1_Mid.wav`, midi: 60, pitch: 'none', gain: -6, onsetDb: -30, preroll: 0.0005 },
      { file: `${IDIO}/Claps/Clap_rr1.wav`, midi: 60, pitch: 'none', gain: -13, onsetDb: -30, preroll: 0.0005 },
    ],
    { base: 32000, unpitched: true, hp: 80, lp: 15000, decay: [0.1, 0.7], maxLen: 0.32, fadeOut: 0.1, drive: 1.8 },
  );
  return { zones: [z], sources: ['VSCO 2 CE Percussion/Snare2-HitSN v9', 'VCSL Snare Drum Modern 3 rimshot v4 (−6 dB)', 'VCSL Claps (−13 dB)'] };
}

/**
 * 14 — kit: C-4 closed hat · D-4 pedal hat · E-4 open hat (VCSL Hi-Hat) · F-4 crash (VSCO stick hit
 * on suspended cymbal fff + VCSL clash cymbals fff + VSCO crash ff) · G-4 ride (VSCO suspended
 * cymbal stick f + bell) · A-4 reverse crash (the crash reversed, 1.92 s = 16 rows). 32 kHz
 * (reverse crash 22 kHz), short tails.
 */
export function kit(): Recipe {
  const HH = `${IDIO}/Hi-Hat Cymbal`;
  const o = { unpitched: true, base: 32000 } as const;
  const pin = (z: RZone, key: number, lo: number, hi: number): RZone => ({ ...z, rootMidi: key, lo, hi });
  const closed = shotZone(60, [{ file: `${HH}/HiHat_HitC_v4_rr1_Mid.wav`, midi: 60, pitch: 'none', onsetDb: -30, preroll: 0.0005 }], { ...o, hp: 300, maxLen: 0.16, fadeOut: 0.06 });
  const pedal = shotZone(62, [{ file: `${HH}/HiHat_Close_rr1_Mid.wav`, midi: 62, pitch: 'none', onsetDb: -30, preroll: 0.0005 }], { ...o, hp: 300, maxLen: 0.16, fadeOut: 0.06 });
  const open = shotZone(64, [{ file: `${HH}/HiHat_HitO_rr1_Mid.wav`, midi: 64, pitch: 'none', onsetDb: -30, preroll: 0.0005 }], { ...o, hp: 250, decay: [0.12, 1.1], maxLen: 0.55, fadeOut: 0.25 });
  const crashLayers: Layer[] = [
    { file: `${V}/Percussion/susCymb1-hitstick_fff_rr1.wav`, midi: 65, pitch: 'none', onsetDb: -30, preroll: 0.0005 },
    { file: `${IDIO}/Clash Cymbals 2/cymbal_crash2_fff1.wav`, midi: 65, pitch: 'none', gain: -1.5, onsetDb: -30, preroll: 0.0005 },
    { file: `${V}/Percussion/cymbal-crash1_ff_rr1.wav`, midi: 65, pitch: 'none', gain: -3, onsetDb: -30, preroll: 0.0005 },
  ];
  const crash = shotZone(65, crashLayers, { ...o, hp: 110, decay: [0.4, 1.9], maxLen: 1.5, fadeOut: 0.7 });
  const ride = shotZone(
    67,
    [
      { file: `${V}/Percussion/susCymb1-hitstick_f_rr1.wav`, midi: 67, pitch: 'none', onsetDb: -30, preroll: 0.0005 },
      { file: `${V}/Percussion/susCymb1-hit-bell_mf.wav`, midi: 67, pitch: 'none', gain: -5, onsetDb: -30, preroll: 0.0005 },
    ],
    { ...o, hp: 260, decay: [0.15, 2.0], maxLen: 0.95, fadeOut: 0.4 },
  );
  // reverse crash: the first 1.92 s of the full crash backwards, ending on the hit (a 16-row riser)
  const full = shotZone(65, crashLayers, { unpitched: true, base: 22050, hp: 110, maxLen: 2.0, fadeOut: 0.01 });
  const R = 22050, n = Math.round(1.92 * R);
  const rev = new Float32Array(n);
  for (let i = 0; i < n; i++) rev[i] = full.data[n - 1 - i] ?? 0;
  for (let i = 0; i < Math.round(0.25 * R); i++) rev[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / Math.round(0.25 * R));
  for (let i = 0; i < 48; i++) rev[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / 48);
  const revZ: RZone = { data: rev, rootMidi: 69, lo: 69, hi: 127, loopStart: 0, loopLength: 0, loopType: 0, rate: R };
  zoneInfo.push({ root: 69, sources: 'the F-4 crash layers, reversed (1.92 s)', attack: 1.9 });
  return {
    zones: [pin(closed, 60, 0, 61), pin(pedal, 62, 62, 63), pin(open, 64, 64, 64), pin(crash, 65, 65, 66), pin(ride, 67, 67, 68), revZ],
    sources: ['VCSL Hi-Hat Cymbal (HitC v4, Close, HitO)', 'crash: VSCO 2 CE susCymb1 stick fff + VCSL Clash Cymbals 2 fff + VSCO 2 CE cymbal-crash1 ff', 'ride: VSCO 2 CE susCymb1 stick f + bell mf', 'reverse crash: the crash reversed'],
  };
}

export const describe = (z: RZone) => `${noteName(z.rootMidi)} ${(z.data.length / z.rate).toFixed(2)} s${z.loopLength ? ` loop ${(z.loopLength / z.rate).toFixed(2)} s` : ''} pk ${db(peakAbs(z.data)).toFixed(1)}`;
