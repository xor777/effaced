// Harmony & texture analysis of an XM module — "ears" for composers who cannot listen.
// For every row it works out which pitched voices are sounding (note spans until the next note,
// key-off, note cut, or the end of a one-shot sample), then scores dissonant intervals between
// voices on different channels, weighted by loudness and register distance. Also reports
// mid-range crowding (too many sustained parts in the same register = mud).

import { type XmModule, KEY_OFF, noteName } from './xm.ts';

export interface HarmonyOptions {
  /** instrument slots to ignore (unpitched drums, kit, scope, markers) */
  ignore?: number[];
  /** slots whose pitch is a pitch class in all octaves (Shepard) */
  allOctaves?: number[];
  /** semitone offsets of chord samples per slot */
  chordTones?: Record<number, number[]>;
  /** song tempo for one-shot lengths */
  rowSec?: number;
}

export interface Clash {
  pos: number;
  row: number;
  a: { ch: number; note: string; ins: number };
  b: { ch: number; note: string; ins: number };
  interval: string;
  score: number;
}

export interface HarmonyReport {
  /** total clash score per position */
  perPos: number[];
  /** worst events (merged over their duration) */
  clashes: (Clash & { rows: number })[];
  /** rows where ≥ 4 sustained parts share the mid register (C-3…C-5) */
  crowded: { pos: number; row: number; parts: string[] }[];
}

interface Voice {
  ch: number;
  ins: number;
  midi: number;
  w: number; // loudness weight 0..1
  allOct: boolean;
  sustained: boolean;
}

/** dissonance weight of two pitches a semitone distance d apart (d ≥ 0) */
function dissonance(d: number, allOct: boolean): [number, string] {
  const pc = d % 12;
  if (allOct) {
    if (pc === 1 || pc === 11) return [0.8, 'm2/M7 (Shepard)'];
    if (pc === 6) return [0.3, 'tritone (Shepard)'];
    if (pc === 2 || pc === 10) return [0.1, 'M2 (Shepard)'];
    return [0, ''];
  }
  if (d === 1) return [1, 'minor 2nd'];
  if (d === 13) return [0.7, 'minor 9th'];
  if (pc === 1 && d > 13) return [0.35, 'm2 + octaves'];
  if (d === 11) return [0.3, 'major 7th'];
  if (pc === 11 && d > 11) return [0.12, 'major 7th + oct'];
  if (d === 6) return [0.35, 'tritone'];
  if (pc === 6) return [0.15, 'tritone + oct'];
  if (d === 2) return [0.15, 'major 2nd'];
  return [0, ''];
}

export function analyseHarmony(m: XmModule, opt: HarmonyOptions = {}): HarmonyReport {
  const ignore = new Set(opt.ignore ?? []);
  const allOct = new Set(opt.allOctaves ?? []);
  const rowSec = opt.rowSec ?? 0.12;
  const C = m.channels;
  const total = m.order.length * 64;

  // per instrument: one-shot length in rows (sample without loop) or Infinity (looped)
  const shotRows = (ins: number, note: number): number => {
    const I = m.instruments[ins - 1];
    if (!I || !I.samples.length) return 0;
    const s = I.samples[I.sampleMap?.[Math.max(0, note - 1)] ?? 0] ?? I.samples[0];
    // a volume envelope without a sustain point that ends at 0 silences the note by itself
    const env = I.volEnv;
    const envRows = env && env.sustain === undefined && env.points.length && env.points[env.points.length - 1][1] === 0
      ? env.points[env.points.length - 1][0] / 6 : Infinity;
    if (s.loopLength > 0) return envRows;
    // playback rate relative to the stored rate for this note
    const semis = note - 49 + s.relativeNote + s.finetune / 128;
    const rate = 8363 * 2 ** (semis / 12);
    const secs = s.data.length / rate;
    return Math.min(envRows, Math.max(1, secs / rowSec));
  };
  const defVol = (ins: number, note: number): number => {
    const I = m.instruments[ins - 1];
    const s = I?.samples[I.sampleMap?.[Math.max(0, note - 1)] ?? 0] ?? I?.samples[0];
    return s ? s.volume : 64;
  };

  // build spans per channel
  const active: Voice[][] = Array.from({ length: total }, () => []);
  for (let ch = 0; ch < C; ch++) {
    type Span = { start: number; ins: number; note: number; vol: number; end: number; arp: number };
    let cur: Span | null = null;
    let lastIns = 0;
    const flush = (endRow: number) => {
      if (!cur) return;
      const end = Math.min(endRow, cur.end, total);
      if (!ignore.has(cur.ins)) {
        const sustained = cur.end === Infinity;
        const w = cur.vol / 64;
        const tones = [0, ...(opt.chordTones?.[cur.ins] ?? [])];
        if (cur.arp) tones.push(cur.arp >> 4, cur.arp & 15);
        for (let r = cur.start; r < end; r++)
          for (const t of new Set(tones))
            active[r].push({ ch: ch + 1, ins: cur.ins, midi: cur.note + 11 + t, w: t && cur.arp ? w * 0.5 : w, allOct: allOct.has(cur.ins), sustained });
      }
      cur = null;
    };
    for (let g = 0; g < total; g++) {
      const p = m.patterns[m.order[Math.floor(g / 64)]];
      const c = p?.cells[(g % 64) * C + ch];
      if (!c) continue;
      if (c.ins) lastIns = c.ins;
      const vol = c.vol >= 0x10 && c.vol <= 0x50 ? c.vol - 0x10 : -1;
      if (c.note === KEY_OFF) {
        flush(g);
        continue;
      }
      if (c.note && !(c.fx === 3 || c.fx === 5)) {
        flush(g);
        const ins = c.ins || lastIns;
        const delay = c.fx === 14 && c.param >> 4 === 0xd ? 1 : 0;
        cur = { start: g + delay, ins, note: c.note, vol: vol >= 0 ? vol : defVol(ins, c.note), end: g + shotRows(ins, c.note), arp: c.fx === 0 ? c.param : 0 };
      } else if (cur) {
        let span: Span = cur;
        if (vol >= 0) {
          // volume change: split the span so the weight follows
          flush(g);
          span = cur = { ...span, start: g, vol };
        }
        if (c.fx === 3 && c.note) span.note = c.note; // portamento target: approximate as arriving at once
        if (c.fx === 0 && c.param) span.arp = c.param;
        if (c.fx === 14 && c.param >> 4 === 0xc) flush(g + 1); // note cut
      }
    }
    flush(total);
  }

  const perPos = new Array(m.order.length).fill(0);
  const events = new Map<string, Clash & { rows: number }>();
  const crowded: HarmonyReport['crowded'] = [];
  for (let g = 0; g < total; g++) {
    const vs = active[g];
    for (let i = 0; i < vs.length; i++)
      for (let j = i + 1; j < vs.length; j++) {
        const a = vs[i], b = vs[j];
        if (a.ch === b.ch) continue;
        const [s, name] = dissonance(Math.abs(a.midi - b.midi), a.allOct || b.allOct);
        if (!s) continue;
        // short overlaps of one-shots are passing tones: count them, but less
        const score = s * a.w * b.w * (a.sustained && b.sustained ? 1 : 0.4);
        perPos[Math.floor(g / 64)] += score;
        const [lo, hi] = a.ch < b.ch ? [a, b] : [b, a];
        const key = `${lo.ch}:${lo.midi}|${hi.ch}:${hi.midi}`;
        const e = events.get(key);
        if (e && e.pos * 64 + e.row + e.rows >= g) {
          e.rows = g - (e.pos * 64 + e.row) + 1;
          e.score += score;
        } else {
          const ev = {
            pos: Math.floor(g / 64),
            row: g % 64,
            a: { ch: lo.ch, note: noteName(lo.midi - 11), ins: lo.ins },
            b: { ch: hi.ch, note: noteName(hi.midi - 11), ins: hi.ins },
            interval: name,
            score,
            rows: 1,
          };
          events.set(e ? `${key}@${g}` : key, ev);
          if (e) events.set(key, ev);
        }
      }
    const mid = vs.filter((v) => v.sustained && !v.allOct && v.midi >= 48 && v.midi <= 72 && v.w > 0.15);
    const chans = [...new Set(mid.map((v) => v.ch))];
    if (chans.length >= 4 && g % 16 === 0)
      crowded.push({ pos: Math.floor(g / 64), row: g % 64, parts: chans.map((c) => `ch${c}:${noteName(mid.find((v) => v.ch === c)!.midi - 11)}`) });
  }
  const clashes = [...new Set(events.values())].sort((x, y) => y.score - x.score);
  return { perPos, clashes, crowded };
}

export function formatHarmony(rep: HarmonyReport, top = 25): string {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  const out: string[] = [];
  const max = Math.max(...rep.perPos, 1e-9);
  out.push('clash score per position (relative bar):');
  rep.perPos.forEach((s, p) => out.push(`  ${hex(p)} ${s.toFixed(1).padStart(7)} ${'█'.repeat(Math.round((s / max) * 40))}`));
  out.push('', `worst clashes (top ${top}): pos:row  len  chA note — chB note  interval  score`);
  for (const c of rep.clashes.slice(0, top))
    out.push(
      `  ${hex(c.pos)}:${String(c.row).padStart(2, '0')} ${String(c.rows).padStart(4)}r  ch${c.a.ch}(${c.a.ins}) ${c.a.note} — ch${c.b.ch}(${c.b.ins}) ${c.b.note}  ${c.interval}  ${c.score.toFixed(2)}`,
    );
  if (rep.crowded.length) {
    out.push('', `crowded mid register (≥4 sustained parts in C-3…C-5), first ${Math.min(15, rep.crowded.length)} of ${rep.crowded.length} bars:`);
    for (const c of rep.crowded.slice(0, 15)) out.push(`  ${hex(c.pos)}:${String(c.row).padStart(2, '0')}  ${c.parts.join(' ')}`);
  }
  return out.join('\n');
}
