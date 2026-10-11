// EFFACED — Act IV · EFFACED (positions 14–1B, 2:34–3:35). E phrygian → F lydian → E phrygian.
//
// Form, harmony, melodies, markers and structural events by the lead composer (NOTES.md); the
// arrangement is written here. One continuous 8×64 = 512-row track per channel, cut into 8 patterns.
//
//   14 Em·F Am Dm7 Fmaj7          15 Em·F Am C·G F          S10 climax at 14:00, energy 5
//   16 Em·Dm Cmaj7 Dm7 Em         17 Em·Dm Cmaj7 Dm7 Esus4  S11 inversion, energy 4
//   18 F G/F Fmaj7 G/F            19 F G/F Fadd9 G/F        S12 the lift E → F (lydian); 19:32 burst
//   1A Fmaj7 Am7 G/F Fmaj7        1B Em·F Am Dm/E E         S13 last EFFACED, unison E 1B:48, silence 1B:60–63
//
// Registers — one job per register, so the tutti stays clear:
//   high (G-5…D-6)   ch7 choir 'aah' + ch8 strings: a sustained halo ABOVE the lead (0xy shimmer in the lydian part)
//   lead (A-4…A-5)   ch10 lead (+ ch11 auto echo)
//   mid (F-3…G-4)    ch12 brass: the melody an octave below (14, 15, 1A, 1B), mirror counterpoint (16–17), fanfares (18)
//   low-mid          ch9 spiccato strings (slot 19) ostinato: G-2…F-4 in E phrygian; in F lydian it moves up into the halo
//   low (C-2…D-3)    ch5 bass galop · ch15 low brass on the roots · ch14 timpani · ch6 sub an octave below
//   impacts          ch16 orchestra hit + ch4 crash + ch14 timpani + ch15 low brass + kick on every section downbeat,
//                    each prepared by a reverse crash (ch3) and an R-retrigger timpani roll 16 / 8 rows before
//
// 14–15 S10 "Compression": EFFACED in the lead, the brass an octave below; the spiccato pumps 3+3+2 with
//      the kick. Orchestra hits on E (14:00) and F (14:08) — the phrygian alarm as two blows, not a smear.
//      In 15 the ostinato is "quantised" bar by bar down to its DC term (repeated roots) while the engine's
//      bitcrush ramps in — the music drops its own high coefficients and leaves the crush its headroom.
// 16–17 S11 "Inversion": mirror counterpoint. The lead plays the diatonic inversion E-D-D-B-G-E-F while
//      the brass plays its mirror (letters reflected about E = the original E-F-F-A-C-E-D in bars 1–2); the
//      two meet on the axis E (16:00, 16:24). Inside out: the synth bass leaves, the spiccato runs the bass
//      line backwards (2+3+3, falling), the ride replaces the hats. Polygon accents 16:00 / 16:32 / 17:00 /
//      17:32: crash, orch hit, timpani, bass and low brass, and a bell climbing E-F-G-A.
// 17:48 → 18:00 the door: reverse crash, timpani roll, tom run, harp run D-4 → E-6; E → F in every voice.
// 18–19 S12 "Canvas": F lydian. The halo jumps high (choir A-5/C-6, strings shimmering), the brass answers
//      the FACADE head with G-major fanfares (the lydian II), the spiccato becomes rising ripples in the
//      halo. 19:16–31 the inhale (reverse crash, snare roll, timpani roll on C, harp run) → 19:32 the burst:
//      lead A-5 over brass A-4, choir C-6, orch hit and timpani F, crash, and the bell scatters particles.
// 1A   S13: the last EFFACED, glorious over Fmaj7; tom run down to E.
// 1B   E phrygian again; the drums leave after bar 2 for a snare/timpani roll; the halo slides (3xx legato)
//      into E, and at 1B:48 every pitched channel lands on E (E-1 … E-6). Then the sound shrinks from the top
//      down — the reverberant voices first, the lead and the dry low E last — and everything is at zero
//      by 1B:59: 1B:60–63 is one beat with nothing sounding in the module (E-4 marker at 1B:60).
//
// Literal statements in this act: EFFACED 14:00:10, 15:00:10, 1A:00:10, 1B:00:10 (brass 8vb on ch12 at the
// same rows); EFFACED inversion 16:00:10, 17:00:10 with its mirror (= EFFACED) 16:00:12, 17:00:12;
// FACADE (F lydian) 18:00:10, 19:00:10. ch11 echoes ch10 automatically (+3 rows, 50 %).

import { CH, INS, Tr, MEL, FX, LEAD_IN, galop, groove, chord, atOrAbove, ws, up8, snareRoll, mixdown, patternsOf, KIT, DRUM_NOTE, type Tracks } from './theory.ts';
import type { PatternDef } from '../../src/music/score/dsl.ts';

const P = 64;
const N = 8; // 14..1B
const ROWS = N * P;
/** absolute row inside the act: (position 0x14..0x1B, row) */
const r = (pos: number, row = 0) => (pos - 0x14) * P + row;

/** harmony per bar; 'X|Y' = two chords of two beats each (32 bars) */
export const HARMONY = [
  'Em|F', 'Am', 'Dm7', 'Fmaj7', /* 14 */ 'Em|F', 'Am', 'C|G', 'F', /* 15 */
  'Em|Dm', 'Cmaj7', 'Dm7', 'Em', /* 16 */ 'Em|Dm', 'Cmaj7', 'Dm7', 'Esus4', /* 17 */
  'F', 'G/F', 'Fmaj7', 'G/F', /* 18 */ 'F', 'G/F', 'Fadd9', 'G/F', /* 19 */
  'Fmaj7', 'Am7', 'G/F', 'Fmaj7', /* 1A */ 'Em|F', 'Am', 'Dm/E', 'Em', /* 1B (bar 4 = unison E from 1B:48) */
];
/** the same harmony in 8-row (half-bar) spans */
const HALF = HARMONY.flatMap((h) => (h.includes('|') ? h.split('|') : [h, h]));
/** bass per half bar (galop) */
const ROOTS = [
  'E-2', 'F-2', 'A-2', 'A-2', 'D-3', 'D-3', 'F-2', 'F-2', /* 14 */ 'E-2', 'F-2', 'A-2', 'A-2', 'C-3', 'G-2', 'F-2', 'F-2', /* 15 */
  'E-2', 'D-2', 'C-3', 'C-3', 'D-3', 'D-3', 'E-2', 'E-2', /* 16 */ 'E-2', 'D-2', 'C-3', 'C-3', 'D-3', 'D-3', 'E-2', 'E-2', /* 17 */
  'F-2', 'F-2', 'F-2', 'F-2', 'F-2', 'F-2', 'F-2', 'F-2', /* 18 */ 'F-2', 'F-2', 'F-2', 'F-2', 'F-2', 'F-2', 'G-2', 'G-2', /* 19 */
  'F-2', 'F-2', 'A-2', 'A-2', 'F-2', 'F-2', 'F-2', 'F-2', /* 1A */ 'E-2', 'F-2', 'A-2', 'A-2', 'E-2', 'E-2', /* 1B (bar 4 by hand) */
];
const half = (i: number) => r(0x14) + 8 * i; // row of half bar i
const oct = (n: string, d: number) => n.replace(/\d$/, (o) => String(+o + d));
/** the letter of `n` in octave 2 (C-2…B-2): the low brass register */
const low2 = (n: string) => `${n[0]}-2`;

const t = {
  kick: new Tr(ROWS, INS.kick), snare: new Tr(ROWS, INS.snare), hats: new Tr(ROWS, INS.hats), perc: new Tr(ROWS, INS.hats),
  bass: new Tr(ROWS, INS.bass), sub: new Tr(ROWS, INS.sub),
  choir: new Tr(ROWS, INS.aah), str: new Tr(ROWS, INS.strings), ost: new Tr(ROWS, INS.spiccato),
  lead: new Tr(ROWS, INS.lead), brass: new Tr(ROWS, INS.brass), bell: new Tr(ROWS, INS.bell),
  timp: new Tr(ROWS, INS.timpani), lowb: new Tr(ROWS, INS.brass), stab: new Tr(ROWS, INS.orchhit), mk: new Tr(ROWS),
};
const clear = (tr: Tr, a: number, b: number) => {
  for (let k = a; k < b; k++) tr.cells[k] = {};
};
/** a one-shot that is let go after `len` rows unless the channel moves on first */
const shot = (tr: Tr, row: number, note: string, v: number, len: number, ins?: number) => {
  tr.n(row, note, v, undefined, ins);
  const end = Math.min(row + len, ROWS - 1);
  for (let k = row + 1; k < end; k++) if (tr.cells[k].note) return;
  if (!tr.cells[end].note) tr.off(end);
};

// ================================ boundary 13 → 14: every channel re-articulates at 14:00 ================================
// (Act III's Shepard on ch15 gives way to the low brass, its e-piano on ch14 to the timpani; a bell is let go)
t.bell.off(r(0x14));

// ================================ drums ================================
const DRUMS: [number, ReturnType<typeof groove>][] = [
  [0x14, groove(5, { crashEvery: true })],
  [0x15, groove(5, { crashEvery: true, fill: 'snare' })],
  [0x16, groove(4, { crash: true })],
  [0x17, groove(4, { crash: true, fill: 'toms' })],
  [0x18, groove(5, { crashEvery: true })],
  [0x19, groove(5, { crashEvery: true })],
  [0x1a, groove(5, { crashEvery: true, fill: 'toms' })], // timpani run A-3 … E-2 lands the phrygian E at 1B:00
  [0x1b, groove(5, { crashEvery: true, mute: [2, 3] })],
];
for (const [pos, g] of DRUMS) {
  t.kick.put(r(pos), g[CH.kick]);
  t.snare.put(r(pos), g[CH.snare]);
  t.hats.put(r(pos), g[CH.hats]);
  t.perc.put(r(pos), g[CH.perc]);
}
// section downbeats: kick and crash at full strength, a snare on the one
for (const pos of [0x14, 0x16, 0x18, 0x1a]) {
  t.kick.v(r(pos), 64);
  t.perc.v(r(pos), 54);
  t.snare.n(r(pos), DRUM_NOTE, 50);
}
// 14 → 15: a two-16th snare pickup
t.snare.n(r(0x14, 62), DRUM_NOTE, 34).n(r(0x14, 63), DRUM_NOTE, 42);
// 15: leave the 8–16 kHz headroom to the engine's bitcrush (hats a touch lower)
for (let k = r(0x15); k < r(0x16); k++) if (t.hats.cells[k].vol) t.hats.cells[k].vol = Math.round(t.hats.cells[k].vol! * 0.8);
/** reverse crash (16 rows) landing on `row`; the hats make room */
const reverse = (row: number, v: number) => {
  clear(t.hats, row - 16, row);
  t.hats.n(row - 16, KIT.reverse, v);
};
reverse(r(0x16), 38); // → the inversion
// 16–17: the ride replaces the hats (compass and ruler: a clean, metallic pulse); polygon crashes
for (const pos of [0x16, 0x17]) {
  clear(t.hats, r(pos), r(pos + 1));
  for (let k = 0; k < 64; k += 2) t.hats.n(r(pos, k), KIT.ride, k % 8 === 0 ? 24 : k % 4 === 0 ? 20 : 15);
}
t.perc.n(r(0x16, 32), KIT.crash, 46).n(r(0x17, 32), KIT.crash, 48);
t.kick.n(r(0x16, 32), DRUM_NOTE, 60).n(r(0x17, 32), DRUM_NOTE, 62);
reverse(r(0x18), 42); // → the lift
// 19:16–31 the inhale: reverse crash, snare roll (32nds in the last beat); 19:32 the burst
reverse(r(0x19, 32), 44);
clear(t.snare, r(0x19, 16), r(0x19, 32));
snareRoll(t.snare, r(0x19, 16), r(0x19, 28), 18, 46);
snareRoll(t.snare, r(0x19, 28), r(0x19, 32), 48, 58, true);
t.kick.v(r(0x19, 32), 64);
t.snare.n(r(0x19, 32), DRUM_NOTE, 60);
t.perc.v(r(0x19, 32), 58);
// 19 → 1A: reverse crash and a snare roll
reverse(r(0x1a), 40);
clear(t.snare, r(0x19, 56), r(0x1a));
snareRoll(t.snare, r(0x19, 56), r(0x1a), 30, 54, true);
// 1B: the drums leave after bar 2 — a heartbeat kick and a snare roll into the unison hit
for (const [k, v] of [[32, 40], [36, 44], [40, 48], [44, 52], [46, 52]]) t.kick.n(r(0x1b, k), DRUM_NOTE, v);
snareRoll(t.snare, r(0x1b, 32), r(0x1b, 44), 22, 46);
snareRoll(t.snare, r(0x1b, 44), r(0x1b, 48), 48, 58, true);

// ================================ low end: bass galop (ch5), low brass (ch15), sub (ch6) ================================
galop(t.bass, r(0x14), ROOTS.slice(0, 16), { per: 8, v: 48 });
galop(t.bass, r(0x18), ROOTS.slice(32, 62), { per: 8, v: 48 });
t.bass.v(r(0x14), 54).v(r(0x18), 54).v(r(0x1a), 52).v(r(0x19, 32), 54);
// 16–17 inside out: the synth bass only punctuates the polygon accents (the spiccato carries the bass line)
for (const [p, k, n] of [[0x16, 0, 'E-2'], [0x16, 32, 'D-2'], [0x17, 0, 'E-2'], [0x17, 32, 'D-2']] as const) {
  t.bass.n(r(p, k), n, 50);
  t.bass.off(r(p, k + 6));
}
// 1B bar 3: the E pedal crescendos into the hit
for (let k = 32; k < 48; k++) {
  const c = t.bass.cells[r(0x1b, k)];
  if (c.vol) c.vol = Math.round(c.vol * (0.82 + (k - 32) * 0.012));
}
// low brass: the roots in octave 2, held, re-tongued on every change and every bar; heavier on the downbeats
// sub: the same roots an octave below
const DOWNBEATS = [r(0x14), r(0x16), r(0x18), r(0x1a), r(0x16, 32), r(0x17), r(0x17, 32), r(0x19, 32), r(0x1b)];
let prev = '';
ROOTS.forEach((n, i) => {
  const row = half(i);
  const lb = low2(n);
  if (lb !== prev || i % 2 === 0) {
    t.lowb.n(row, lb, DOWNBEATS.includes(row) ? 46 : 38);
    t.sub.n(row, oct(lb, -1), 42);
  }
  prev = lb;
});

// ================================ the halo: choir 'aah' (ch7) + strings (ch8), above the lead ================================
// one voicing per half bar: [choir, strings]; null = hold; 'A-5*037' = strings with a 0xy chord shimmer.
// Every note is a chord tone and stays clear of the melody note it sounds with (no 2nds / 7ths / 9ths).
type V2 = [string, string];
const HALO: Record<number, (V2 | null)[]> = {
  0x14: [['G-5', 'B-5'], ['A-5', 'C-6'], null, null, ['A-5', 'D-6'], null, ['A-5', 'C-6'], null],
  0x15: [['G-5', 'B-5'], ['A-5', 'C-6'], null, null, ['G-5', 'C-6'], ['G-5', 'B-5'], ['A-5', 'C-6'], null],
  0x16: [['G-5', 'B-5'], ['F-5', 'A-5'], ['G-5', 'B-5'], null, ['F-5', 'A-5'], null, ['G-5', 'B-5'], null],
  0x17: [['G-5', 'B-5'], ['F-5', 'A-5'], ['G-5', 'B-5'], null, ['F-5', 'A-5'], null, ['E-5', 'A-5'], null],
  0x18: [['A-5', 'F-5*047'], null, ['G-5', 'G-5*047'], null, ['C-6', 'A-5*037'], null, ['G-5', 'G-5*047'], null],
  0x19: [['A-5', 'F-5*047'], null, ['G-5', 'G-5*047'], null, ['C-6', 'F-5*047'], null, ['D-6', 'D-5*059'], null],
  0x1a: [['C-6', 'A-5*037'], null, null, null, ['D-6', 'G-5*047'], null, ['C-6', 'A-5*037'], null],
  0x1b: [['G-5', 'B-5'], ['A-5', 'C-6'], null, null, ['A-5', 'D-6'], null, null, null],
};
const HALOV: Record<number, [number, number]> = {
  0x14: [28, 26], 0x15: [28, 26], 0x16: [24, 24], 0x17: [24, 24], 0x18: [30, 24], 0x19: [30, 24], 0x1a: [30, 24], 0x1b: [28, 26],
};
{
  const tr = [t.choir, t.str];
  const lead = [LEAD_IN.aah, LEAD_IN.strings];
  const ev: { row: number; note: string; xy?: string; v: number }[][] = [[], []];
  const last = ['', ''];
  for (const [ps, list] of Object.entries(HALO)) {
    const pos = +ps;
    list.forEach((vc, k) =>
      vc?.forEach((spec, i) => {
        if (spec === last[i]) return; // common tones sustain
        last[i] = spec;
        const [note, xy] = spec.split('*');
        ev[i].push({ row: Math.max(0, r(pos, 8 * k) - lead[i]), note, xy, v: HALOV[pos][i] });
      }),
    );
  }
  ev.forEach((list, i) =>
    list.forEach((e, k) => {
      if (!e.xy) tr[i].n(e.row, e.note, e.v);
      else tr[i].arp(e.row, list[k + 1]?.row ?? r(0x1b), e.note, e.xy, e.v);
    }),
  );
}
t.choir.v(r(0x17, 62), 34); // 18:00 the door: the choir lands a little louder than it holds
t.choir.v(r(0x19, 30), 34); // the burst: C-6, the brightest pad note of the song

// ================================ ch9 · the ostinato (spiccato strings, slot 19) ================================
/** chord ladder from the root at or above `lo`: [root, 5th, 8ve, 10th (or the sus 11th)] */
function ladder(sym: string, lo: string): string[] {
  const c = chord(sym);
  const R = atOrAbove(c.tones[0], lo);
  const f5 = atOrAbove(c.tones[2], ws(R, 1));
  const o8 = up8(R);
  return [R, f5, o8, atOrAbove(c.tones[1], ws(o8, 1))];
}
const ostRow = (row: number, notes: string[], vols: number[], ins?: number) => notes.forEach((n, i) => t.ost.n(row + i, n, vols[i], undefined, ins));
// S10 pump: 3+3+2 with the kick (root, 5th, octave), low strings. In 15 the quantiser takes the top away.
const PUMP_V = [36, 25, 27, 34, 25, 27, 34, 30];
const QUANT = [[0, 0, 0, 1, 1, 1, 2, 2], [0, 0, 0, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0, 1, 1], [0, 0, 0, 0, 0, 0, 0, 0]];
/** pump on half bar i (global index), quantiser level q; on E → F the last 8th anticipates F with the melody */
const pump = (i: number, q = 0, vols = PUMP_V) => {
  const L = ladder(HALF[i], 'G-2');
  const notes = QUANT[q].map((j) => L[j]);
  if (HALF[i] === 'Em' && HALF[i + 1] === 'F') notes[6] = notes[7] = ladder('F', 'G-2')[q < 2 ? 2 : 0];
  ostRow(half(i), notes, vols);
};
for (let i = 0; i < 8; i++) pump(i);
for (let i = 8; i < 16; i++) {
  const q = (i - 8) >> 1;
  pump(i, q, q === 3 ? PUMP_V.map((v, k) => Math.min(46, v + (i - 14) * 6 + k)) : PUMP_V);
}
t.ost.v(r(0x14), 44);
// S11 mirror: time reversed (2+3+3) and falling — the bass line itself, in octave 2–3
const MIRROR_V = [34, 24, 32, 24, 26, 32, 24, 30];
for (let i = 16; i < 32; i++) {
  if (i >= 30) break; // 17:48 the harp run takes over
  const L = ladder(HALF[i], 'C-2');
  ostRow(half(i), [L[3], L[3], L[2], L[2], L[2], L[1], L[1], L[0]], MIRROR_V);
}
t.ost.v(r(0x16), 42).v(r(0x17), 40);
// 17:48–63 harp run D-4 → E-6, one white key per row; F (the new tonic) arrives at 18:00
ostRow(r(0x17, 48), ['D-4', 'E-4', 'F-4', 'G-4', 'A-4', 'B-4', 'C-5', 'D-5', 'E-5', 'F-5', 'G-5', 'A-5', 'B-5', 'C-6', 'D-6', 'E-6'],
  Array.from({ length: 16 }, (_, i) => 24 + i), INS.harp);
// S12 / S13: rising ripples up in the halo (1 5 8 10 12 10 8 5); Fmaj7 arpeggios in 1A
const RIP: Record<string, string[]> = {
  F: ['F-4', 'C-5', 'F-5', 'A-5', 'C-6', 'A-5', 'F-5', 'C-5'],
  Fadd9: ['F-4', 'C-5', 'G-5', 'A-5', 'C-6', 'A-5', 'G-5', 'C-5'],
  'G/F': ['G-4', 'D-5', 'G-5', 'B-5', 'D-6', 'B-5', 'G-5', 'D-5'],
  Fmaj7: ['F-4', 'C-5', 'E-5', 'A-5', 'C-6', 'A-5', 'E-5', 'C-5'],
  Am7: ['A-4', 'E-5', 'G-5', 'A-5', 'C-6', 'A-5', 'G-5', 'E-5'],
};
const RIP_V = [32, 22, 24, 22, 28, 22, 24, 20];
for (let i = 32; i < 56; i++) {
  if (i === 43) continue; // 19:24–31 harp run
  // 1A bar 1: the lead holds F over Fmaj7, so the ripple leaves the E out
  ostRow(half(i), RIP[i === 48 || i === 49 ? 'F' : HALF[i]], RIP_V);
}
t.ost.v(r(0x18), 40).v(r(0x1a), 38);
// 19:24–31 harp run up the lydian scale into the burst
ostRow(r(0x19, 24), ['G-4', 'A-4', 'B-4', 'C-5', 'D-5', 'E-5', 'F-5', 'G-5'], [26, 28, 30, 32, 34, 36, 38, 40], INS.harp);
t.ost.v(r(0x19, 32), 42);
// 1B: the pump returns; bar 3 narrows to the point
for (let i = 56; i < 60; i++) pump(i);
ostRow(r(0x1b, 32), ['E-3', 'E-3', 'E-3', 'A-3', 'A-3', 'A-3', 'D-4', 'D-4'], PUMP_V);
ostRow(r(0x1b, 40), Array(8).fill('E-3'), [30, 30, 32, 34, 36, 38, 40, 42]);

// ================================ lead (ch10) and brass (ch12) ================================
const LEAD = [MEL.EFFACED_1, MEL.EFFACED_2, MEL.INVERSION_1, MEL.INVERSION_2, MEL.LYDIAN_A1, MEL.LYDIAN_A2, MEL.EFFACED_LYDIAN, MEL.EFFACED_COLLAPSE];
LEAD.forEach((m, i) => t.lead.line(r(0x14 + i), m, { v: i === 2 || i === 3 ? 46 : 50, vib: FX.vibLead, vibAfter: 4 }));
t.lead.v(r(0x14), 54).v(r(0x18), 52).v(r(0x19, 32), 58).v(r(0x1a), 52);

// brass: EFFACED 8vb (14, 15, 1A, 1B); in 16–17 the mirror of the lead (letters reflected about E) —
// bars 1–2 are the original EFFACED, so the word and its inversion sound together and meet on E
for (const i of [0, 1, 6, 7]) t.brass.line(r(0x14 + i), LEAD[i], { v: 36, steps: -7 });
const MIRROR = 'E-4/6 F-4/2 F-4/8 | A-3/4 C-4/4 E-4/6 D-4/2 | -/6 C-4/2 B-3/4 G-3/4 |';
t.brass.line(r(0x16), `${MIRROR} A-3/6 B-3/2 C-4/4 E-4/4`, { v: 38 });
t.brass.line(r(0x17), `${MIRROR} A-3/8 B-3/4 C-4/4`, { v: 38 }); // Esus4: A, B, then C → the 5th of F at 18:00
// 18: the FACADE head in octaves, then G-major fanfares (the lydian II) answer the held D and E
t.brass.line(r(0x18), 'F-3/6 A-3/2 C-4/4 A-3/4 | G-3/4 B-3/4 D-4/4 G-4/4 | A-4/8 G-4/4 F-4/4 | D-4/8 B-3/4 G-3/4', { v: 38 });
// 19: in octaves with the lead all the way up to the burst (A-4 under the lead's A-5)
t.brass.line(r(0x19), MEL.LYDIAN_A2, { v: 38, steps: -7 });
t.brass.v(r(0x14), 40).v(r(0x16), 40).v(r(0x18), 42).v(r(0x19, 32), 44).v(r(0x1a), 40);

// ================================ ch14 · timpani ================================
// [pos, row, note, vol] — each stroke is let go before the harmony moves under it
const TIMP: [number, number, string, number][] = [
  [0x14, 0, 'E-2', 64], [0x14, 8, 'F-2', 54], [0x14, 16, 'A-2', 50], [0x14, 32, 'D-3', 50], [0x14, 48, 'F-2', 50],
  [0x15, 0, 'E-2', 60], [0x15, 8, 'F-2', 52], [0x15, 16, 'A-2', 48], [0x15, 32, 'C-3', 48], [0x15, 40, 'G-2', 46], [0x15, 48, 'F-2', 50],
  [0x16, 0, 'E-2', 62], [0x16, 32, 'D-2', 56], [0x17, 0, 'E-2', 60], [0x17, 32, 'D-2', 58],
  [0x18, 0, 'F-2', 64], [0x18, 8, 'C-3', 44], [0x18, 16, 'G-2', 50], [0x18, 24, 'D-3', 42], [0x18, 32, 'F-2', 54], [0x18, 40, 'C-3', 44], [0x18, 48, 'G-2', 50], [0x18, 56, 'D-3', 42],
  [0x19, 0, 'F-2', 58], [0x19, 8, 'C-3', 44], [0x19, 32, 'F-2', 64], [0x19, 48, 'G-2', 52],
  [0x1a, 0, 'F-2', 64], [0x1a, 8, 'C-3', 44], [0x1a, 16, 'A-2', 52], [0x1a, 24, 'E-2', 44], [0x1a, 32, 'G-2', 50], [0x1a, 40, 'D-3', 42], [0x1a, 48, 'F-2', 50],
  [0x1b, 0, 'E-2', 62], [0x1b, 8, 'F-2', 54], [0x1b, 16, 'A-2', 52], [0x1b, 24, 'E-2', 44],
];
/** R-retrigger roll (32nds) crescendo on [from, to) — the preparation of a downbeat */
const roll = (from: number, to: number, note: string, v0: number, v1: number) => {
  for (let k = from; k < to; k++) t.timp.n(k, note, Math.round(v0 + ((v1 - v0) * (k - from)) / Math.max(1, to - from - 1)), 'R03');
};
roll(r(0x14, 60), r(0x15), 'F-2', 30, 46); // the F of the chord rolls, the E of 15:00 answers
roll(r(0x15, 56), r(0x16), 'F-2', 30, 56); // with the snare fill → E at 16:00
roll(r(0x16, 28), r(0x16, 32), 'D-2', 30, 46); // into the polygon accents
roll(r(0x16, 60), r(0x17), 'E-2', 30, 46);
roll(r(0x17, 28), r(0x17, 32), 'D-2', 32, 48);
roll(r(0x17, 48), r(0x17, 56), 'E-2', 30, 54); // the door; then the tom run on ch4
roll(r(0x19, 16), r(0x19, 32), 'C-3', 24, 60); // the inhale on the dominant
roll(r(0x19, 56), r(0x1a), 'C-3', 28, 54); // → 1A:00
roll(r(0x1b, 32), r(0x1b, 48), 'E-2', 28, 60); // into the unison
for (const [p, k, n, v] of TIMP) {
  const row = r(p, k);
  t.timp.n(row, n, v);
  // let the stroke go before the next harmony (or 12 rows), unless the next stroke comes first
  let end = row + 12;
  for (let j = row + 1; j <= row + 12; j++) if (HALF[(j - r(0x14)) >> 3] !== HALF[(row - r(0x14)) >> 3] && (j - r(0x14)) % 8 === 0) { end = j; break; }
  let free = true;
  for (let j = row + 1; j <= end; j++) if (t.timp.cells[j]?.note) free = false;
  if (free && end < ROWS) t.timp.off(end);
}

// ================================ ch16 · orchestra hits (root + octave), short, on the melody's note ================================
const HITS: [number, number, string, number, number][] = [
  [0x14, 0, 'E-3', 62, 6], [0x14, 8, 'F-3', 54, 8], [0x15, 0, 'E-3', 58, 6], [0x15, 8, 'F-3', 52, 8],
  [0x16, 0, 'E-3', 58, 6], [0x16, 32, 'D-3', 54, 8], [0x17, 0, 'E-3', 58, 6], [0x17, 32, 'D-3', 58, 8],
  [0x18, 0, 'F-3', 64, 8], [0x19, 0, 'F-3', 54, 8], [0x19, 32, 'F-3', 64, 8],
  [0x1a, 0, 'A-3', 62, 6], [0x1b, 0, 'E-3', 60, 6], [0x1b, 8, 'F-3', 54, 8],
];
for (const [p, k, n, v, len] of HITS) shot(t.stab, r(p, k), n, v, len);

// ================================ ch13 · bell: polygon accents, the burst's particles, light in 1A ================================
for (const [p, k, n, v] of [[0x16, 0, 'E-6', 26], [0x16, 32, 'F-6', 28], [0x17, 0, 'G-6', 30], [0x17, 32, 'A-6', 32]] as const) shot(t.bell, r(p, k), n, v, 8); // 3 → 5 → 17 → 257
shot(t.bell, r(0x18), 'C-6', 28, 8);
shot(t.bell, r(0x19), 'C-6', 24, 8);
['A-6', 'G-6', 'F-6', 'C-6', 'A-5', 'F-5', 'C-5', 'A-4'].forEach((n, i) => t.bell.n(r(0x19, 32 + 2 * i), n, 38 - 3 * i)); // particles fall
t.bell.off(r(0x19, 48));
shot(t.bell, r(0x1a), 'E-6', 24, 8);
shot(t.bell, r(0x1a, 32), 'D-6', 20, 8);

// ================================ 1B:40–63 · the collapse and the silence ================================
const HIT = r(0x1b, 48), SIL = r(0x1b, 60);
// the halo slides into E (3xx legato, no instrument: the envelopes keep going) and swells
const slide = (tr: Tr, from: number, note: string, speed: string, v0: number, v1: number) => {
  tr.n(from, note, undefined, speed, '-');
  for (let k = from + 1; k < HIT; k++) tr.fx(k, speed);
  tr.ramp(from, HIT, v0, v1);
};
slide(t.choir, r(0x1b, 40), 'E-5', '302', 28, 34); // A → E, a fourth down
slide(t.str, r(0x1b, 44), 'E-6', '302', 26, 32); // D → E
// 1B:48 the unison E — every pitched channel on E, from E-1 to E-6
t.kick.n(HIT, DRUM_NOTE, 64);
t.snare.n(HIT, DRUM_NOTE, 58);
t.perc.n(HIT, KIT.crash, 54);
t.stab.n(HIT, 'E-3', 64);
t.timp.n(HIT, 'E-2', 64);
t.bass.n(HIT, 'E-2', 54);
t.lowb.n(HIT, 'E-2', 48);
t.sub.n(HIT, 'E-1', 46);
t.ost.n(HIT, 'E-3', 44);
t.brass.v(HIT, 42);
t.lead.v(HIT, 54);
// … then the sound shrinks from the top down to one point: the reverberant voices go first, the lead
// and the dry low E last; everything is at zero by 1B:59, so 1B:60–63 is really silent in the module
const fade = (tr: Tr, a: number, b: number, v0: number) => {
  tr.ramp(a, b, v0, 0);
  tr.off(b, 0);
};
fade(t.str, HIT, r(0x1b, 52), 30);
fade(t.choir, HIT, r(0x1b, 53), 32);
fade(t.stab, r(0x1b, 50), r(0x1b, 54), 50);
fade(t.perc, r(0x1b, 49), r(0x1b, 54), 44);
fade(t.timp, r(0x1b, 50), r(0x1b, 55), 54);
fade(t.brass, r(0x1b, 50), r(0x1b, 55), 38);
t.ost.off(r(0x1b, 51), 0);
t.lead.ramp(r(0x1b, 50), r(0x1b, 57), 46, 0); // the lead's own key-off (v0) is at 1B:57 (MEL); its echo ends at 1B:60
fade(t.lowb, r(0x1b, 50), r(0x1b, 57), 44);
fade(t.bass, r(0x1b, 50), r(0x1b, 58), 46);
fade(t.sub, r(0x1b, 50), r(0x1b, 59), 42);
// belt and braces: volume 0 on every channel at 1B:59 and 1B:60, no note-ons in 60–63
for (const tr of Object.values(t)) {
  if (tr === t.mk || tr === t.lead) continue;
  for (const k of [r(0x1b, 59), SIL]) if (!tr.cells[k].note) tr.v(k, 0);
}

// ================================ markers ================================
t.mk.n(r(0x14), 'D-4'); // climax
for (const [p, k] of [[0x16, 0], [0x16, 32], [0x17, 0], [0x17, 32]]) t.mk.n(r(p, k), 'D-4'); // polygons 3 → 5 → 17 → 257
t.mk.n(r(0x18), 'C-4'); // look: the tonic lifts E → F
t.mk.n(r(0x19, 32), 'D-4'); // the burst: particles leave the canvas
t.mk.n(SIL, 'E-4'); // one beat of silence

// ================================ mix ================================
const all: Tracks = {
  [CH.kick]: t.kick, [CH.snare]: t.snare, [CH.hats]: t.hats, [CH.perc]: t.perc, [CH.bass]: t.bass, [CH.sub]: t.sub,
  [CH.padA]: t.choir, [CH.padB]: t.str, [CH.arp]: t.ost, [CH.lead]: t.lead, [CH.counter]: t.brass, [CH.bell]: t.bell,
  [CH.pluck]: t.timp, [CH.fx]: t.lowb, [CH.stab]: t.stab, [CH.marker]: t.mk,
};
// per-position trims (energy 5 5 4 4 5 5 5 5→0) and per-channel balance; measured with tools/render-xm.ts
const POS_TRIM = [-3, -3, -4, -4, -2.5, -2.5, -3, -3];
const CH_TRIM: Partial<Record<number, number>> = { [CH.bass]: -4, [CH.sub]: -3, [CH.lead]: 1, [CH.fx]: -3, [CH.arp]: 3, [CH.pluck]: 4 };
mixdown(all, POS_TRIM, CH_TRIM);

const names = ['14_compress', '15_compress', '16_invert', '17_invert', '18_canvas_lift', '19_canvas_burst', '1A_erase', '1B_erase_point'];
export const patterns: Record<string, PatternDef> = patternsOf(names, all);
export const order: string[] = names;
