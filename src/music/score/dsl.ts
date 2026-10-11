// Score DSL: the track is written as TypeScript, one string per channel per pattern, and compiled
// to an .xm by tools/build-xm.ts. Channels and instrument slots are 1-based, exactly as in the
// tracker and in MUSIC_BRIEF.md.
//
// TRACK STRING — whitespace-separated tokens, one token = one row (64 rows per pattern).
//   .  ...  -          empty row
//   C-4  C#4  Db4  C4  note; tracker octaves, C-4 = middle C (MIDI 60). Sharps '#', flats 'b'
//   ==  OFF  ^^        key off
//   :7  :bell          instrument by slot number or name (sticky inside the pattern; otherwise
//                      the channel default from roster.ts)
//   :-                 write the note WITHOUT an instrument number → legato with 3xx: the playing
//                      sample, its volume and envelopes continue (tracker convention)
//   v48                volume column: set volume 0..64 (decimal)
//   ~6A                volume column raw byte in hex (advanced: slides, panning, …)
//   !047  !A0F  !EC3   effect: letter + 2 hex digits (XM effects, see MUSIC_BRIEF §10)
//   parts concatenate without spaces:  C-4:bell v48 is WRONG,  C-4:bellv48!A02 is right
//   *N                 repeat the token N rows:  .*15   C-2*2
//   |                  bar line, ignored (use it for readability, e.g. every 16 rows)
// A track may also be an object { row: token } (sparse) or an array of tokens.

import { type XmCell, type XmPattern, emptyCell, KEY_OFF, FX_CHARS } from '../xm/xm.ts';
import { CHANNELS, CH_DEFAULT_INS, INS } from '../roster.ts';

export const ROWS = 64;
export const POSITIONS = 32;

export type Track = string | Record<number, string> | (string | null | undefined)[];
/** channel number (1..18) → track */
export type PatternDef = Partial<Record<number, Track>>;

export interface Built {
  name: string;
  pattern: XmPattern;
}

const NOTE_RE = /^([A-Ga-g])([-#b]?)(\d)/;
const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** parse a note name like C-4 / C#4 / Db4 / C4 into an XM note number (1..96) */
export function parseNote(s: string): number {
  const m = NOTE_RE.exec(s);
  if (!m) throw new Error(`bad note "${s}"`);
  let pc = SEMI[m[1].toUpperCase()];
  if (m[2] === '#') pc++;
  if (m[2] === 'b') pc--;
  const n = +m[3] * 12 + pc + 1;
  if (n < 1 || n > 96) throw new Error(`note out of range "${s}"`);
  return n;
}

function insByName(s: string): number {
  if (/^\d+$/.test(s)) return +s;
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
  const v = (INS as Record<string, number>)[s];
  if (!v) throw new Error(`unknown instrument "${s}" (known: ${Object.keys(INS).join(', ')})`);
  return v;
}

export interface Token {
  note: number;
  ins: number; // explicit instrument (0 = none given)
  vol: number;
  fx: number;
  param: number;
  hasFx: boolean;
  /** ':-' — leave the instrument column empty (legato) */
  noIns: boolean;
}

/** parse one row token */
export function parseToken(tok: string): Token {
  const t: Token = { note: 0, ins: 0, vol: 0, fx: 0, param: 0, hasFx: false, noIns: false };
  let s = tok;
  if (s === '.' || s === '...' || s === '-' || s === '') return t;
  if (s.startsWith('==') || s.startsWith('^^') || s.startsWith('OFF')) {
    t.note = KEY_OFF;
    s = s.replace(/^(==|\^\^|OFF)/, '');
  } else if (s.startsWith('...')) s = s.slice(3);
  else if (s.startsWith('.')) s = s.slice(1);
  else if (NOTE_RE.test(s)) {
    const m = NOTE_RE.exec(s)!;
    t.note = parseNote(m[0]);
    s = s.slice(m[0].length);
  }
  while (s.length) {
    let m: RegExpExecArray | null;
    if ((m = /^:-/.exec(s))) {
      t.noIns = true;
    } else if ((m = /^:([a-z0-9]+?)(?=v\d|~|!|$)/i.exec(s))) {
      t.ins = insByName(m[1]);
    } else if ((m = /^v(\d{1,2})/.exec(s))) {
      const v = +m[1];
      if (v > 64) throw new Error(`volume > 64 in "${tok}"`);
      t.vol = 0x10 + v;
    } else if ((m = /^~([0-9a-f]{2})/i.exec(s))) {
      t.vol = parseInt(m[1], 16);
    } else if ((m = /^!([0-9A-Z])([0-9a-f]{2})/i.exec(s))) {
      t.fx = FX_CHARS.indexOf(m[1].toUpperCase());
      t.param = parseInt(m[2], 16);
      t.hasFx = true;
    } else throw new Error(`cannot parse "${s}" in token "${tok}"`);
    s = s.slice(m[0].length);
  }
  return t;
}

/** expand a track into exactly `rows` token strings (or throw) */
export function expandTrack(track: Track, rows = ROWS): (string | null)[] {
  const out: (string | null)[] = new Array(rows).fill(null);
  if (typeof track === 'string') {
    const toks: string[] = [];
    for (const raw of track.split(/\s+/)) {
      if (!raw || raw === '|') continue;
      const m = /^(.*?)\*(\d+)$/.exec(raw);
      if (m) for (let i = 0; i < +m[2]; i++) toks.push(m[1]);
      else toks.push(raw);
    }
    if (toks.length > rows) throw new Error(`track has ${toks.length} rows (> ${rows})`);
    toks.forEach((t, i) => (out[i] = t));
  } else if (Array.isArray(track)) {
    if (track.length > rows) throw new Error(`track has ${track.length} rows (> ${rows})`);
    track.forEach((t, i) => (out[i] = t ?? null));
  } else {
    for (const [k, v] of Object.entries(track)) {
      const r = +k;
      if (!(r >= 0 && r < rows)) throw new Error(`row ${k} out of range`);
      out[r] = v;
    }
  }
  return out;
}

/** compile a pattern definition into an 18-channel XM pattern */
export function pattern(name: string, def: PatternDef): Built {
  const cells: XmCell[] = Array.from({ length: ROWS * CHANNELS }, emptyCell);
  for (const [chKey, track] of Object.entries(def)) {
    const ch = +chKey;
    if (!(ch >= 1 && ch <= CHANNELS)) throw new Error(`[${name}] channel ${chKey} out of range 1..${CHANNELS}`);
    if (track === undefined) continue;
    let rows: (string | null)[];
    try {
      rows = expandTrack(track);
    } catch (e) {
      throw new Error(`[${name}] ch${ch}: ${(e as Error).message}`);
    }
    let curIns = CH_DEFAULT_INS[ch];
    rows.forEach((tok, r) => {
      if (!tok) return;
      let t: Token;
      try {
        t = parseToken(tok);
      } catch (e) {
        throw new Error(`[${name}] ch${ch} row ${r}: ${(e as Error).message}`);
      }
      if (t.ins) curIns = t.ins;
      const c = cells[r * CHANNELS + ch - 1];
      c.note = t.note;
      // every real note carries its instrument, as trackers write it
      c.ins = t.noIns ? 0 : t.note && t.note !== KEY_OFF ? curIns : t.ins;
      c.vol = t.vol;
      c.fx = t.fx;
      c.param = t.param;
    });
  }
  return { name, pattern: { rows: ROWS, cells } };
}

export interface ScoreSong {
  name: string;
  /** unique patterns in first-use order */
  patterns: Built[];
  /** order list: indices into patterns, one per position */
  order: number[];
  /** names per order position, for reports */
  orderNames: string[];
}

export interface SongDef {
  name?: string;
  patterns: Record<string, PatternDef | Built>;
  /** 32 pattern names, one per position 00..1F */
  order: string[];
  /**
   * Optional automatic lead echo across pattern boundaries (MUSIC_BRIEF §3): channel `to` gets a copy
   * of channel `from` delayed by `delay` rows at `vol` × volume. Applied per order position, so the
   * echo of a phrase continues into the next position. Positions listed in `skip` are left alone.
   */
  echo?: {
    from: number;
    to: number;
    delay?: number;
    vol?: number;
    positions?: number[];
    pan?: number;
    /** notes shorter than this many rows are not echoed (a delayed copy of a run is a second player a
     *  step behind); default 4 */
    minLen?: number;
    /** cut a sounding echo note when the lead moves a second or a seventh away from it; default true */
    cutClash?: boolean;
  };
}

export function song(def: SongDef): ScoreSong {
  const built = new Map<string, Built>();
  for (const [name, p] of Object.entries(def.patterns)) {
    built.set(name, 'pattern' in p && (p as Built).pattern ? (p as Built) : pattern(name, p as PatternDef));
  }
  const seq = def.order.map((n, i) => {
    const b = built.get(n);
    if (!b) throw new Error(`order[${i.toString(16)}]: unknown pattern "${n}"`);
    return b;
  });
  if (def.order.length !== POSITIONS) console.warn(`[score] order has ${def.order.length} positions (expected ${POSITIONS})`);

  // per-position copies when the echo rewrites a channel
  let perPos: Built[] = seq;
  if (def.echo) perPos = applyEcho(seq, def.echo);

  // dedupe identical patterns
  const uniq: Built[] = [];
  const keyOf = (b: Built) => b.pattern.cells.map((c) => `${c.note},${c.ins},${c.vol},${c.fx},${c.param}`).join(';');
  const index = new Map<string, number>();
  const order = perPos.map((b) => {
    const k = keyOf(b);
    let i = index.get(k);
    if (i === undefined) {
      i = uniq.length;
      uniq.push(b);
      index.set(k, i);
    }
    return i;
  });
  return { name: def.name ?? 'EFFACED', patterns: uniq, order, orderNames: def.order };
}

function applyEcho(seq: Built[], e: NonNullable<SongDef['echo']>): Built[] {
  const delay = e.delay ?? 3, vol = e.vol ?? 0.5, minLen = e.minLen ?? 4, cutClash = e.cutClash ?? true;
  const from = e.from - 1, to = e.to - 1;
  const total = seq.length * ROWS;
  const src = (gr: number) => seq[Math.floor(gr / ROWS)].pattern.cells[(gr % ROWS) * CHANNELS + from];
  const isOn = (c: XmCell) => !!c.note && c.note !== KEY_OFF && !(c.fx === 3 || c.fx === 5);
  const isNote = (c: XmCell) => !!c.note; // note-on, key-off or portamento target: ends the previous span

  // 1. the echo channel over the whole song (global rows), then cut into the positions that use it
  const echo: (XmCell | null)[] = new Array(total).fill(null);
  // source note spans: start row → length in rows (to the next note / key-off in the source)
  const len = new Map<number, number>();
  let open = -1;
  for (let gr = 0; gr <= total; gr++) {
    const c = gr < total ? src(gr) : null;
    // a portamento target continues the sounding note (a glide), it does not end its span
    if (c === null || c.note === KEY_OFF || isOn(c)) {
      if (open >= 0) len.set(open, gr - open);
      open = c && isOn(c) ? gr : -1;
    }
  }
  let sounding = 0; // note the echo channel is holding (0 = silent)
  let echoing = false; // the source note under the echo row is being echoed
  const keyOff = (): XmCell => ({ ...emptyCell(), note: KEY_OFF });
  for (let er = 0; er < total; er++) {
    const gr = er - delay;
    // the lead moves now: cut an echo note that would rub against it
    const lead = src(er);
    let cut = false;
    if (cutClash && sounding && isOn(lead)) {
      const d = Math.abs(lead.note - sounding) % 12;
      cut = d === 1 || d === 2 || d === 10 || d === 11;
    }
    if (gr < 0) continue;
    const s = src(gr);
    let cell: XmCell | null = null;
    if (isOn(s)) {
      echoing = (len.get(gr) ?? 0) >= minLen;
      if (echoing) {
        cell = { ...emptyCell(), note: s.note, ins: s.ins, fx: s.fx, param: s.param };
        cell.vol = s.vol >= 0x10 && s.vol <= 0x50 ? 0x10 + Math.round((s.vol - 0x10) * vol) : 0x10 + Math.round(64 * vol);
        sounding = s.note;
      } else if (sounding) {
        cell = keyOff();
        sounding = 0;
      }
    } else if (isNote(s)) {
      // key-off or a portamento target in the source
      if (s.note === KEY_OFF) {
        echoing = false;
        if (sounding) (cell = keyOff()), (sounding = 0);
      } else if (echoing && sounding) {
        cell = { ...emptyCell(), note: s.note, fx: s.fx, param: s.param };
        sounding = s.note;
      }
    } else if (echoing && sounding && (s.fx || s.param || s.vol)) {
      // effects / volume changes on the echoed note follow it
      cell = { ...emptyCell(), fx: s.fx, param: s.param };
      if (s.vol >= 0x10 && s.vol <= 0x50) cell.vol = 0x10 + Math.round((s.vol - 0x10) * vol);
      else if (s.vol) cell.vol = s.vol;
    }
    if (!cell && cut) {
      cell = keyOff();
      sounding = 0;
      echoing = false;
    }
    if (cell && e.pan !== undefined) {
      // `pan`: the echo sits on its own side — replace copied 8xx, and put 8xx on notes with a free effect column
      if (cell.fx === 8) cell.param = e.pan;
      else if (cell.note && cell.note !== KEY_OFF && !cell.fx && !cell.param) (cell.fx = 8), (cell.param = e.pan);
      else if (cell.vol >= 0xc0 && cell.vol <= 0xcf) cell.vol = 0xc0 | (e.pan >> 4);
    }
    echo[er] = cell;
  }

  return seq.map((b, pos) => {
    if (e.positions && !e.positions.includes(pos)) return b;
    const cells = b.pattern.cells.map((c) => ({ ...c }));
    for (let r = 0; r < ROWS; r++) Object.assign(cells[r * CHANNELS + to], echo[pos * ROWS + r] ?? emptyCell());
    return { name: `${b.name}+echo@${pos.toString(16).padStart(2, '0')}`, pattern: { rows: ROWS, cells } };
  });
}

// ---------------------------------------------------------------------------------------------
// small helpers for writing tracks

/** n empty rows */
export const rest = (n: number) => '.*' + n;
/** repeat a track fragment n times */
export const rep = (s: string, n: number) => Array(n).fill(s).join(' ');
/** join fragments */
export const seq = (...parts: string[]) => parts.join(' ');
/** put tokens every `step` rows: spread(['C-2','G-2'], 8) → C-2 .*7 G-2 .*7 */
export const spread = (toks: string[], step: number) => toks.map((t) => `${t} ${step > 1 ? rest(step - 1) : ''}`).join(' ');
/** shift a note token by semitones (keeps the rest of the token) */
export function transposeToken(tok: string, semis: number): string {
  const m = NOTE_RE.exec(tok);
  if (!m) return tok;
  const n = parseNote(m[0]) + semis;
  const names = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
  return names[(n - 1) % 12] + Math.floor((n - 1) / 12) + tok.slice(m[0].length);
}
export const transpose = (track: string, semis: number) =>
  track.split(/(\s+)/).map((t) => (/\S/.test(t) ? transposeToken(t, semis) : t)).join('');
