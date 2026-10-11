// ENGINE STRESS TEST (not music): 32 unique, dense, seeded-random patterns with every channel
// busy all the time — used to measure render time of a full-length (4:06 + tail) module.
//   node tools/build-xm.ts music/score/_stress.ts out/stress.xm && node tools/render-xm.ts out/stress.xm
import { song, type PatternDef } from '../../src/music/score/dsl.ts';

let seed = 0xeffaced;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const WHITE = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const note = (lo: number, hi: number) => `${pick(WHITE)}-${lo + Math.floor(rnd() * (hi - lo + 1))}`;
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/** a 64-row track: every `step` rows a token from gen(row), else empty */
function track(step: number, gen: (row: number) => string): string {
  const t: string[] = [];
  for (let r = 0; r < 64; r++) t.push(r % step === 0 ? gen(r) : '.');
  return t.join(' ');
}

function pat(i: number): PatternDef {
  return {
    1: track(2, (r) => (r % 4 === 0 || rnd() < 0.4 ? 'C-4:kick' : '.')),
    2: track(2, (r) => (r % 8 === 4 ? 'C-4:snare' : rnd() < 0.3 ? `C-4:snarev${16 + Math.floor(rnd() * 20)}${rnd() < 0.2 ? '!R03' : ''}` : '.')),
    3: track(1, () => `${pick(['C-4', 'C-4', 'D-4', 'E-4'])}:hatsv${24 + Math.floor(rnd() * 24)}`),
    4: track(8, (r) => (r % 32 === 0 ? 'F-4:hats' : `${note(2, 3)}:timpani`)),
    5: track(2, () => `${note(1, 2)}:bass${rnd() < 0.15 ? '!305' : ''}`),
    6: track(8, () => `${note(1, 2)}:sub`),
    7: track(16, () => `${note(3, 5)}:${pick(['aah', 'ooh'])}`),
    8: track(8, () => `${note(3, 5)}:strings`),
    9: track(2, () => `${note(4, 5)}:${pick(['lead', 'epiano'])}!0${pick(['37', '47', '57', '35'])}`),
    10: track(2, () => `${note(4, 5)}:${pick(['lead', 'brass'])}${rnd() < 0.5 ? '!4' + pick(['46', '58', '34']) : ''}`),
    12: track(4, () => `${note(3, 4)}:${pick(['strings', 'brass'])}`),
    13: track(3, () => `${note(4, 6)}:${pick(['bell', 'epiano'])}`),
    14: track(1, () => `${note(3, 6)}:harpv${30 + Math.floor(rnd() * 30)}`),
    15: track(2, (r) => `${WHITE[(r / 2 + i) % 7]}-4:shepard`),
    16: track(16, () => `${note(3, 4)}:orchhit`),
    17: track(8, (r) => (r === 0 ? `C-3:scope!9${hex2(Math.floor(rnd() * 256))}` : `.!9${hex2(Math.floor(rnd() * 256))}`)),
    18: { 0: 'D-4' },
  };
}

const patterns: Record<string, PatternDef> = {};
const order: string[] = [];
for (let i = 0; i < 32; i++) {
  patterns['p' + i] = pat(i);
  order.push('p' + i);
}
export default song({ name: 'stress test', patterns, order, echo: { from: 10, to: 11 } });
