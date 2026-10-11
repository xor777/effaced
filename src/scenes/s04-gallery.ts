// S04 · Gallery (PLAN §4, 07:00–08:63): a dark exhibition hall inside the facade city. On the right
// wall six VGA memories of the 90s demoscene glow like paintings (#DECADE: the Machine's
// "decades"); the left wall is a panoramic Scream Tracker 3 — real DOM text locked into the 3D
// scene with CSS matrix3d — playing the very patterns we hear. The ghost channel 17 shows through
// for a few frames on each note of E-G-A-C; the instrument list is the creature's diary.
// The hall (and its renderer) is shared with S06, which flies into the tunnel memory.

import { type Gfx, type Program, type Target, program, fullscreen, bindTarget, createTarget } from '../gfx/gl.ts';
import { memories, ATLAS_W, ATLAS_H } from '../gfx/billboards.ts';
import type { Scene, FrameCtx } from './types.ts';
import type { TrackInfo } from '../audio/types.ts';
import { TrackerHud, FT2, FT_W, FT_H, HUD_SPLIT, HUD_TEX_W, HUD_TEX_H, SCOPES } from '../meta/hud.ts';
import { smoothstep } from '../timeline/events.ts';
import { ROW } from '../timeline/script.ts';

// --- the hall (metres; y up, the hall runs along -z)
export const HALL = {
  HW: 3.6, // half width
  HH: 5.0, // height
  ZN: 4.0, // entrance wall
  ZF: -24.0, // far wall (doorway to the city)
  MEM_Z0: -1.0, // memories on the right wall: centres every 2.8 m
  MEM_DZ: -2.8,
  MEM_Y: 2.0,
  MEM_HW: 0.8, // 1.6 × 1.2 m, 4:3 like the tubes they came from
  MEM_HH: 0.6,
  FRAME: 0.06,
  DOOR_HW: 1.3,
  DOOR_H: 3.6,
  SKY_HW: 0.35,
};
/** the tracker: a FastTracker II screen, 16:10 like FT2's 640 × 400, 4.3 m tall on the left wall */
const HUD_H_M = 4.3;
const HUD_W_M = (HUD_H_M * FT_W) / FT_H;
export const HUD_RECT = {
  Z0: -5.3,
  Z1: -5.3 - HUD_W_M,
  Y0: 0.4,
  Y1: 0.4 + HUD_H_M,
};
export const memZ = (i: number) => HALL.MEM_Z0 + i * HALL.MEM_DZ;
/** light map: the box's surfaces at 5 cm (see s04-gallery.glsl) */
const LM_W = 560;
const LM_H = 588;

const fl = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const DEFINES =
  Object.entries(HALL).map(([k, v]) => `#define ${k} ${fl(v)}`).join('\n') +
  `
#define HUD_Z0 ${fl(HUD_RECT.Z0)}
#define HUD_Z1 ${fl(HUD_RECT.Z1)}
#define HUD_Y0 ${fl(HUD_RECT.Y0)}
#define HUD_Y1 ${fl(HUD_RECT.Y1)}
#define HUD_SPLIT ${fl(HUD_SPLIT)}
#define HUD_TEXW ${fl(HUD_TEX_W)}
#define FT_W ${fl(FT_W)}
#define FT_H ${fl(FT_H)}
#define SCOPE_RECT vec4(${fl(SCOPES.x)}, ${fl(SCOPES.y)}, ${fl(SCOPES.w)}, ${fl(SCOPES.h)})
#define SCOPE_COLS ${SCOPES.cols}
#define SCOPE_ROWS ${SCOPES.rows}
#define HUD_GAIN 1.6
#define ATLAS_W ${fl(ATLAS_W)}
#define ATLAS_H ${fl(ATLAS_H)}
`;

export interface View {
  eye: number[];
  right: number[];
  up: number[];
  fwd: number[];
  /** tan(vertical fov / 2) */
  tanH: number;
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function lookAt(eye: number[], target: number[], fovYdeg: number, roll = 0): View {
  const fwd = norm(sub(target, eye));
  let right = norm(cross(fwd, [0, 1, 0]));
  let up = cross(right, fwd);
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const r2 = right.map((v, i) => v * c + up[i] * s);
    up = up.map((v, i) => v * c - right[i] * s);
    right = r2;
  }
  return { eye, right, up, fwd, tanH: Math.tan((fovYdeg * Math.PI) / 360) };
}

/** world → camera matrix (column-major, camera looks down -z) */
export function viewMatrix(v: View): Float32Array {
  const { eye: e, right: r, up: u, fwd: f } = v;
  return new Float32Array([
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -dot(r, e), -dot(u, e), dot(f, e), 1,
  ]);
}

/**
 * Smooth camera path through keys [τ, x, y, z] (Hermite, finite-difference tangents). Ends are eased
 * (zero velocity) unless `free`, where they keep the speed of the first/last segment — for moves that
 * come in from, or leave into, another scene at speed.
 */
export function path(keys: number[][], t: number, free = false): number[] {
  const n = keys.length;
  const edge = (k: number, o: number) => [1, 2, 3].map((j) => (keys[k + o][j] - keys[k][j]) / (keys[k + o][0] - keys[k][0]));
  if (t <= keys[0][0]) return free ? keys[0].slice(1).map((v, j) => v + edge(0, 1)[j] * (t - keys[0][0])) : keys[0].slice(1);
  if (t >= keys[n - 1][0]) return free ? keys[n - 1].slice(1).map((v, j) => v + edge(n - 1, -1)[j] * (t - keys[n - 1][0])) : keys[n - 1].slice(1);
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1];
  const h = b[0] - a[0], u = (t - a[0]) / h;
  const tan = (k: number) => {
    if (k === 0) return free ? edge(0, 1) : [0, 0, 0];
    if (k === n - 1) return free ? edge(n - 1, -1) : [0, 0, 0];
    const p = keys[k - 1], q = keys[k + 1];
    return [1, 2, 3].map((j) => (q[j] - p[j]) / (q[0] - p[0]));
  };
  const ma = tan(i), mb = tan(i + 1);
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return [1, 2, 3].map((j, k) => h00 * a[j] + h10 * h * ma[k] + h01 * b[j] + h11 * h * mb[k]);
}

const hexLin = (h: string, k: number) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * k);
};

/** The hall renderer (one per GL context; S04 and S06 share it). */
export interface DrawOpts {
  t: number;
  expo: number;
  kick?: number;
  /** memory screen drawn as alpha 0 (S06's Droste level) */
  hole?: number;
  /** brightness of the GL copy of the tracker */
  hudGL?: number;
  screenGain?: number;
  doorGain?: number;
  skyGain?: number;
  spotGain?: number;
  /** seconds since each memory screen switched on (< 0 off); default: all on */
  memOn?: number[];
  /** ages (s) of the last four kicks for the skylight chase; < 0 = none */
  chase?: number[];
  /** picture-light beams in the air */
  beamGain?: number;
  /** the tracker's channel scopes: per channel amplitude, cycles, waveform, ghost glow */
  scopes?: Float32Array;
}

const ALL_ON = [99, 99, 99, 99, 99, 99];
const NO_CHASE = [-1, -1, -1, -1];
const NO_SCOPES = new Float32Array(18 * 4);

/** The hall renderer (one per GL context; S04 and S06 share it). */
export class Gallery {
  g: Gfx;
  prog: Program;
  lmProg: Program;
  hudTex: WebGLTexture | null = null;
  lmap: Target | null = null;
  constructor(g: Gfx) {
    this.g = g;
    this.prog = program(g, 'scenes/s04-gallery', '', DEFINES);
    this.lmProg = program(g, 'scenes/s04-gallery', '', DEFINES + '#define LIGHTMAP\n');
  }
  programs() {
    return [this.prog, this.lmProg];
  }
  init() {
    const gl = this.g.gl;
    if (this.hudTex) return;
    this.hudTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.hudTex);
    const levels = Math.floor(Math.log2(HUD_TEX_W)) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, HUD_TEX_W, HUD_TEX_H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // until the HUD has drawn itself: FT2 blue panels over a black pattern editor
    const c = new Uint8Array(HUD_TEX_W * HUD_TEX_H * 4);
    for (let y = 0; y < HUD_TEX_H; y++)
      for (let x = 0; x < HUD_TEX_W; x++) {
        const pat = y > HUD_TEX_H * 0.47 && y < HUD_TEX_H * 0.97 && x > HUD_TEX_W * 0.04 && x < HUD_TEX_W * 0.96;
        c.set(pat ? [0, 0, 0, 255] : [40, 85, 134, 255], (y * HUD_TEX_W + x) * 4);
      }
    this.uploadHud(c);
    this.lmap = createTarget(this.g, LM_W, LM_H, { formats: [gl.RGBA16F] });
  }
  /** the GL's copy of the tracker screen (RGBA8 pixels from the HUD; a plain CPU upload, no canvas) */
  uploadHud(px: Uint8Array) {
    const gl = this.g.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.hudTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HUD_TEX_W, HUD_TEX_H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  private common(p: Program, o: DrawOpts) {
    const mem = memories(this.g);
    p.tex('atlas', mem.tex, 0)
      .tex('hudTex', this.hudTex, 1)
      .set('t', o.t)
      .set('hudInfo', hexLin(FT2.desk, 0.7))
      .set('hudPat', hexLin(FT2.val, 0.06))
      .set('scope', o.scopes ?? NO_SCOPES)
      .set('hudGL', o.hudGL ?? 1)
      .set('screenGain', o.screenGain ?? 2.4)
      .set('doorGain', o.doorGain ?? 3)
      .set('skyGain', o.skyGain ?? 0.9)
      .set('spotGain', o.spotGain ?? 6)
      .set('expo', o.expo)
      .set('hole', o.hole ?? -1)
      .set('kick', o.kick ?? 0)
      .set('memOn', o.memOn ?? ALL_ON)
      .set('chase', o.chase ?? NO_CHASE)
      .set('beamGain', o.beamGain ?? 1);
  }
  /** re-light the room (the screens change every frame); call once per frame before draw() */
  relight(o: DrawOpts) {
    const gl = this.g.gl;
    const mem = memories(this.g);
    if (!this.lmProg.use() || !mem.tex || !this.lmap) return;
    gl.disable(gl.BLEND);
    bindTarget(this.g, this.lmap);
    this.common(this.lmProg, o);
    fullscreen(this.g);
  }
  /** draw the hall from `v` into `target` */
  draw(v: View, target: Target, o: DrawOpts) {
    const gl = this.g.gl;
    const mem = memories(this.g);
    bindTarget(this.g, target);
    if (!this.prog.use() || !mem.tex || !this.lmap) return;
    gl.disable(gl.BLEND);
    this.common(this.prog, o);
    this.prog
      .tex('lmap', this.lmap.tex[0], 2)
      .set('res', target.w, target.h)
      .set('eye', v.eye)
      .set('cam', [...v.right, ...v.up, ...v.fwd])
      .set('tanH', v.tanH);
    fullscreen(this.g);
  }
}

const galleries = new WeakMap<Gfx, Gallery>();
export function gallery(g: Gfx): Gallery {
  let x = galleries.get(g);
  if (!x) galleries.set(g, (x = new Gallery(g)));
  return x;
}

// --- silent mode (no RenderResult): read the patterns straight from the module, so the HUD still
// shows the real song. With sound the render's own track data is used (RenderResult.track).
let devTrackP: Promise<TrackInfo | null> | null = null;
function devTrack(): Promise<TrackInfo | null> {
  return (devTrackP ??= (async () => {
    try {
      const url = new URLSearchParams(location.search).get('xm') ?? '/music/effaced.xm';
      const [{ readXm }, r] = await Promise.all([import('../music/xm/xm.ts'), fetch(url)]);
      if (!r.ok) return null;
      const xm = readXm(new Uint8Array(await r.arrayBuffer()));
      return {
        title: xm.name,
        channels: xm.channels,
        order: xm.order,
        patterns: xm.patterns.map((p) => ({ rows: p.rows, cells: p.cells })),
        instruments: xm.instruments.map((i) => i.name),
        posTime: [],
        duration: 0,
        tail: 0,
      };
    } catch (e) {
      console.warn('[S04] no track for the HUD', e);
      return null;
    }
  })());
}

// --- the drums of 07–08 as onset times: from the render, from the module (dev, silent), or the groove
// as written (NOTES §2: kick x.....x.x.x....., snare on 2 and 4 with fills, ride in 8ths, crash and
// orchestra hit on 07:00, crash on 08:00)
const G0 = 7 * 64, G1 = 9 * 64;
const FALLBACK: Record<number, number[]> = {
  1: Array.from({ length: 8 }, (_, b) => [0, 6, 8, 10].map((r) => G0 + b * 16 + r)).flat(),
  2: [...Array.from({ length: 8 }, (_, b) => [4, 12].map((r) => G0 + b * 16 + r)).flat(), G0 + 27, G0 + 28, ...[56, 57, 58, 59, 60, 61, 62, 63].map((r) => G0 + 64 + r)],
  3: Array.from({ length: 64 }, (_, i) => G0 + i * 2),
  4: [G0, G0 + 64],
  16: [G0],
};
type Drums = Record<number, number[]>;
function drumsFrom(audio: FrameCtx['audio'], track: TrackInfo | null): Drums {
  // the pattern data is the cheapest exact source (a few hundred cells); the render's note list only
  // when there is no track
  const out: Drums = {};
  const tr = track ?? audio?.track ?? null;
  for (const ch of [1, 2, 3, 4, 16]) {
    let t: number[] = [];
    if (tr)
      for (let g = G0; g < G1; g++) {
        const pat = tr.patterns[tr.order[g >> 6]];
        const c = pat?.cells[(g & 63) * tr.channels + ch - 1];
        if (c && c.note > 0 && c.note < 97) t.push(g * ROW);
      }
    else if (audio) t = audio.notes.filter((n) => n.ch === ch && n.grow >= G0 && n.grow < G1).map((n) => n.t);
    out[ch] = t.length ? t : FALLBACK[ch].map((r) => r * ROW);
  }
  return out;
}
/** index of the last time ≤ t (−1 if none) */
function lastAt(times: number[], t: number) {
  let lo = 0, hi = times.length - 1, r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (times[m] <= t) (r = m), (lo = m + 1);
    else hi = m - 1;
  }
  return r;
}
const pulse = (times: number[], t: number, decay: number) => {
  const i = lastAt(times, t);
  return i < 0 ? 0 : Math.exp(-(t - times[i]) / decay);
};

// --- S04 camera. S03 leaves at speed, so we come in through the entrance at speed (free start),
// shed it in the first bar while the six tubes switch on, one per drum hit; bars 2–4 truck along the
// memories with whip-pans on the bar lines; on 08:00 (crash, the ghost's A) a whip round to the
// tracker and an orbit until its whole screen fills the frame (08:16); 08:32 is the one still bar,
// then the snare roll pushes in to the diary and the cut. Keys: [seconds into the cue, x, y, z].
const BAR = 16 * ROW;
export const EYE = [
  [0.0, 0.1, 1.3, 4.6],
  [0.55, 0.45, 1.42, 1.5],
  [1.92, 1.25, 1.62, -0.7],
  [3.84, 1.7, 1.72, -5.6],
  [5.76, 1.75, 1.75, -10.4],
  [7.4, 1.75, 1.8, -14.6],
  [8.6, 1.65, 2.3, -11.6],
  [9.6, 1.2, 2.55, -8.8],
  [11.52, 1.05, 2.55, -8.78],
  [13.44, 0.98, 2.56, -8.8],
  [15.36, -0.4, 3.05, -10.05],
];
interface Shot {
  t: number; // the whip lands here (on a bar line)
  whip: number; // its length, ending at t
  aim: (τ: number, eye: number[]) => number[];
}
const SHOTS: Shot[] = [
  { t: 0, whip: 0, aim: (τ) => [0.9 + 0.3 * τ, 1.8, -20] }, // down the hall, the tubes switching on
  { t: BAR, whip: 0.26, aim: (τ, e) => [3.6, 2.0, e[2] - 1.5] }, // 07:16 onto the memories
  { t: 2 * BAR, whip: 0.2, aim: (τ, e) => [3.6, 2.05, e[2] + 0.35] }, // 07:32 turn to watch one pass
  { t: 3 * BAR, whip: 0.2, aim: (τ, e) => [3.6, 2.0, e[2] - 1.5] }, // 07:48 ahead again
  // 08:00 the whip round to the tracker (the ghost's A, the crash), an orbit until the FastTracker
  // screen fills the frame on 08:16: the diary top right, the busy channels, the ghost's scope
  { t: 4 * BAR, whip: 0.3, aim: (τ) => { const k = smoothstep(4 * BAR, 5 * BAR, τ); return [-3.6, 2.4 + 0.15 * k, -9.4 + 0.66 * k]; } },
  // 08:32 the still bar (channel 17 scrolls in at the right of the pattern editor), then the
  // snare roll pushes in towards the diary
  { t: 6 * BAR, whip: 0, aim: (τ) => { const k = smoothstep(7 * BAR, 8 * BAR, τ); return [-3.6, 2.55 + 1.3 * k, -8.74 - 1.8 * k]; } },
];
const norm3 = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
function slerp3(a: number[], b: number[], k: number) {
  const c = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const th = Math.acos(c);
  if (th < 1e-4) return norm3(a.map((v, i) => v + (b[i] - v) * k));
  const s = Math.sin(th);
  return a.map((v, i) => (Math.sin((1 - k) * th) * v + Math.sin(k * th) * b[i]) / s);
}
/** looking direction at τ: the current shot's aim, whipped in from the previous one */
function lookDir(τ: number, eye: number[]): number[] {
  let i = 0;
  while (i + 1 < SHOTS.length && τ >= SHOTS[i + 1].t - SHOTS[i + 1].whip) i++;
  const dir = (k: number) => norm3(sub(SHOTS[k].aim(τ, eye), eye));
  const sh = SHOTS[i];
  if (i === 0 || τ >= sh.t || sh.whip === 0) return dir(i);
  const u = (τ - (sh.t - sh.whip)) / sh.whip;
  const e = u * u * u * (u * (u * 6 - 15) + 10); // smootherstep: fast in the middle, lands soft on the beat
  return slerp3(dir(i - 1), dir(i), e);
}

export function createGallery(g: Gfx): Scene {
  const mem = memories(g);
  const gal = gallery(g);
  let hud: TrackerHud | null = null;
  let active = false;
  let track: TrackInfo | null = null;
  let trackSrc: unknown = undefined;
  let drums: Drums | null = null;
  let drumsSrc: unknown = undefined;
  /** when each tube switches on (s into the cue): the first six drum hits */
  let onAt = [0, 0.48, 0.72, 0.96, 1.2, 1.44];
  let crash = 0;

  const ensureHud = () => (hud ??= new TrackerHud(HUD_W_M, HUD_H_M));
  let dbgView: View | null = null; // dev: __s04.look([x,y,z], [x,y,z]) pins the camera
  if (import.meta.env.DEV)
    (window as unknown as Record<string, unknown>).__s04 = {
      gal,
      mem,
      hud: () => hud,
      look: (eye: number[] | null, aim: number[]) => (dbgView = eye ? lookAt(eye, aim, 50) : null),
      camera: (τ: number) => camera(τ, 0),
    };

  const placeHud = (h: TrackerHud, v: View) =>
    h.place(viewMatrix(v), 2 * Math.atan(v.tanH), [-HALL.HW, (HUD_RECT.Y0 + HUD_RECT.Y1) / 2, (HUD_RECT.Z0 + HUD_RECT.Z1) / 2], [0, 0, -1], [0, 1, 0]);

  /** the camera at τ (s into the cue); sn: snare pulse for the micro-shake (as in S03) */
  function camera(τ: number, sn: number): View {
    const eye = path(EYE, τ, true);
    const d = lookDir(τ, eye);
    // bank into the whips: roll follows the yaw rate
    const d2 = lookDir(τ + 0.01, path(EYE, τ + 0.01, true));
    const yawRate = (Math.atan2(d2[0], -d2[2]) - Math.atan2(d[0], -d[2])) / 0.01;
    const roll = Math.max(-0.12, Math.min(0.12, -0.022 * (Math.abs(yawRate) < 20 ? yawRate : 0)));
    const shake = sn * 0.004;
    const aim = [
      eye[0] + d[0] * 4 + Math.sin(τ * 91.7) * shake * 4,
      eye[1] + d[1] * 4 + Math.sin(τ * 77.1 + 1) * shake * 4,
      eye[2] + d[2] * 4,
    ];
    // a wider lens while we rush in, the normal one once inside
    const fov = 50 + 9 * Math.exp(-τ / 0.5);
    return lookAt(eye, aim, fov, roll);
  }

  return {
    id: 'S04',
    title: 'Gallery',
    // the crash on 08:00 (and the street light at 07:00) flashes the exposure
    post: () => ({ bloom: 0.1, bloomRadius: 1.1, vignette: 0.42, grain: 0.04, exposure: 0.7 * crash }),
    programs: () => [...mem.programs(), ...gal.programs()],
    init() {
      mem.init();
      gal.init();
      const h = ensureHud(); // build the DOM while the loader runs, not at the cut
      // read the song in the loader too (the render's track arrives only after it), then lay out and
      // raster the screen as it will be at 07:00 — the first S04 frame then costs only its own work
      devTrack().then((t) => {
        if (!t || active) return;
        if (!track) track = t;
        h.setTrack(t);
        const v = camera(0, 0);
        h.prime({ pos: 7, row: 0, rowT: 1, t: G0 * ROW }, () => placeHud(h, v));
      });
    },
    enter() {
      active = true;
      const h = ensureHud();
      h.setTrack(track);
      h.show(true);
    },
    leave() {
      active = false;
      hud?.show(false);
    },
    render(f: FrameCtx, hdr: Target | null) {
      const τ = f.local;

      // the song for the HUD: the real render, or (dev, silent) the module itself
      const src = f.audio?.track ?? null;
      if (src !== trackSrc) {
        trackSrc = src;
        track = src;
        if (!src)
          devTrack().then((t) => {
            if (trackSrc === null && t) {
              track = t;
              hud?.setTrack(t);
            }
          });
        else hud?.setTrack(track);
      }
      // the drums
      const dsrc = f.audio ?? track;
      if (!drums || dsrc !== drumsSrc) {
        drumsSrc = dsrc;
        drums = drumsFrom(f.audio, track);
        const t0 = G0 * ROW;
        const first = [...drums[1], ...drums[2]].filter((t) => t >= t0 - 1e-3).sort((a, b) => a - b).slice(0, 6);
        if (first.length === 6) onAt = first.map((t) => Math.max(0, t - t0));
      }
      const kickP = pulse(drums[1], f.t, 0.13);
      const snareP = pulse(drums[2], f.t, 0.11);
      const rideP = pulse(drums[3], f.t, 0.09);
      crash = Math.max(pulse(drums[4], f.t, 0.3), pulse(drums[16], f.t, 0.3));
      const k = lastAt(drums[1], f.t);
      const chase = [0, 1, 2, 3].map((j) => (k - j >= 0 ? f.t - drums![1][k - j] : -1));

      mem.update(f.t, f.jumped, kickP);
      const v = dbgView ?? camera(τ, snareP);
      // stepping in from the bright street: the eye adapts within the first beats
      const expo = 1 + 2.6 * Math.exp(-τ / 0.35);

      if (active && hud) {
        placeHud(hud, v);
        const row = Math.floor(f.prow);
        hud.update({ pos: f.pos, row, rowT: (f.prow - row) * ROW, t: f.t });
        hud.setOpacity(1);
        // the DOM follows the GL exposure: eye adaptation and the crash flashes
        hud.setBrightness((1 + (expo - 1) * 0.3) * 2 ** (0.7 * crash * 0.6));
        hud.setPulse(rideP);
        // the same lilac air the GL puts in front of everything (fogT in s04-gallery.glsl)
        const yc = (HUD_RECT.Y0 + HUD_RECT.Y1) / 2;
        const fog = (z: number) => 1 - Math.exp(-0.016 * Math.hypot(v.eye[0] + HALL.HW, v.eye[1] - yc, v.eye[2] - z));
        hud.setFog(fog(HUD_RECT.Z0), fog(HUD_RECT.Z1));
      }
      hud?.updateScopes(f.t, f.audio ? f.S : null);
      if (hud?.bake(f.t)) gal.uploadHud(hud.pixels);

      const o: DrawOpts = {
        t: f.t,
        expo,
        kick: 0.8 * kickP + 0.5 * snareP,
        hudGL: 1,
        memOn: onAt.map((t) => τ - t),
        chase,
        beamGain: 1 + 1.6 * snareP + 0.4 * crash,
        scopes: hud?.scopes,
      };
      gal.relight(o);
      gal.draw(v, hdr!, o);
    },
  };
}

export default createGallery;
