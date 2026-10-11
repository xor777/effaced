// One-off repair of the shipped bank v1 WAVs (the library recordings are not kept, so the fixes the
// recipes in tools/bank/sampled.ts now apply at build time are applied here to music/instruments/):
//   node tools/bank/repair-v1.ts
//  · 03 strings, 05 brass: cleanHead() — no splice dip, no onset pitch scoop (dsp.ts)
//  · 03 strings: key splits [≤45 G2 · 46–53 D3 · 54–60 B3 · 61–72 A4 · ≥73 G5] so the score's 3xx
//    legato chains stay within about ±5 semitones of their zone
//  · 15 timpani: the E2 zone (VCSL Timpani1C, an ambiguous drum with a split principal mode at
//    E2+26 c / F2+44 c) is replaced by the A2 drum resampled a fourth down (levelled to v0 E2)
// Idempotent: the manifest records what was done in `repairs`.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWav, mono, writeWav } from '../wav.ts';
import { cleanHead, mtof, resample, cut, fromDb, momentaryMax, peakAbs, limitPeaks } from './dsp.ts';
import { xmExactRate } from '../../src/audio/synth/bank.ts';

const dir = resolve(process.env.BANK_DIR ?? 'music/instruments');
const manPath = resolve(dir, 'manifest.json');
const man = JSON.parse(readFileSync(manPath, 'utf8'));
man.repairs ??= [];
const done = (k: string) => man.repairs.includes(k);
const entry = (slot: number) => man.instruments.find((e: { slot: number }) => e.slot === slot);

for (const [slot, o] of [
  [3, { tol: 10, levelDb: -3, fade: 0.04, maxCut: 0.25 }],
  [5, { tol: 20, levelDb: -8, fade: 0.012, maxCut: 0.15 }],
] as const) {
  const key = `cleanHead:${slot}`;
  if (done(key)) continue;
  const e = entry(slot);
  for (const z of e.zones) {
    const w = readWav(resolve(dir, z.file));
    const x = mono(w);
    const r = cleanHead(x, w.sampleRate, mtof(z.rootMidi), z.loopStart, z.loopLength, o);
    writeWav(resolve(dir, z.file), w.sampleRate, [r.data]);
    console.log(`${z.file}: cut ${((r.cut / w.sampleRate) * 1000).toFixed(0)} ms, head gain ≤ +${r.maxGainDb.toFixed(1)} dB, loop ${z.loopStart} → ${z.loopStart - r.cut}`);
    z.loopStart -= r.cut;
  }
  const def = e.zones.find((z: { file: string }) => z.file === e.file);
  if (def) e.loopStart = def.loopStart;
  man.repairs.push(key);
}

if (!done('splits:3')) {
  const e = entry(3);
  const firsts = [0, 46, 54, 61, 73];
  e.zones.sort((a: { rootMidi: number }, b: { rootMidi: number }) => a.rootMidi - b.rootMidi);
  e.zones.forEach((z: { lo: number; hi: number }, i: number) => {
    z.lo = firsts[i];
    z.hi = i + 1 < firsts.length ? firsts[i + 1] - 1 : 127;
  });
  man.repairs.push('splits:3');
  console.log('03 strings splits', e.zones.map((z: { rootMidi: number; lo: number; hi: number }) => `${z.rootMidi}:${z.lo}–${z.hi}`).join(' '));
}

if (!done('timpani:dropE2')) {
  const e = entry(15);
  const z0 = e.zones.find((z: { rootMidi: number }) => z.rootMidi === 40);
  if (z0) {
    e.zones = e.zones.filter((z: { rootMidi: number }) => z.rootMidi !== 40);
    e.zones.sort((a: { rootMidi: number }, b: { rootMidi: number }) => a.rootMidi - b.rootMidi);
    e.zones[0].lo = 0;
    if (existsSync(resolve(dir, z0.file))) rmSync(resolve(dir, z0.file));
    const def = e.zones.reduce((a: { rootMidi: number }, b: { rootMidi: number }) => (Math.abs(b.rootMidi - 60) < Math.abs(a.rootMidi - 60) ? b : a));
    Object.assign(e, { file: def.file, rootMidi: def.rootMidi, loopStart: 0, loopLength: 0, loopType: 0 });
    e.note = 'concert timpani, 3 drum tunings A2 (covers ≤ A#2) / C3 / F3 at 22 kHz (pitch = principal mode), 0.95 s; tight onsets for R03 rolls';
    console.log('15 timpani: E2 zone dropped, A2 zone covers', `${e.zones[0].lo}–${e.zones[0].hi}`);
  }
  man.repairs.push('timpani:dropE2');
}
// the low timpani keys (≤ G2) get their own zone again: the A2 drum resampled a fourth down
// (E2 root), levelled to the v0 E2 zone (−19.6 LUFS momentary) so low rolls keep their role level
if (!done('timpani:E2fromA2')) {
  const e = entry(15);
  const a2 = e.zones.find((z: { rootMidi: number }) => z.rootMidi === 45);
  const w = readWav(resolve(dir, a2.file));
  const src = mono(w);
  const rate = xmExactRate(22050, 40);
  // A2 at w.sampleRate → E2 at `rate`: ratio = rate · f(A2) / (w.sampleRate · f(E2))
  let y = resample(src, (rate * mtof(45)) / (w.sampleRate * mtof(40)));
  const n = Math.round(0.95 * rate);
  y = cut(y, 0, n, 0, Math.round(0.45 * rate));
  const g = fromDb(-19.6 - momentaryMax(y, rate));
  for (let i = 0; i < y.length; i++) y[i] *= g;
  const gr = peakAbs(y) > 0.98 ? limitPeaks(y, rate, 0.98) : 0;
  const file = '15-timpani-E2.wav';
  writeWav(resolve(dir, file), Math.round(rate), [y]);
  a2.lo = 43;
  e.zones.unshift({ file, rootMidi: 40, lo: 0, hi: 42, loopStart: 0, loopLength: 0, loopType: 0, rate: Math.round(rate), lufs: +momentaryMax(y, rate).toFixed(2), v0Lufs: -19.6 });
  e.note = 'concert timpani, 4 zones E2 (the A2 drum a fourth down) / A2 / C3 / F3 at 22 kHz (pitch = principal mode), 0.95 s; tight onsets for R03 rolls';
  man.repairs.push('timpani:E2fromA2');
  console.log(`15 timpani: E2 zone = A2 drum −5 st, ${momentaryMax(y, rate).toFixed(1)} LUFS, limiter ${gr.toFixed(1)} dB`);
}
writeFileSync(manPath, JSON.stringify(man, null, 1) + '\n');
