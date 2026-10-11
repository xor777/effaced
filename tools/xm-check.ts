// xm-check: validate any .xm against MUSIC_BRIEF.md (timing, effects, white keys, markers, motifs).
//   node tools/xm-check.ts music/effaced.xm
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readXm } from '../src/music/xm/xm.ts';
import { checkXm, formatReport } from '../src/music/xm/check.ts';
import type { Manifest } from '../src/music/xm/instruments.ts';

const path = resolve(process.argv[2] ?? 'music/effaced.xm');
const xm = readXm(new Uint8Array(readFileSync(path)));
const chordTones: Record<number, number[]> = {};
const unpitched: number[] = [];
const manifestPath = resolve('music/instruments/manifest.json');
if (existsSync(manifestPath)) {
  const man: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const e of man.instruments) {
    if (e.chordTones) chordTones[e.slot] = e.chordTones;
    if (e.unpitched) unpitched.push(e.slot);
  }
} else unpitched.push(12, 13, 14);
const rep = checkXm(xm, { chordTones, unpitched });
console.log(`${path}: "${xm.name}" ${xm.channels} ch, speed ${xm.speed}, BPM ${xm.bpm}, ${xm.order.length} positions`);
console.log(formatReport(rep));
process.exit(rep.issues.some((i) => i.level === 'error') ? 1 : 0);
