// EFFACED — Act II · FACADE (positions 05–0C, 0:38–1:40). A aeolian / C ionian, G mixolydian bridge.
//
// The theme act. Written as one continuous 8×64 = 512-row track per channel (pad slurs, ties, fills and
// the lead's fall-off cross pattern boundaries), cut into eight patterns. Harmony, the theme melodies (MEL),
// the literal FACADE statements, the ghost E-G-A-C, the markers and the structural events are the lead
// composer's contract (NOTES.md); everything else is the arrangement.
//
//   05 F G Am Em      06 F G C G       07 Am F C G      08 Am F C Dm7
//   09 G Am/G G7 C/G  0A Dm/G Em/G F/G [G stop hit 0A:48 → silence]
//   0B F G Am Em      0C F G Am7 (A-4 alone, held into 0D)
//
// Layout — one register per layer, so every line stays audible: bass/sub · one chord layer under the
// tune · a counter-line (tenor) · the lead + auto echo (ch11) · sparkle or descant above the tune.
//
// 05 S3 "City"     band entry: crash, orch hit F, kick, galop, lead FACADE (05:00:10) + echo; one choir
//                  'aah' line under the tune, slurred chord to chord (3xx legato, no re-attack); harp 16ths
//                  above it (octave 5–6); the strings' A-5 inherited from 04 (the 3rd of F) fades in bar 1.
// 06               theme A2 climbs to the G-5 peak (06:32: crash + orch hit C); from bar 2 the strings
//                  double it a third below; tom fill; reverse crash (ch15) into 07.
// 07 S4 "Gallery"  theme B1 as a four-part tracker texture: bass · string-chord 0xy (ch9, octave 3) ·
//                  counter-melody in long slurred strings (ch12: E | F | E-G | B → C) · tune; ride cymbal;
//                  tracker quotes for the HUD: 0xy chord, 3xx slurs, the lead's held D bursts into a 07C
//                  arpeggio (07:58, echoed); ghost E (07:00) G (07:32) on ch17.
// 08               theme B2 → D-5; the counter climbs E-G-A under the held E (the first steps of the
//                  stairs); ghost A (08:00) C (08:32); snare fill, reverse crash into the bridge.
// 09 S5 "Stairs"   G pedal galop, kick on every beat (footsteps), parallel 6/3 triads a step per bar
//                  (ch8 strings, ch7 choir, ch12 top) carrying the rise, spiccato an octave below them,
//                  the Shepard (ch15) in the background: a step per half bar, only onto chord tones, pitch
//                  classes always climbing; the lead's D-5 falls away (2xx, echoed) and leaves at 09:15.
// 0A               brass takes the top voice, orch hits climb D-E-F to the stop hit's G, timpani, the snare
//                  builds to 32nds; stop hit 0A:48 (D-4 marker); 0A:49–63 silent but for decays.
// 0B S6 "Escher"   the reprise, fuller: bass · spiccato ostinato (octave 3) · brass counter-melody (G fanfare
//                  under the held D, A-G-E under the held E) · tune · choir descant above it (F G A G);
//                  crash every bar, the push on 0B:30 (crash, orch hit A, bass anticipate bar 3).
// 0C               A2 head; bar 3 the Droste spiral: one falling Am7 figure A-G-E-C at three scales at once
//                  (spiccato 16ths, harp 8ths, brass quarters), dying away; 0C:48 nothing but ch7 'ooh'
//                  A-4 (from 0C:46) — held into 0D, where it becomes the 5th of Dm9.

import {
  CH, INS, Tr, MEL, FX, BAR, LEAD_IN, galop, arp16, fill, num, isWhite, ws, mixdown, patternsOf, KIT, DRUM_NOTE,
  type Tracks,
} from './theory.ts';
import type { PatternDef } from '../../src/music/score/dsl.ts';

const P = 64;
const N = 8; // positions 05..0C
const ROWS = N * P;
const r = (pos: number, row = 0) => (pos - 0x05) * P + row;

/** harmony, one chord per bar (32 bars) — the contract with the lead composer */
export const HARMONY = [
  'F', 'G', 'Am', 'Em', /* 05 */ 'F', 'G', 'C', 'G', /* 06 */
  'Am', 'F', 'C', 'G', /* 07 */ 'Am', 'F', 'C', 'Dm7', /* 08 */
  'G', 'Am/G', 'G7', 'C/G', /* 09 */ 'Dm/G', 'Em/G', 'F/G', 'G', /* 0A (G = stop hit) */
  'F', 'G', 'Am', 'Em', /* 0B */ 'F', 'G', 'Am7', null, /* 0C (bar 4: the single A) */
];
/** bass root per bar (galop register E-2…D-3) */
const ROOT = ['F-2', 'G-2', 'A-2', 'E-2', 'F-2', 'G-2', 'C-3', 'G-2', 'A-2', 'F-2', 'C-3', 'G-2', 'A-2', 'F-2', 'C-3', 'D-3',
  'G-2', 'G-2', 'G-2', 'G-2', 'G-2', 'G-2', 'G-2', 'G-2', 'F-2', 'G-2', 'A-2', 'E-2', 'F-2', 'G-2', 'A-2', ''];
const bar = (i: number) => i * BAR; // absolute row of bar i (0 = 05:00)

const t = {
  kick: new Tr(ROWS, INS.kick), snare: new Tr(ROWS, INS.snare), hats: new Tr(ROWS, INS.hats), perc: new Tr(ROWS, INS.timpani),
  bass: new Tr(ROWS, INS.bass), sub: new Tr(ROWS, INS.sub),
  choir: new Tr(ROWS, INS.aah), str: new Tr(ROWS, INS.strings), arp: new Tr(ROWS, INS.harp),
  lead: new Tr(ROWS, INS.lead), counter: new Tr(ROWS, INS.strings),
  pluck: new Tr(ROWS, INS.harp), fx: new Tr(ROWS, INS.shepard), stab: new Tr(ROWS, INS.orchhit), ghost: new Tr(ROWS, INS.scope), mk: new Tr(ROWS),
};

// =================================================================================================
// helpers

/** 3xx speed that glides `from` → `to` within `ticks` ticks (linear table: xx/16 semitone per tick) */
const porta = (from: string, to: string, ticks: number) =>
  '3' + Math.min(255, Math.max(1, Math.ceil((Math.abs(num(to) - num(from)) * 16) / ticks))).toString(16).toUpperCase().padStart(2, '0');

/**
 * A sustained voice on one channel: `hit` attacks a note (instrument written), `slur` moves to the next
 * note legato (3xx and no instrument: the PADsynth keeps sounding, no new attack), `off` keys it off.
 */
class Voice {
  cur: string | null = null;
  readonly tr: Tr;
  constructor(tr: Tr) {
    this.tr = tr;
  }
  hit(row: number, note: string, v: number, ins?: number, fx?: string): this {
    this.tr.n(row, note, v, fx, ins);
    this.cur = note;
    return this;
  }
  slur(row: number, note: string, v?: number, ticks = 3): this {
    if (!this.cur) throw new Error(`slur to ${note} at row ${row}: nothing is sounding`);
    if (note === this.cur) {
      if (v !== undefined) this.tr.v(row, v);
      return this;
    }
    this.tr.n(row, note, v, porta(this.cur, note, ticks), '-');
    this.cur = note;
    return this;
  }
  off(row: number): this {
    this.tr.off(row);
    this.cur = null;
    return this;
  }
}

/** an effect on every row of [from, to) that has no effect yet, starting `after` rows after each note-on */
function vibrato(tr: Tr, from: number, to: number, fx: string, after: number): void {
  let onset = -99;
  for (let row = from; row < to; row++) {
    const c = tr.cells[row];
    if (c.note === '==') onset = -99;
    else if (c.note) onset = row;
    if (onset >= 0 && row - onset >= after && !c.fx) tr.fx(row, fx);
  }
}

/** 0xy chord: [root, xy] one per bar from `from` (null = rest that bar); attacked `leadIn` rows early after
 *  a rest, otherwise slurred chord to chord */
function chordArp(v: Voice, from: number, chords: ([string, string] | null)[], vol: number[], ins?: number, leadIn = 0): void {
  chords.forEach((c, i) => {
    const row = from + bar(i);
    if (!c) {
      if (v.cur) v.off(row);
      return;
    }
    const [root, xy] = c;
    // the slur rows carry 3xx, so Tr.n cannot see the 0xy that follows: check its results here
    for (const d of [xy[1], xy[2]]) if (!isWhite(num(root) + parseInt(d, 16))) throw new Error(`0${xy.slice(1)} on ${root}: black key`);
    const end = row + BAR;
    if (!v.cur) {
      v.hit(row - leadIn, root, vol[i], ins, xy);
      for (let k = row - leadIn + 1; k < end; k++) v.tr.fx(k, xy);
    } else {
      v.slur(row, root, vol[i], 2);
      for (let k = row + 1; k < end; k++) v.tr.fx(k, xy);
    }
  });
}

// --- drums: one char per row (kick/snare: X accent, x normal, o ghost; hats: C/c closed, o open, p pedal, R/r ride)
const KV: Record<string, number> = { X: 60, x: 50, o: 40 };
const SV: Record<string, number> = { X: 52, x: 40, o: 20 };
const HV: Record<string, number> = { C: 26, c: 17, o: 26, p: 20, R: 30, r: 21 };
const HN: Record<string, string> = { C: KIT.closed, c: KIT.closed, o: KIT.open, p: KIT.pedal, R: KIT.ride, r: KIT.ride };
function drumBar(row: number, k: string, s: string, h: string, g = 1): void {
  for (const p of [k, s, h]) if (p.length !== BAR) throw new Error(`drum bar "${p}" is not 16 rows`);
  for (let i = 0; i < BAR; i++) {
    if (k[i] !== '.') t.kick.n(row + i, DRUM_NOTE, Math.round(KV[k[i]] * g));
    if (s[i] !== '.') t.snare.n(row + i, DRUM_NOTE, Math.round(SV[s[i]] * g));
    if (h[i] !== '.') t.hats.n(row + i, HN[h[i]], Math.round(HV[h[i]] * g));
  }
}
const crash = (row: number, v: number) => t.perc.n(row, KIT.crash, v, undefined, INS.hats);
const kitTracks = { [CH.kick]: t.kick, [CH.snare]: t.snare, [CH.perc]: t.perc };

// =================================================================================================
// boundary 04 → 05: Act I leaves the strings on A-5 (the sus4 that becomes the 3rd of F) and the Shepard
// riser sounding; ch7 'aah' D-4 and ch5/ch6 E are replaced by new notes at 05:00, ch8's warm-pad arp
// (E-4 057) is keyed off (ch8 rests until the stairs)
t.str.off(r(0x05));
t.counter.fxSpan(r(0x05, 0), r(0x05, 12), 'EB3'); // the A-5 sings over the downbeat and fades across three beats
t.counter.off(r(0x05, 12));
t.fx.off(r(0x05));

// =================================================================================================
// drums

const E4 = { k: 'X.....x.X.x.....', s: '....X.......X...', h: 'CcccCcccCcccCcoc' };
const PICK = '....X.......X.xx'; // two 16ths into the next phrase
// 05 — the band
for (let b = 0; b < 4; b++) drumBar(r(0x05) + bar(b), E4.k, b === 3 ? PICK : E4.s, E4.h);
crash(r(0x05), 48);
// 06 — A2; the peak; tom fill (the timpani run A G E D C A G E)
const FILLK = 'X.....x.........'; // first half of a fill bar (the fill writes its own kicks)
for (let b = 0; b < 4; b++) drumBar(r(0x06) + bar(b), b === 3 ? FILLK : E4.k, b === 3 ? '....X...........' : E4.s, b === 3 ? 'CcccCccc........' : E4.h);
crash(r(0x06), 34);
crash(r(0x06, 32), 42);
fill('toms', kitTracks, r(0x06, 56));
// 07–08 — the gallery: ride instead of hats, ghost notes
const RIDE = 'R.r.R.r.R.r.R.r.';
for (let b = 0; b < 4; b++) drumBar(r(0x07) + bar(b), E4.k, b === 3 ? '....X.......Xoxx' : b === 1 ? '....X......oX...' : E4.s, RIDE);
crash(r(0x07), 46);
for (let b = 0; b < 4; b++) drumBar(r(0x08) + bar(b), b === 3 ? FILLK : E4.k, b === 3 ? '....X...........' : b === 1 ? '....X......oX...' : E4.s, b === 3 ? 'R.r.R.r.........' : RIDE);
crash(r(0x08), 34);
fill('snare', kitTracks, r(0x08, 56));
// 09 — the stairs: footsteps on every beat, backbeat, 8th hats (energy 3)
for (let b = 0; b < 4; b++) drumBar(r(0x09) + bar(b), 'X...x...X...x...', b === 3 ? PICK : '....X.......X...', 'C.c.C.c.C.c.C.c.', 0.85);
crash(r(0x09), 40);
// 0A — 16th hats, then the roll (16ths → 32nds) to the stop hit; timpani on G
for (let b = 0; b < 2; b++) drumBar(r(0x0a) + bar(b), 'X...x...X...x.x.', '....X.....o.X...', 'CcccCcccCcccCccc', 0.92);
drumBar(r(0x0a, 32), 'X...x...X...x...', '................', 'C.c.C.c.C.c.C.c.', 0.95);
for (let i = 0; i < 16; i++) t.snare.n(r(0x0a, 32 + i), DRUM_NOTE, Math.round(24 + (30 * i) / 15), i >= 12 ? 'R03' : undefined);
t.perc.n(r(0x09, 48), 'G-2', 34).n(r(0x0a, 0), 'G-2', 40).n(r(0x0a, 16), 'G-2', 44);
for (let i = 0; i < 16; i++) t.perc.n(r(0x0a, 32 + i), 'G-2', Math.round(26 + (28 * i) / 15));
// 0B — fuller: groove-5 kick, ghost snares, 16th hats, crash every bar, the push on 0B:30
const E5 = { k: 'X..x..x.X.x...x.', s: '....X..o....X..o', h: 'CcCcCcCcCcCcCcoc' };
drumBar(r(0x0b, 0), E5.k, E5.s, E5.h);
drumBar(r(0x0b, 16), 'X..x..x.X.x...X.', '....X..o....X...', 'CcCcCcCcCcCcCco.');
drumBar(r(0x0b, 32), '......x.X.x...x.', '....X..o....X..o', '..CcCcCcCcCcCcoc');
drumBar(r(0x0b, 48), 'X..x..x.X.x.....', '....X..o....Xxxx', E5.h);
crash(r(0x0b, 0), 50);
crash(r(0x0b, 16), 38);
crash(r(0x0b, 30), 46);
crash(r(0x0b, 48), 38);
// 0C — two bars of band, then the spiral: a last kick and two timpani heartbeats; bar 4 silent
drumBar(r(0x0c, 0), E4.k, E4.s, E4.h);
drumBar(r(0x0c, 16), 'X.....x.X.......', '....X.......X...', 'CcccCcccCccc....');
crash(r(0x0c), 42);
t.kick.n(r(0x0c, 32), DRUM_NOTE, 46);
t.perc.n(r(0x0c, 32), 'A-2', 42).n(r(0x0c, 40), 'E-2', 30);

// reverse crashes (ch15, free outside the bridge) into the scene changes 07:00 and 09:00
t.fx.n(r(0x06, 48), KIT.reverse, 30, undefined, INS.hats);
t.fx.n(r(0x08, 48), KIT.reverse, 30, undefined, INS.hats);

// =================================================================================================
// bass and sub

galop(t.bass, r(0x05), ROOT.slice(0, 16), { approach: true });
// galop() aims its approach note at the nearest octave of the next root (C-2 from F-2), not at the root
// actually played (C-3): step into C-3 from D-3 instead of leaping a 9th from D-2
for (const pos of [0x07, 0x08]) t.bass.n(r(pos, 31), 'D-3', 42);
galop(t.bass, r(0x09), ROOT.slice(16, 20), { oct: '4', v: 44 });
galop(t.bass, r(0x0a), ROOT.slice(20, 23), { oct: '24', v: 47 });
galop(t.bass, r(0x0b), ROOT.slice(24, 30), { approach: true, v: 48 });
// the push: the bass jumps to A with the lead's anticipated E on 0B:30 and ties over the bar line
t.bass.n(r(0x0b, 30), 'A-2', 50);
for (const k of [31, 32]) t.bass.cells[r(0x0b, k)] = {};
// 0C bar 3: one long A under the spiral, dying away
t.bass.n(r(0x0c, 32), 'A-2', 42).ramp(r(0x0c, 34), r(0x0c, 48), 38, 14, 2).off(r(0x0c, 48));

const subRoot = (n: string) => n.replace(/(\d)$/, (d) => String(+d - 1));
ROOT.slice(0, 23).forEach((n, i) => t.sub.n(bar(i), subRoot(n), 40));
ROOT.slice(24, 30).forEach((n, i) => t.sub.n(bar(24 + i), subRoot(n), 42));
t.sub.n(r(0x0b, 30), 'A-1', 42).cells[r(0x0b, 32)] = {};
t.sub.n(r(0x0c, 32), 'A-1', 38).ramp(r(0x0c, 36), r(0x0c, 48), 34, 12, 4).off(r(0x0c, 48));

const str = new Voice(t.str), choir = new Voice(t.choir), ctr = new Voice(t.counter);

// =================================================================================================
// 05–06 (theme A): one choir line under the tune (ch7 'aah', 3rds and 5ths, slurred chord to chord),
// harp sparkle above it (ch9); in 06 the strings' thirds take over the middle from bar 2 (ch12)

const PAD_A = ['C-4', 'D-4', 'E-4', 'E-4', 'C-4']; // 05 F G Am Em | 06 F
const PAD_V = [28, 28, 29, 29, 28];
PAD_A.forEach((n, i) => (i === 0 ? choir.hit(bar(i), n, PAD_V[i]) : choir.slur(bar(i), n, PAD_V[i])));
choir.off(r(0x06, 16)); // rests until the stairs

// harp 16ths above the tune: chord tones in octave 5–6, up-and-down cells (the PM sparkle)
const HI: Record<string, string[]> = {
  F: ['F-5', 'A-5', 'C-6'], G: ['G-5', 'B-5', 'D-6'], Am: ['A-5', 'C-6', 'E-6'], Em: ['G-5', 'B-5', 'E-6'], C: ['G-5', 'C-6', 'E-6'],
};
HARMONY.slice(0, 8).forEach((sym, b) => {
  const tones = HI[sym!];
  const peak = b >= 6 ? 3 : 0; // under the G-5 peak the sparkle steps back
  for (let i = 0; i < BAR; i++) t.arp.n(bar(b) + i, tones[[0, 1, 2, 1][i % 4]], (i % 4 === 0 ? 21 : 16) - peak);
});

// 06: the strings double the climb a third below — B C D | E | E . D C B (under D E F | G | G . F E D)
ctr.hit(r(0x06, 16), 'B-4', 30);
ctr.slur(r(0x06, 24), 'C-5', 32).slur(r(0x06, 28), 'D-5', 33).slur(r(0x06, 32), 'E-5', 36);
ctr.slur(r(0x06, 56), 'D-5', 36).slur(r(0x06, 58), 'C-5', 34).slur(r(0x06, 60), 'B-4', 32);
t.counter.ramp(r(0x06, 34), r(0x06, 48), 36, 40, 2);

// =================================================================================================
// 07–08 (theme B, the gallery): bass · string-chord 0xy (ch9, octave 3) · counter-melody (ch12, tenor) · tune

// the tracker string-chord: one channel, the whole triad by 0xy (A-3 037 = Am, F-3 047 = F, G-3 047 = G; over
// the bass D, F-3 047 is Dm7). It breathes in the C bars, where bass, counter and tune already spell C and
// the counter climbs.
const chordV = new Voice(t.arp);
chordArp(chordV, r(0x07), [['A-3', '037'], ['F-3', '047'], null, ['G-3', '047'], ['A-3', '037'], ['F-3', '047'], null, ['F-3', '047']],
  [20, 20, 20, 20, 20, 20, 21, 22], INS.strings, LEAD_IN.strings);
// the counter-melody: long slurred notes against the falling arpeggios
//   07: E-4 | F-4 | E-4 G-4 | B-4      08: C-5 . A-4 | . F-4 | E-4 . G-4 A-4 | (A-4 swells into the stairs)
ctr.hit(r(0x07, 0) - LEAD_IN.strings, 'E-4', 30);
const CTR: [number, string, number][] = [
  [r(0x07, 16), 'F-4', 32], [r(0x07, 32), 'E-4', 31], [r(0x07, 36), 'G-4', 33], [r(0x07, 48), 'B-4', 35],
  [r(0x08, 0), 'C-5', 36], [r(0x08, 12), 'A-4', 34], [r(0x08, 24), 'F-4', 32],
  [r(0x08, 32), 'E-4', 31], [r(0x08, 40), 'G-4', 33], [r(0x08, 44), 'A-4', 34],
];
for (const [row, n, v] of CTR) ctr.slur(row, n, v, 4);
t.counter.ramp(r(0x07, 2), r(0x07, 14), 30, 34, 2).ramp(r(0x07, 18), r(0x07, 30), 32, 35, 2).ramp(r(0x07, 50), r(0x07, 62), 35, 38, 2);
t.counter.ramp(r(0x08, 50), r(0x08, 64), 34, 40, 2);

// =================================================================================================
// lead: the theme (the echo on ch11 is automatic, see effaced.ts)

const vib = { v: 46, vib: FX.vibLead, vibAfter: 4 };
t.lead.line(r(0x05), MEL.THEME_A1, vib);
t.lead.line(r(0x06), MEL.THEME_A2, vib);
t.lead.line(r(0x07), MEL.THEME_B1, vib);
t.lead.line(r(0x08), MEL.THEME_B2, vib);
// tracker quote: the held D of B1 bursts into a fifth-and-octave arpeggio (D A D'), leading into B2's A-5
for (let k = 58; k < 64; k++) t.lead.fx(r(0x07, k), '07C');
// the D-5 of B2 rings into the bridge, then falls away (2xx fall-off towards the G pedal) and leaves
t.lead.fxSpan(r(0x09, 0), r(0x09, 8), FX.vibLead);
t.lead.fxSpan(r(0x09, 8), r(0x09, 15), '203');
t.lead.ramp(r(0x09, 8), r(0x09, 15), 44, 14);
t.lead.off(r(0x09, 15));
t.lead.line(r(0x0b), MEL.THEME_A1, { ...vib, v: 48 });
t.lead.line(r(0x0c), 'F-4/6 A-4/2 C-5/4 A-4/4 | D-5/8 E-5/4 F-5/4 | E-5/8 C-5/4 A-4/4 | ==/16', { ...vib, v: 48 });

// =================================================================================================
// bridge 09–0A: the Penrose staircase — parallel 6/3 triads a step per bar over the G pedal

/** [ch8 strings, ch7 choir, ch12 top] per bar */
const STAIR: [string, string, string][] = [
  ['B-3', 'D-4', 'G-4'], ['C-4', 'E-4', 'A-4'], ['D-4', 'F-4', 'B-4'], ['E-4', 'G-4', 'C-5'], // 09 G Am/G G7 C/G
  ['F-4', 'A-4', 'D-5'], ['G-4', 'B-4', 'E-5'], ['A-4', 'C-5', 'F-5'], // 0A Dm/G Em/G F/G
];
STAIR.forEach(([s, c, top], i) => {
  const row = r(0x09) + bar(i);
  const v = 26 + i; // the staircase grows
  if (i === 0) {
    str.hit(row - LEAD_IN.strings, s, v);
    choir.hit(row - LEAD_IN.aah, c, v);
  } else if (i === 4) {
    // 0A: a fresh bow stroke with the brass entry — the B-3 sample slurred all the way up to A-4
    // would sit 10 semitones above its zone (squeaky); re-attacked here it stays within ±5
    str.hit(row - LEAD_IN.strings, s, v);
    choir.slur(row, c, v, 2);
  } else {
    str.slur(row, s, v, 2);
    choir.slur(row, c, v, 2);
  }
  if (i < 4) ctr.slur(row, top, 31 + i, 2);
  else ctr.hit(row, top, 38 + 3 * (i - 4), INS.brass); // 0A: brass on top, re-attacked each step
});
vibrato(t.counter, r(0x06, 0), r(0x0a, 0), FX.vibStr, 5);
vibrato(t.counter, r(0x0a, 0), r(0x0a, 48), FX.vibStr, 6);
// spiccato an octave below the triads (cellos and violas climbing with them): 8ths in 09, 16ths in 0A,
// a 6-note figure against the 4/4 so the steps never line up
const LOW = STAIR.map(([s, c, top]) => [ws(s, -7), ws(c, -7), ws(top, -7), s]);
arp16(t.arp, r(0x09), LOW.slice(0, 4), [0, 1, 2, 3, 2, 1], BAR, 2, (i) => (i % 2 === 0 ? 24 : 19), INS.spiccato);
arp16(t.arp, r(0x0a), LOW.slice(4), [0, 1, 2, 3, 2, 1], BAR, 1, (i) => (i % 4 === 0 ? 26 : 20), INS.spiccato);
// Shepard, in the background: a step every half bar, always onto a chord tone, pitch classes always
// climbing (G B | C E | F G | C E | F A | B E | F A) — the staircase that rises forever
const SHEP = ['G', 'B', 'C', 'E', 'F', 'G', 'C', 'E', 'F', 'A', 'B', 'E', 'F', 'A'];
SHEP.forEach((l, k) => t.fx.n(r(0x09) + 8 * k, `${l}-4`, Math.round(8 + (9 * k) / (SHEP.length - 1))));

// =================================================================================================
// the stop hit (0A:48): tutti on G, then silence until 0B:00

const STOP = r(0x0a, 48);
t.kick.n(STOP, DRUM_NOTE, 64);
crash(STOP, 52);
t.bass.n(STOP, 'G-2', 52).off(STOP + 3);
t.sub.n(STOP, 'G-1', 46).off(STOP + 6);
str.off(STOP);
choir.off(STOP);
ctr.off(STOP);
for (const tr of [t.fx, t.arp]) tr.off(STOP);

// =================================================================================================
// 0B–0C (the reprise): bass · spiccato ostinato (octave 3) · brass counter-melody (tenor) · tune ·
// choir descant above it (octave 5)

// the choir descant F | G | A | G — F | G . A | G (no lead-in: 0A:49–63 stays silent)
const DESC: [number, string, number][] = [
  [r(0x0b, 0), 'F-5', 28], [r(0x0b, 16), 'G-5', 29], [r(0x0b, 32), 'A-5', 30], [r(0x0b, 48), 'G-5', 29],
  [r(0x0c, 0), 'F-5', 28], [r(0x0c, 16), 'G-5', 28], [r(0x0c, 28), 'A-5', 28], [r(0x0c, 32), 'G-5', 26],
];
DESC.forEach(([row, n, v], i) => (i === 0 ? choir.hit(row, n, v) : choir.slur(row, n, v)));
// 0C bar 3: the descant dies away under the spiral; ch7 turns into the single 'ooh' A-4 (0C:46, held into 0D)
t.choir.ramp(r(0x0c, 34), r(0x0c, 44), 24, 10, 2);
const ONE = r(0x0c, 48);
choir.hit(ONE - LEAD_IN.ooh, 'A-4', 26, INS.ooh);

// spiccato ostinato: root-3rd-5th-3rd in 16ths, octave 3
const LOWO: Record<string, string[]> = { F: ['F-3', 'A-3', 'C-4'], G: ['G-3', 'B-3', 'D-4'], Am: ['A-3', 'C-4', 'E-4'], Em: ['E-3', 'G-3', 'B-3'] };
HARMONY.slice(24, 30).forEach((sym, b) => {
  const tones = LOWO[sym!];
  for (let i = 0; i < BAR; i++) t.arp.n(r(0x0b) + bar(b) + i, tones[[0, 1, 2, 1][i % 4]], i % 4 === 0 ? 25 : 19, undefined, INS.spiccato);
});

// brass counter-melody (re-attacked notes, on the beat): the G fanfare under the held D, A-G-E under the held E
t.counter.line(r(0x0b), 'C-4/16 | G-3/4 B-3/4 D-4/4 G-4/4 | A-4/8 G-4/4 E-4/4 | E-4/8 D-4/8', { ins: INS.brass, v: 38 });
t.counter.line(r(0x0c), 'C-4/16 | B-3/16 | A-4v34/4 G-4v30/4 E-4v26/4 C-4v22/4 | ==/16', { ins: INS.brass, v: 38 });
t.counter.v(r(0x0b, 16), 36).v(r(0x0b, 28), 42).v(r(0x0b, 32), 42);
vibrato(t.counter, r(0x0b), r(0x0c, 32), FX.vibStr, 6);

// 0C bar 3 — the Droste spiral: one falling Am7 figure at three scales (spiccato 16ths, harp 8ths an
// octave lower, brass quarters above), dying away into the single A
const SPIRAL = ['A-5', 'G-5', 'E-5', 'C-5', 'A-4', 'G-4', 'E-4', 'C-4'];
for (let i = 0; i < 16; i++) t.arp.n(r(0x0c, 32 + i), SPIRAL[i % 8], Math.round(27 - (13 * i) / 15) + (i % 4 === 0 ? 2 : 0), undefined, INS.spiccato);
SPIRAL.map((n) => ws(n, -7)).forEach((n, i) => t.pluck.n(r(0x0c, 32 + 2 * i), n, 26 - 2 * i, undefined, INS.harp));
for (const tr of [t.arp, t.pluck]) tr.off(ONE);

// =================================================================================================
// orchestra hits (ch16)

t.stab.n(r(0x05), 'F-3', 58); // the band entry
t.stab.n(r(0x06, 32), 'C-4', 46); // the G-5 peak
t.stab.n(r(0x07), 'A-3', 48); // the gallery
t.stab.n(r(0x0a, 0), 'D-3', 44).n(r(0x0a, 16), 'E-3', 48).n(r(0x0a, 32), 'F-3', 52); // the stairs' last steps
t.stab.n(STOP, 'G-3', 60); // the stop hit
t.stab.n(r(0x0b), 'F-3', 58).n(r(0x0b, 30), 'A-3', 50); // reprise + the push
t.stab.n(r(0x0c), 'F-3', 46);

// =================================================================================================
// ghost: retrograde CAGE (E-G-A-C), very quiet, 07–08

t.ghost.line(r(0x07), 'E-4/32 G-4/32 | A-4/32 C-5/24 ==/8', { v: 8 });

// =================================================================================================
// markers

t.mk.n(r(0x05), 'D-4'); // band entry
t.mk.n(r(0x07), 'C-4'); // look: the gallery / tracker HUD; the ghost channel shows through
t.mk.n(STOP, 'D-4'); // stop hit

// =================================================================================================
// mix (energy 4; the bridge 3 → 4; 0C falls to 2) — tuned with tools/render-xm.ts against NOTES.md §6

// balance inside the act (relative; the mix pass will rebalance for the sampled bank): the lines that
// carry a section come forward — the counter-melody in 07–08, the staircase triads in the bridge
t.counter.trim(3, r(0x07) - 1, r(0x09));
t.counter.trim(4, r(0x09), r(0x0a));
for (const tr of [t.str, t.choir]) tr.trim(4, r(0x09) - LEAD_IN.aah, STOP);
t.choir.trim(2, 0, r(0x06, 16));
t.arp.trim(3, 0, r(0x07) - 1); // harp sparkle
t.arp.trim(3, r(0x0b), r(0x0c, 32)); // spiccato ostinato

const all: Tracks = {
  [CH.kick]: t.kick, [CH.snare]: t.snare, [CH.hats]: t.hats, [CH.perc]: t.perc, [CH.bass]: t.bass, [CH.sub]: t.sub,
  [CH.padA]: t.choir, [CH.padB]: t.str, [CH.arp]: t.arp, [CH.lead]: t.lead, [CH.counter]: t.counter,
  [CH.pluck]: t.pluck, [CH.fx]: t.fx, [CH.stab]: t.stab, [CH.ghost]: t.ghost, [CH.marker]: t.mk,
};
mixdown(all, [-5, -5, -5, -5, -6.5, -5.5, -4.5, -4.5], { [CH.bass]: -4, [CH.sub]: -3, [CH.lead]: 1 });

const names = ['05_facade_a1', '06_facade_a2', '07_gallery_b1', '08_gallery_b2', '09_stairs', '0A_stairs_stop', '0B_reprise', '0C_spiral'];
export const patterns: Record<string, PatternDef> = patternsOf(names, all);
export const order: string[] = names;
