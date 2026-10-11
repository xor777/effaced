// EFFACED — shared music theory and track-writing toolkit for all act files.
//
// Everything here produces DSL tracks (see src/music/score/dsl.ts) and enforces the white-key rule
// (MUSIC_BRIEF §6) at write time: a black key anywhere before position 1F throws immediately, with the
// row, instead of surfacing later in xm-check. Only tracks created with `new Tr(rows, ins, true)`
// (the 1F cadence) may contain black keys.
//
// Conventions (NOTES.md has the full list):
//   - rows are 16ths, 4 rows = beat, 16 rows = bar, 64 rows = pattern; tracker octaves, C-4 = middle C
//   - every note carries an explicit volume (vNN); instrument per note (`:name`) whenever the channel
//     plays anything other than its roster default
//   - PADsynth slots have slow attacks: start them ahead of the harmonic downbeat (LEAD_IN)
//
// Contents
//   pitch ........ num/name/isWhite/ws (white-key steps)/semi/nearest/atOrAbove
//   modes ........ MODE, scale(), deg()
//   chords ....... chord('Fmaj7'), stack(), voiceLead(), arpXY()/arpOf() for 0xy
//   Tr ........... track builder: n/off/v/fx/ramp/arp/line/put/pat; `line()` mini-notation
//   rhythm ....... groove(level), fill, galop(), arp16()
//   special ...... shepard(), cycle() (S8 12-row cycle), DROP_ORDER/dropOut() (S14), echoOf()
//   motifs ....... MOTIF (note letters) and MEL (the composed main melodies, in line() notation)

import { parseNote, ROWS, type PatternDef, type ScoreSong } from '../../src/music/score/dsl.ts';
import { CH, INS } from '../../src/music/roster.ts';

export { CH, INS, ROWS };

// =================================================================================================
// time

export const BEAT = 4;
export const BAR = 16;
/** rows → seconds at speed 6 / BPM 125 */
export const sec = (rows: number) => rows * 0.12;

/** position numbers by scene (MUSIC_BRIEF §7) */
export const POS = {
  S0_beam: 0x00,
  S1_border: 0x01,
  S2_cage: 0x03,
  S3_city: 0x05,
  S4_gallery: 0x07,
  S5_stairs: 0x09,
  S6_escher: 0x0b,
  S7_indra: 0x0d,
  S8_chaser: 0x0f,
  S9_still: 0x12,
  S10_compress: 0x14,
  S11_invert: 0x16,
  S12_canvas: 0x18,
  S13_erase: 0x1a,
  S14_portrait: 0x1c,
  S15_after: 0x1f,
} as const;

/** "0F:23" → global row (pos·64 + row) */
export function at(addr: string): number {
  const [p, r] = addr.split(':');
  return parseInt(p, 16) * ROWS + +r;
}

// =================================================================================================
// pitch

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export const LETTERS: Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

/** note name → XM note number (C-4 = 49) */
export const num = (note: string): number => parseNote(note);
/** XM note number → name ('C-4', 'C#4') */
export const name = (n: number): string => NAMES[(n - 1) % 12] + Math.floor((n - 1) / 12);
export const isWhite = (note: string | number): boolean => {
  const n = typeof note === 'string' ? num(note) : note;
  return ![1, 3, 6, 8, 10].includes((n - 1) % 12);
};
/** assert a white key; returns the note */
export function white(note: string, where = ''): string {
  if (!isWhite(note)) throw new Error(`black key ${note}${where ? ' at ' + where : ''} (white-key rule, MUSIC_BRIEF §6)`);
  return note;
}
export const letterOf = (note: string): Letter => note[0].toUpperCase() as Letter;
export const octaveOf = (note: string): number => +note[2];

/** move a white key by k white keys (diatonic steps): ws('B-3', 1) = 'C-4', ws('C-4', -2) = 'A-3' */
export function ws(note: string, k: number): string {
  white(note);
  const idx = octaveOf(note) * 7 + LETTERS.indexOf(letterOf(note)) + k;
  return `${LETTERS[((idx % 7) + 7) % 7]}-${Math.floor(idx / 7)}`;
}
/** transpose by semitones; the result must be white unless allowBlack */
export function semi(note: string, s: number, allowBlack = false): string {
  const r = name(num(note) + s);
  if (!allowBlack) white(r, `${note}${s >= 0 ? '+' : ''}${s}`);
  return r;
}
export const up8 = (note: string) => semi(note, 12, true);
export const down8 = (note: string) => semi(note, -12, true);
/** the note with letter `l` at or above `ref` */
export function atOrAbove(l: Letter, ref: string): string {
  let n = `${l}-${octaveOf(ref)}`;
  if (num(n) < num(ref)) n = up8(n);
  return n;
}
/** the note with letter `l` at or below `ref` */
export function atOrBelow(l: Letter, ref: string): string {
  let n = `${l}-${octaveOf(ref)}`;
  if (num(n) > num(ref)) n = down8(n);
  return n;
}
/** the note with a letter from `ls` nearest to `ref` (ties go down) */
export function nearest(ref: string, ls: Letter[]): string {
  let best = '', bd = 99;
  for (const l of ls)
    for (const n of [atOrBelow(l, ref), atOrAbove(l, ref)]) {
      const d = Math.abs(num(n) - num(ref));
      if (d < bd || (d === bd && num(n) < num(best))) (best = n), (bd = d);
    }
  return best;
}

// =================================================================================================
// modes — every mode is a rotation of the white keys

export const MODE = { ionian: 'C', dorian: 'D', phrygian: 'E', lydian: 'F', mixolydian: 'G', aeolian: 'A', locrian: 'B' } as const;
/** the 7 letters of the white-key mode starting on `tonic` */
export const scale = (tonic: Letter): Letter[] => LETTERS.map((_, i) => LETTERS[(LETTERS.indexOf(tonic) + i) % 7]);
/** scale degree d (1-based, may exceed 7 or be < 1) above `tonic` in octave `oct` */
export const deg = (tonic: Letter, d: number, oct: number): string => ws(`${tonic}-${oct}`, d - 1);

// =================================================================================================
// chords — diatonic tertian stacks on white keys, with quality checking

export interface Chord {
  sym: string;
  root: Letter;
  /** chord tones, root first, in stacking order (7th, 9th … appended) */
  tones: Letter[];
  /** bass letter (slash chords), defaults to root */
  bass: Letter;
}

const semis = (a: Letter, b: Letter) => (((num(`${b}-4`) - num(`${a}-4`)) % 12) + 12) % 12;
/** stack of diatonic thirds on root: [1, 3, 5, 7, 9, 11, 13] */
const thirds = (root: Letter) => [0, 2, 4, 6, 1, 3, 5].map((k) => LETTERS[(LETTERS.indexOf(root) + k) % 7]);

/**
 * Parse a white-key chord symbol and verify that its quality is what the white keys give:
 * 'Am', 'F', 'Bdim', 'G7', 'Fmaj7', 'Am7', 'Bø7' (= Bm7b5), 'Dm9', 'Fmaj9', 'Cadd9', 'G6', 'Esus4',
 * 'E7sus4', 'Asus2', 'Dm11', 'G/B', 'Am/G' …  'E' or 'Bm' throw: they need black keys.
 */
export function chord(sym: string): Chord {
  const [main, slash] = sym.split('/');
  const root = main[0].toUpperCase() as Letter;
  if (!LETTERS.includes(root) || /^[A-G][#b]/.test(main)) throw new Error(`chord ${sym}: white-key roots only`);
  const q = main.slice(1);
  const st = thirds(root);
  const third = semis(root, st[1]), fifth = semis(root, st[2]), seventh = semis(root, st[3]);
  const triad = third === 4 && fifth === 7 ? 'maj' : third === 3 && fifth === 7 ? 'min' : 'dim';
  const sus4 = /sus4/.test(q), sus2 = /sus2/.test(q), sus = sus4 || sus2;
  const wantMin = /^m(?!aj)/.test(q), wantDim = /dim|°|ø|m7b5/.test(q);
  if (!sus) {
    const want = wantDim ? 'dim' : wantMin ? 'min' : 'maj';
    if (want !== triad) throw new Error(`chord ${sym}: the white keys give ${root}${triad === 'maj' ? '' : triad === 'min' ? 'm' : 'dim'} (black key needed)`);
  } else if (fifth !== 7) throw new Error(`chord ${sym}: ${root} has a diminished fifth on white keys`);
  const tones: Letter[] = [root];
  if (sus4) tones.push(LETTERS[(LETTERS.indexOf(root) + 3) % 7]);
  else if (sus2) tones.push(LETTERS[(LETTERS.indexOf(root) + 1) % 7]);
  else tones.push(st[1]);
  tones.push(st[2]);
  const ext = q.replace(/^m(?!aj)|dim|°|ø|sus[24]/g, '');
  const has = (re: RegExp) => re.test(ext);
  const add = (l: Letter) => !tones.includes(l) && tones.push(l);
  if (has(/maj/) && seventh !== 11) throw new Error(`chord ${sym}: ${root} has a minor seventh on white keys`);
  if (has(/(^|[^d])(7|9|11|13)/) && !has(/maj/) && !has(/add/) && seventh !== 10 && !has(/^6/))
    throw new Error(`chord ${sym}: ${root} has a major seventh on white keys (write ${root}maj7)`);
  if (has(/6/)) add(LETTERS[(LETTERS.indexOf(root) + 5) % 7]);
  if (has(/(^|[^d])(7|9|11|13)|maj/)) add(st[3]);
  if (has(/add9|(^|[^d])9|11|13/)) add(st[4]);
  if (has(/11/)) add(st[5]);
  if (has(/13/)) add(st[6]);
  for (const l of tones) white(`${l}-4`);
  const bass = (slash ? slash[0].toUpperCase() : root) as Letter;
  return { sym, root, tones, bass };
}

/** diatonic triad (or n-note tertian stack) built upward on a white key: triad('B-3') = B-3 D-4 F-4 */
export const triad = (low: string, n = 3): string[] => Array.from({ length: n }, (_, i) => ws(low, 2 * i));

/** stack letters upward from `low` (each next note is the first such letter above the previous) */
export function stack(low: string, letters: Letter[]): string[] {
  const out: string[] = [white(low)];
  for (const l of letters.slice(1)) out.push(atOrAbove(l, ws(out[out.length - 1], 1)));
  return out;
}

/**
 * Smooth voice-leading: move each voice of `prev` to the nearest tone of `next`; if a tone listed in
 * `must` (default: the chord's 3rd, or the sus note) ends up missing, the voice that moves least to get
 * it takes it. Returns the new voicing (same number of voices, same order).
 */
export function voiceLead(prev: string[], next: Chord, must: Letter[] = [next.tones[1]]): string[] {
  const out = prev.map((n) => nearest(n, next.tones));
  for (const m of must) {
    if (out.some((n) => letterOf(n) === m)) continue;
    let bi = 0, bd = 99, bn = '';
    out.forEach((n, i) => {
      const c = nearest(prev[i], [m]);
      const d = Math.abs(num(c) - num(prev[i]));
      if (d < bd && out.filter((x) => letterOf(x) === letterOf(n)).length > 1) (bi = i), (bd = d), (bn = c);
    });
    if (bn) out[bi] = bn;
  }
  return out;
}

export interface PadOpt {
  /** rows per chord (default 16) */
  per?: number;
  /** volume per voice */
  v?: number[];
  /** instrument per voice (undefined = the track's default) */
  ins?: (string | number | undefined)[];
  /** rows each voice starts ahead of the chord (LEAD_IN), per voice */
  leadIn?: number[];
  /** re-strike voices that keep their note (default false: common tones sustain) */
  restrike?: boolean;
}
/**
 * Voice-led pad chords across several channels: voice i of the voicing goes to track ts[i]. `syms`
 * holds one chord symbol per span (null = keep the previous chord sounding). `start` is the voicing
 * of the first chord (or a reference voicing the first chord is led from). Returns the final voicing.
 */
export function padChords(ts: Tr[], from: number, syms: (string | null)[], start: string[], opt: PadOpt = {}): string[] {
  const per = opt.per ?? BAR;
  // a leading null means the start voicing is already sounding: only changed voices are written
  let prev = start, first = !!syms[0];
  syms.forEach((sym, i) => {
    if (!sym) return;
    const vc = voiceLead(prev, chord(sym));
    vc.forEach((n, k) => {
      if (!first && n === prev[k] && !opt.restrike) return;
      const row = Math.max(0, from + i * per - (opt.leadIn?.[k] ?? 0));
      ts[k].n(row, n, opt.v?.[k], undefined, opt.ins?.[k]);
    });
    prev = vc;
    first = false;
  });
  return prev;
}

/** 0xy parameter for a note `root` arpeggiating to `a` and `b` (both above root, ≤ 15 semitones, white) */
export function arpXY(root: string, a: string, b: string): string {
  const x = num(a) - num(root), y = num(b) - num(root);
  for (const [n, d] of [[a, x], [b, y]] as const) {
    if (d < 0 || d > 15) throw new Error(`0xy: ${n} is ${d} semitones from ${root} (0..15)`);
    white(n, `0xy on ${root}`);
  }
  white(root, '0xy root');
  return '0' + x.toString(16).toUpperCase() + y.toString(16).toUpperCase();
}
/** 0xy for the next two tones of `sym` above `root` (root must be a chord tone): arpOf('A-3','Am') = '037' */
export function arpOf(root: string, sym: string): string {
  const c = chord(sym);
  const i = c.tones.indexOf(letterOf(root));
  if (i < 0) throw new Error(`arpOf: ${root} not in ${sym}`);
  const triad = c.tones.slice(0, 3);
  const k = triad.indexOf(letterOf(root));
  const order = k >= 0 ? [triad[(k + 1) % 3], triad[(k + 2) % 3]] : [triad[0], triad[1]];
  const a = atOrAbove(order[0], ws(root, 1));
  const b = atOrAbove(order[1], ws(a, 1));
  return arpXY(root, a, b);
}

// =================================================================================================
// volume and timing conventions (NOTES.md §6)

/** default volumes by role at energy 4; scale with energy via vol(role, energy) */
export const VOL = {
  kick: 60, snare: 52, hats: 20, crash: 44, timp: 48,
  bass: 46, sub: 40,
  pad: 26, choir: 26, strings: 28,
  arp: 24, lead: 46, counter: 36, brass: 40,
  bell: 44, epiano: 36, pluck: 30, fx: 24, stab: 52, ghost: 12,
} as const;
export type Role = keyof typeof VOL;
const ENERGY_SCALE = [0.35, 0.55, 0.72, 0.86, 1.0, 1.1];
/** role volume at an energy level 0..5 (clamped to 64) */
export const vol = (role: Role, energy = 4): number => Math.min(64, Math.round(VOL[role] * ENERGY_SCALE[energy] / ENERGY_SCALE[4]));

/**
 * Rows to start a sustained PADsynth note ahead of its harmonic downbeat so its slow attack arrives
 * in time (attacks in the v0 bank: warm pad ≈ 35 ticks, aah ≈ 18, ooh ≈ 20, strings ≈ 11).
 */
export const LEAD_IN = { pad: 4, aah: 2, ooh: 2, strings: 1 } as const;

/** effect strings */
export const FX = {
  vibLead: '453', // PM lead vibrato (speed 5, depth 3) — start it a few rows after the note
  vibWide: '465',
  vibStr: '432', // strings / choir: slow and shallow vibrato (speed 3, depth 2). Was '342' = tone portamento 3xx by mistake: it slid sustained notes to stale 3xx targets (F#6 brass squeaks in 0A, A#5 strings in 13)
  portaLegato: '3FF',
} as const;

// =================================================================================================
// Tr — the track builder

export interface Cell {
  note?: string; // 'C-4', '==' (key-off)
  ins?: string | number;
  vol?: number; // 0..64 set volume
  raw?: string; // raw volume-column byte (hex), used when vol is undefined
  fx?: string; // effect letter + 2 hex digits, e.g. '037', '453', 'EC2'
}

export interface LineOpt {
  /** default volume for notes without vNN */
  v?: number;
  /** instrument for every note of the line */
  ins?: string | number;
  /** default duration of items without /N (rows) */
  dur?: number;
  /** vibrato effect (e.g. FX.vibLead) applied to sounding notes from `vibAfter` rows after the onset */
  vib?: string;
  vibAfter?: number;
  /** transpose by white-key steps */
  steps?: number;
  /** check that '|' bar lines fall on absolute bar boundaries (default true) */
  barCheck?: boolean;
}

/** parse one line() item without duration: 'C-5', 'C-5v40', 'C-5:bellv40!453', '-', '==', '.v20' */
function parseItem(item: string): Cell | null {
  if (item === '-' || item === '.' || item === '') return null;
  const c: Cell = {};
  let s = item;
  const m = /^([A-G][-#b]?\d|==)/i.exec(s);
  if (m) {
    c.note = m[1] === '==' ? '==' : m[1][0].toUpperCase() + m[1].slice(1);
    s = s.slice(m[0].length);
  } else if (s.startsWith('.') || s.startsWith('-')) s = s.slice(1);
  while (s.length) {
    let mm: RegExpExecArray | null;
    if ((mm = /^:([a-z0-9]+?)(?=v\d|~|!|$)/i.exec(s))) c.ins = /^\d+$/.test(mm[1]) ? +mm[1] : mm[1];
    else if ((mm = /^v(\d{1,2})/.exec(s))) c.vol = +mm[1];
    else if ((mm = /^~([0-9a-f]{2})/i.exec(s))) c.raw = mm[1];
    else if ((mm = /^!([0-9A-Z][0-9a-f]{2})/i.exec(s))) c.fx = mm[1].toUpperCase();
    else throw new Error(`cannot parse "${s}" in "${item}"`);
    s = s.slice(mm[0].length);
  }
  return c;
}

/**
 * A track of `rows` rows (64 = one pattern; 128, 192 … for passages spanning positions, cut with pat(i)).
 *
 * line() mini-notation — whitespace-separated items, each `ITEM/DUR` (DUR in rows):
 *   C-5/12          note held 12 rows (nothing else written: it sustains)
 *   C-5v40!453/4    with volume and effect
 *   -/8             sustain the previous note 8 more rows (no event)
 *   ==/4            key-off, then 4 rows of nothing
 *   |               bar line: checked to fall on a bar boundary (row % 16 == 0)
 */
export class Tr {
  readonly rows: number;
  readonly cells: Cell[];
  /** default instrument written with every note */
  ins?: string | number;
  /** allow black keys (only the 1F cadence) */
  readonly black: boolean;

  constructor(rows = ROWS, ins?: string | number, black = false) {
    this.rows = rows;
    this.ins = ins;
    this.black = black;
    this.cells = Array.from({ length: rows }, () => ({}));
  }

  private cell(row: number): Cell {
    if (!(row >= 0 && row < this.rows) || row !== Math.floor(row)) throw new Error(`row ${row} out of 0..${this.rows - 1}`);
    return this.cells[row];
  }

  /** note-on with optional volume, effect and instrument */
  n(row: number, note: string, v?: number, fx?: string, ins?: string | number): this {
    fx = fx?.replace(/^!/, '').toUpperCase();
    if (!this.black) white(note, `row ${row}`);
    else num(note);
    if (fx && /^0[0-9A-F]{2}$/i.test(fx) && fx !== '000' && !this.black) {
      const x = parseInt(fx[1], 16), y = parseInt(fx[2], 16);
      white(semi(note, x, true), `0${fx.slice(1)} on ${note} row ${row}`);
      white(semi(note, y, true), `0${fx.slice(1)} on ${note} row ${row}`);
    }
    const c = this.cell(row);
    c.note = note;
    c.ins = ins ?? this.ins;
    if (v !== undefined) c.vol = v;
    if (fx !== undefined) c.fx = fx.replace(/^!/, '').toUpperCase();
    return this;
  }
  /** key-off (optionally with a volume) */
  off(row: number, v?: number): this {
    const c = this.cell(row);
    c.note = '==';
    c.ins = undefined;
    if (v !== undefined) c.vol = v;
    return this;
  }
  /** set volume without a note */
  v(row: number, vol: number): this {
    if (vol < 0 || vol > 64) throw new Error(`volume ${vol}`);
    this.cell(row).vol = Math.round(vol);
    return this;
  }
  /** effect without changing the note (e.g. '037', '453', 'EC2', 'A04') */
  fx(row: number, fx: string): this {
    this.cell(row).fx = fx.replace(/^!/, '').toUpperCase();
    return this;
  }
  /** raw volume-column byte (hex, e.g. '91' = fine volume slide up 1) */
  raw(row: number, hex: string): this {
    this.cell(row).raw = hex;
    return this;
  }
  /** volume ramp from v0 (at row `from`) to v1 (at row `to`-1), written every `step` rows */
  ramp(from: number, to: number, v0: number, v1: number, step = 1): this {
    const n = to - from;
    for (let r = from; r < to; r += step) this.v(r, Math.round(v0 + ((v1 - v0) * (r - from)) / Math.max(1, n - 1)));
    if ((to - 1 - from) % step) this.v(to - 1, v1);
    return this;
  }
  /** effect on every row of [from, to) (keeps existing effects unless overwrite) */
  fxSpan(from: number, to: number, fx: string, overwrite = false): this {
    for (let r = from; r < to; r++) if (overwrite || !this.cell(r).fx) this.fx(r, fx);
    return this;
  }
  /** 0xy chord arpeggio: `root` at `from` with 0xy, 0xy repeated on every row until `to` */
  arp(from: number, to: number, root: string, xy: string, v?: number, ins?: string | number): this {
    this.n(from, root, v, xy, ins);
    for (let r = from + 1; r < to; r++) if (!this.cell(r).note) this.fx(r, xy);
    return this;
  }
  /** write a line() melody starting at `from`; returns the row after its end */
  line(from: number, spec: string, opt: LineOpt = {}): number {
    let row = from;
    const events: { row: number; c: Cell | null; dur: number }[] = [];
    for (const raw of spec.trim().split(/\s+/)) {
      if (!raw) continue;
      if (raw === '|') {
        if (opt.barCheck !== false && row % BAR) throw new Error(`line: bar line at row ${row} (not a bar boundary) in "${spec}"`);
        continue;
      }
      const m = /^(.*?)(?:\/(\d+))?$/.exec(raw)!;
      const dur = m[2] ? +m[2] : (opt.dur ?? 1);
      const c = parseItem(m[1]);
      if (c?.note && c.note !== '==' && opt.steps) c.note = ws(c.note, opt.steps);
      events.push({ row, c, dur });
      row += dur;
    }
    if (row > this.rows) throw new Error(`line ends at row ${row} > ${this.rows}: "${spec}"`);
    // sounding spans for vibrato
    let onset = -1;
    const spans: [number, number][] = [];
    events.forEach((e, i) => {
      if (e.c?.note) {
        if (onset >= 0) spans.push([onset, e.row]);
        onset = e.c.note === '==' ? -1 : e.row;
      }
      if (i === events.length - 1 && onset >= 0) spans.push([onset, e.row + e.dur]);
    });
    for (const e of events) {
      if (!e.c) continue;
      const { note, ins, vol, raw, fx } = e.c;
      if (note === '==') this.off(e.row, vol);
      else if (note) this.n(e.row, note, vol ?? opt.v, fx, ins ?? opt.ins);
      else {
        if (vol !== undefined) this.v(e.row, vol);
        if (fx) this.fx(e.row, fx);
      }
      if (raw) this.raw(e.row, raw);
    }
    if (opt.vib) {
      const after = opt.vibAfter ?? 4;
      for (const [a, b] of spans) if (b - a > after + 1) this.fxSpan(a + after, b, opt.vib);
    }
    return row;
  }
  /** copy rows of another track into this one (cells are cloned; empty cells don't overwrite) */
  put(from: number, src: Tr, srcFrom = 0, len = src.rows - srcFrom): this {
    for (let i = 0; i < len; i++) {
      const s = src.cells[srcFrom + i];
      if (Object.keys(s).length) Object.assign(this.cell(from + i), { ...s });
    }
    return this;
  }
  /** rows of note-ons (not key-offs) */
  notes(): number[] {
    return this.cells.flatMap((c, r) => (c.note && c.note !== '==' ? [r] : []));
  }
  lastNote(): number {
    const n = this.notes();
    return n.length ? n[n.length - 1] : -1;
  }
  /** scale every volume in rows [from, to) by `db` decibels (mixing trim; notes without vNN untouched) */
  trim(db: number, from = 0, to = this.rows): this {
    const g = Math.pow(10, db / 20);
    for (let r = from; r < to; r++) {
      const c = this.cells[r];
      if (c.vol !== undefined && c.vol > 0) c.vol = Math.max(1, Math.min(64, Math.round(c.vol * g)));
    }
    return this;
  }
  /** remove everything from `row` on (inclusive) */
  clearFrom(row: number): this {
    for (let r = row; r < this.rows; r++) this.cells[r] = {};
    return this;
  }
  /** the DSL track for pattern slice i (rows i·64 … i·64+63) */
  pat(i = 0): (string | null)[] {
    if ((i + 1) * ROWS > this.rows) throw new Error(`pat(${i}): track has ${this.rows} rows`);
    return this.cells.slice(i * ROWS, (i + 1) * ROWS).map(tok);
  }
}

function tok(c: Cell): string | null {
  if (c.note === undefined && c.vol === undefined && c.raw === undefined && !c.fx) return null;
  let s = c.note ?? '.';
  if (c.note && c.note !== '==' && c.ins !== undefined) s += ':' + c.ins;
  if (c.vol !== undefined) s += 'v' + c.vol;
  else if (c.raw !== undefined) s += '~' + c.raw;
  if (c.fx) s += '!' + c.fx;
  return s;
}

/** channel → track for one or more patterns */
export type Tracks = Partial<Record<number, Tr>>;

/** merge track sets into a PatternDef for pattern slice i (a channel may appear only once) */
export function pat(i: number, ...sets: Tracks[]): PatternDef {
  const def: PatternDef = {};
  for (const set of sets)
    for (const [k, t] of Object.entries(set)) {
      if (!t) continue;
      if (def[+k]) throw new Error(`pat: channel ${k} given twice`);
      def[+k] = t.pat(i);
    }
  return def;
}

/**
 * Mixing trims for an act written as continuous tracks: `posTrim[i]` dB applies to every channel in
 * pattern slice i, `chTrim[ch]` dB to a channel throughout. Tune with tools/render-xm.ts against the
 * loudness targets in NOTES.md §6.
 */
export function mixdown(all: Tracks, posTrim: number[], chTrim: Partial<Record<number, number>> = {}): void {
  for (const [ch, t] of Object.entries(all))
    if (t) posTrim.forEach((db, p) => t.trim(db + (chTrim[+ch] ?? 0), p * ROWS, p * ROWS + ROWS));
}

/** one PatternDef per slice, named in order */
export function patternsOf(names: string[], all: Tracks): Record<string, PatternDef> {
  return Object.fromEntries(names.map((n, i) => [n, pat(i, all)]));
}

/** a fresh set of tracks of `rows` rows with the roster's role instruments */
export function tracks(rows: number, chans: number[]): Record<number, Tr> {
  const out: Record<number, Tr> = {};
  for (const c of chans) out[c] = new Tr(rows);
  return out;
}

// =================================================================================================
// markers (channel 18) — MUSIC_BRIEF §11

export const MK = { look: 'C-4', hit: 'D-4', mode: 'E-4', motif: 'F-4' } as const;
/** a marker track from { row: 'hit' | 'mode' | … } */
export function markers(rows: number, at: Record<number, keyof typeof MK>): Tr {
  const t = new Tr(rows);
  for (const [r, k] of Object.entries(at)) t.n(+r, MK[k]);
  return t;
}

// =================================================================================================
// drums

/** slot 14 kit: the note selects the sound (all unpitched) */
export const KIT = { closed: 'C-4', pedal: 'D-4', open: 'E-4', crash: 'F-4', ride: 'G-4', reverse: 'A-4' } as const;
/** kick and snare play at their natural pitch on C-4 */
export const DRUM_NOTE = 'C-4';

/**
 * Bar patterns, one char per row. kick/snare: X accent, x normal, o ghost. hats: c closed, C accented
 * closed, o open, p pedal, r ride. Volumes come from VOL at the given energy.
 */
export const GROOVES = {
  1: { kick: '................', snare: '................', hats: '................' },
  2: { kick: 'X.......x.......', snare: '................', hats: '..c...c...c...c.' },
  3: { kick: 'X.......X.x.....', snare: '....X.......X...', hats: 'C.c.C.c.C.c.C.c.' },
  4: { kick: 'X.....x.X.x.....', snare: '....X.......X...', hats: 'CcccCcccCcccCcoc' },
  5: { kick: 'X..x..x.X.x...x.', snare: '....X..o....X..o', hats: 'CcCcCcCcCcCcCcoc' },
  half: { kick: 'X.........x.....', snare: '........X.......', hats: 'C.c.C.c.C.c.C.c.' },
} as const;
export type Energy = 1 | 2 | 3 | 4 | 5;

export interface GrooveOpt {
  bars?: number; // default 4 (one pattern)
  energy?: Energy; // volume level (defaults to the groove level, 4 for 'half')
  /** last-bar fill: 'snare' (16ths crescendo, last 2 beats), 'toms' (timpani tom run, last 2 beats), 'none' */
  fill?: 'snare' | 'toms' | 'none';
  /** crash on row 0 of the first bar (ch4) — "crash on one" */
  crash?: boolean;
  /** crash on every bar */
  crashEvery?: boolean;
  /** reverse crash leading into the next pattern's downbeat (rows 48–63 of the last bar) */
  reverse?: boolean;
  /** bars (0-based) to leave out entirely */
  mute?: number[];
}

/** kick/snare/hats/perc tracks for `bars` bars of a groove level */
export function groove(level: Energy | 'half', opt: GrooveOpt = {}): Record<number, Tr> {
  const bars = opt.bars ?? 4;
  const rows = bars * BAR;
  const e = opt.energy ?? (level === 'half' ? 3 : level);
  const k = new Tr(rows, INS.kick), s = new Tr(rows, INS.snare), h = new Tr(rows, INS.hats), p = new Tr(rows);
  const g = GROOVES[level];
  const kv = { X: vol('kick', e), x: vol('kick', e) - 8, o: vol('kick', e) - 18 };
  const sv = { X: vol('snare', e), x: vol('snare', e) - 8, o: Math.max(8, vol('snare', e) - 30) };
  const hv = { C: vol('hats', e) + 6, c: vol('hats', e) - 2, o: vol('hats', e) + 4, p: vol('hats', e), r: vol('hats', e) + 2 };
  const hn: Record<string, string> = { C: KIT.closed, c: KIT.closed, o: KIT.open, p: KIT.pedal, r: KIT.ride };
  for (let b = 0; b < bars; b++) {
    if (opt.mute?.includes(b)) continue;
    const fillBar = b === bars - 1 && opt.fill && opt.fill !== 'none';
    for (let i = 0; i < BAR; i++) {
      const r = b * BAR + i;
      if (fillBar && i >= 8) continue;
      const kc = g.kick[i] as 'X' | 'x' | 'o' | '.', sc = g.snare[i] as 'X' | 'x' | 'o' | '.', hc = g.hats[i];
      if (kc !== '.') k.n(r, DRUM_NOTE, kv[kc]);
      if (sc !== '.') s.n(r, DRUM_NOTE, sv[sc]);
      if (hc !== '.') h.n(r, hn[hc], hv[hc as keyof typeof hv]);
    }
    if (fillBar) fill(opt.fill as 'snare' | 'toms', { [CH.kick]: k, [CH.snare]: s, [CH.perc]: p }, b * BAR + 8, e);
    if (opt.crashEvery || (opt.crash && b === 0)) p.n(b * BAR, KIT.crash, vol('crash', e), undefined, INS.hats);
  }
  if (opt.reverse) p.n(rows - BAR, KIT.reverse, vol('crash', e) - 8, undefined, INS.hats);
  return { [CH.kick]: k, [CH.snare]: s, [CH.hats]: h, [CH.perc]: p };
}

/** an 8-row (two-beat) fill starting at `from` */
export function fill(kind: 'snare' | 'toms', t: Record<number, Tr>, from: number, energy: number = 4, toms: string[] = ['A-3', 'G-3', 'E-3', 'D-3', 'C-3', 'A-2', 'G-2', 'E-2']): void {
  const top = vol('snare', energy as Energy);
  if (kind === 'snare') {
    for (let i = 0; i < 8; i++) t[CH.snare].n(from + i, DRUM_NOTE, Math.round(top * (0.45 + 0.08 * i)));
    t[CH.kick].n(from, DRUM_NOTE, vol('kick', energy)).n(from + 4, DRUM_NOTE, vol('kick', energy) - 6);
  } else {
    toms.slice(0, 8).forEach((n, i) => t[CH.perc].n(from + i, n, Math.round(vol('timp', energy) * (0.7 + 0.04 * i)), undefined, INS.timpani));
    t[CH.kick].n(from, DRUM_NOTE, vol('kick', energy)).n(from + 6, DRUM_NOTE, vol('kick', energy) - 4);
    t[CH.snare].n(from + 7, DRUM_NOTE, top);
  }
}

/** a snare roll (16ths, or 32nds via R retrigger) crescendo from v0 to v1 over [from, to) */
export function snareRoll(t: Tr, from: number, to: number, v0: number, v1: number, retrig = false): Tr {
  for (let r = from; r < to; r++) t.n(r, DRUM_NOTE, Math.round(v0 + ((v1 - v0) * (r - from)) / Math.max(1, to - from - 1)), retrig ? 'R03' : undefined, INS.snare);
  return t;
}

// =================================================================================================
// bass — the galop (MUSIC_BRIEF §3: "eighth + two sixteenths", octave leaps)

export interface GalopOpt {
  /** rows per root (default 16 = one bar) */
  per?: number;
  v?: number;
  /** octave leap: on the 8th of beats 2 and 4 ('24'), on every 4th beat ('4'), or none */
  oct?: '24' | '4' | 'none';
  /** last 16th of each span approaches the next root by a white-key step */
  approach?: boolean;
  ins?: string | number;
}

/**
 * Galop bass: per beat `R . R R` (8th + two 16ths), accent on the 8th. `roots` are bass notes
 * (keep them in E-2…D-3 so the octave leaps stay in the bass's sweet spot).
 */
export function galop(t: Tr, from: number, roots: string[], opt: GalopOpt = {}): Tr {
  const per = opt.per ?? BAR;
  const v = opt.v ?? VOL.bass;
  const oct = opt.oct ?? '24';
  roots.forEach((root, i) => {
    const start = from + i * per;
    for (let b = 0; b < per / BEAT; b++) {
      const r = start + b * BEAT;
      const beatInBar = ((r % BAR) / BEAT) | 0;
      const leap = (oct === '24' && beatInBar % 2 === 1) || (oct === '4' && beatInBar === 3);
      t.n(r, leap ? semi(root, 12) : root, v, undefined, opt.ins);
      t.n(r + 2, root, v - 8, undefined, opt.ins);
      t.n(r + 3, root, v - 6, undefined, opt.ins);
    }
    const next = roots[i + 1];
    if (opt.approach && next) {
      // aim at the root as written (not the nearest octave of its letter — that leapt a 9th, e.g. F-2→C-3)
      const tgt = next;
      // approach by step from the side away from the current root (from above when moving up a step)
      let appr = num(tgt) > num(root) ? ws(tgt, -1) : num(tgt) < num(root) ? ws(tgt, 1) : ws(root, 1);
      if (appr === root) appr = num(tgt) > num(root) ? ws(tgt, 1) : ws(tgt, -1);
      t.n(start + per - 1, appr, v - 4, undefined, opt.ins);
    }
  });
  return t;
}

/** long bass/sub notes: one note per span */
export function held(t: Tr, from: number, notes: string[], per: number, v: number, ins?: string | number): Tr {
  notes.forEach((n, i) => n && n !== '-' && t.n(from + i * per, n, v, undefined, ins));
  return t;
}

// =================================================================================================
// arpeggios

/**
 * Written-out arpeggio: for each span of `per` rows play `shape` (indices into the chord's note list,
 * one per `step` rows) — e.g. arp16(t, 0, [['A-3','E-4','A-4','C-5'], …], [0,1,2,3], 16, 1).
 */
export function arp16(t: Tr, from: number, chords: string[][], shape: number[], per = BAR, step = 1, v: number | ((i: number) => number) = VOL.arp, ins?: string | number): Tr {
  chords.forEach((notes, ci) => {
    for (let i = 0; i * step < per; i++) {
      const n = notes[shape[i % shape.length]];
      if (n) t.n(from + ci * per + i * step, n, typeof v === 'function' ? v(i) : v, undefined, ins);
    }
  });
  return t;
}

// =================================================================================================
// Shepard (slot 17: the note sets only the pitch class — play octave 4)

export interface ShepardOpt {
  dir?: 1 | -1;
  /** volume, or [from, to] for a ramp across the run */
  v?: number | [number, number];
}
/** discrete white-key Shepard scale: a step every `every` rows on [from, to), starting on letter `start` */
export function shepard(t: Tr, from: number, to: number, every: number, start: Letter, opt: ShepardOpt = {}): Tr {
  const dir = opt.dir ?? 1;
  let li = LETTERS.indexOf(start);
  const steps = Math.ceil((to - from) / every);
  for (let k = 0; k < steps; k++) {
    const r = from + k * every;
    const v = Array.isArray(opt.v) ? Math.round(opt.v[0] + ((opt.v[1] - opt.v[0]) * k) / Math.max(1, steps - 1)) : (opt.v ?? VOL.fx);
    t.n(r, `${LETTERS[((li % 7) + 7) % 7]}-4`, v, undefined, INS.shepard);
    li += dir;
  }
  return t;
}

// =================================================================================================
// S8 — the strictly periodic 12-row cycle (0F:00 … 11:63 = 192 rows = 16 revolutions)

export const S8 = { from: 0x0f, rows: 192, period: 12, revolutions: 16, end: at('11:48') } as const;
/** global row (relative to 0F:00) of revolution `rev` (0..15) step `k` (0..11) */
export const s8Row = (rev: number, k = 0) => rev * S8.period + k;

/**
 * Write a periodic figure: item i of `items` (line() items without duration, e.g. 'D-4v20', '-')
 * on every row r of [from, to) with (r - phase) mod period == i (phase defaults to `from`).
 */
export function cycle(t: Tr, items: string[], from: number, to: number, opt: { ins?: string | number; phase?: number } = {}): Tr {
  const P = items.length;
  const ph = opt.phase ?? from; // item 0 falls on `from` unless a phase row is given
  for (let r = from; r < to; r++) {
    const c = parseItem(items[(((r - ph) % P) + P) % P]);
    if (!c) continue;
    if (c.note === '==') t.off(r, c.vol);
    else if (c.note) t.n(r, c.note, c.vol, c.fx, c.ins ?? opt.ins);
    else {
      if (c.vol !== undefined) t.v(r, c.vol);
      if (c.fx) t.fx(r, c.fx);
    }
  }
  return t;
}

// =================================================================================================
// S14 — channels drop out one every 12 rows (1C:00 … 1E:63; 16 channels × 12 rows = 192 rows)

/**
 * Drop order (first to go → last). Channel k (0-based index here) plays its FINAL note-on exactly at
 * 1C:00 + 12·k rows and is silent by 1C:00 + 12·(k+1). The bell is last: final note 1E:52.
 */
export const DROP_ORDER: number[] = [
  CH.hats, CH.snare, CH.perc, CH.kick, CH.stab, CH.fx, CH.arp, CH.echo,
  CH.lead, CH.sub, CH.bass, CH.pluck, CH.counter, CH.padB, CH.padA, CH.bell,
];
export const S14 = { from: 0x1c, rows: 192 } as const;
/** the row (relative to 1C:00) of channel `ch`'s final note-on */
export const dropRow = (ch: number): number => {
  const k = DROP_ORDER.indexOf(ch);
  if (k < 0) throw new Error(`channel ${ch} is not in the S14 drop order`);
  return 12 * k;
};
/** "1D:08"-style address of a drop row */
export const dropAddr = (ch: number) => {
  const r = dropRow(ch);
  return `${(S14.from + Math.floor(r / ROWS)).toString(16).toUpperCase()}:${String(r % ROWS).padStart(2, '0')}`;
};

/**
 * Enforce the drop-out on a 192-row track of channel `ch`: verifies the final note-on sits exactly on
 * the channel's drop row (throws otherwise), removes anything after it, and — for sustained sounds
 * (fade: true) — fades the volume to 0 across the 12-row slot and keys off at its end.
 */
export function dropOut(t: Tr, ch: number, opt: { fade?: boolean } = {}): Tr {
  if (t.rows !== S14.rows) throw new Error(`dropOut: track must have ${S14.rows} rows`);
  const dr = dropRow(ch);
  t.clearFrom(dr + 1);
  if (t.lastNote() !== dr) throw new Error(`dropOut ch${ch}: final note must be at ${dropAddr(ch)} (row ${dr}), found row ${t.lastNote()}`);
  const end = dr + 12;
  if (opt.fade) {
    const v0 = t.cells[dr].vol ?? 32;
    for (let r = dr + 1; r < Math.min(end, t.rows); r++) t.v(r, Math.round(v0 * (1 - (r - dr) / 12)));
    if (end < t.rows) t.off(end, 0);
  }
  return t;
}

// =================================================================================================
// echo by hand (for positions where the song-level auto echo is off)

/** a copy of `src` delayed by `delay` rows at `scale` × volume (notes, key-offs, volumes and effects) */
export function echoOf(src: Tr, delay = 3, scale = 0.5, from = 0, to = src.rows): Tr {
  const t = new Tr(src.rows, src.ins, src.black);
  for (let r = from; r < to; r++) {
    const c = src.cells[r];
    const d = r + delay;
    if (d >= t.rows || !Object.keys(c).length) continue;
    const e: Cell = { ...c };
    if (e.vol !== undefined) e.vol = Math.round(e.vol * scale);
    else if (e.note && e.note !== '==') e.vol = Math.round(32 * scale);
    t.cells[d] = e;
  }
  return t;
}

// =================================================================================================
// motifs (MUSIC_BRIEF §5) and the composed main melodies

export const MOTIF = {
  CAGE: ['C', 'A', 'G', 'E'],
  FACADE: ['F', 'A', 'C', 'A', 'D', 'E'],
  BEADED: ['B', 'E', 'A', 'D', 'E', 'D'],
  EFFACED: ['E', 'F', 'F', 'A', 'C', 'E', 'D'],
  FADE: ['F', 'A', 'D', 'E'],
  /** retrograde of CAGE — ghost channel 17 in 07–08 */
  CAGE_RETRO: ['E', 'G', 'A', 'C'],
  /** diatonic inversion of EFFACED around E — 16–17 */
  EFFACED_INV: ['E', 'D', 'D', 'B', 'G', 'E', 'F'],
} as const satisfies Record<string, readonly Letter[]>;

/**
 * The main melodies, in line() notation, one entry per 4-bar phrase (64 rows). Harmony per bar in the
 * comment. Act composers: orchestrate, double, answer and decorate these — but keep the notes and
 * rhythm of the literal statements (NOTES.md §3).
 */
export const MEL = {
  /** 01 / 02 bell (ch13): the first naked CAGE, one note per bar. Am | Am | Am7 | Fmaj7 */
  CAGE_BELL: 'C-5/16 | A-4/16 | G-4/16 | E-4/16',
  /** 05 / 0B lead: theme A, phrase 1. F | G | Am | Em — first six notes = literal FACADE */
  THEME_A1: 'F-4/6 A-4/2 C-5/4 A-4/4 | D-5/14 E-5/2 | -/12 D-5/2 C-5/2 | B-4/6 C-5/2 B-4/4 G-4/4',
  /** 06 lead: theme A, phrase 2 (climbs to the G-5 peak). F | G | C | G */
  THEME_A2: 'F-4/6 A-4/2 C-5/4 A-4/4 | D-5/8 E-5/4 F-5/4 | G-5/16 | -/8 F-5/2 E-5/2 D-5/4',
  /** 07 lead: theme B, phrase 1 (mirror of the head: falling arpeggios). Am | F | C | G */
  THEME_B1: 'A-5/6 G-5/2 E-5/4 C-5/4 | D-5/6 C-5/2 A-4/8 | G-4/4 C-5/4 E-5/4 G-5/4 | F-5/6 E-5/2 D-5/8',
  /** 08 lead: theme B, phrase 2 (half cadence onto D, the 5th of the coming G pedal). Am | F | C | Dm7 */
  THEME_B2: 'A-5/6 G-5/2 E-5/4 C-5/4 | D-5/6 C-5/2 A-4/4 C-5/4 | E-5/12 D-5/2 C-5/2 | D-5/16',
  /** 0D–0E bell (ch13): BEADED as a chorale, one pearl per bar over the descending circle of fifths.
   *  Dm9 | G7 | Cmaj7 | Fmaj7 || Bø7 | Em7 | Am7 | Dm9 */
  BEADED_CHORALE: '-/16 | B-4/16 | E-5/16 | A-4/16 | D-5/16 | E-5/8 D-5/8 | C-5/16 | A-4/16',
  /** 14 lead: the climax. Em·F | Am | Dm7 | Fmaj7 — first seven notes = literal EFFACED */
  EFFACED_1: 'E-5/6 F-5/2 F-5/8 | A-4/4 C-5/4 E-5/6 D-5/2 | -/6 C-5/2 D-5/4 F-5/4 | E-5/6 D-5/2 C-5/4 A-4/4',
  /** 15 lead. Em·F | Am | C·G | F (F→E into 16) */
  EFFACED_2: 'E-5/6 F-5/2 F-5/8 | A-4/4 C-5/4 E-5/8 | D-5/4 C-5/4 B-4/4 D-5/4 | F-5/8 E-5/4 F-5/4',
  /** 16 lead: diatonic inversion E-D-D-B-G-E-F. Em·Dm | Cmaj7 | Dm7 | Em */
  INVERSION_1: 'E-5/6 D-5/2 D-5/8 | B-4/4 G-4/4 E-4/6 F-4/2 | -/6 G-4/2 A-4/4 C-5/4 | B-4/6 A-4/2 G-4/4 E-4/4',
  /** 17 lead. Em·Dm | Cmaj7 | Dm7 | Esus4 (→ F at 18:00) */
  INVERSION_2: 'E-5/6 D-5/2 D-5/8 | B-4/4 G-4/4 E-4/6 F-4/2 | -/6 G-4/2 A-4/4 C-5/4 | B-4/8 A-4/4 G-4/4',
  /** 18 lead: theme A1 re-lit in F lydian. F | G/F | Fmaj7 | G/F (the B is the lydian #11) */
  LYDIAN_A1: 'F-4/6 A-4/2 C-5/4 A-4/4 | D-5/14 E-5/2 | -/12 D-5/2 C-5/2 | B-4/6 C-5/2 B-4/4 G-4/4',
  /** 19 lead: peak A-5 at 19:32 (D-4 marker: the particle burst). F | G/F | F(add9) | G/F */
  LYDIAN_A2: 'F-4/6 A-4/2 C-5/4 A-4/4 | D-5/8 E-5/4 F-5/4 | A-5/16 | -/8 G-5/2 F-5/2 E-5/4',
  /** 1A lead: the last EFFACED, glorious in F lydian. Fmaj7 | Am7 | G/F | Fmaj7 */
  EFFACED_LYDIAN: 'E-5/6 F-5/2 F-5/8 | A-4/4 C-5/4 E-5/6 D-5/2 | -/6 C-5/2 D-5/4 F-5/4 | E-5/6 D-5/2 C-5/4 A-4/4',
  /** 1B lead: EFFACED back in E phrygian, collapsing onto the unison E at 1B:48; cut at 1B:57 so the
   *  auto-echo (3 rows later) is silent by the 1B:60 silence. Em·F | Am | Dm/E | E(unison) */
  EFFACED_COLLAPSE: 'E-5/6 F-5/2 F-5/8 | A-4/4 C-5/4 E-5/8 | D-5/4 C-5/4 B-4/4 A-4/4 | E-4/9 ==v0/7',
  /** 1C–1E bell (ch13), 192 rows: FADE three times, sparser each time; final E exactly at 1E:52.
   *  1C: Dm9 | Fmaj7 | G6 | Am7   1D: Dm9 | Fmaj7 | Em7 | Am7   1E: Dm9 | Fmaj7 | G(add9) | (E alone) */
  FADE_BELL:
    'F-4/16 | A-4/16 | D-5/16 | E-5/16 | F-4/8 A-4/8 D-5/8 E-5/24 | C-5/8 A-4/8 | F-4/16 | A-4/16 | D-5/20 E-5/12',
} as const;

// =================================================================================================
// audit: forgotten sustained notes

/** looped (sustaining) instrument slots in the v0 bank: they ring until a new note, key-off or v0 */
export const SUSTAINED: number[] = [INS.aah, INS.ooh, INS.strings, INS.pad, INS.brass, INS.lead, INS.bass, INS.sub, INS.shepard, INS.scope];

/**
 * Find sustained notes that ring longer than `maxRows` without any new event on their channel —
 * typically a note left hanging across an act boundary. `allow` lists "ch@pos:row" note starts that
 * are meant to be long (e.g. the S8 pads). Returns human-readable lines.
 */
export function auditSustain(song: ScoreSong, maxRows = 128, allow: string[] = []): string[] {
  const out: string[] = [];
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  const addr = (g: number) => `${hex(Math.floor(g / ROWS))}:${String(g % ROWS).padStart(2, '0')}`;
  const total = song.order.length * ROWS;
  for (let ch = 1; ch <= 17; ch++) {
    let start = -1, label = '';
    const close = (g: number) => {
      if (start >= 0 && g - start > maxRows && !allow.includes(`${ch}@${addr(start)}`))
        out.push(`ch${ch} ${label} from ${addr(start)} rings to ${g >= total ? 'the end' : addr(g)} (${g - start} rows) — key it off or move on`);
      start = -1;
    };
    song.order.forEach((pi, pos) => {
      const cells = song.patterns[pi].pattern.cells;
      for (let r = 0; r < ROWS; r++) {
        const c = cells[r * 18 + ch - 1];
        const g = pos * ROWS + r;
        if (c.note === 97 || c.vol === 0x10) close(g);
        else if (c.note) {
          close(g);
          if (SUSTAINED.includes(c.ins)) {
            start = g;
            label = name(c.note);
          }
        }
      }
    });
    if (start >= 0 && Math.floor(start / ROWS) < song.order.length - 1) close(total);
  }
  return out;
}
