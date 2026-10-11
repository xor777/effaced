// Harmony/texture check — "ears" for the composers: dissonant intervals between sounding voices
// (weighted by loudness, duration and register) and crowded mid-register bars.
//   node tools/harmony-check.ts out/act2.xm [--pos 09-0A] [--top 40]
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readXm } from '../src/music/xm/xm.ts';
import { analyseHarmony, formatHarmony } from '../src/music/xm/harmony.ts';
import type { Manifest } from '../src/music/xm/instruments.ts';
import { INS } from '../src/music/roster.ts';

const args = process.argv.slice(2);
const path = resolve(args.find((a) => !a.startsWith('--') && !/^[0-9a-f]{2}(-[0-9a-f]{2})?$/i.test(a)) ?? 'music/effaced.xm');
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const xm = readXm(new Uint8Array(readFileSync(path)));
const ignore: number[] = [INS.kick, INS.snare, INS.hats, INS.scope, INS.marker];
const chordTones: Record<number, number[]> = {};
const man = resolve('music/instruments/manifest.json');
if (existsSync(man)) {
  for (const e of (JSON.parse(readFileSync(man, 'utf8')) as Manifest).instruments) {
    if (e.unpitched && !ignore.includes(e.slot)) ignore.push(e.slot);
    if (e.chordTones) chordTones[e.slot] = e.chordTones;
  }
}
const rep = analyseHarmony(xm, { ignore, allOctaves: [INS.shepard], chordTones });
const range = opt('--pos');
if (range) {
  const [a, b] = range.split('-').map((x) => parseInt(x, 16));
  const lo = a, hi = b ?? a;
  rep.clashes = rep.clashes.filter((c) => c.pos >= lo && c.pos <= hi);
  rep.crowded = rep.crowded.filter((c) => c.pos >= lo && c.pos <= hi);
}
console.log(`${path}`);
console.log(formatHarmony(rep, +(opt('--top') ?? 25)));
