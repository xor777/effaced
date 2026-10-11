// The ghost's XY oscilloscope voice (channel 17, slot 18 "scope"). L = x, R = y in [-1, 1]:
// a Lissajous figure that morphs into Fourier epicycles of the creature's sigil — a closed
// compass-and-ruler contour (PLACEHOLDER glyph; the real sigil comes with the visuals).
// The note frequency is the traversal rate: one full figure per period.
//
// XM samples are mono, so the tracker plays a mono preview (x of the sigil); the engine
// synthesizes the true stereo XY signal from the channel-17 notes (ScopeSynth) and uses it
// for RenderResult.ghostL/ghostR and in the mix. 9xx on channel 17 sets the morph target
// (900 = Lissajous, 9FF = sigil).

import { TAU, mtof, periodicLoop, normalize } from './util.ts';
import type { Zone, P } from './synths.ts';

export type Pt = [number, number];

/**
 * The creature's sigil: a square maze — one stroke spiralling in walls around a cell — and the way
 * out: from the innermost cell a stroke breaks through the walls to the outside and ends in the "+1".
 * (The director's pick among the prototypes; no circles, no radial symmetry.) The beam needs a closed
 * loop, so the path runs out to the +1 and back along itself: the retrace adds no new line.
 */
export const SIGIL_MAZE: Pt[] = [
  [-0.55, -0.55], [-0.55, 0.8], [0.8, 0.8], [0.8, -0.8], [-0.35, -0.8], [-0.35, 0.55], [0.55, 0.55],
  [0.55, -0.55], [-0.1, -0.55], [-0.1, 0.25], [0.25, 0.25], [0.25, -0.2],
  // the way out: from the innermost cell straight through the walls
  [0.1, -0.2], [0.1, 0.05], [1.05, 0.05],
];
export function sigilPath(): Pt[] {
  const pts: Pt[] = [];
  const line = (a: Pt, b: Pt, n: number) => {
    for (let i = 0; i < n; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  };
  const way = [...SIGIL_MAZE, ...SIGIL_MAZE.slice(0, -1).reverse()];
  for (let i = 0; i < way.length - 1; i++) line(way[i], way[i + 1], Math.max(2, Math.round(Math.hypot(way[i + 1][0] - way[i][0], way[i + 1][1] - way[i][1]) * 48)));
  pts.push(way[way.length - 1]);
  return pts;
}

/** Fourier coefficients c_k (k = −K..K) of a closed polyline, resampled uniformly by arc length. */
export function contourDft(path: Pt[], K: number, M = 2048): { re: Float64Array; im: Float64Array } {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = cum[cum.length - 1] + Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]);
  const xs = new Float64Array(M), ys = new Float64Array(M);
  let seg = 0;
  for (let j = 0; j < M; j++) {
    const s = (j / M) * total;
    while (seg < path.length - 2 && cum[seg + 1] < s) seg++;
    const a = path[seg], b = path[seg + 1] ?? path[0];
    const len = (cum[seg + 1] ?? total) - cum[seg];
    const u = len > 0 ? (s - cum[seg]) / len : 0;
    xs[j] = a[0] + (b[0] - a[0]) * u;
    ys[j] = a[1] + (b[1] - a[1]) * u;
  }
  const re = new Float64Array(2 * K + 1), im = new Float64Array(2 * K + 1);
  for (let k = -K; k <= K; k++) {
    let sr = 0, si = 0;
    for (let j = 0; j < M; j++) {
      const a = (-TAU * k * j) / M;
      const c = Math.cos(a), s = Math.sin(a);
      sr += xs[j] * c - ys[j] * s;
      si += xs[j] * s + ys[j] * c;
    }
    re[k + K] = sr / M;
    im[k + K] = si / M;
  }
  return { re, im };
}

export interface Curve {
  x: Float32Array;
  y: Float32Array;
}

const TABLE = 4096;
let sigilCache: Curve[] | null = null;
let plusOne: Pt = [0, 0];

/** where the "+1" (the end of the way out) sits in the sigil tables' coordinates */
export function sigilPlusOne(): Pt {
  sigilTables();
  return plusOne;
}

/**
 * Band-limited sigil tables: level j keeps |k| ≤ 2^j harmonics (j = 0..8, K ≤ 256), with Lanczos
 * σ-factors against Gibbs ringing, scaled into ±1 (ScopeParams.size scales the output). The audio
 * picks the highest level under Nyquist (≤ 64 harmonics for the ghost's notes); the visuals use
 * the top level, SIGIL_FULL, so the maze keeps its corners and its innermost turn.
 */
export const SIGIL_FULL = 8;
export function sigilTables(): Curve[] {
  if (sigilCache) return sigilCache;
  const KMAX = 1 << SIGIL_FULL;
  const { re, im } = contourDft(sigilPath(), KMAX);
  const levels: Curve[] = [];
  let scale = 0;
  for (let j = 0; j <= SIGIL_FULL; j++) {
    const K = 1 << j;
    const x = new Float32Array(TABLE + 1), y = new Float32Array(TABLE + 1);
    for (let k = -K; k <= K; k++) {
      if (k === 0) continue; // centre the figure
      const sig = k === 0 ? 1 : Math.sin((Math.PI * k) / (K + 1)) / ((Math.PI * k) / (K + 1));
      const cr = re[k + KMAX] * sig, ci = im[k + KMAX] * sig;
      for (let t = 0; t <= TABLE; t++) {
        const a = (TAU * k * t) / TABLE;
        const c = Math.cos(a), s = Math.sin(a);
        x[t] += cr * c - ci * s;
        y[t] += cr * s + ci * c;
      }
    }
    if (j === SIGIL_FULL) for (let t = 0; t <= TABLE; t++) scale = Math.max(scale, Math.abs(x[t]), Math.abs(y[t]));
    levels.push({ x, y });
  }
  const g = 1 / scale;
  for (const l of levels) for (let t = 0; t <= TABLE; t++) (l.x[t] *= g), (l.y[t] *= g);
  const end = SIGIL_MAZE[SIGIL_MAZE.length - 1];
  plusOne = [(end[0] - re[KMAX]) * g, (end[1] - im[KMAX]) * g];
  return (sigilCache = levels);
}

export interface ScopeParams {
  /** Lissajous frequency ratio x:y */
  a: number;
  b: number;
  /** phase drift of the Lissajous x (cycles per second) — the figure slowly rotates */
  drift: number;
  /** morph time constant (s): at note-on the figure is a Lissajous, it becomes the sigil */
  morphTime: number;
  /** sigil rotation (turns per second) */
  spin: number;
  /** output size 0..1 */
  size: number;
}
export const SCOPE_DEFAULTS: ScopeParams = { a: 3, b: 2, drift: 0.05, morphTime: 4, spin: 0, size: 0.9 };

/** a change on the ghost channel: a new traversal frequency (note-on) and/or a morph target (9xx) */
export interface ScopeEvent {
  /** sample index */
  at: number;
  /** traversal frequency (Hz) from this point on */
  f?: number;
  /** morph target 0..1 (0 = Lissajous, 1 = sigil) */
  morph?: number;
}

/**
 * Streaming XY synth. Events must be sorted by `at`. The beam phase is continuous across notes;
 * the morph glides toward its target with time constant `morphTime` (default target: the sigil,
 * so a song starts as a Lissajous figure that resolves into the sigil). `amp[i]` scales sample i
 * (the engine derives it from libopenmpt's render of the scope instrument, so the volume column,
 * slides, envelopes and cuts all apply).
 */
export class ScopeSynth {
  private ev: ScopeEvent[];
  private ei = 0;
  private th = 0;
  private f = 0;
  private m = 0;
  private target = 1;
  private sr: number;
  private p: ScopeParams;
  private k: number;
  constructor(events: ScopeEvent[], sr: number, p: ScopeParams = SCOPE_DEFAULTS) {
    this.ev = events;
    this.sr = sr;
    this.p = p;
    this.k = 1 - Math.exp(-1 / (p.morphTime * sr));
  }
  /** render samples [start, start+n) into l/r (overwrites) */
  render(start: number, n: number, amp: Float32Array, l: Float32Array, r: Float32Array): void {
    const tabs = sigilTables();
    const p = this.p, sr = this.sr;
    let lvlMax = 0;
    const setF = (f: number) => {
      this.f = f;
      const kMax = Math.max(1, Math.floor((0.45 * sr) / Math.max(1, f)));
      lvlMax = Math.min(SIGIL_FULL, Math.floor(Math.log2(kMax)));
    };
    setF(this.f);
    for (let i = 0; i < n; i++) {
      const at = start + i;
      while (this.ei < this.ev.length && this.ev[this.ei].at <= at) {
        const e = this.ev[this.ei++];
        if (e.f !== undefined) setF(e.f);
        if (e.morph !== undefined) this.target = e.morph;
      }
      this.m += (this.target - this.m) * this.k;
      const g = amp[i] * p.size;
      if (this.f <= 0 || g === 0) {
        l[i] = 0;
        r[i] = 0;
        if (this.f > 0) {
          this.th += this.f / sr;
          if (this.th >= 1) this.th -= Math.floor(this.th);
        }
        continue;
      }
      const m = this.m, th = this.th;
      const lv = Math.min(lvlMax, m * 1.6 * lvlMax);
      const l0 = Math.floor(lv), fr = lv - l0, l1 = Math.min(lvlMax, l0 + 1);
      let sp = th + p.spin * (at / sr);
      sp -= Math.floor(sp);
      const u = sp * TABLE;
      const ui = u | 0, uf = u - ui;
      const A = tabs[l0], B = tabs[l1];
      const ax = A.x[ui] + (A.x[ui + 1] - A.x[ui]) * uf, ay = A.y[ui] + (A.y[ui + 1] - A.y[ui]) * uf;
      const bx = B.x[ui] + (B.x[ui + 1] - B.x[ui]) * uf, by = B.y[ui] + (B.y[ui + 1] - B.y[ui]) * uf;
      const sx = ax + (bx - ax) * fr, sy = ay + (by - ay) * fr;
      const lx = Math.sin(TAU * (p.a * th + p.drift * (at / sr))), ly = Math.sin(TAU * p.b * th);
      const w = m * m * (3 - 2 * m);
      l[i] = (lx + (sx - lx) * w) * g;
      r[i] = (ly + (sy - ly) * w) * g;
      this.th = th + this.f / sr;
      if (this.th >= 1) this.th -= 1;
    }
  }
}

/**
 * 'scope' — the tracker's mono preview: x of the sigil traversed at the root note, looped.
 *  loop  s  loop length
 */
export function scopePreview(p: P, sr: number, root: number): Zone {
  const { L, f } = periodicLoop(mtof(root), sr, p.loop);
  const tab = sigilTables()[6];
  const data = new Float32Array(L + 1);
  for (let i = 0; i < L + 1; i++) {
    const u = (((f * i) / sr) % 1) * TABLE;
    const ui = u | 0, uf = u - ui;
    data[i] = tab.x[ui] + (tab.x[ui + 1] - tab.x[ui]) * uf;
  }
  normalize(data, 0.9);
  return { data, rootMidi: root, lo: 0, hi: 127, loopStart: 1, loopLength: L, loopType: 1 };
}
