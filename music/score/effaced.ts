// EFFACED — the whole song: 32 positions 00–1F, one pattern per position (repeats are deduplicated by
// the DSL when patterns turn out identical). Build + check:
//   node tools/build-xm.ts music/score/effaced.ts music/effaced.xm
//   node tools/render-xm.ts music/effaced.xm out/effaced.wav
// Blueprint and rules: music/score/NOTES.md.

import { song } from '../../src/music/score/dsl.ts';
import { CH } from '../../src/music/roster.ts';
import { auditSustain } from './theory.ts';
import * as act1 from './act1.ts';
import * as act2 from './act2.ts';
import * as act3 from './act3.ts';
import * as act4 from './act4.ts';
import * as act5 from './act5.ts';

const acts = [act1, act2, act3, act4, act5];
const order = acts.flatMap((a) => a.order);
if (order.length !== 32) throw new Error(`order has ${order.length} positions, expected 32`);

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const effaced = song({
  name: 'EFFACED',
  patterns: Object.assign({}, ...acts.map((a) => a.patterns)),
  order,
  // the lead echo (MUSIC_BRIEF §3): ch11 = ch10 three rows later at 50 %. On in Acts II and IV and the
  // S9 build (12–13); off in Act I (ch11 unused), 0D–11 (ch11 free for the Act III composer) and Act V
  // (1C–1E write ch11 by hand inside the drop-out schedule; 1F has no lead).
  echo: { from: CH.lead, to: CH.echo, delay: 3, vol: 0.5, positions: [...range(0x05, 0x0c), ...range(0x12, 0x1b)] },
});

// sustained notes left ringing for more than two patterns (deliberately long ones are listed)
// (the S8 pads and strings hold Dm9 through the whole lilac-chaser cycle)
const LONG_ON_PURPOSE = ['7@0E:62', '8@0E:60', '12@0E:63'];
for (const line of auditSustain(effaced, 128, LONG_ON_PURPOSE)) console.warn(`[score] sustain: ${line}`);

export default effaced;
