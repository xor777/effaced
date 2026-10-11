// Score (TypeScript DSL) → .xm, then xm-check.
//   node tools/build-xm.ts [music/score/effaced.ts] [music/effaced.xm] [--strict]
// Instruments come from music/instruments/manifest.json (tools/build-instruments.ts); until that
// exists, recognisable placeholder waveforms are used so the loop works from day one.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { type XmInstrument, type XmModule, writeXm } from '../src/music/xm/xm.ts';
import { type Manifest, toXmInstrument, markerInstrument, placeholderInstruments } from '../src/music/xm/instruments.ts';
import { checkXm, formatReport } from '../src/music/xm/check.ts';
import type { ScoreSong } from '../src/music/score/dsl.ts';
import { INS, CHANNELS, DIARY } from '../src/music/roster.ts';
import { readWav, mono } from './wav.ts';
import { manifestToXmInstrument } from '../src/audio/synth/xm-zones.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const strict = process.argv.includes('--strict');
const scorePath = resolve(args[0] ?? 'music/score/effaced.ts');
const outPath = resolve(args[1] ?? 'music/effaced.xm');
const manifestPath = resolve('music/instruments/manifest.json');

const t0 = performance.now();
const mod = await import(pathToFileURL(scorePath).href);
const score: ScoreSong = mod.default ?? mod.song;
if (!score?.patterns) throw new Error(`${scorePath}: default export must be song({...})`);

// --- instruments
const slots = new Map<number, XmInstrument>();
const chordTones: Record<number, number[]> = {};
const unpitched: number[] = [];
let source: string;
if (existsSync(manifestPath)) {
  const man: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const load = (file: string) => {
    const w = readWav(resolve(dirname(manifestPath), file));
    return { data: mono(w), sampleRate: w.sampleRate };
  };
  for (const e of man.instruments) {
    // multi-zone instruments (samples + sampleMap); single-zone entries fall back to toXmInstrument
    slots.set(e.slot, manifestToXmInstrument(e, load));
    if (e.chordTones) chordTones[e.slot] = e.chordTones;
    if (e.unpitched) unpitched.push(e.slot);
  }
  source = `manifest (${man.instruments.length} instruments)`;
} else {
  const ph = placeholderInstruments();
  for (const e of ph.instruments) {
    slots.set(e.slot, toXmInstrument(e, ph.data.get(e.slot)!, ph.sampleRate!));
    if (e.unpitched) unpitched.push(e.slot);
  }
  source = 'PLACEHOLDER waveforms (music/instruments/manifest.json not found)';
}
slots.set(INS.marker, markerInstrument());
const instruments: XmInstrument[] = [];
for (let s = 1; s <= INS.marker; s++) instruments.push(slots.get(s) ?? { name: '', samples: [], fadeout: 0 });
// the diary (PLAN appendix B) replaces the working names of slots 01–16
DIARY.forEach((line, i) => {
  if (line.length > 22) throw new Error(`diary line ${i + 1} is ${line.length} chars, XM allows 22`);
  instruments[i] = { ...instruments[i], name: line };
});

const xm: XmModule = {
  name: score.name.slice(0, 20),
  tracker: 'EFFACED score dsl',
  channels: CHANNELS,
  speed: 6,
  bpm: 125,
  linear: true,
  restart: 0,
  order: score.order,
  patterns: score.patterns.map((b) => b.pattern),
  instruments,
};
const bytes = writeXm(xm);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, bytes);

// --- check
const rep = checkXm(xm, { chordTones, unpitched });
const patBytes = writeXm({ ...xm, instruments: [] }).length - 336;
rep.stats.patternBytes = patBytes;
console.log(`${outPath}: ${bytes.length} bytes, ${score.patterns.length} patterns, instruments: ${source}`);
console.log(`pattern data ${patBytes} B packed, ${gzipSync(writeXm({ ...xm, instruments: [] })).length} B gzip · built in ${(performance.now() - t0).toFixed(0)} ms`);
console.log(formatReport(rep));
const errors = rep.issues.filter((i) => i.level === 'error').length;
if (errors && strict) process.exit(1);
