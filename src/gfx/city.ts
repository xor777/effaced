// Shared CPU side of the city of facades (S03 · S05 · S10): music sync helpers, the neon sign atlas,
// camera splines and the uniforms of src/shaders/lib/city.glsl.

import { type Gfx, type Program, program } from './gl.ts';
import type { FrameCtx } from '../scenes/types.ts';
import { ROW } from '../timeline/script.ts';
import type { Vec3 } from './taa.ts';

// ---------------------------------------------------------------------------------------------
// Music sync. Note-ons come from the rendered track (f.audio.notes). In dev with `?silent` there is
// no render, so the module's pattern data is parsed directly (same rows, no audio); only if both are
// missing the caller's fallback rows are used.

interface Ev {
  t: number;
  grow: number;
  ch: number;
  name: string;
}

let devNotes: Ev[] | null = null;
let devLoading = false;
function loadDevNotes() {
  if (devLoading || !import.meta.env.DEV) return;
  devLoading = true;
  Promise.all([fetch('/music/effaced.xm').then((r) => r.arrayBuffer()), import('../music/xm/xm.ts')])
    .then(([buf, xm]) => {
      const m = xm.readXm(new Uint8Array(buf));
      const out: Ev[] = [];
      m.order.forEach((pi, pos) => {
        const pat = m.patterns[pi];
        for (let r = 0; r < pat.rows; r++)
          for (let ch = 0; ch < m.channels; ch++) {
            const c = pat.cells[r * m.channels + ch];
            if (c.note && c.note < 97) {
              const grow = pos * 64 + r;
              out.push({ t: grow * ROW, grow, ch: ch + 1, name: xm.noteName(c.note) });
            }
          }
      });
      devNotes = out;
      cache.clear();
    })
    .catch(() => {});
}

let markerEvs: { src: unknown; list: Ev[] } | null = null;
function allNotes(f: FrameCtx): Ev[] | null {
  if (f.audio) {
    // markers of channel 18 live in their own list
    if (!markerEvs || markerEvs.src !== f.audio) {
      const ms = (f.audio.markers ?? []).map((m) => ({ t: m.t, grow: m.row, ch: 18, name: m.note }));
      markerEvs = { src: f.audio, list: [...(f.audio.notes as Ev[]).filter((n) => n.ch !== 18), ...ms] };
    }
    return markerEvs.list;
  }
  if (!devNotes) loadDevNotes();
  return devNotes;
}

const cache = new Map<string, number[]>();
let cacheSrc: unknown = null;

/**
 * Times (s) of note-ons on tracker channel `ch` in global rows [from, to), optionally only notes named
 * `name` (e.g. 'D-4' on the marker channel 18). Falls back to `fallbackRows` (global rows).
 */
export function onsets(f: FrameCtx, ch: number, from: number, to: number, fallbackRows: number[] = [], name?: string): number[] {
  const src = allNotes(f);
  if (src !== cacheSrc) {
    cache.clear();
    cacheSrc = src;
  }
  const key = `${ch}:${from}:${to}:${name ?? ''}:${fallbackRows.length}`;
  let r = cache.get(key);
  if (!r) {
    const hits = src ? src.filter((n) => n.ch === ch && n.grow >= from && n.grow < to && (!name || n.name === name)).map((n) => n.t) : [];
    r = hits.length ? hits : fallbackRows.map((x) => x * ROW);
    if (src) cache.set(key, r); // cache only real data; fallbacks are recomputed until the notes arrive
  }
  return r;
}

/** index of the last onset ≤ t (−1 if none) */
export function lastIndex(times: number[], t: number): number {
  let lo = 0, hi = times.length - 1, r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (times[m] <= t) {
      r = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return r;
}

/** seconds since the last onset ≤ t (Infinity if none) */
export function since(times: number[], t: number): number {
  const i = lastIndex(times, t);
  return i < 0 ? Infinity : t - times[i];
}

/** a percussive envelope from onsets: fast attack, exponential decay `d` seconds */
export function pulse(times: number[], t: number, d: number, attack = 0.012): number {
  const s = since(times, t);
  if (!isFinite(s)) return 0;
  return Math.min(1, s / attack) * Math.exp(-Math.max(0, s - attack) / d);
}

/** global row of position `pos`, row `row` */
export const grow = (pos: number, row = 0) => pos * 64 + row;

// ---------------------------------------------------------------------------------------------
// neon sign atlas: text → signed distance field (Felzenszwalb EDT) + per-pixel letter index

export interface TextAtlas {
  tex: WebGLTexture;
  /** per line: v0, v1, u1, aspect — see lib/city.glsl uTextLine */
  lines: [number, number, number, number][];
  /** per line: number of characters */
  count: number[];
}

const INF = 1e20;
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}
/** squared euclidean distance to the nearest `true` pixel, in place on a grid of 0 / INF */
function edt2d(g: Float64Array, w: number, h: number) {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
}

/**
 * Render `lines` with `font` into one SDF atlas, one band per entry. An entry may hold several rows
 * separated by '\n' (centred, one shared letter size) — a tablet with a few lines of text. Distances
 * are stored in band heights (r = 0.5 + 2·d, so ±0.25 band heights), the character index in g
 * (row-major over the entry's characters, newlines not counted).
 */
export function textAtlas(g: Gfx, lines: string[], font = '600 120px Didot, "Bodoni 72", Georgia, serif', LH = 160, W = 1600): TextAtlas {
  const gl = g.gl;
  const entries = lines.map((s) => s.split('\n'));
  const bandH = entries.map((rows) => rows.length * LH);
  const H = Math.max(LH, bandH.reduce((x, y) => x + y, 0));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  cx.fillStyle = '#000';
  cx.fillRect(0, 0, W, H);
  cx.font = font;
  cx.fillStyle = '#fff';
  cx.textBaseline = 'alphabetic';
  const pad = Math.round(LH * 0.3);
  const out = new Uint8Array(W * H * 4);
  const meta: TextAtlas['lines'] = [];
  const count: number[] = [];
  const letter = new Uint8Array(W * H);
  let top = 0;
  entries.forEach((rows, li) => {
    const ms = rows.map((r) => cx.measureText(r));
    const maxW = Math.max(...ms.map((m) => m.width), 1);
    const inkH = Math.max(...ms.map((m) => m.actualBoundingBoxAscent + m.actualBoundingBoxDescent), 1);
    // one letter size for the whole entry: the widest row fits, every row's ink fits its band
    const scale = Math.min(1, (W - 2 * pad) / maxW, (LH * 0.86) / inkH);
    const capH = cx.measureText('H').actualBoundingBoxAscent * scale;
    const width = maxW * scale + 2 * pad;
    let charBase = 0;
    rows.forEach((row, ri) => {
      const x0 = pad + ((maxW - ms[ri].width) * scale) / 2;
      const y0 = top + ri * LH + LH / 2 + capH / 2;
      cx.save();
      cx.translate(x0, y0);
      cx.scale(scale, scale);
      cx.fillText(row, 0, 0);
      cx.restore();
      // character index per column of this row: split between neighbouring characters halfway
      const edges: number[] = [];
      for (let i = 0; i < row.length; i++) edges.push(x0 + cx.measureText(row.slice(0, i + 1)).width * scale);
      for (let col = 0; col < W; col++) {
        let k = 0;
        while (k < edges.length - 1 && col > edges[k]) k++;
        const v = Math.min(255, charBase + k);
        for (let y = top + ri * LH; y < top + (ri + 1) * LH; y++) letter[y * W + col] = v;
      }
      charBase += row.length;
    });
    meta.push([top / H, (top + bandH[li]) / H, width / W, width / bandH[li]]);
    count.push(charBase);
    top += bandH[li];
  });
  const img = cx.getImageData(0, 0, W, H).data;
  // one distance transform per band, so neighbouring entries never see each other
  top = 0;
  for (let li = 0; li < entries.length; li++) {
    const bh = bandH[li];
    const inside = new Float64Array(W * bh), outside = new Float64Array(W * bh);
    const o = top * W;
    for (let i = 0; i < W * bh; i++) {
      const on = img[(o + i) * 4] > 127;
      inside[i] = on ? 0 : INF; // distance to ink (for outside pixels)
      outside[i] = on ? INF : 0; // distance to background (for inside pixels)
    }
    edt2d(inside, W, bh);
    edt2d(outside, W, bh);
    for (let i = 0; i < W * bh; i++) {
      const j = o + i;
      const sd = (Math.sqrt(inside[i]) - Math.sqrt(outside[i])) / bh; // + outside, band heights
      out[j * 4] = Math.max(0, Math.min(255, Math.round((0.5 + 2 * sd) * 255)));
      out[j * 4 + 1] = letter[j];
      out[j * 4 + 3] = 255;
    }
    top += bh;
  }
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { tex, lines: meta, count };
}

// ---------------------------------------------------------------------------------------------
// camera keyframes: [time, ...values] with C1 cubic Hermite interpolation (finite-difference tangents)

export function spline(keys: number[][], t: number): number[] {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0].slice(1);
  if (t >= keys[n - 1][0]) return keys[n - 1].slice(1);
  let i = 0;
  while (i < n - 2 && keys[i + 1][0] <= t) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n - 1, i + 2)];
  const h = k2[0] - k1[0];
  const u = (t - k1[0]) / h;
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const out: number[] = [];
  for (let j = 1; j < k1.length; j++) {
    const m1 = i === 0 ? (k2[j] - k1[j]) / h : (k2[j] - k0[j]) / (k2[0] - k0[0]);
    const m2 = i + 2 >= n ? (k2[j] - k1[j]) / h : (k3[j] - k1[j]) / (k3[0] - k1[0]);
    out.push(h00 * k1[j] + h10 * h * m1 + h01 * k2[j] + h11 * h * m2);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// light + palette of lib/city.glsl. Colours are linear Display P3 (convert hex words with hexP3).

export interface CityLook {
  sunDir: Vec3;
  sunCol: Vec3;
  skyHor: Vec3;
  skyZen: Vec3;
  fogCol: Vec3;
  /** density at y = 0, height falloff, sun in-scatter gain, HG anisotropy */
  fog: [number, number, number, number];
  ground: Vec3;
  /** floor: thick rhomb, thin rhomb, grout */
  pal: [Vec3, Vec3, Vec3];
  /** stucco colours of the flats */
  stucco: [Vec3, Vec3, Vec3, Vec3];
  trim: Vec3;
  neon: Vec3;
  win: Vec3;
  /** sky-light scale (default 1) */
  ambient?: number;
  /** cirrus: amount, scale, drift speed, brightness relative to the horizon */
  cloud?: [number, number, number, number];
}

const srgb2lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** '#facade' → linear Display P3 (the CSS colour exactly), times `k` */
export function hexP3(hex: string, k = 1): Vec3 {
  const v = parseInt(hex.slice(1), 16);
  const r = srgb2lin(((v >> 16) & 255) / 255), g = srgb2lin(((v >> 8) & 255) / 255), b = srgb2lin((v & 255) / 255);
  return [
    k * (0.8224621 * r + 0.177538 * g),
    k * (0.0331941 * r + 0.9668058 * g),
    k * (0.0170827 * r + 0.0723974 * g + 0.9105199 * b),
  ];
}

export const normalize3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
export const mix3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

export function setCityLook(p: Program, L: CityLook, time = 0) {
  const c = L.cloud ?? [0, 1, 0, 1];
  p.set('uSunDir', normalize3(L.sunDir))
    .set('uSunCol', L.sunCol)
    .set('uSkyHor', L.skyHor)
    .set('uSkyZen', L.skyZen)
    .set('uFogCol', L.fogCol)
    .set('uFog', L.fog)
    .set('uGround', L.ground)
    .set('uPal', [...L.pal[0], ...L.pal[1], ...L.pal[2]])
    .set('uStucco', L.stucco.flat())
    .set('uTrim', L.trim)
    .set('uNeon', L.neon)
    .set('uWinCol', L.win)
    .set('uCloud', c[0], c[1], c[2] * time, c[3])
    .set('uAmb', L.ambient ?? 1);
}

export interface Sign {
  /** cell (x, z) of the flat that carries it */
  cell: [number, number];
  /** atlas line index */
  line: number;
  /** letter (band) height in world units */
  height: number;
  /** centre height on the flat */
  y: number;
  /** characters lit so far */
  lit: number;
  /** characters [from, lit) are igniting (flicker) while phase < 1 */
  from: number;
  phase: number;
  /** overall neon level */
  level: number;
}

/**
 * Neon ignition driven by note-ons: after the i-th onset `counts[i]` characters are lit (default i + 1);
 * the new ones flicker for `dur` seconds.
 */
export function ignite(times: number[], t: number, counts?: number[], dur = 0.3): { lit: number; from: number; phase: number } {
  const i = lastIndex(times, t);
  if (i < 0) return { lit: 0, from: 0, phase: 1 };
  const c = (j: number) => (j < 0 ? 0 : counts ? counts[Math.min(j, counts.length - 1)] : j + 1);
  return { lit: c(i), from: c(i - 1), phase: Math.min(1, (t - times[i]) / dur) };
}

export function setCitySigns(p: Program, atlas: TextAtlas, signs: Sign[], unit: number) {
  const S = new Float32Array(16), Y = new Float32Array(4), lit = new Float32Array(16), TL = new Float32Array(16);
  signs.slice(0, 4).forEach((s, i) => {
    S.set([s.cell[0], s.cell[1], s.line + 1, s.height], i * 4);
    Y[i] = s.y;
    lit.set([s.lit, s.level, s.from, s.phase], i * 4);
  });
  atlas.lines.slice(0, 4).forEach((l, i) => TL.set(l, i * 4));
  p.set('uSign', S).set('uSignY', Y).set('uSignLit', lit).set('uTextLine', TL).tex('uText', atlas.tex, unit);
}

// ---------------------------------------------------------------------------------------------
/** one compiled program per (context, shader) shared by the scenes of the city (S03 and S10 both fly the avenue) */
const shared = new WeakMap<Gfx, Map<string, Program>>();
export function sharedProgram(g: Gfx, fs: string, defines = ''): Program {
  let m = shared.get(g);
  if (!m) shared.set(g, (m = new Map()));
  const key = fs + '|' + defines;
  let p = m.get(key);
  if (!p) m.set(key, (p = program(g, fs, '', defines)));
  return p;
}
