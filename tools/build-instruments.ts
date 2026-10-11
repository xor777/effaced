// Instrument bank v1 → music/instruments/NN-id[-ROOT].wav + manifest.json (MUSIC_BRIEF §9).
//   node tools/build-instruments.ts [--only 3,5,7] [--out dir] [--pitch]
// Sampled slots come from CC0 library recordings in samples/ (tools/bank/sampled.ts; fetch them
// with `node tools/bank/fetch-samples.ts`); the choirs, warm pad, lead, bass, sub, Shepard and
// scope are synthesised from src/audio/synth/bank.ts. The previous synthetic bank is kept in
// music/instruments-synth-v0/ (copied on the first v1 build).
//
// Levels: every instrument is calibrated so that a note at the same volume-column value has the
// same perceived loudness as the v0 instrument the composers balanced against (K-weighted LUFS of
// the zone at its root: held-note loudness 0.5–3 s for loops, momentary 400 ms maximum for
// one-shots), plus a few deliberate corrections (CORRECTIONS below). All zones of an instrument are
// equalised to the same loudness. --only rebuilds some slots and merges them into the manifest.
//
// The manifest follows src/music/xm/instruments.ts (ManifestEntry) with the multi-zone `zones`
// extension (src/audio/synth/xm-zones.ts); `file`/`rootMidi`/loop describe the zone nearest middle C.
// Extra fields (ignored by the XM builder): kind, note, source, sources, level, attackSec, zone lufs.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BANK, renderInstrument, type InstrumentSpec } from '../src/audio/synth/bank.ts';
import { fm } from '../src/audio/synth/synths.ts';
import { kick as synthKick } from '../src/audio/synth/drums.ts';
import type { Manifest, ManifestEntry } from '../src/music/xm/instruments.ts';
import { writeWav } from './wav.ts';
import { zoneLoudness, seamMetrics, softClip, peakAbs, db, fromDb, attackTime, removeDC, phaseRotate, ROTATIONS, limitPeaks } from './bank/dsp.ts';
import * as S from './bank/sampled.ts';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const SR = 44100;
const only = arg('--only')?.split(',').map(Number);
const dir = resolve(arg('--out') ?? 'music/instruments');
const backup = resolve('music/instruments-synth-v0');

// keep the v0 bank the composers balanced against
const live = resolve('music/instruments');
if (existsSync(resolve(live, 'manifest.json')) && !existsSync(backup)) {
  const m = JSON.parse(readFileSync(resolve(live, 'manifest.json'), 'utf8'));
  if (String(m.generator).includes('bank v0')) {
    cpSync(live, backup, { recursive: true });
    console.log(`v0 bank backed up → ${backup}`);
  }
}
mkdirSync(dir, { recursive: true });

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m: number) => NAMES[m % 12] + (Math.floor(m / 12) - 1);

// ---------------------------------------------------------------------------------------------
// level calibration

/**
 * v0 reference loudness per zone (LUFS of the mono zone at its root, metric above), measured on the
 * v0 bank (music/instruments-synth-v0): [root, LUFS] per v0 zone. A v1 zone is calibrated to the v0
 * zone that played its root key, so every register keeps the level the composers balanced against.
 */
const V0: Record<number, [number, number][]> = {
  1: [[50, -14.4], [60, -12.0], [70, -12.1], [80, -12.7]],
  2: [[50, -14.5], [60, -10.2], [70, -13.2], [80, -12.5]],
  3: [[43, -12.4], [55, -12.4], [67, -12.6], [79, -13.8], [91, -9.9]],
  4: [[48, -12.5], [60, -11.7], [72, -13.1]],
  5: [[55, -8.5], [69, -8.7]],
  6: [[64, -6.0], [76, -5.7]],
  7: [[72, -4.8], [88, -4.0]],
  8: [[48, -11.6], [60, -11.3], [72, -11.1]],
  9: [[36, -12.1], [48, -12.1], [60, -14.3], [72, -14.1], [84, -16.1]],
  10: [[33, -6.1], [45, -4.2]],
  12: [[60, -12.4]],
  13: [[60, -21.7]],
  15: [[40, -19.6], [47, -16.9], [54, -17.1]],
  16: [[60, -15.7]],
  19: [[43, -20.5], [55, -18.1], [67, -16.6], [79, -17.0], [91, -14.0]],
};
/** the v0 loudness at a key: the v0 zone whose (half-way split) key range holds it */
function v0At(slot: number, key: number): number {
  const zs = V0[slot];
  let best = zs[0];
  for (let i = 0; i < zs.length; i++) {
    const lo = i === 0 ? -1 : Math.floor((zs[i - 1][0] + zs[i][0]) / 2) + 1;
    if (key >= lo) best = zs[i];
  }
  return best[1];
}
const V0_KIT: Record<number, number> = { 60: -25.2, 62: -26.0, 64: -20.9, 65: -10.2, 67: -14.0, 69: -10.0 };
/** deliberate departures from the v0 levels (dB) — the instruments the user flagged */
const CORRECTIONS: Record<number, [number, string]> = {
  7: [-3, 'the v0 FM bell "hammered": 3 dB lower, plus an 8 ms soft attack and a dark top'],
  13: [4, 'the v0 snare sat ≈9 dB under the kick at the composers\' intended VOL balance (52 vs 60): +4 dB'],
  16: [1, 'orchestra hit +1 dB (S10 climax impact)'],
};
const KIT_CORR: Record<number, [number, string]> = {
  65: [3, 'crash +3 dB: the v0 crash "fell flat" at the S10 climax'],
  69: [1, 'reverse crash +1 dB with the bigger crash'],
};
/** slots whose v0 rendering is kept bit-for-bit (no recalibration) */
const KEEP = new Set([11, 17, 18]);

// ---------------------------------------------------------------------------------------------
// build one slot

type RZone = S.RZone;
/** storage rates of the synthetic slots (the bank must stay ≈3 MB): pads/choirs/bass/FX 22 kHz, lead 28 kHz, sub as v0 */
const SYNTH_RATE: Record<number, number> = { 1: 22050, 2: 22050, 4: 22050, 6: 28000, 10: 22050, 11: 44100, 17: 22050, 18: 22050 };
/** "ring" slots: looped tails, but levelled like the v0 one-shots (momentary max of the first second) */
const RING = new Set([7, 8, 9]);
interface Built { zones: RZone[]; source: 'sampled' | 'synth'; sources: string[] }

function build(spec: InstrumentSpec): Built {
  switch (spec.slot) {
    case 3: return { ...S.strings(), source: 'sampled' };
    case 5: return { ...S.brass(), source: 'sampled' };
    case 7: {
      // the v0 FM bell, much softer index and a slower attack, as a quiet partial layer
      const p = { ...spec.params, i1: 2.2, i1e: 0.3, i2: 0.8, l2: 0.15, attack: 0.008, decay: 6.5 };
      return { ...S.bell((root, rate) => fm(p, rate, root).data), source: 'sampled' };
    }
    case 8: return { ...S.epiano(), source: 'sampled' };
    case 9: return { ...S.harp(), source: 'sampled' };
    case 12: {
      const body = synthKick({ ...spec.params, f0: 140, f1: 50, decay: 0.36, click: 0.5, drive: 2.6, hold: 0.035, sweep: 0.03 }, SR, 60).data;
      return { ...S.kick(body, SR, -4, 2.5), source: 'sampled' };
    }
    case 13: return { ...S.snare(), source: 'sampled' };
    case 14: {
      const k = S.kit();
      return { zones: k.zones, sources: k.sources, source: 'sampled' };
    }
    case 15: return { ...S.timpani(), source: 'sampled' };
    case 16: return { ...S.orchHit(), source: 'sampled' };
    case 19: return { ...S.spiccato(), source: 'sampled' };
    default:
      return { zones: renderInstrument(spec, SYNTH_RATE[spec.slot] ?? SR), source: 'synth', sources: [`synthetic: ${spec.kind} (src/audio/synth/bank.ts) at ${SYNTH_RATE[spec.slot] ?? SR} Hz`] };
  }
}

interface Level { metric: string; refMidi: number; v0Lufs: number | null; correctionDb: number; targetLufs: number | null; lufs: number; peakDb: number; softClipped: number; limitedDb?: number; shortfallDb: number; why?: string }

let need = 0;
let zoneTargets: { root: number; v0: number; lufs: number }[] = [];
/** a zone as it plays (loop unrolled) for `secs` */
function unroll(z: RZone, secs: number): Float32Array {
  const n = Math.round(secs * z.rate), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let k = i;
    if (z.loopLength && k >= z.loopStart + z.loopLength) k = z.loopStart + ((k - z.loopStart) % z.loopLength);
    y[i] = z.data[k] ?? 0;
  }
  return y;
}
/**
 * How far over full scale an instrument may be pushed (dB of peak reduction): one-shots go through a
 * 1.5 ms lookahead limiter (cymbals up to 9 dB, kick / snare / timpani 6 dB, other pitched one-shots
 * 4.5 dB — only the first milliseconds of the transient are touched), loops through a memoryless soft knee (sampled
 * 2.5 dB after trying a phase rotator; synthetic pads/leads 1 dB). Beyond that the level is left short of the target
 * (reported as `shortfallDb`).
 */
const KNEE = (slot: number, looped: boolean, synth: boolean) => (slot === 14 ? 9 : [12, 13, 15].includes(slot) ? 6 : looped ? (synth ? 1 : 2.5) : 4.5);

function calibrate(spec: InstrumentSpec, b: Built): Level {
  need = -99;
  zoneTargets = [];
  const ring = RING.has(spec.slot);
  const loud = (z: RZone) => (ring ? zoneLoudness({ ...z, loopStart: 0, loopLength: 0, data: unroll(z, 1.2) }, z.rate) : zoneLoudness(z, z.rate));
  const metric = ring ? 'momentary max 400 ms of the first 1.2 s (LUFS, mono)' : b.zones[0].loopLength ? 'held-note loudness 0.5–3 s (LUFS, mono)' : 'momentary max 400 ms (LUFS, mono)';
  if (KEEP.has(spec.slot)) {
    const ref = b.zones.reduce((a, z) => (Math.abs(z.rootMidi - 60) < Math.abs(a.rootMidi - 60) ? z : a));
    return { metric, refMidi: ref.rootMidi, v0Lufs: null, correctionDb: 0, targetLufs: null, lufs: loud(ref), peakDb: db(Math.max(...b.zones.map((z) => peakAbs(z.data)))), softClipped: 0, shortfallDb: 0 };
  }
  let clipped = 0, shortfall = 0, limited = 0;
  const fit = (z: RZone, target: number) => {
    // DC: loops lose the mean of the part that repeats forever, one-shots their overall mean
    if (z.loopLength) {
      let m = 0;
      for (let i = z.loopStart; i < z.loopStart + z.loopLength; i++) m += z.data[i];
      m /= z.loopLength;
      for (let i = 0; i < z.data.length; i++) z.data[i] -= m;
    } else removeDC(z.data);
    const scale = () => {
      const g = fromDb(target - loud(z));
      for (let i = 0; i < z.data.length; i++) z.data[i] *= g;
      return peakAbs(z.data);
    };
    let pk = scale();
    if (pk > 0.98 && z.loopLength && !ring && b.source === 'sampled') {
      // try the phase rotators, keep the lowest crest
      let best: Float32Array | null = null, bp = pk;
      for (const set of ROTATIONS) {
        const y = phaseRotate(z.data.slice(), z.rate, set);
        const g = fromDb(target - zoneLoudness({ ...z, data: y }, z.rate));
        const p = peakAbs(y) * g;
        if (p < bp - 0.02) (bp = p), (best = y);
      }
      if (best) {
        z.data = best;
        pk = scale();
      }
    }
    need = Math.max(need, db(pk / 0.98));
    if (pk > 0.98) {
      const over = db(pk / 0.98), max = KNEE(spec.slot, z.loopLength > 0 && !ring, b.source === 'synth');
      if (over > max) {
        const back = fromDb(-(over - max));
        for (let i = 0; i < z.data.length; i++) z.data[i] *= back;
        shortfall = Math.max(shortfall, over - max);
      }
      // one-shots: a lookahead limiter on the transient (re-levelled until it converges);
      // loops: a memoryless soft knee (seam-safe)
      if (z.loopLength && !ring) clipped += softClip(z.data, 0.8);
      else {
        let gr = limitPeaks(z.data, z.rate, 0.98);
        for (let it = 0; it < 4; it++) {
          const miss = target - loud(z);
          if (miss < 0.15 || gr + miss > max) break;
          for (let i = 0; i < z.data.length; i++) z.data[i] *= fromDb(miss);
          gr += limitPeaks(z.data, z.rate, 0.98);
        }
        limited = Math.max(limited, gr);
      }
    }
    shortfall = Math.max(shortfall, target - loud(z));
  };
  if (spec.slot === 14) {
    for (const z of b.zones) fit(z, V0_KIT[z.rootMidi] + (KIT_CORR[z.rootMidi]?.[0] ?? 0));
    zoneTargets = b.zones.map((z) => ({ root: z.rootMidi, v0: V0_KIT[z.rootMidi], lufs: +loud(z).toFixed(2) }));
    const crash = b.zones.find((z) => z.rootMidi === 65)!;
    return {
      metric, refMidi: 65, v0Lufs: V0_KIT[65], correctionDb: KIT_CORR[65][0], targetLufs: V0_KIT[65] + KIT_CORR[65][0], lufs: loud(crash),
      peakDb: db(Math.max(...b.zones.map((z) => peakAbs(z.data)))), softClipped: clipped, limitedDb: +limited.toFixed(2), shortfallDb: +Math.max(0, shortfall).toFixed(2), why: Object.values(KIT_CORR).map((c) => c[1]).join('; '),
    };
  }
  const corr = CORRECTIONS[spec.slot]?.[0] ?? 0;
  for (const z of b.zones) fit(z, v0At(spec.slot, z.rootMidi) + corr);
  const ref = b.zones.reduce((a, z) => (Math.abs(z.rootMidi - 64) < Math.abs(a.rootMidi - 64) ? z : a));
  const v0 = v0At(spec.slot, ref.rootMidi);
  zoneTargets = b.zones.map((z) => ({ root: z.rootMidi, v0: v0At(spec.slot, z.rootMidi), lufs: +loud(z).toFixed(2) }));
  return {
    metric, refMidi: ref.rootMidi, v0Lufs: v0, correctionDb: corr, targetLufs: v0 + corr, lufs: loud(ref),
    peakDb: db(Math.max(...b.zones.map((z) => peakAbs(z.data)))), softClipped: clipped, limitedDb: +limited.toFixed(2), shortfallDb: +Math.max(0, shortfall).toFixed(2), why: CORRECTIONS[spec.slot]?.[1],
  };
}

// ---------------------------------------------------------------------------------------------

interface MZone { file: string; rootMidi: number; lo: number; hi: number; keys?: number[]; loopStart: number; loopLength: number; loopType: 0 | 1 | 2; rate?: number; lufs?: number; v0Lufs?: number }
type Entry = ManifestEntry & { zones: MZone[]; note: string; kind: string; source?: string; sources?: string[]; level?: Level; attackSec?: number };

const manPath = resolve(dir, 'manifest.json');
const haveSamples = existsSync(S.LIB);
const prev: Entry[] = (only || !haveSamples) && existsSync(manPath) ? JSON.parse(readFileSync(manPath, 'utf8')).instruments : [];
if (!haveSamples) console.log(`samples/ not present: sampled slots keep their shipped WAVs (re-fetch: node tools/bank/fetch-samples.ts); synthetic slots are rebuilt`);
const bytesOf: Record<number, number> = {};
const srcRows: { spec: InstrumentSpec; source: string; sources: string[]; zones: { m: MZone; z: RZone; info?: S.ZoneInfo }[] }[] = [];
const entries: Entry[] = [];
const rows: string[] = [];
const t0 = performance.now();
for (const spec of BANK) {
  if (only && !only.includes(spec.slot)) {
    const e = prev.find((x) => x.slot === spec.slot);
    if (e) entries.push(e);
    continue;
  }
  const t = performance.now();
  S.zoneInfo.length = 0;
  if (!haveSamples && spec.sampled) {
    // no library on disk: keep the shipped zones of the sampled slots as they are
    const e = prev.find((x) => x.slot === spec.slot);
    if (!e) throw new Error(`slot ${spec.slot}: samples/ is missing and ${dir} has no previous build of it — run: node tools/bank/fetch-samples.ts`);
    entries.push({ ...e, name: spec.name, volume: spec.volume, fadeout: spec.fadeout, volEnv: spec.volEnv, sends: spec.sends, note: spec.note });
    rows.push(`${String(spec.slot).padStart(2)} ${spec.id.padEnd(8)} kept (samples/ not present)`);
    continue;
  }
  const b: Built = build(spec);
  const level: Level = calibrate(spec, b);
  const headroom = need;
  const infos = [...S.zoneInfo];
  const nn = String(spec.slot).padStart(2, '0');
  // remove this slot's old files (zone roots may have changed)
  for (const f of readdirSync(dir)) if (f.startsWith(`${nn}-`) && f.endsWith('.wav')) rmSync(resolve(dir, f));
  bytesOf[spec.slot] = 0;
  const mz: MZone[] = b.zones.map((z) => {
    const file = b.zones.length === 1 ? `${nn}-${spec.id}.wav` : `${nn}-${spec.id}-${noteName(z.rootMidi).replace('#', 's')}.wav`;
    writeWav(resolve(dir, file), Math.round(z.rate), [z.data]);
    bytesOf[spec.slot] += 44 + z.data.length * 2;
    const zt = zoneTargets.find((x) => x.root === z.rootMidi);
    const e: MZone = { file, rootMidi: z.rootMidi, lo: z.lo, hi: z.hi, loopStart: z.loopStart, loopLength: z.loopLength, loopType: z.loopType, rate: Math.round(z.rate), lufs: zt?.lufs ?? +zoneLoudness(z, z.rate).toFixed(2), ...(zt ? { v0Lufs: zt.v0 } : {}) };
    if (z.keys) e.keys = z.keys;
    return e;
  });
  srcRows.push({ spec, source: b.source, sources: b.sources, zones: mz.map((m, i) => ({ m, z: b.zones[i], info: infos.find((x) => x.root === m.rootMidi) })) });
  const def = mz.reduce((a, c) => (Math.abs(c.rootMidi - 60) < Math.abs(a.rootMidi - 60) ? c : a));
  const defZ = b.zones[mz.indexOf(def)];
  const attackSec = +attackTime(defZ.data, defZ.rate, -3, defZ.loopLength ? 1.5 : 0.5).toFixed(3);
  entries.push({
    slot: spec.slot,
    name: spec.name,
    file: def.file,
    rootMidi: def.rootMidi,
    loopStart: def.loopStart,
    loopLength: def.loopLength,
    loopType: def.loopType,
    volume: spec.volume,
    panning: 128,
    fadeout: spec.fadeout,
    ...(spec.volEnv ? { volEnv: spec.volEnv } : {}),
    ...(spec.chordTones ? { chordTones: spec.chordTones } : {}),
    ...(spec.unpitched ? { unpitched: true } : {}),
    sends: spec.sends,
    kind: b.source === 'sampled' ? 'sampled' : spec.kind,
    note: spec.note,
    source: b.source,
    sources: b.sources,
    level: { ...level, lufs: +level.lufs.toFixed(2), peakDb: +level.peakDb.toFixed(2) },
    attackSec,
    zones: mz,
  });
  const secs = b.zones.map((z) => z.data.length / z.rate);
  let worst = { step: 0, levelDb: 0, specDb: 0 };
  for (const z of b.zones)
    if (z.loopLength) {
      const m = seamMetrics(z.data, z.rate, z.loopStart, z.loopLength);
      worst = { step: Math.max(worst.step, m.step), levelDb: Math.max(worst.levelDb, Math.abs(m.levelDb)), specDb: Math.max(worst.specDb, m.specDb) };
    }
  rows.push(
    `${String(spec.slot).padStart(2)} ${spec.id.padEnd(8)} ${b.source.padEnd(7)} zones ${String(b.zones.length).padStart(2)} ${Math.min(...secs).toFixed(2)}–${Math.max(...secs).toFixed(2)} s ` +
      `${b.zones[0].loopLength ? `seam ${worst.step.toFixed(1)}× ${worst.levelDb.toFixed(2)} dB ${worst.specDb.toFixed(1)} dBsp` : 'one-shot                    '} ` +
      `att ${attackSec.toFixed(3)} s  ${level.lufs.toFixed(1)} LUFS (v0 ${level.v0Lufs ?? '—'}${level.correctionDb ? ` ${level.correctionDb > 0 ? '+' : ''}${level.correctionDb}` : ''}) pk ${level.peakDb.toFixed(1)}${level.softClipped ? ` knee ${level.softClipped} (+${headroom.toFixed(1)} dB)` : ''}${level.limitedDb ? ` lim ${level.limitedDb.toFixed(1)} dB` : ''}${level.shortfallDb ? ` SHORT ${level.shortfallDb.toFixed(1)} dB` : ''}  ${(bytesOf[spec.slot] / 1024).toFixed(0)} KB  ${((performance.now() - t) / 1000).toFixed(1)} s`,
  );
}
entries.sort((a, b) => a.slot - b.slot);
S.savePitchCache();
const notes = [
  'bank v1: sampled slots from VSCO 2 Community Edition and VCSL by Versilian Studios (CC0), see each entry\'s `sources`; synthetic slots from src/audio/synth/bank.ts.',
  'Tuning: every pitched zone is resampled to an XM-exact rate (src/audio/synth/bank.ts xmExactRate) after its pitch was measured, so libopenmpt/FT2 1/16-semitone finetune is exact.',
  'Levels (`level`, zone `lufs` / `v0Lufs`): every zone is calibrated to the loudness of the v0 zone that played the same key (the bank the score was balanced against), plus the listed corrections — the same volume-column value gives the v0 role level in every register. Metric: K-weighted LUFS of the mono zone at its root — loops: held note 0.5–3 s; one-shots and ring instruments (bell, e-piano, harp): momentary 400 ms max. `shortfallDb`: how far the loudest zone stayed under its target (full-scale limit).',
  'Sends (`sends`) are the engine FX sends (src/audio/engine-core.ts reads them from BANK in src/audio/synth/bank.ts).',
];
// fixes applied after the first v1 build (tools/bank/repair-v1.ts) — the recipes now include them
const repairs = ['cleanHead:3', 'cleanHead:5', 'splits:3', 'timpani:dropE2', 'timpani:E2fromA2'];
const manifest: Manifest & { generator: string; notes: string[]; repairs: string[] } = { sampleRate: SR, generator: 'tools/build-instruments.ts (bank v1)', notes, repairs, instruments: entries };
writeFileSync(manPath, JSON.stringify(manifest, null, 1) + '\n');
console.log(rows.join('\n'));
let bytes = 0;
for (const f of readdirSync(dir)) if (f.endsWith('.wav')) bytes += readFileSync(resolve(dir, f)).length;
console.log(`${entries.length} instruments → ${dir} (${(bytes / 1e6).toFixed(2)} MB of wav = ${(bytes / 1048576).toFixed(2)} MiB) in ${((performance.now() - t0) / 1000).toFixed(1)} s${only ? ` (rebuilt ${only.join(',')}, merged)` : ''}`);
if (process.argv.includes('--pitch')) for (const m of S.measured) console.log(`  pitch ${m.file.split('/').pop()!.padEnd(44)} ${m.nominal.padEnd(4)} ${m.hz.toFixed(2)} Hz ${m.cents.toFixed(1)}`);

// ---------------------------------------------------------------------------------------------
// music/instruments/SOURCES.md: where every zone came from and how it was made (the raw library
// downloads are not kept; tools/bank/fetch-samples.ts re-fetches the files listed at the end)

/** how each slot is made (beyond the per-zone sources) */
const PROCESS: Record<number, string> = {
  1: 'PADsynth (src/audio/synth/padsynth.ts): mixed male/female formant sets, 40-cent ensemble bandwidth, partials ≤ 9.5 kHz, lowest-crest of 8 random-phase tables; one table = the whole seamless loop. Zone roots A3/F#4/G#5 are placed so the score\'s 3xx legato chains stay within ±7 semitones of their zone.',
  2: 'PADsynth as 01, "ooh" formants, partials ≤ 8 kHz.',
  3: 'Unison layers per zone, each onset-trimmed, pitch measured (YIN median over the sustain) and resampled (Kaiser sinc) to the XM-exact rate of its root; lowpass 12 kHz, high shelf −3 dB @ 5 kHz; envelope flattened over the sustain; 1.1 s crossfade loop (0.25 s, correlation-matched, linear↔equal-power by correlation). Head cleaned (dsp.ts cleanHead): cut to where the pitch is within ±10 c and the level within −3 dB of the sustain, evened to the sustain level, 40 ms fade-in. Key splits chosen for the score\'s legato chains.',
  4: 'PADsynth hollow pad (even partials −7 dB), partials ≤ 7 kHz, no LFO.',
  5: 'As 03 (no splice); lowpass 11.5 kHz, shelf −2 dB @ 4.5 kHz; 0.8 s loops; peaks: phase rotator (allpass cascade) then ≤ 2.5 dB soft knee. Head cleaned: cut to where the pitch is within ±20 c (lip scoops removed), the plateau before a late swell evened to the sustain level, 12 ms fade-in.',
  6: 'Subtractive synth (src/audio/synth/synths.ts): 3 detuned saw/pulse oscillators, 2-stage lowpass, periodic loop.',
  7: 'Vibraphone + hand chimes (−2 dB) pitch-matched and summed, plus the v0 FM bell (soft index) at −9 dB; lowpass 6.5/7 kHz, shelf −3 dB @ 4 kHz; 8 ms raised-cosine attack; 0.8 s natural head, then a 0.3 s loop held at constant level — the tail is the XM volume envelope (T60 4.5 s); transient limited ≤ 4.5 dB.',
  8: 'Onset-trimmed, pitch-matched, lowpass 9.5 kHz, 6 ms soft attack; 0.5 s natural head + 0.16 s loop; tail = XM envelope (≈3 s).',
  9: 'Onset-trimmed, pitch-matched, lowpass 11 kHz; 0.32 s natural head + 0.16 s loop; tail = XM envelope (T60 2.2 s).',
  10: 'Subtractive synth: saw/pulse, filter pluck, drive; periodic loop.',
  11: 'Sine + 2nd/3rd harmonic (unchanged from v0).',
  12: 'v0 sine-sweep kick body (140→50 Hz, click) + damped concert bass drum (−4 dB, LP 9 kHz, T60 0.42 s), tanh glue; 0.36 s.',
  13: 'Snare + rimshot (−6 dB) + clap (−13 dB), HP 80 Hz, extra decay T60 0.7 s, tanh glue; 0.32 s.',
  14: 'Hats trimmed to 0.16 / 0.16 / 0.55 s; crash = three cymbals layered (HP 110 Hz, T60 1.9 s from 0.4 s, 1.5 s); ride = stick + bell (T60 2 s, 0.95 s); reverse crash = the crash reversed, 1.92 s at 22 kHz; transients through a 1.5 ms lookahead limiter.',
  15: 'Loudest hits; pitch = principal (1,1) mode found from the 1 : 1.5 : 2 mode pattern; lowpass 9 kHz, extra decay from 0.35 s, 0.95 s; tight onset (0.8 ms pre-roll) for R03 rolls. The low drum (Timpani1C) was dropped — its principal mode is split E2+26 c / F2+44 c, an ambiguous pitch; the E2 zone is the A2 drum a fourth down.',
  16: 'Cello spic at the root, viola + violin spic an octave up, horn + trombone stac at the root, trumpet stac an octave up, timpani an octave below, short clash cymbal (−9 dB), bass drum (−5 dB); attacks aligned (each layer\'s −6 dB point), tanh drive 1.6, decay T60 1 s, 0.7 s.',
  17: 'Shepard tone, 12 pitch-class zones (unchanged generator, 0.17 s loops at 22 kHz).',
  18: 'Scope preview tone (unchanged generator, 0.25 s loop at 22 kHz).',
  19: 'Round robins 1 + 2 stacked (−3 dB) per section, onsets cut at −14 dB re peak (4 ms pre-roll) and aligned; pitch from the loud 30–200 ms; lowpass 12 kHz, shelf −2 dB @ 5 kHz, extra decay T60 0.45 s from 90 ms; 0.36 s.',
};
const REPO: Record<string, string> = { vsco2ce: 'https://github.com/sgossner/VSCO-2-CE (branch master)', vcsl: 'https://github.com/sgossner/VCSL (branch master)' };

function writeSources(): void {
  const out: string[] = [];
  out.push('# Instrument bank v1 — sources', '');
  out.push('Generated by `node tools/build-instruments.ts`. Every sampled zone below was made from recordings of two CC0 (public domain) libraries by Versilian Studios:', '');
  for (const [k, v] of Object.entries(REPO)) out.push(`- \`${k}/…\` = ${v} — CC0 1.0`);
  out.push('', 'File paths are relative to the repository root (drop the `vsco2ce/` / `vcsl/` prefix). The raw downloads are not kept in this project; `node tools/bank/fetch-samples.ts` re-downloads exactly the files listed at the end into `samples/` (79 files, ≈90 MB), after which the build reproduces this bank.', '');
  out.push('Notes are scientific pitch (C4 = middle C = tracker C-4).', '');
  out.push('Common processing: stereo → mono (L+R, or the louder channel when the pair is anti-correlated); onset trimmed; pitch measured and every pitched zone resampled (Kaiser-windowed sinc) to an XM-exact rate so libopenmpt/FT2 1/16-semitone finetune is exact; DC removed; level calibrated per zone to the v0 zone that played the same key (see manifest `level`, zone `lufs`/`v0Lufs`).', '');
  let total = 0;
  for (const r of srcRows) {
    const bytes = r.zones.reduce((a, z) => a + 44 + z.z.data.length * 2, 0);
    total += bytes;
    out.push(`## ${String(r.spec.slot).padStart(2, '0')} ${r.spec.name} (${r.source}, ${(bytes / 1024).toFixed(0)} KB)`, '');
    out.push(r.spec.note, '');
    if (PROCESS[r.spec.slot]) out.push(`Processing: ${PROCESS[r.spec.slot]}`, '');
    out.push('| zone | keys | rate | length | loop | source |', '|---|---|---|---|---|---|');
    for (const { m, z, info } of r.zones) {
      const keys = m.keys ? `${noteName((m.keys[0] % 12) + 60).replace(/-?\d+$/, '')} (every octave)` : m.lo === 0 && m.hi === 127 ? 'all' : m.lo === 0 ? `≤ ${noteName(m.hi)}` : m.hi === 127 ? `≥ ${noteName(m.lo)}` : `${noteName(m.lo)}–${noteName(m.hi)}`;
      const loop = z.loopLength ? `${(z.loopStart / z.rate).toFixed(2)} + ${(z.loopLength / z.rate).toFixed(2)} s` : '—';
      out.push(`| \`${m.file}\` ${noteName(m.rootMidi)} | ${keys} | ${Math.round(z.rate)} | ${(z.data.length / z.rate).toFixed(2)} s | ${loop} | ${info?.sources.replaceAll('|', '/') ?? (r.source === 'synth' ? 'synthetic' : r.sources.join('; '))} |`);
    }
    out.push('');
  }
  out.push(`Total: ${(total / 1024).toFixed(0)} KB of 16-bit mono WAV.`, '');
  out.push('## Files', '', 'Library files read by the build (relative to `samples/`):', '', '```');
  for (const f of [...S.used].sort()) out.push(f);
  out.push('```', '');
  writeFileSync(resolve(dir, 'SOURCES.md'), out.join('\n'));
}

if (haveSamples && !only && dir === live) writeSources();
