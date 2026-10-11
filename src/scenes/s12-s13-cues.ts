// S12 / S13 · the music of positions 18–1B as event lists, the same with and without sound.
// With a render the note-ons come from it (RenderResult.notes); in silent mode from the score as written
// (music/score/act4.ts, read out of music/effaced.xm: [row from 18:00, midi, volume] per note). The
// pictures are driven by these onsets, not by the RMS envelopes: a hit is a hit whether or not it sounds,
// and both scenes look the same in silent dev mode as in the show.
// (No default export: the scene registry skips this module.)

import type { FrameCtx } from './types.ts';
import { ROW, ROWS } from '../timeline/script.ts';
import { CH } from '../music/roster.ts';

/** global rows of 18:00 and 1C:00 */
export const R18 = 0x18 * ROWS;
const R1C = 0x1c * ROWS;

export interface Ev {
  /** song time (s) */
  t: number;
  midi: number;
  /** velocity 0..1 (volume column / 64) */
  v: number;
}

// prettier-ignore
const SCORE: Record<number, number[]> = {
  [CH.kick]: [0,60,48,3,60,42,6,60,42,8,60,48,10,60,42,14,60,42,16,60,48,19,60,42,22,60,42,24,60,48,26,60,42,30,60,42,32,60,48,35,60,42,38,60,42,40,60,48,42,60,42,46,60,42,48,60,48,51,60,42,54,60,42,56,60,48,58,60,42,62,60,42,64,60,48,67,60,42,70,60,42,72,60,48,74,60,42,78,60,42,80,60,48,83,60,42,86,60,42,88,60,48,90,60,42,94,60,42,96,60,48,99,60,42,102,60,42,104,60,48,106,60,42,110,60,42,112,60,48,115,60,42,118,60,42,120,60,48,122,60,42,126,60,42,128,60,45,131,60,40,134,60,40,136,60,45,138,60,40,142,60,40,144,60,45,147,60,40,150,60,40,152,60,45,154,60,40,158,60,40,160,60,45,163,60,40,166,60,40,168,60,45,170,60,40,174,60,40,176,60,45,179,60,40,182,60,40,184,60,45,190,60,42,192,60,45,195,60,40,198,60,40,200,60,45,202,60,40,206,60,40,208,60,45,211,60,40,214,60,40,216,60,45,218,60,40,222,60,40,224,60,28,228,60,31,232,60,34,236,60,37,238,60,37,240,60,45],
  [CH.snare]: [0,60,37,4,60,43,7,60,20,12,60,43,15,60,20,20,60,43,23,60,20,28,60,43,31,60,20,36,60,43,39,60,20,44,60,43,47,60,20,52,60,43,55,60,20,60,60,43,63,60,20,68,60,43,71,60,20,76,60,43,79,60,20,80,60,13,81,60,16,82,60,17,83,60,19,84,60,21,85,60,23,86,60,25,87,60,27,88,60,28,89,60,31,90,60,32,91,60,34,92,60,36,93,60,38,94,60,41,95,60,43,96,60,45,100,60,43,103,60,20,108,60,43,111,60,20,116,60,43,119,60,20,120,60,22,121,60,25,122,60,28,123,60,30,124,60,33,125,60,35,126,60,38,127,60,40,128,60,35,132,60,40,135,60,19,140,60,40,143,60,19,148,60,40,151,60,19,156,60,40,159,60,19,164,60,40,167,60,19,172,60,40,175,60,19,180,60,40,183,60,19,191,60,40,196,60,40,199,60,19,204,60,40,207,60,19,212,60,40,215,60,19,220,60,40,223,60,19,224,60,16,225,60,17,226,60,18,227,60,21,228,60,22,229,60,23,230,60,25,231,60,26,232,60,28,233,60,30,234,60,31,235,60,33,236,60,34,237,60,36,238,60,39,239,60,41,240,60,41],
  [CH.perc]: [0,65,40,16,65,36,32,65,36,48,65,36,64,65,36,80,65,36,96,65,43,112,65,36,128,65,38,144,65,34,160,65,34,176,65,34,184,57,26,185,55,28,186,52,29,187,50,30,188,48,33,189,45,34,190,43,35,191,40,37,192,65,34,208,65,34,240,65,38],
  [CH.lead]: [0,65,44,6,69,42,8,72,42,12,69,42,16,74,42,30,76,42,44,74,42,46,72,42,48,71,42,54,72,42,56,71,42,60,67,42,64,65,42,70,69,42,72,72,42,76,69,42,80,74,42,88,76,42,92,77,42,96,81,49,120,79,42,122,77,42,124,76,42,128,76,41,134,77,40,136,77,40,144,69,40,148,72,40,152,76,40,158,74,40,166,72,40,168,74,40,172,77,40,176,76,40,182,74,40,184,72,40,188,69,40,192,76,40,198,77,40,200,77,40,208,69,40,212,72,40,216,76,40,224,74,40,228,72,40,232,71,40,236,69,40,240,64,43],
  [CH.bell]: [0,84,21,64,84,18,96,93,28,98,91,26,100,89,24,102,84,22,104,81,19,106,77,17,108,72,15,110,69,13,128,88,17,160,86,14],
  [CH.stab]: [0,53,48,64,53,40,96,53,48,128,57,44,192,52,42,200,53,38,240,52,45],
};

export interface Cues {
  kick: Ev[];
  snare: Ev[];
  /** ch4: the crash (F-4 of the metal kit) */
  crash: Ev[];
  /** ch4: the timpani/tom run (1A:56–63) */
  toms: Ev[];
  lead: Ev[];
  bell: Ev[];
  /** ch16 orchestra hits */
  stab: Ev[];
}

const CRASH = 65; // KIT.crash = F-4

function build(audio: FrameCtx['audio']): Cues {
  const pick = (ch: number): Ev[] => {
    const ns = audio?.notes?.filter((n) => n.ch === ch && n.grow >= R18 && n.grow < R1C) ?? [];
    if (ns.length) return ns.map((n) => ({ t: n.t, midi: n.midi, v: (n.vol < 0 ? 64 : n.vol) / 64 }));
    const a = SCORE[ch];
    const out: Ev[] = [];
    for (let i = 0; i < a.length; i += 3) out.push({ t: (R18 + a[i]) * ROW, midi: a[i + 1], v: a[i + 2] / 64 });
    return out;
  };
  const perc = pick(CH.perc);
  return {
    kick: pick(CH.kick),
    snare: pick(CH.snare),
    crash: perc.filter((e) => e.midi === CRASH),
    toms: perc.filter((e) => e.midi !== CRASH),
    lead: pick(CH.lead),
    bell: pick(CH.bell),
    stab: pick(CH.stab),
  };
}

let memo: { audio: FrameCtx['audio']; c: Cues } | null = null;
/** the event lists for this render (memoised per RenderResult) */
export function cues(audio: FrameCtx['audio']): Cues {
  if (!memo || memo.audio !== audio) memo = { audio, c: build(audio) };
  return memo.c;
}

/** index of the last event at or before t (−1 if none) */
export function lastAt(ev: Ev[], t: number): number {
  let lo = 0, hi = ev.length - 1, r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (ev[m].t <= t + 1e-6) (r = m), (lo = m + 1);
    else hi = m - 1;
  }
  return r;
}

/** the last event's envelope at t: rises over `a` s, decays with time constant `d` (× its velocity) */
export function pulse(ev: Ev[], t: number, d: number, a = 0.012, vel = true): number {
  const i = lastAt(ev, t);
  if (i < 0) return 0;
  const x = Math.max(0, t - ev[i].t);
  return (vel ? ev[i].v : 1) * Math.min(1, x / a) * Math.exp(-Math.max(0, x - a) / d);
}

/** sum of all the events' envelopes (overlapping decays add up) — for rolls */
export function swell(ev: Ev[], t: number, d: number, from = 0): number {
  let s = 0;
  for (let i = lastAt(ev, t); i >= 0; i--) {
    const x = Math.max(0, t - ev[i].t);
    if (x > 6 * d || ev[i].t < from) break;
    s += ev[i].v * Math.exp(-x / d);
  }
  return s;
}

/**
 * Σ v·(1 − e^(−(t−tᵢ)/d)) over the events up to t: a monotone, continuous staircase whose every step
 * eases in with time constant d — integrate it into an angle and each hit becomes a whip that settles.
 */
export function steps(ev: Ev[], t: number, d: number, vel = true, from = -Infinity): number {
  let s = 0;
  const n = lastAt(ev, t);
  for (let i = 0; i <= n; i++) if (ev[i].t >= from) s += (vel ? ev[i].v : 1) * (1 - Math.exp(-Math.max(0, t - ev[i].t) / d));
  return s;
}

/** seconds since the last event (Infinity before the first) */
export function since(ev: Ev[], t: number): number {
  const i = lastAt(ev, t);
  return i < 0 ? Infinity : t - ev[i].t;
}
