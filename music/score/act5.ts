// EFFACED — Act V · FADE (positions 1C–1F + tail, 3:35–~4:15). D dorian → E major → A major.
//
//   1C Dm9 Fmaj7 G6 Am7   1D Dm9 Fmaj7 Em7 Am7   1E Dm9 Fmaj7 Gadd9 (E alone)   1F E E7 | A A → tail
//
// S14 "Portrait" (1C–1E): a white field, a still face, 23 s of fixation. Everything is even and soft;
// the bell sings FADE three times (MEL.FADE_BELL, literal 1C:00 / 1D:00 / 1E:00), gently, and the 16
// channels leave one every 12 rows (theory.ts DROP_ORDER): each channel's FINAL note-on sits exactly on
// its drop row and the voice fades out across its 12-row slot (raised-cosine volume, key-off v0 at the
// end). Every last word is a chord tone that matters:
//
//   k  row  addr   ch  voice                            last word
//   0    0  1C:00   3  hats (pedal "chick")             the clock's last tick (S8's tick)
//   1   12  1C:12   2  snare                            a muffled tap on the heartbeat
//   2   24  1C:24   4  timpani roll on A (pp hairpin)   A — 5th of Dm, 3rd of F, the final tonic
//   3   36  1C:36   1  kick heartbeat (12-row grid)      the fourth, softest beat
//   4   48  1C:48  16  'ooh' halo A-4                    A — the lead's A-4 (CAGE) takes the note
//   5   60  1C:60  15  Shepard halo (pitch classes)     A — Am's root, Dm's fifth, the final tonic
//   6   72  1D:08   9  the S8 chaser cycle (harp)        D — the cycle lands on its own first note
//   7   84  1D:20  11  echo, 12 rows behind the lead    G — it never reaches the E
//   8   96  1D:32  10  lead: CAGE remembered            E-4 — the root of Em
//   9  108  1D:44   6  sub                              A-1 — leans into Am7 (and the end)
//  10  120  1D:56   5  low strings (bass)               D-2 — the tonic, anticipating Dm
//  11  132  1E:04  14  harp                             A-2 → D-3, a small amen
//  12  144  1E:16  12  strings (low pad voice)          F-3 — F, the first letter of FADE
//  13  156  1E:28   8  warm pad (middle voice)          G-3 — the G that becomes G♯ at 1F:00
//  14  168  1E:40   7  choir 'ooh' (top pad voice)      E-4 — handed to the bell an octave up
//  15  180  1E:52  13  bell                             E-5 alone → the root of E major
//
// Voicing rule (clarity): the bell and the lead are the melody; pads, harp, halo and the chaser cycle
// keep at least a minor third away from every melody note sounding with them (no seconds, sevenths or
// ninths against the bell). That is why the 7ths/9ths of the written chords live in the melody only
// (the bell's E-5 over F, the lead's G-4 over Dm/F) and the pads hold plain triads/sevenths below.
// 8–16 kHz stays free (no hats/air after 1C:00; the ghost's breath lives there) — the only content left
// in that band is the attack of the bell's FM partials on its D-5/E-5/A-4 strikes.
//
// S15 "Afterimage" (1F): the screen cuts to white. The first black keys of the track: E major blooms
// around the bell's ringing E (G♯ in the strings, the harp sweeps through it), the bell names the G♯
// at 1F:16 while the choir's E steps down to D (E7: the old tonic D, pulling down). At 1F:32 every
// voice steps into A major, legato, by step — top B→C♯ (choir aah, violins an octave above), G♯→A,
// D→C♯ (the cage's tonic falls a semitone outside), B→A, bass and sub E→A, a pp timpani roll into the
// A, a harp sweep up to C♯6, the bell's C♯6 on top. The bell's whole ending reads D-5 · E-5 · G♯5 · C♯6:
// intervals that widen as it climbs out. The last note-on of the piece is the harp's C♯5 (1F:60). No key-offs: the
// chord rings into the tail, which the engine holds 6 s and then fades. ch1/ch2/ch10 (light, camera,
// glyphs) and ch17 stay silent in 1F so the white screen stays untouched for the afterimage.

import {
  CH, INS, Tr, MEL, FX, BAR, BEAT, S14, DROP_ORDER, dropRow, dropOut, KIT, mixdown, patternsOf, pat, type Tracks,
} from './theory.ts';
import type { PatternDef } from '../../src/music/score/dsl.ts';

const R = S14.rows; // 192 rows: 1C:00 … 1E:63

/** harmony per bar (12 bars of S14). Voiced for clarity: bar 2 without its B (the lead holds C-5 over it). */
export const HARMONY = ['Dm9', 'Fmaj7', 'G6', 'Am7', 'Dm9', 'Fmaj7', 'Em7', 'Am7', 'Dm9', 'Fmaj7', 'Gadd9', null];

// ---- helpers ---------------------------------------------------------------------------------------------------------

/** legato: the note without an instrument number plus 3xx — the playing sample, volume and envelope continue */
function leg(t: Tr, row: number, note: string, v: number, speed = 0x10): Tr {
  return t.n(row, note, v, '3' + speed.toString(16).toUpperCase().padStart(2, '0'), '-');
}

/** soft entrance: the note starts at v0 and swells to v1 over `len` rows (written on the following rows) */
function swell(t: Tr, row: number, v0: number, v1: number, len: number): Tr {
  for (let i = 1; i <= len; i++) t.v(row + i, Math.round(v0 + ((v1 - v0) * i) / len));
  return t;
}

/**
 * The farewell: dropOut() verifies that the final note-on sits exactly on the channel's drop row and
 * clears everything after it; then the voice fades across its 12-row slot with a raised-cosine volume
 * curve (holds, then slips away — no step) and keys off with v0 at the slot's end. `vib` keeps a
 * vibrato alive while it fades.
 */
function farewell(t: Tr, ch: number, opt: { fade?: boolean; vib?: string } = {}): Tr {
  dropOut(t, ch);
  if (opt.fade === false) return t;
  const dr = dropRow(ch);
  const v0 = t.cells[dr].vol ?? 32;
  for (let i = 1; i < 12; i++) t.v(dr + i, Math.round(v0 * (0.5 + 0.5 * Math.cos((Math.PI * i) / 12))));
  if (opt.vib) t.fxSpan(dr + 2, dr + 12, opt.vib);
  if (dr + 12 < t.rows) t.off(dr + 12, 0);
  return t;
}

// ======================================================================================================================
// S14 · 1C–1E · the portrait
// ======================================================================================================================

const s: Record<number, Tr> = {};
const T = (ch: number, ins?: number) => (s[ch] = new Tr(R, ins));

// ---- the melody: the bell sings FADE (notes untouched; gentle, every note left to ring) ------------------------------
T(CH.bell, INS.bell).line(0, MEL.FADE_BELL, { v: 32 });
s[CH.bell].v(0, 33).v(16, 32).v(32, 32).v(48, 33); // 1C: one word per bar
s[CH.bell].v(64, 31).v(72, 29).v(80, 29).v(88, 31).v(112, 28).v(120, 27); // 1D: faster, so lighter
s[CH.bell].v(128, 30).v(144, 29).v(160, 30).v(180, 34); // 1E: slowest; the E alone, clear

// the lead remembers CAGE (literal: 1C:24 C-5, 1C:48 A-4, 1D:08 G-4, 1D:32 E-4); the echo answers one
// chaser revolution (12 rows) later and leaves before the E
T(CH.lead, INS.lead);
T(CH.echo, INS.lead);
const CAGE_MEM: [number, string][] = [[24, 'C-5'], [48, 'A-4'], [72, 'G-4'], [96, 'E-4']];
CAGE_MEM.forEach(([row, n], i) => {
  const v = 17 - i; // each word a little softer
  const last = i === CAGE_MEM.length - 1;
  // remembered, not announced: each word starts below its level and swells (the last one is simply laid down)
  s[CH.lead].n(row, n, last ? v : v - 5);
  if (!last) swell(s[CH.lead], row, v - 5, v, 4).fxSpan(row + 7, row + 24, FX.vibLead);
  if (!last) {
    const e = Math.round(v / 2), eLast = i === CAGE_MEM.length - 2;
    s[CH.echo].n(row + 12, n, eLast ? e : e - 2);
    if (!eLast) swell(s[CH.echo], row + 12, e - 2, e, 4).fxSpan(row + 19, row + 36, FX.vibLead);
  }
});

// ---- the pad chorale, three voices under the melody (legato moves only: no new attacks inside a voice) -------------
//   bar      0 Dm  1 F   2 G6s 3 Am  4 Dm  5 F   6 Em  7 Am  8 Dm  9 F   10 G  11 (E)
//   ooh  7   D-4   C-4   D-4   C-4   D-4   C-4   B-3   C-4   D-4   C-4   B-3 → E-4 (168)
//   warm 8   A-3   A-3   G-3   G-3   A-3   A-3   G-3   G-3   A-3   A-3 → G-3 (156)
//   str 12   F-3   F-3   E-3   E-3   F-3   F-3   E-3   E-3   D-3 → F-3 (144)
// (the ooh rocks D–C–D–C like breathing; every bar is a plain triad or a 7th chord with no tone a step
// from the bell's note)
const PADS: [number, number, string[], number][] = [
  [CH.padA, INS.ooh, ['D-4', 'C-4', 'D-4', 'C-4', 'D-4', 'C-4', 'B-3', 'C-4', 'D-4', 'C-4', 'B-3'], 20],
  [CH.padB, INS.pad, ['A-3', 'A-3', 'G-3', 'G-3', 'A-3', 'A-3', 'G-3', 'G-3', 'A-3', 'A-3'], 22],
  [CH.counter, INS.strings, ['F-3', 'F-3', 'E-3', 'E-3', 'F-3', 'F-3', 'E-3', 'E-3', 'D-3'], 19],
];
for (const [ch, ins, line, v] of PADS) {
  const t = T(ch, ins).n(0, line[0], v);
  line.forEach((n, b) => {
    if (b === 0) return;
    if (n !== line[b - 1]) leg(t, b * BAR, n, v, 0x0c);
    else if (b % 4 === 0) leg(t, b * BAR, n, v); // a silent re-touch every pattern (keeps the sustain audit honest)
  });
}
// the last words
leg(s[CH.counter], 144, 'F-3', 19, 0x0c);
leg(s[CH.padB], 156, 'G-3', 22, 0x0c); // reaches the G as the G chord arrives
leg(s[CH.padA], 168, 'E-4', 20, 0xff); // straight to the E (no glide): the thread the bell takes up at 1E:52
s[CH.counter].fxSpan(6, 144, FX.vibStr);

// ---- the floor: sub and low strings, one root per bar; each leaves leaning into the next chord ----------------------
T(CH.sub, INS.sub);
['D-1', 'F-1', 'G-1', 'A-1', 'D-1', 'F-1', 'E-1'].forEach((n, b) => s[CH.sub].n(b * BAR, n, b ? 24 : 8));
s[CH.sub].ramp(1, 14, 9, 24, 2); // the floor fades in with the white field (a sine has no attack of its own)
s[CH.sub].n(108, 'A-1', 22); // a beat early: Am7 (and, much later, A major)
T(CH.bass, INS.strings);
['D-2', 'F-2', 'G-2', 'A-2', 'D-2', 'F-2', 'E-2', 'A-2'].forEach((n, b) => s[CH.bass].n(b * BAR, n, 21));
s[CH.bass].n(120, 'D-2', 20); // two beats early: the tonic, fading as Dm arrives

// ---- harp: a quarter-note broken chord per bar, doubling the pads (never a second against the melody), settling
// lower bar by bar; a small amen (A → D) to end -----------------------------------------------------------------------
T(CH.pluck, INS.harp);
const HARP: string[][] = [
  ['D-3', 'A-3', 'D-4', 'F-4'], // Dm   (bell F-4)
  ['F-3', 'C-4', 'F-4', 'A-4'], // F    (bell A-4, lead C-5)
  ['G-2', 'E-3', 'G-3', 'D-4'], // G6sus (bell D-5, lead C-5): exactly the pads' notes
  ['A-2', 'C-4', 'E-4', 'A-4'], // Am   (bell E-5, lead A-4; the warm pad's G-3 in between)
  ['D-3', 'F-3', 'A-3', 'D-4'], // Dm   (bell F-4 → A-4, lead G-4 from 72)
  ['F-2', 'C-3', 'F-3', 'A-3'], // F    (bell D-5 → E-5, lead G-4)
  ['E-3', 'B-3', 'E-4', 'G-4'], // Em   (bell E-5, lead E-4)
  ['A-2', 'E-3', 'C-4', 'E-4'], // Am   (bell C-5 → A-4)
];
HARP.forEach((ns, b) => ns.forEach((n, k) => s[CH.pluck].n(b * BAR + k * BEAT, n, (k === 0 ? 19 : 15) - Math.floor(b / 3))));
s[CH.pluck].n(128, 'A-2', 16).n(132, 'D-3', 15);

// ---- the S8 chaser wheel (ch9), faintly, until 1D:08: the figure of 0F–11 (Act III's wheel D F A C E F A F E C A F,
// up seven rungs and down five) on the same 12-row period, its rungs re-strung per bar on chord tones that keep
// clear of the melody and the pads; 72 rows = 6 revolutions, landing on its first note, D -----------------------------
const WHEEL_STEP = [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]; // rung per row of a revolution
const LADDER: string[][] = [
  ['D-4', 'F-4', 'A-4', 'C-5', 'D-5', 'F-5', 'A-5'], // Dm   (S8's own rungs, minus the E that would rub the bell's F)
  ['C-4', 'F-4', 'A-4', 'C-5', 'F-5', 'A-5', 'C-6'], // F
  ['D-4', 'G-4', 'A-4', 'D-5', 'G-5', 'A-5', 'D-6'], // G6sus (no B, no E: the lead's C and the bell's D sit above)
  ['C-4', 'E-4', 'A-4', 'C-5', 'E-5', 'A-5', 'C-6'], // Am   (no G: the lead's A-4 is there)
  ['D-4', 'F-4', 'A-4', 'C-5', 'D-5', 'F-5', 'A-5'], // Dm
];
T(CH.arp, INS.harp);
for (let r = 0; r <= 72; r++) {
  const k = WHEEL_STEP[r % 12];
  const fadeIn = Math.min(1, (r + 4) / 16), fadeOut = 1 - (0.35 * r) / 72;
  const acc = k === 0 ? 13 : k === 6 ? 11 : 9; // the wheel's own accents: its start and its top
  s[CH.arp].n(r, LADDER[Math.floor(r / BAR)][k], Math.max(2, Math.round(acc * fadeIn * fadeOut)));
}

// ---- halos: ch16 'ooh' on A-4 (consonant with every chord of the first phrase); the Shepard tone, a pitch class
// in all octaves, very soft, on a chord tone per bar that nothing in the texture rubs against ---------------------------
T(CH.stab, INS.ooh).n(0, 'A-4', 15);
leg(s[CH.stab], 48, 'A-4', 15); // the lead's A-4 arrives: the choir lets it take the note
T(CH.fx, INS.shepard).n(0, 'A-4', 10).n(16, 'C-4', 10).n(32, 'G-4', 10).n(48, 'C-4', 10).n(60, 'A-4', 9);

// ---- the kit says goodbye in the first bar (light and camera stay calm: everything pp) ---------------------------------
T(CH.hats, INS.hats).n(0, KIT.pedal, 9); // one closed "chick" — S8's tick, the clock stops; 8–16 kHz free after it
T(CH.snare, INS.snare).n(0, 'A-3', 11).n(12, 'A-3', 8); // two muffled taps on the heartbeat (pitched down = darker)
// kick: a slow heartbeat on the chaser's 12-row period, softer each time (pitched down: rounder, no click)
T(CH.kick, INS.kick).n(0, 'A-3', 22).n(12, 'A-3', 20).n(24, 'A-3', 17).n(36, 'A-3', 13);
// timpani: a pp roll on A (the 5th of Dm, the 3rd of F) swelling with the white field, then one last stroke
T(CH.perc, INS.timpani);
for (let r = 0; r < 24; r++) s[CH.perc].n(r, 'A-2', r < 12 ? 3 + r : 15 - Math.round((r - 12) * 0.6), 'R03');
s[CH.perc].n(24, 'A-2', 12);

// ---- enforce the drop-out schedule: every channel in DROP_ORDER; the bell rings on into 1F ----------------------------
const VIB: Partial<Record<number, string>> = { [CH.lead]: FX.vibLead, [CH.echo]: FX.vibLead, [CH.counter]: FX.vibStr };
for (const ch of DROP_ORDER) farewell(s[ch], ch, { fade: ch !== CH.bell, vib: VIB[ch] });

// ======================================================================================================================
// S15 · 1F · the afterimage: E major → A major (black keys allowed only here), held into the tail
// ======================================================================================================================

const f: Record<number, Tr> = {};
const F = (ch: number, ins?: number) => (f[ch] = new Tr(64, ins, true));

// the floor
F(CH.sub, INS.sub).n(0, 'E-1', 26).n(32, 'A-1', 30);
F(CH.bass, INS.strings).n(0, 'E-2', 24).n(32, 'A-2', 28);
for (const [a, b] of [[6, 32], [38, 64]]) f[CH.bass].fxSpan(a, b, FX.vibStr);
// timpani: a soft E at the cut, a pp roll swelling into the A
F(CH.perc, INS.timpani).n(0, 'E-2', 15);
for (let r = 22; r < 32; r++) f[CH.perc].n(r, 'E-2', 5 + (r - 22), 'R03');
f[CH.perc].n(32, 'A-2', 22);

// the chorale: six voices, open spacing (fifth, fourth, thirds from the bottom up), every one moving by step
// (legato) into A major; a slow crescendo to 1F:32
//   voice        ch   E (1F:00)  E7 (1F:16)  A (1F:32)
//   halo         3    B-5 str    ·           C#6   (violins, very soft: the C# on top of everything)
//   top          7    B-4 aah    ·           C#5   ← the choir's top voice: B → C#, the note "outside"
//   alto         8    G#4 str    ·           A-4   (the first black key in the pads; leading tone up)
//   tenor        16   E-4 ooh    D-4         C#4   ← the old tonic D falls to C#
//   baritone     12   B-3 str    ·           A-3
//   bass voice   15   E-3 pad    ·           E-3
const CHORALE: [number, number, string, string | null, string, number][] = [
  [CH.hats, INS.strings, 'B-5', null, 'C#6', 15],
  [CH.padA, INS.aah, 'B-4', null, 'C#5', 30],
  [CH.padB, INS.strings, 'G#4', null, 'A-4', 25],
  [CH.stab, INS.ooh, 'E-4', 'D-4', 'C#4', 24],
  [CH.counter, INS.strings, 'B-3', null, 'A-3', 23],
  [CH.fx, INS.pad, 'E-3', null, 'E-3', 25],
];
for (const [ch, ins, e, e7, a, v] of CHORALE) {
  const t = F(ch, ins);
  const v0 = Math.round(v * 0.78);
  t.n(0, e, v0);
  t.ramp(8, 32, v0, Math.round(v * 0.9), 4); // crescendo through E and E7
  if (e7) leg(t, 16, e7, Math.round(v * 0.86), 0x0c);
  const from = e7 ?? e;
  if (a !== from) leg(t, 32, a, v, 0x08); // a singer's step: 2–4 ticks of glide
  else t.v(32, v);
  if (ins === INS.strings) for (const [x, y] of [[6, 16], [22, 32], [38, 64]]) t.fxSpan(x, y, FX.vibStr);
}

// the bell: its E-5 (1E:52) rings on as the root of E major; it names the G# at 1F:16 and the C# at 1F:32
F(CH.bell, INS.bell).n(16, 'G#5', 26).n(32, 'C#6', 29);

// harp: sweeps rotating over three channels (ch14, ch11 — panned left by the engine — and ch9) so each string
// rings on under the next two instead of being cut
const HARPS = [F(CH.pluck, INS.harp), F(CH.echo, INS.harp), F(CH.arp, INS.harp)];
const sweep = (from: number, notes: string[], v: number, step = 1) =>
  notes.forEach((n, i) => HARPS[i % 3].n(from + i * step, n, v - (i % 3 === 1 ? 2 : 0) + Math.round(i / 3)));
sweep(0, ['E-3', 'G#3', 'B-3', 'E-4', 'G#4', 'B-4', 'E-5', 'G#5', 'B-5'], 15); // the light floods in
for (const h of HARPS) h.v(31, 0); // the harpist damps the E strings on the breath before the A
sweep(32, ['A-3', 'C#4', 'E-4', 'A-4', 'C#5', 'E-5', 'A-5', 'C#6'], 17); // up to the C# on top
sweep(48, ['A-2', 'E-3', 'A-3', 'C#4', 'E-4', 'A-4', 'C#5'], 11, 2); // afterglow, settling: the last note-on is C#

// markers: the cut (D-4) and the arrival (C-4)
F(CH.marker).n(0, 'D-4').n(32, 'C-4');

// ======================================================================================================================
// mix — S14 even and thinning (≈ −10 … −12 dB under the E5 climaxes), the cadence blooming (≈ −5 dB)
// ======================================================================================================================
mixdown(s, [-10, -10, -9], { [CH.sub]: -4, [CH.lead]: -2, [CH.echo]: -2 });
mixdown(f, [-5.3], { [CH.sub]: -5 });

const names = ['1C_portrait', '1D_portrait', '1E_portrait_bell', '1F_afterimage'];
export const patterns: Record<string, PatternDef> = {
  ...patternsOf(names.slice(0, 3), s as Tracks),
  [names[3]]: pat(0, f as Tracks),
};
export const order: string[] = names;
