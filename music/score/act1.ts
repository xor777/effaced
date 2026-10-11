// EFFACED — Act I · CAGE (positions 00–04, 0:00–0:38). A aeolian, energy 1 → 3.
//
// Fully composed: this file is the style and code reference for the other acts (NOTES.md).
// The act is written as one continuous 5×64 = 320-row track per channel (so pad lead-ins and ties
// can cross pattern boundaries), then cut into five patterns.
//
//   bar:   00: N.C.(C) N.C.(C) Am   Am  | 01: Am   Am   Am7   Fmaj7 | 02: Amadd9 Fmaj9 Cadd9 G6
//          03: Am  G   F   Esus4         | 04: Am  G/B  C   Dm7·E7sus4  → 05:00 F (band entry)
//
// 00  S0 "Beam"      the lone scope tone C-4 on ch17 (the picture IS this signal; 9xx morphs
//                    Lissajous → sigil); from bar 3 the warm pad and the ooh choir rise under it: Am.
// 01  S1 "Border"    the scope hands its C to the bell: the first naked CAGE (C-5 A-4 G-4 E-4), one
//                    note per bar, F-4 markers on each. The pad holds Am; under the 4th note (E) the
//                    harmony slides to Fmaj7 — the E becomes a major seventh, "outside the triangle".
// 02                 harmonised CAGE: the same four bell notes over i–VI–III–VII (Am–F–C–G6), the
//                    choir holds one common tone E (5th → maj7 → 3rd) then D; harp ripples in 8ths.
// 03  S2 "Cage"      Andalusian descent A–G–F–E: 0xy chord arps on the warm pad, the strings enter
//                    with the long line (a sequence that rises through F-A-C — the FACADE head
//                    foreshadowed), choir "aah", bass and sub.
// 04                 the bass climbs A–B–C–D–E (→ F at 05:00): harp 16th ostinato, timpani on each
//                    bar, strings climb C5…A5 (the suspended A becomes the 3rd of F at 05:00),
//                    Shepard riser + reverse crash from 04:48, drum break over E7sus4 from 04:56.

import { CH, INS, Tr, pat, MEL, FX, groove, shepard, arpOf, KIT, DRUM_NOTE, type Tracks } from './theory.ts';
import type { PatternDef } from '../../src/music/score/dsl.ts';

const P = 64;
const ROWS = 5 * P;
/** absolute row inside the act: (position 0..4, row) */
const r = (pos: number, row: number) => pos * P + row;

// --- 17 · ghost: the scope tone ------------------------------------------------------------------
// The engine draws the XY figure from this channel (pitch = traversal rate, 9xx = morph target
// 00 Lissajous … FF sigil). Volume = figure size: it grows from a dot.
const ghost = new Tr(ROWS, INS.scope);
ghost.n(0, 'C-4', 2, '900').ramp(1, 25, 4, 36, 2);
ghost.fx(16, '920').fx(24, '940').fx(32, '960').fx(40, '980').fx(48, '9B0').fx(56, '9E0').fx(r(1, 0), '9FF');
// 01: the tone fades as the bell takes over its C, then lets go
ghost.ramp(r(1, 0), r(1, 16), 36, 0, 2).off(r(1, 16));

// --- 8 · warm pad (sustained roots, then 0xy chord arps) ------------------------------------------
const pad = new Tr(ROWS, INS.pad);
// 00 bar 3: rises from nothing (very slow PADsynth attack + a volume ramp on top)
pad.n(28, 'A-2', 1).ramp(29, 64, 2, 28, 2);
// 01: holds Am; bar 4 slides to F (Fmaj7 with the bell's E on top). Lead-in 4 rows.
pad.n(r(1, 44), 'F-2', 28);
// 02: roots of i–VI–III–VII
pad.n(r(1, 60), 'A-2', 28).n(r(2, 12), 'F-2', 28).n(r(2, 28), 'C-3', 28).n(r(2, 44), 'G-2', 27);
// 03–04: tracker arpeggios (0xy) — every chord voiced as the closest inversion, top line E D C B | E G G A B
const arps: [number, string, string][] = [
  [r(2, 62), 'A-3', 'Am'],
  [r(3, 14), 'G-3', 'G'],
  [r(3, 30), 'F-3', 'F'],
  [r(3, 46), 'E-3', 'Esus4'],
  [r(3, 62), 'A-3', 'Am'],
  [r(4, 14), 'B-3', 'G/B'],
  [r(4, 30), 'C-4', 'C'],
  [r(4, 46), 'D-4', 'Dm7'],
  [r(4, 54), 'E-4', 'Esus4'],
];
arps.forEach(([row, root, sym], i) => {
  const end = i + 1 < arps.length ? arps[i + 1][0] : ROWS;
  pad.arp(row, end, root, arpOf(root, sym), i < 4 ? 22 : 24);
});

// --- 7 · choir: ooh in S0–S1, aah from 03 -----------------------------------------------------------
const choir = new Tr(ROWS, INS.ooh);
choir.n(38, 'E-3', 1).ramp(39, 64, 2, 22, 2); // 00: the fifth, so the scope's C completes Am
choir.n(r(1, 46), 'A-3', 22); // 01 bar 4: the 3rd of F
// 02: one common tone through three chords (5th of Am, maj7 of F, 3rd of C), then the 5th of G
choir.n(r(1, 62), 'E-4', 24).n(r(2, 46), 'D-4', 24);
// 03 (aah): E over Am/G (G6), C over F, the sus4 A over E
choir.n(r(2, 62), 'E-4', 26, undefined, INS.aah).n(r(3, 30), 'C-4', 26, undefined, INS.aah).n(r(3, 46), 'A-3', 26, undefined, INS.aah);
// 04: E pedal-tone over the climbing bass, D over Dm7 that stays as the 7th of E7sus4 (→ C at 05:00)
choir.n(r(3, 62), 'E-4', 27, undefined, INS.aah).n(r(4, 46), 'D-4', 28, undefined, INS.aah);

// --- 13 · bell: the first naked CAGE (01) and the harmonised one (02) -------------------------------
const bell = new Tr(ROWS, INS.bell);
bell.line(r(1, 0), MEL.CAGE_BELL, { v: 44 });
bell.v(r(1, 0), 46).v(r(1, 48), 46); // first and last word-notes slightly forward
bell.line(r(2, 0), MEL.CAGE_BELL, { v: 42 });

// --- 18 · markers: F-4 on each note of the first CAGE (three triangle vertices + the point outside) ---
const mk = new Tr(ROWS);
for (const b of [0, 16, 32, 48]) mk.n(r(1, b), 'F-4');

// --- 14 · harp: 8th-note ripples (02–03) --------------------------------------------------------------
const harp = new Tr(ROWS, INS.harp);
const ripple: [number, string[]][] = [
  [r(2, 0), ['A-2', 'E-3', 'A-3', 'B-3', 'C-4', 'E-4', 'C-4', 'B-3']], // Am(add9)
  [r(2, 16), ['F-2', 'C-3', 'F-3', 'G-3', 'A-3', 'C-4', 'A-3', 'G-3']], // Fmaj9 (E in the choir)
  [r(2, 32), ['C-3', 'G-3', 'C-4', 'D-4', 'E-4', 'G-4', 'E-4', 'D-4']], // Cadd9
  [r(2, 48), ['G-2', 'D-3', 'G-3', 'B-3', 'D-4', 'E-4', 'D-4', 'B-3']], // G6
  [r(3, 0), ['A-2', 'E-3', 'A-3', 'B-3', 'C-4', 'E-4', 'C-4', 'B-3']], // Am
  [r(3, 16), ['G-2', 'D-3', 'G-3', 'A-3', 'B-3', 'D-4', 'B-3', 'A-3']], // G
  [r(3, 32), ['F-2', 'C-3', 'F-3', 'G-3', 'A-3', 'C-4', 'A-3', 'G-3']], // F
  [r(3, 48), ['E-2', 'B-2', 'E-3', 'A-3', 'B-3', 'E-4', 'B-3', 'A-3']], // Esus4
];
ripple.forEach(([row, notes], bar) => {
  const lift = bar < 4 ? 0 : 3;
  notes.forEach((n, i) => harp.n(row + 2 * i, n, (i === 0 ? 27 : i === 4 ? 24 : 21) + lift));
});

// --- 12 · strings: the long line (03–04), delayed vibrato ----------------------------------------------
const str = new Tr(ROWS, INS.strings);
str.line(r(3, 0), 'C-5/10 B-4/2 A-4/4 | B-4/10 A-4/2 G-4/4 | F-4/4 A-4/4 C-5/8 | A-4/8 B-4/8', { v: 30, vib: FX.vibStr, vibAfter: 5 });
str.line(r(4, 0), 'C-5/12 B-4/2 C-5/2 | D-5/12 C-5/2 D-5/2 | E-5/12 D-5/2 E-5/2 | F-5/8 A-5/8', { v: 34, vib: FX.vibStr, vibAfter: 5 });
// a gentle crescendo through the climb
str.v(r(3, 16), 31).v(r(3, 32), 32).v(r(3, 48), 33).v(r(4, 16), 36).v(r(4, 32), 38).v(r(4, 48), 40).v(r(4, 56), 42);

// --- 9 · arp: harp 16th ostinato over the climbing bass (04, until the break) ----------------------------
const arp = new Tr(ROWS, INS.harp);
const ost: [number, number, string[]][] = [
  [r(4, 0), 16, ['A-3', 'E-4', 'A-4', 'C-5']], // Am
  [r(4, 16), 16, ['B-3', 'D-4', 'G-4', 'B-4']], // G/B
  [r(4, 32), 16, ['C-4', 'G-4', 'C-5', 'E-5']], // C
  [r(4, 48), 8, ['D-4', 'A-4', 'C-5', 'F-5']], // Dm7 (two beats; the break follows)
];
ost.forEach(([row, len, notes], bar) => {
  for (let i = 0; i < len; i++) arp.n(row + i, notes[i % 4], (i % 4 === 0 ? 26 : 20) + 2 * bar);
});

// --- 5 · bass / 6 · sub ------------------------------------------------------------------------------------
const bass = new Tr(ROWS, INS.bass);
// 03: whole notes down the Andalusian line, 8ths in the last two beats
bass.n(r(3, 0), 'A-2', 36).n(r(3, 16), 'G-2', 36).n(r(3, 32), 'F-2', 36).n(r(3, 48), 'E-2', 36);
for (const k of [8, 10, 12, 14]) bass.n(r(3, 48 + k), 'E-2', k === 8 ? 34 : 30);
// 04: 8th-note drive climbing A B C D → E (the E7sus4 break), F arrives at 05:00
(['A-2', 'B-2', 'C-3'] as const).forEach((n, b) => {
  for (let i = 0; i < 8; i++) bass.n(r(4, b * 16 + 2 * i), n, i % 2 ? 36 : 42);
});
for (let i = 0; i < 4; i++) bass.n(r(4, 48 + 2 * i), 'D-3', i % 2 ? 38 : 44);
bass.n(r(4, 56), 'E-3', 46);

const sub = new Tr(ROWS, INS.sub);
sub.n(r(1, 0), 'A-1', 4).ramp(r(1, 1), r(1, 16), 8, 26, 3).n(r(1, 48), 'F-1', 26);
sub.n(r(2, 0), 'A-1', 28).n(r(2, 16), 'F-1', 28).n(r(2, 32), 'C-2', 26).n(r(2, 48), 'G-1', 28);
sub.n(r(3, 0), 'A-1', 30).n(r(3, 16), 'G-1', 30).n(r(3, 32), 'F-1', 30).n(r(3, 48), 'E-1', 30);
sub.n(r(4, 0), 'A-1', 32).n(r(4, 16), 'B-1', 32).n(r(4, 32), 'C-2', 32).n(r(4, 48), 'D-2', 32).n(r(4, 56), 'E-1', 34);

// --- 1–4 · percussion (04 only): timpani on the climbing roots, hats, reverse crash, the break -------------
const perc = new Tr(ROWS, INS.timpani);
perc.n(r(4, 0), 'A-2', 34).n(r(4, 16), 'B-2', 36).n(r(4, 32), 'C-3', 38).n(r(4, 48), 'D-3', 42);
// break: timpani 8ths on E crescendo
[56, 58, 60, 62].forEach((k, i) => perc.n(r(4, k), 'E-2', 44 + 4 * i));

const hats = new Tr(ROWS, INS.hats);
for (let i = 0; i < 8; i++) hats.n(r(4, 16 + 2 * i), KIT.closed, 10 + (i % 2 ? 0 : 3)); // 8ths
for (let i = 0; i < 16; i++) hats.n(r(4, 32 + i), KIT.closed, i % 2 ? 11 : 16); // 16ths
hats.n(r(4, 48), KIT.reverse, 34); // 1.92 s riser landing exactly on 05:00

// the break uses the groove helper's snare fill for its last two beats, plus a lead-in figure
const brk = groove(1, { bars: 1, fill: 'snare', energy: 4 });
const kick = new Tr(ROWS, INS.kick);
const snare = new Tr(ROWS, INS.snare);
kick.n(r(4, 48), DRUM_NOTE, 46).n(r(4, 54), DRUM_NOTE, 40);
snare.n(r(4, 52), DRUM_NOTE, 30).n(r(4, 55), DRUM_NOTE, 24);
kick.put(r(4, 48), brk[CH.kick]);
snare.put(r(4, 48), brk[CH.snare]);
kick.n(r(4, 63), DRUM_NOTE, 50); // a last push into the downbeat

// --- 15 · fx: Shepard riser — white-key steps every 2 rows, rising forever into the band entry -------------
const fx = new Tr(ROWS);
shepard(fx, r(4, 32), r(4, 64), 2, 'A', { v: [6, 30] });

// --- mix ---------------------------------------------------------------------------------------------------
// Volumes above are written as relative balances; these trims set the act's loudness curve against the
// engine master (+9 dB, bus compressor, limiter): measured with tools/render-xm.ts, NOTES.md §6 targets
// 00 ≈ −22, 01 ≈ −20, 02 ≈ −19, 03 ≈ −17.5, 04 ≈ −16 LUFS (energy 1 → 3).
const POS_TRIM = [-7, -11, -9.5, -6, -5];
const CH_TRIM: Partial<Record<number, number>> = {
  [CH.bell]: 2, [CH.bass]: -6, [CH.sub]: -3, [CH.counter]: 4, [CH.padA]: 2, [CH.padB]: 2, [CH.ghost]: -3, [CH.pluck]: 3,
};

// --- assemble ----------------------------------------------------------------------------------------------
const all: Tracks = {
  [CH.kick]: kick,
  [CH.snare]: snare,
  [CH.hats]: hats,
  [CH.perc]: perc,
  [CH.bass]: bass,
  [CH.sub]: sub,
  [CH.padA]: choir,
  [CH.padB]: pad,
  [CH.arp]: arp,
  [CH.counter]: str,
  [CH.bell]: bell,
  [CH.pluck]: harp,
  [CH.fx]: fx,
  [CH.ghost]: ghost,
  [CH.marker]: mk,
};

for (const [ch, t] of Object.entries(all)) for (let p = 0; p < 5; p++) t!.trim(POS_TRIM[p] + (CH_TRIM[+ch] ?? 0), p * P, p * P + P);

const names = ['00_beam', '01_cage_naked', '02_cage_harmonised', '03_cage_arps', '04_cage_break'];
export const patterns: Record<string, PatternDef> = Object.fromEntries(names.map((n, i) => [n, pat(i, all)]));
export const order: string[] = names;

