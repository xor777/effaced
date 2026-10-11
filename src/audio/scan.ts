// Read the score side of an .xm for the engine and the demo: note events, channel-18 markers,
// HUD pattern data, per-channel instrument timeline (for FX sends) and the ghost's scope events.
// Times come from libopenmpt (position starts), so anything libopenmpt plays is in sync.

import { readXm, noteName, type XmModule } from '../music/xm/xm.ts';
import type { NoteEvent, Marker, TrackInfo } from './types.ts';
import { MARKER_CH, GHOST_CH } from './types.ts';

export const SCOPE_SLOT = 18;
export const MARKER_SLOT = 0x7f;
const FX_E = 14;
const FX_9 = 9;
const FX_3 = 3;
const FX_5 = 5;

export interface InsChange {
  /** seconds */
  t: number;
  /** instrument slot (1-based) now playing on the channel */
  slot: number;
}

export interface Scan {
  xm: XmModule;
  track: TrackInfo;
  notes: NoteEvent[];
  markers: Marker[];
  /** per channel (index ch-1): instrument changes at note-ons */
  insTimeline: InsChange[][];
  /** channel (index ch-1) has audible notes */
  used: boolean[];
  /** ghost channel: notes that play the scope slot / other slots */
  ghostScope: boolean;
  ghostOther: boolean;
  /** ghost scope events in seconds: f = traversal Hz (note-on), morph = 9xx target */
  scopeEvents: { t: number; f?: number; morph?: number }[];
}

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * @param posTime start time (s) of every order position, length order.length + 1 (last = end),
 *                e.g. from libopenmpt timeAt(o, 0) and duration.
 */
export function scanXm(bytes: Uint8Array, posTime: number[]): Scan {
  const xm = readXm(bytes);
  const C = xm.channels;
  const notes: NoteEvent[] = [];
  const markers: Marker[] = [];
  const insTimeline: InsChange[][] = Array.from({ length: C }, () => []);
  const used = new Array(C).fill(false);
  const lastIns = new Array(C).fill(0);
  const scopeEvents: Scan['scopeEvents'] = [];
  let ghostScope = false, ghostOther = false;
  let grow = 0;
  xm.order.forEach((p, pos) => {
    const pat = xm.patterns[p];
    if (!pat) return;
    const t0 = posTime[pos], t1 = posTime[pos + 1] ?? t0 + pat.rows * 0.12;
    const rowDur = (t1 - t0) / pat.rows;
    const tick = rowDur / Math.max(1, xm.speed);
    for (let row = 0; row < pat.rows; row++, grow++) {
      for (let c = 0; c < C; c++) {
        const cell = pat.cells[row * C + c];
        const ch = c + 1;
        let t = t0 + row * rowDur;
        if (cell.fx === FX_E && cell.param >> 4 === 0xd) t += (cell.param & 15) * tick;
        if (cell.ins) lastIns[c] = cell.ins;
        if (ch === GHOST_CH && cell.fx === FX_9) scopeEvents.push({ t, morph: cell.param / 255 });
        if (cell.note < 1 || cell.note > 96) continue;
        const slot = cell.ins || lastIns[c];
        const midi = cell.note + 11;
        if (ch === MARKER_CH) {
          markers.push({ t, row: grow, note: noteName(cell.note) });
          continue;
        }
        const porta = cell.fx === FX_3 || cell.fx === FX_5 || (cell.vol & 0xf0) === 0xf0;
        notes.push({
          t,
          pos,
          row,
          grow,
          ch,
          note: cell.note,
          midi,
          name: noteName(cell.note),
          ins: cell.ins,
          vol: cell.vol >= 0x10 && cell.vol <= 0x50 ? cell.vol - 0x10 : -1,
        });
        if (slot === MARKER_SLOT) continue;
        used[c] = true;
        if (!porta) insTimeline[c].push({ t, slot });
        if (ch === GHOST_CH) {
          if (slot === SCOPE_SLOT) {
            ghostScope = true;
            scopeEvents.push({ t, f: midiToHz(midi) });
          } else ghostOther = true;
        }
      }
    }
  });
  notes.sort((a, b) => a.t - b.t || a.ch - b.ch);
  scopeEvents.sort((a, b) => a.t - b.t);
  const track: TrackInfo = {
    title: xm.name,
    channels: C,
    order: xm.order.slice(),
    patterns: xm.patterns.map((p) => ({ rows: p.rows, cells: p.cells.map((c) => ({ note: c.note, ins: c.ins, vol: c.vol, fx: c.fx, param: c.param })) })),
    instruments: xm.instruments.map((i) => i.name),
    posTime: posTime.slice(),
    duration: posTime[posTime.length - 1],
    tail: 0,
  };
  return { xm, track, notes, markers, insTimeline, used, ghostScope, ghostOther, scopeEvents };
}

/**
 * A copy of the module with `extra` empty 64-row positions appended, so libopenmpt keeps
 * rendering (notes ring out, envelopes release) after the last real position.
 */
export function withTail(bytes: Uint8Array, extra: number): Uint8Array {
  const dv0 = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hs = dv0.getUint32(60, true), len = dv0.getUint16(64, true), npat = dv0.getUint16(70, true);
  if (len + extra > 256) throw new Error('order list too long for the tail');
  let p = 60 + hs;
  for (let i = 0; i < npat; i++) p += dv0.getUint32(p, true) + dv0.getUint16(p + 7, true);
  const empty = new Uint8Array([9, 0, 0, 0, 0, 64, 0, 0, 0]); // header len 9, packing 0, 64 rows, 0 bytes
  const out = new Uint8Array(bytes.length + empty.length);
  out.set(bytes.subarray(0, p));
  out.set(empty, p);
  out.set(bytes.subarray(p), p + empty.length);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < extra; i++) out[80 + len + i] = npat;
  dv.setUint16(64, len + extra, true);
  dv.setUint16(70, npat + 1, true);
  return out;
}
