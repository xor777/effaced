// xm-check (MUSIC_BRIEF §4, §6, §10, §11): validates a module against the brief and reports every
// problem with a `pos:row:channel` address. Pure TS — used by tools/xm-check.ts and the preview page.

import { type XmModule, type XmCell, KEY_OFF, isBlackKey, noteName, fxName, pitchClass } from './xm.ts';
import { CHANNELS, GHOST_CH, MARKER_CH, INS } from '../roster.ts';

export interface Issue {
  level: 'error' | 'warn' | 'info';
  at: string; // "0F:23:10" (pos:row:channel, hex pos, decimal row, 1-based channel)
  msg: string;
}

export interface CheckOptions {
  /** semitone offsets of each tone in chord samples, per instrument slot (from the instrument manifest) */
  chordTones?: Record<number, number[]>;
  /** instrument slots that are unpitched percussion (exempt from the white-key rule) */
  unpitched?: number[];
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
const addr = (pos: number, row: number, ch?: number) => `${hex2(pos)}:${String(row).padStart(2, '0')}${ch ? `:${ch}` : ''}`;

const FINAL_POS = 0x1f;
const ALLOWED_FX = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'C', 'E', 'K', 'R', 'G', 'H']);
const ALLOWED_E = new Set([0x1, 0x2, 0xa, 0xb, 0xc, 0xd]);

const MOTIFS: { word: string; act: string; from: number; to: number }[] = [
  { word: 'CAGE', act: 'I', from: 0x00, to: 0x04 },
  { word: 'FACADE', act: 'II', from: 0x05, to: 0x0c },
  { word: 'BEADED', act: 'III', from: 0x0d, to: 0x13 },
  { word: 'EFFACED', act: 'IV', from: 0x14, to: 0x1b },
  { word: 'FADE', act: 'V', from: 0x1c, to: 0x1f },
];
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export interface CheckReport {
  issues: Issue[];
  motifs: { word: string; at: string[] }[];
  markers: { at: string; note: string }[];
  stats: { patterns: number; uniquePatterns: number; notes: number; patternBytes: number };
}

export function checkXm(m: XmModule, opt: CheckOptions = {}): CheckReport {
  const issues: Issue[] = [];
  const err = (at: string, msg: string) => issues.push({ level: 'error', at, msg });
  const warn = (at: string, msg: string) => issues.push({ level: 'warn', at, msg });
  const unpitched = new Set(opt.unpitched ?? [INS.kick, INS.snare, INS.hats]);

  // --- global timing
  if (m.channels !== CHANNELS) err('--', `channels = ${m.channels}, expected ${CHANNELS}`);
  if (m.speed !== 6) err('--', `speed = ${m.speed}, expected 6`);
  if (m.bpm !== 125) err('--', `BPM = ${m.bpm}, expected 125`);
  if (m.order.length !== 32) err('--', `order list has ${m.order.length} positions, expected 32 (00–1F)`);
  if (!m.linear) warn('--', 'amiga frequency table; linear expected');

  let notes = 0;
  const markers: { at: string; note: string }[] = [];
  // per channel: sequence of note-ons for motif search
  const lines: { pc: number; at: string; pos: number }[][] = Array.from({ length: CHANNELS }, () => []);

  m.order.forEach((pi, pos) => {
    const p = m.patterns[pi];
    if (!p) return err(addr(pos, 0), `order points to missing pattern ${pi}`);
    if (p.rows !== 64) err(addr(pos, 0), `pattern ${pi} has ${p.rows} rows, expected 64`);
    const lastIns: number[] = new Array(CHANNELS).fill(0);
    for (let r = 0; r < p.rows; r++) {
      for (let ch = 1; ch <= m.channels; ch++) {
        const c: XmCell = p.cells[r * m.channels + ch - 1];
        if (!c) continue;
        const at = addr(pos, r, ch);
        if (c.ins) lastIns[ch - 1] = c.ins;
        const ins = c.ins || lastIns[ch - 1];

        // effects
        if (c.fx || c.param) {
          const f = fxName(c)[0];
          if (!ALLOWED_FX.has(f)) err(at, `effect ${fxName(c)} not allowed (time-shifting or unsupported)`);
          if (f === 'E' && !ALLOWED_E.has(c.param >> 4)) err(at, `effect ${fxName(c)} not allowed`);
        }

        if (ch === MARKER_CH) {
          if (c.note && c.note !== KEY_OFF) {
            const nn = noteName(c.note);
            if (ins !== INS.marker) err(at, `marker channel note with instrument ${ins}, must be 7F`);
            if (!['C-4', 'D-4', 'E-4', 'F-4'].includes(nn)) warn(at, `marker ${nn} has no meaning (C-4 look, D-4 hit, E-4 mode, F-4 motif)`);
            markers.push({ at: addr(pos, r), note: nn });
          }
          continue;
        }
        if (ins === INS.marker && c.note) err(at, 'instrument 7F (marker) used outside channel 18');

        if (!c.note || c.note === KEY_OFF) continue;
        notes++;
        // the ghost and Shepard count too; unpitched drums don't
        const pitched = !unpitched.has(ins);
        if (pitched && pos !== FINAL_POS) {
          const tones = [c.note];
          const chord = opt.chordTones?.[ins];
          if (chord) for (const t of chord) tones.push(c.note + t);
          if (c.fx === 0 && c.param) tones.push(c.note + (c.param >> 4), c.note + (c.param & 15));
          for (const t of tones) if (isBlackKey(t)) err(at, `black key ${noteName(t)}${t !== c.note ? ` (from ${noteName(c.note)} ${fxName(c)}${chord ? '/chord' : ''})` : ''}`);
        }
        if (pitched) lines[ch - 1].push({ pc: pitchClass(c.note), at, pos });
      }
      // arpeggio without a note continues on the playing note — checked loosely above only when a note is present
    }
  });

  // --- stale portamento: 3xx/5xy on a row without a note slides to the channel's last portamento
  // target, which a plain note-on does NOT reset (FT2/libopenmpt). After a new note that target is
  // stale, often set on another sample zone: the note glides a zone-distance away (the '342' typo for
  // vibrato '432' produced F#6 squeaks in 0A and A#5 strings in 13). Only safe inside a legato chain.
  {
    const fresh: boolean[] = new Array(CHANNELS).fill(false); // target set since the last plain note-on
    m.order.forEach((pi, pos) => {
      const p = m.patterns[pi];
      if (!p) return;
      for (let r = 0; r < p.rows; r++)
        for (let ch = 1; ch < MARKER_CH; ch++) {
          const c = p.cells[r * m.channels + ch - 1];
          if (!c) continue;
          const porta = c.fx === 3 || c.fx === 5;
          if (c.note && c.note !== KEY_OFF) {
            if (porta) fresh[ch - 1] = true;
            else fresh[ch - 1] = false;
          } else if (porta && !fresh[ch - 1])
            err(addr(pos, r, ch), `${fxName(c)} without a note after a new note: slides to a stale portamento target (vibrato is 4xy)`);
        }
    });
  }

  // --- motifs: literal statement (consecutive note-ons in one channel) inside the act
  const motifs = MOTIFS.map((mo) => {
    const want = [...mo.word].map((ch) => PC[ch]);
    const found: string[] = [];
    lines.forEach((ln) => {
      for (let i = 0; i + want.length <= ln.length; i++) {
        if (ln[i].pos < mo.from || ln[i].pos > mo.to) continue;
        if (want.every((pc, k) => ln[i + k].pc === pc)) found.push(ln[i].at);
      }
    });
    if (!found.length) warn(`${hex2(mo.from)}–${hex2(mo.to)}`, `no literal ${mo.word} (act ${mo.act}) found in any single channel`);
    return { word: mo.word, at: found };
  });

  // --- required markers (MUSIC_BRIEF §7)
  const hasMarker = (pos: number, rowFrom: number, rowTo: number, note: string) =>
    markers.some((mk) => {
      const [p, r] = mk.at.split(':').map((x, i) => (i === 0 ? parseInt(x, 16) : +x));
      return p === pos && r >= rowFrom && r <= rowTo && mk.note === note;
    });
  const need: [number, number, number, string, string][] = [
    [0x05, 0, 0, 'D-4', 'band entry at 05:00'],
    [0x0a, 48, 63, 'D-4', 'stop hit in the last bar of 0A'],
    [0x0f, 0, 0, 'E-4', 'lilac-chaser cycle start at 0F:00'],
    [0x14, 0, 0, 'D-4', 'climax at 14:00'],
    [0x1b, 60, 60, 'E-4', 'one beat of silence at 1B:60'],
    [0x1f, 0, 0, 'D-4', 'final cadence at 1F:00'],
  ];
  for (const [pos, a, b, note, why] of need) if (!hasMarker(pos, a, b, note)) warn(addr(pos, a, MARKER_CH), `missing ${note} marker: ${why}`);
  const cageF = markers.filter((mk) => mk.note === 'F-4' && /^0[12]:/.test(mk.at)).length;
  if (cageF < 4) warn('01–02', `expected 4 F-4 markers on the first CAGE notes, found ${cageF}`);

  // --- one beat of silence at 1B:60–63
  const p1b = m.patterns[m.order[0x1b]];
  if (p1b)
    for (let r = 60; r < 64; r++)
      for (let ch = 1; ch < MARKER_CH; ch++) {
        const c = p1b.cells[r * m.channels + ch - 1];
        if (c && c.note && c.note !== KEY_OFF) err(addr(0x1b, r, ch), 'note inside the silent beat 1B:60–63');
      }

  // --- ghost: informative
  const ghostNotes = lines[GHOST_CH - 1].length;
  if (!ghostNotes) issues.push({ level: 'info', at: '--', msg: 'ghost channel 17 is empty' });

  const uniq = new Set(m.order).size;
  return {
    issues,
    motifs,
    markers,
    stats: { patterns: m.patterns.length, uniquePatterns: uniq, notes, patternBytes: 0 },
  };
}

export function formatReport(rep: CheckReport): string {
  const out: string[] = [];
  const order = { error: 0, warn: 1, info: 2 };
  const sorted = [...rep.issues].sort((a, b) => order[a.level] - order[b.level] || a.at.localeCompare(b.at));
  const counts = { error: 0, warn: 0, info: 0 };
  for (const i of sorted) counts[i.level]++;
  const MAX = 60;
  sorted.slice(0, MAX).forEach((i) => out.push(`${i.level.toUpperCase().padEnd(5)} ${i.at.padEnd(9)} ${i.msg}`));
  if (sorted.length > MAX) out.push(`… ${sorted.length - MAX} more`);
  out.push('');
  out.push('motifs: ' + rep.motifs.map((m) => `${m.word} ${m.at.length ? m.at.slice(0, 4).join(', ') : '—'}`).join(' · '));
  out.push(`markers: ${rep.markers.map((m) => `${m.at} ${m.note}`).join(', ') || '—'}`);
  out.push(
    `stats: ${rep.stats.notes} notes, ${rep.stats.uniquePatterns} unique patterns in order, pattern data ${rep.stats.patternBytes} B packed` +
      `  ·  ${counts.error} errors, ${counts.warn} warnings`,
  );
  return out.join('\n');
}
