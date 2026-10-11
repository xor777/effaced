// S12 · Canvas (PLAN §4, §8): the lift E → F, the FACADE theme in lydian. The <canvas> itself shrinks
// into a window and turns in CSS 3D — flat, zero thickness: the screen is a facade too.
//
// What happens inside it is the butterfly effect, 65536 + 1. Lorenz found sensitivity to initial
// conditions by rounding 0.506127 to 0.506; here 65536 particles start on a line 1/65536 of the
// attractor long — one point of light — and the Lorenz flow pulls that difference apart until it no
// longer fits in the canvas. The butterfly is never drawn: it is what the chaos leaves once it has
// filled the attractor. The particles are an offset each from a reference trajectory the CPU carries in
// double precision (the offsets obey the exact difference flow), drawn as the thread through them in
// their order, its colour running along it (#ACCEDE → #DECADE → #FACADE): stretched, the gradient
// stretches; folded, the colours interleave. And one more — the +1, warm, with a long trail: the one
// that did not fit. The camera follows the ensemble, magnified at first, and pulls back as it spreads.
//
// The music drives every move (onsets from s12-s13-cues.ts, the same with and without sound): the
// attractor's own time lurches forward on every kick and hit — the thread stretches and folds in jolts
// and eases between them.
//   18:00  orchestra hit F, the tonic lifts: the full-screen canvas snaps into a window (a spring) and
//          leaves its own frame behind as an afterimage on the outside layer; from now on it stands on
//          a mirror (-webkit-box-reflect: its reflection turns with it) and its border glows; inside,
//          one point — it becomes a short line within the bar;
//   bars   each crash is a gesture of the window (a whip at 18:16, a swing at 18:32, a full turn at 18:48,
//          a punch towards us on the orchestra hit of 19:00), and the window's fast moves leave afterimage
//          frames; the line grows, turns, bends (18:48), and on 19:00 jumps into loops;
//   19:16  the inhale (snare and timpani roll): the flow races, the thread folds and mixes until both
//          wings are filled — only now the butterfly reads — and it presses on the canvas's edges, which
//          light up where it touches (S01: the creature shows at the edges);
//   19:32  the burst: the canvas flashes, the +1 leads the particles out through the frame, white-hot,
//          shock rings and a flash on the outside, the stage shakes; they cool into colour on the Thomas
//          attractor;
//   19:44  they land on the sigil (S13's first frame).
//
// Both contexts run the same offsets in lock-step from 18:00 (65536 particles: cheap), so at the burst
// a particle leaves one canvas and appears in the other at the same place. The outside is projected with
// the stage's own CSS perspective and the canvas's own matrix3d, so the two layers line up exactly
// (checked against getBoundingClientRect). Everything the launch depends on (inner camera, the window)
// is a pure function of song time.

import { type Gfx, type Program, type Target, createGfx, program, ensureTarget, bindTarget, fullscreen, PingPong } from '../gfx/gl.ts';
import type { Scene, FrameCtx } from './types.ts';
import { markerTimes, hit, smoothstep } from '../timeline/events.ts';
import { ROW, ROWS } from '../timeline/script.ts';
import { sigilTables, SIGIL_FULL } from '../audio/synth/scope.ts';
import { SIGIL_R, SIGIL_COL, BANDS, p3 } from './s13-erasure.ts'; // same sigil size and light, same banded splatting
import { cues, pulse, swell, type Cues, type Ev } from './s12-s13-cues.ts';

const TW = 256; // the thread: 256 × 256 = 65536 particles (the +1 rides on the CPU)
const OW = 1024, OH = 512; // the outside: 524288 particles, 8 along every segment of the thread
const PER = (OW * OH) / (TW * TW);
const RATE = 60; // simulation steps per second of song time (both contexts) — the scene runs at 60 Hz
const HSUB = 0.008, MAXSUB = 24; // attractor time per RK4 substep, substeps per pass
const ATTR = 45; // the attractor's extent (Lorenz units)
const R0 = ATTR / 65536; // half-length of the starting line: 1/65536 of the attractor
const CA = [0, 0, 24.5]; // the attractor's centre
const FRAME_K = 0.072; // canvas units per Lorenz unit with the whole attractor in view
const THOMAS_B = 0.2, THOMAS_H = 3.2 / RATE; // Thomas: dissipation b, attractor time per step
const THOMAS_AT = [0, 0.02, -0.3, 0.2]; // its centre in the stage (H units) and its scale (H per unit)
const P18 = 0x18 * ROWS, P1A = 0x1a * ROWS;
const T0 = P18 * ROW;
const rowT = (r: number) => T0 + r * ROW;

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeIn = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x);
const easeOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) ** 3);
/** 0 → 1 with one overshoot (x in units of the move's length) */
const spring = (x: number) => (x <= 0 ? 0 : x >= 3 ? 1 : 1 - Math.exp(-4.5 * x) * Math.cos(5.5 * x));

// ---- 4×4 column-major
type M4 = number[];
const mul = (a: M4, b: M4): M4 => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const tr = (x: number, y: number, z: number): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const sc = (x: number, y: number, z: number): M4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const rx = (a: number): M4 => [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1];
const ry = (a: number): M4 => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
const rz = (a: number): M4 => [Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const app = (m: M4, v: number[]) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);

// ---- the window's poses: [scale, rotateX°, rotateY°, rotateZ°, x, y, z (H units, y up)], entered at a row
// with a curve over a number of rows. CSS: translate · rotateY · rotateX · rotateZ · scale.
type Pose = number[];
const IDENT: Pose = [1, 0, 0, 0, 0, 0, 0];
const POSES: { row: number; dur: number; k: (x: number) => number; p: Pose }[] = [
  { row: 0, dur: 5, k: spring, p: [0.62, 6, -14, 2, 0, 0, 0] }, // 18:00 the canvas becomes a window
  { row: 16, dur: 4, k: spring, p: [0.6, 4, -40, 6, 0.06, 0, -0.04] }, // whip
  { row: 32, dur: 4, k: spring, p: [0.6, -9, 36, -6, -0.12, 0.02, 0] }, // swing back, aside
  { row: 48, dur: 13, k: ease, p: [0.62, 3, 350, 0, 0, 0, 0.04] }, // a full turn
  { row: 64, dur: 4, k: spring, p: [0.65, 4, 366, 2, 0, 0, 0.06] }, // (the punch is an accent)
  { row: 80, dur: 16, k: easeIn, p: [0.5, 2, 360, -8, 0, 0.01, -0.5] }, // the inhale: away from us
  { row: 96, dur: 2.5, k: spring, p: [0.66, 0, 360, 0, 0, 0, 0.1] }, // the burst: slammed to the front
  { row: 99, dur: 13, k: easeOut, p: [0.58, 10, 432, 5, 0.08, 0, -0.25] }, // emptied, it turns away
  { row: 112, dur: 14, k: ease, p: [1, 0, 360, 0, 0, 0, 0] }, // back to the screen, dark (S13 at identity)
];

// ---- the start: a point on the attractor and the direction a line through it will stretch along
type V3 = [number, number, number];
const lorenz = (p: V3): V3 => [10 * (p[1] - p[0]), p[0] * (28 - p[2]) - p[1], p[0] * p[1] - (8 / 3) * p[2]];
const rk4 = (p: V3, h: number): V3 => {
  const ad = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const k1 = lorenz(p), k2 = lorenz(ad(p, k1, h / 2)), k3 = lorenz(ad(p, k2, h / 2)), k4 = lorenz(ad(p, k3, h));
  return [0, 1, 2].map((i) => p[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])) as V3;
};
let START: { p0: V3; e: V3; plus: V3 } | null = null;
/** deterministic: (1, 1, 20) settled for 50 time units; the direction a small offset grows most along
 *  over the next 1.5 (power iteration on JᵀJ of the flow map); the +1 just past the line's end */
const start = () =>
  (START ??= (() => {
    let p0: V3 = [1, 1, 20];
    for (let i = 0; i < 10000; i++) p0 = rk4(p0, 0.005);
    const run = (q: V3) => {
      for (let i = 0; i < 300; i++) q = rk4(q, 0.005);
      return q;
    };
    const base = run(p0), eps = 1e-7;
    const J = [0, 1, 2].map((j) => {
      const q = [...p0] as V3;
      q[j] += eps;
      const r = run(q);
      return [0, 1, 2].map((i) => (r[i] - base[i]) / eps);
    });
    let e: number[] = [1, 0.3, 0.2];
    for (let it = 0; it < 40; it++) {
      const w = [0, 1, 2].map((i) => J[0][i] * e[0] + J[1][i] * e[1] + J[2][i] * e[2]);
      const v = [0, 1, 2].map((j) => J[j][0] * w[0] + J[j][1] * w[1] + J[j][2] * w[2]);
      const n = Math.hypot(...v);
      e = v.map((x) => x / n);
    }
    const f = lorenz(p0), fn = Math.hypot(...f);
    const k = 1 + 2 / 65536;
    const plus: V3 = [0, 1, 2].map((i) => p0[i] + e[i] * R0 * k + (f[i] / fn) * R0 * 0.4) as V3;
    return { p0, e: e as V3, plus };
  })());

interface Ctx {
  g: Gfx;
  sim: Program;
  splat: Program;
  tone: Program;
  out?: Program;
  thomas?: Program;
  /** the 65536 offsets */
  thread: PingPong;
  outer?: PingPong;
  home?: PingPong;
  /** the Thomas homes settled once: a reset is a copy, not a burn-in */
  seedHome: Target | null;
  hist: Target | null;
  /** nothing splatted since the last clear */
  empty: boolean;
  acc: number;
  W: number;
}

export function createCanvas(g: Gfx): Scene {
  const gl = g.gl;
  // ---- the outside: a second full-screen canvas over the stage, additive
  const oc = document.createElement('canvas');
  oc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;pointer-events:none;mix-blend-mode:plus-lighter';
  const stage = g.canvas.parentElement;
  stage?.insertBefore(oc, g.canvas.nextSibling);
  const g2 = createGfx(oc);
  const gl2 = g2.gl;

  const make = (gg: Gfx, outside: boolean): Ctx => ({
    g: gg,
    sim: program(gg, 'scenes/s12-sim'),
    splat: program(gg, 'scenes/s12-splat', outside ? 'scenes/s12-out.vert' : 'scenes/s12-in.vert'),
    tone: program(gg, 'scenes/s12-tone'),
    out: outside ? program(gg, 'scenes/s12-out') : undefined,
    thomas: outside ? program(gg, 'scenes/s12-thomas') : undefined,
    thread: new PingPong({ formats: [gg.gl.RGBA32F], filter: gg.gl.NEAREST }),
    outer: outside ? new PingPong({ formats: [gg.gl.RGBA32F, gg.gl.RGBA32F], filter: gg.gl.NEAREST }) : undefined,
    home: outside ? new PingPong({ formats: [gg.gl.RGBA32F], filter: gg.gl.NEAREST }) : undefined,
    seedHome: null,
    hist: null,
    empty: false,
    acc: 0,
    W: 1,
  });
  const A = make(g, false); // the canvas
  const B = make(g2, true); // the outside
  let sigTex: WebGLTexture | null = null;
  let sigN = 0;
  let trailTex: WebGLTexture | null = null;
  const TRAIL = 256; // the +1's trail: its path over the last TRAIL·DTR of attractor time (~ a loop round a wing)
  const DTR = 0.0025;
  const trailData = new Float32Array(TRAIL * 4);
  let steps_ = -1; // simulation steps done (both contexts), -1 = needs a reset
  let pristine = false; // the state is the start (0 steps), as the warm-up leaves it
  let warmed = false;
  let active = false;
  let wasOutside = false;
  let dH = 2000 / 945; // CSS perspective in stage heights
  let Hcss = 945;
  const pal = {
    // the thread, by the place on the starting line: the hex words, their saturation pushed (they are pastels)
    thread: [p3('#ACCEDE'), p3('#DECADE'), p3('#FACADE')].map((c) => {
      const y = 0.229 * c[0] + 0.692 * c[1] + 0.079 * c[2];
      return c.map((x) => Math.max(0, y + (x - y) * 3) * 2.2);
    }),
    plus: [1.0, 0.5, 0.2],
    // outside, round the Thomas lobes: magenta, #FACADE gold, cyan, violet (saturated P3)
    out: [[1.0, 0.12, 0.55], [1.0, 0.62, 0.22], [0.05, 0.72, 0.95], [0.48, 0.16, 1.0]],
    heat: [1.6, 1.5, 1.35],
    sigil: SIGIL_COL,
  };
  const BG = [p3('#24152E').map((x) => x * 0.6), p3('#0B0710').map((x) => x * 0.6)];
  // dev knobs (globalThis.__s12)
  const dev = { ref: 60, expo: 1.0, gain: 1.0, plusGain: 1.0, edge: 0.7, yaw: -0.8, pitch: 0.3, depthK: 0.6, land: 2.4 };
  if (import.meta.env.DEV) (globalThis as unknown as { __s12: typeof dev }).__s12 = dev;
  const FRAME = p3('#FACADE');

  // ---- music
  interface Plan {
    c: Cues;
    hit: number;
    land0: number;
    land1: number;
    /** pose transitions (times) and the value each one starts from */
    poseT: number[];
    poseFrom: Pose[];
    /** hits inside the scene (crash + orchestra), for the inner camera's whips */
    whips: Ev[];
    /** the attractor's time lurches: kicks, and the hits (orchestra hit of 19:00 the biggest) */
    kicks: Ev[];
    jolts: { t: number; a: number }[];
    stab64: number;
  }
  let memo: { audio: FrameCtx['audio']; p: Plan } | null = null;
  const plan = (audio: FrameCtx['audio']): Plan => {
    if (memo && memo.audio === audio) return memo.p;
    const c = cues(audio);
    const tHit = markerTimes(audio, 'D-4', P18, P1A, [P18 + 96])[0];
    // the crashes of the scene, by row (a missing one falls back to its written row)
    const inS = (e: Ev) => e.t >= T0 - 1e-3 && e.t < P1A * ROW - 1e-3;
    const crash = c.crash.filter(inS);
    const near = (row: number) => crash.find((e) => Math.abs(e.t - rowT(row)) < 2.5 * ROW)?.t ?? rowT(row);
    const poseT = POSES.map((k) => (k.row % 16 === 0 && k.row < 112 ? near(k.row) : rowT(k.row)));
    poseT[6] = tHit; // the burst
    poseT[7] = tHit + 3 * ROW;
    const poseFrom: Pose[] = [];
    let cur = IDENT;
    POSES.forEach((k, i) => {
      if (i > 0) {
        const q = POSES[i - 1];
        const x = q.k((poseT[i] - poseT[i - 1]) / (q.dur * ROW));
        cur = poseFrom[i - 1].map((v, j) => v + (q.p[j] - v) * x);
      }
      poseFrom.push(cur);
    });
    const merged: Ev[] = [];
    for (const e of [...crash, ...c.stab.filter(inS)].sort((a, b) => a.t - b.t)) {
      const last = merged[merged.length - 1];
      if (last && e.t - last.t < 0.03) last.v = Math.max(last.v, e.v);
      else merged.push({ ...e });
    }
    const stab64 = near(64);
    const before = (e: Ev) => e.t >= T0 - 1e-3 && e.t < tHit - 1e-3;
    const jolts = merged.filter(before).map((e) => ({ t: e.t, a: Math.abs(e.t - stab64) < 0.05 ? 2.0 : e.t < T0 + 0.05 ? 0.6 : 0.8 }));
    for (const e of c.snare.filter((e) => e.t >= rowT(79.5) && e.t < tHit - 1e-3)) jolts.push({ t: e.t, a: 0.05 * e.v });
    jolts.sort((a, b) => a.t - b.t);
    const p: Plan = {
      c,
      hit: tHit,
      land0: rowT(108),
      land1: rowT(126),
      poseT,
      poseFrom,
      whips: merged.filter((e) => e.t > T0 + 0.01 && e.t < tHit - 0.01),
      kicks: c.kick.filter(before),
      jolts,
      stab64,
    };
    memo = { audio, p };
    return p;
  };

  /** the inhale 19:16–19:31 */
  const inhaleAt = (p: Plan, t: number) => easeIn((t - rowT(80)) / (p.hit - rowT(80))) * (t < p.hit ? 1 : 0);
  /**
   * The attractor's own time at song time t: a slow drift, a lurch on every kick and a bigger one on
   * every hit (each eases in over a fraction of a second), and in the inhale it races. Lorenz's
   * Lyapunov exponent is ≈ 0.9: ~10 units take the line from 1/65536 to the whole attractor (19:16),
   * the inhale's ~5 more fold it until it fills both wings.
   */
  const tauAt = (p: Plan, t: number) => {
    if (t <= T0) return 0;
    let s = 0.28 * (t - T0);
    for (const e of p.kicks) {
      if (e.t > t) break;
      s += 0.11 * e.v * (1 - Math.exp(-(t - e.t) / 0.07));
    }
    for (const e of p.jolts) {
      if (e.t > t) break;
      s += e.a * (1 - Math.exp(-(t - e.t) / 0.22));
    }
    const t80 = rowT(80);
    if (t > t80) s += t < p.hit ? 4.2 * easeIn((t - t80) / (p.hit - t80)) : 4.2 + 2 * (t - p.hit);
    return s;
  };
  const stepT = (k: number) => T0 + k / RATE;

  // ---- the CPU's half: the reference trajectory and the +1 in double precision, and 16 sample particles
  // along the line (the ensemble's centre and extent, for the camera) — history per step, so the camera
  // at any step is a pure function of it
  const MAXSTEPS = Math.ceil((P1A * ROW - T0) * RATE) + 16;
  const NSAMP = 16;
  const refH = new Float64Array(3 * MAXSTEPS), plusH = new Float64Array(3 * MAXSTEPS), cenH = new Float64Array(3 * MAXSTEPS), extH = new Float64Array(MAXSTEPS);
  const dirH = new Float64Array(3 * MAXSTEPS); // the line's direction (first sample → last)
  let cpuK = -1;
  let ref: V3 = [0, 0, 0], plus: V3 = [0, 0, 0];
  let samp: V3[] = [];
  const refs = new Float32Array(3 * (2 * MAXSUB + 1));
  // the +1 and the reference at every substep (τ, positions): the +1's trail is resampled from these at
  // even steps of τ, smooth however fast the flow runs
  const SUBMAX = MAXSTEPS * MAXSUB + 1;
  const subT = new Float64Array(SUBMAX), subP = new Float64Array(3 * SUBMAX), subR = new Float64Array(3 * SUBMAX);
  const refsD = new Float64Array(3 * (MAXSUB + 1)); // this step's reference at its substeps (double)
  const subK = new Int32Array(MAXSTEPS); // substeps recorded up to and including step k
  let nSub = 0, tauNow = 0;
  let camCache: Cam[] = [];
  const pushSub = () => {
    subT[nSub] = tauNow;
    subP.set(plus, 3 * nSub);
    subR.set(ref, 3 * nSub);
    nSub++;
  };
  const record = (k: number) => {
    refH.set(ref, 3 * k);
    plusH.set(plus, 3 * k);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], cen = [0, 0, 0];
    for (const q of samp) for (let i = 0; i < 3; i++) (mn[i] = Math.min(mn[i], q[i])), (mx[i] = Math.max(mx[i], q[i])), (cen[i] += q[i] / NSAMP);
    cenH.set(cen, 3 * k);
    extH[k] = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2], 1e-9);
    const a = samp[NSAMP - 1], b = samp[0];
    const dv = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dl = Math.hypot(...dv) || 1;
    dirH.set(dv.map((x) => x / dl), 3 * k);
  };
  const cpuReset = () => {
    const { p0, e } = start();
    ref = [...p0] as V3;
    plus = [...start().plus] as V3;
    samp = Array.from({ length: NSAMP }, (_, j) => {
      const u = ((j + 0.5) / NSAMP) * 2 - 1;
      return [0, 1, 2].map((i) => p0[i] + e[i] * R0 * u) as V3;
    });
    cpuK = 0;
    record(0);
    nSub = 0;
    tauNow = 0;
    camCache = [];
    pushSub();
    subK[0] = nSub;
  };
  /** step k: the reference at every half substep into `refs` (for the GPU), everything advanced */
  const cpuStep = (p: Plan, k: number) => {
    const dtau = Math.max(0, tauAt(p, stepT(k)) - tauAt(p, stepT(k - 1)));
    const n = dtau > 0 ? Math.min(MAXSUB, Math.max(1, Math.ceil(dtau / HSUB))) : 0;
    const h = n ? dtau / n : 0;
    let r = ref;
    refs.set(r, 0);
    for (let s = 0; s < n; s++) {
      r = rk4(r, h / 2);
      refs.set(r, 3 * (2 * s + 1));
      r = rk4(r, h / 2);
      refs.set(r, 3 * (2 * s + 2));
      refsD.set(r, 3 * s);
    }
    for (let s = 0; s < n; s++) {
      plus = rk4(plus, h);
      ref = at3(refsD, s);
      tauNow += h;
      pushSub();
      for (let j = 0; j < NSAMP; j++) samp[j] = rk4(samp[j], h);
    }
    ref = r;
    cpuK = k;
    subK[k] = nSub;
    record(k);
    return { n, h };
  };
  const at3 = (a: Float64Array, k: number): V3 => [a[3 * k], a[3 * k + 1], a[3 * k + 2]];

  // ---- the inner camera at song time t (its step): follows the ensemble magnified, pulls back as it spreads
  // the share of the canvas the ensemble should fill, by row: a point, a short line, … the whole attractor
  const FILL: [number, number][] = [[0, 0.006], [16, 0.06], [32, 0.13], [48, 0.24], [64, 0.42], [80, 0.75], [88, 1]];
  const fillAt = (r: number) => {
    let i = 0;
    while (i + 1 < FILL.length && r >= FILL[i + 1][0]) i++;
    if (i + 1 >= FILL.length) return 1;
    const [r0, f0] = FILL[i], [r1, f1] = FILL[i + 1];
    return Math.exp(Math.log(f0) + (Math.log(f1) - Math.log(f0)) * ease((r - r0) / (r1 - r0)));
  };
  const innerCam = (p: Plan, t: number) => {
    const k = Math.max(0, Math.min(cpuK, Math.floor((t - T0) * RATE + 1e-6)));
    const l = t - T0;
    // magnification: the ensemble's extent over the last second (so a lurch shows as a lurch, and the
    // camera eases back after it), set against the share it should fill
    let lg = 0, nl = 0;
    for (let j = Math.max(0, k - 60); j <= k; j++) (lg += Math.log(extH[j])), nl++;
    const ext = Math.exp(lg / nl);
    const m0 = Math.max(1, (fillAt((t - T0) / ROW) * ATTR) / ext);
    const mag = m0 * (1 + 0.32 * inhaleAt(p, t)); // the inhale: it presses on the canvas's edges
    const track = smoothstep(1.3, 4, m0);
    const cen = at3(cenH, k), rf = at3(refH, k), pl = at3(plusH, k);
    const c = [0, 1, 2].map((i) => CA[i] + (cen[i] - CA[i]) * track);
    // a slow orbit that ends face-on to the wings at the burst; each hit a whip, alternately left and right
    let whip = 0;
    p.whips.forEach((e, i) => {
      if (e.t <= t) whip += (i % 2 ? -1 : 1) * 0.45 * e.v * (1 - Math.exp(-(t - e.t) / 0.16));
    });
    const yaw = dev.yaw - 0.12 * (p.hit - Math.min(t, p.hit)) + whip;
    const pitch = dev.pitch + 0.05 * Math.sin(l * 0.37);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Rx(pitch) · [x, z, −y] · Rz(yaw), as a GLSL mat3 (column-major)
    const rzm = [cy, sy, 0, -sy, cy, 0, 0, 0, 1];
    const swap = [1, 0, 0, 0, 0, -1, 0, 1, 0];
    const rxm = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
    const m3 = (a: number[], b: number[]) => {
      const o = new Array(9).fill(0);
      for (let cc = 0; cc < 3; cc++) for (let r = 0; r < 3; r++) for (let kk = 0; kk < 3; kk++) o[cc * 3 + r] += a[kk * 3 + r] * b[cc * 3 + kk];
      return o;
    };
    const fixed = m3(rxm, m3(swap, rzm));
    // while it is magnified the camera follows the stretching: the line lies across the view (the flow
    // turns it as it goes round the attractor — the camera turns with it), slowly rolling; it hands over to
    // the fixed view as the ensemble spreads
    const ax = at3(dirH, k);
    const roll = 0.35 * Math.sin(l * 0.6) + whip * 0.6;
    const upc = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const d0 = upc[0] * ax[0] + upc[1] * ax[1] + upc[2] * ax[2];
    let up = upc.map((x, i) => x - d0 * ax[i]);
    const ul = Math.hypot(...up);
    up = up.map((x) => x / ul);
    const fw = [ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]];
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const rr = ax.map((x, i) => cr * x + sr * up[i]), uu = up.map((x, i) => -sr * ax[i] + cr * x);
    // world → view rows (rr, uu, fw), as a column-major mat3
    const follow = [rr[0], uu[0], fw[0], rr[1], uu[1], fw[1], rr[2], uu[2], fw[2]];
    // blend (and re-orthonormalise: Gram–Schmidt on the columns' rows)
    const bl = follow.map((x, i) => fixed[i] + (x - fixed[i]) * track);
    const row = (r: number) => [bl[r], bl[3 + r], bl[6 + r]];
    let r0 = row(0), r1 = row(1);
    const n0 = Math.hypot(...r0);
    r0 = r0.map((x) => x / n0);
    const d01 = r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2];
    r1 = r1.map((x, i) => x - d01 * r0[i]);
    const n1 = Math.hypot(...r1);
    r1 = r1.map((x) => x / n1);
    const r2 = [r0[1] * r1[2] - r0[2] * r1[1], r0[2] * r1[0] - r0[0] * r1[2], r0[0] * r1[1] - r0[1] * r1[0]];
    const rot = [r0[0], r1[0], r2[0], r0[1], r1[1], r2[1], r0[2], r1[2], r2[2]];
    const breath = 1 + 0.12 * pulse(p.c.stab, t, 0.3);
    const focal = 1.02 * (1 + 0.12 * smoothstep(0, 4, l));
    return {
      rot,
      view: [FRAME_K * mag * breath, focal, 4.2, 0],
      ref: [rf[0] - c[0], rf[1] - c[1], rf[2] - c[2]],
      plus: [pl[0] - c[0], pl[1] - c[1], pl[2] - c[2]],
      refAbs: rf,
      c,
      mag,
      track,
    };
  };
  type Cam = ReturnType<typeof innerCam>;
  /** the camera of step k (cached until the next reset) */
  const camAt = (p: Plan, k: number): Cam => (camCache[k] ??= innerCam(p, stepT(k)));
  /** a point relative to the camera's centre (Lorenz units) as camera `ic` shows it (innerView of s12-lib):
   *  false behind the eye */
  const viewOf = (ic: Cam, rel: number[], out: number[]) => {
    const s = ic.view[0], R = ic.rot;
    const x = rel[0] * s, y = rel[1] * s, z = rel[2] * s;
    const qx = R[0] * x + R[3] * y + R[6] * z, qy = R[1] * x + R[4] * y + R[7] * z, qz = R[2] * x + R[5] * y + R[8] * z;
    const den = ic.view[2] - qz;
    if (den < 0.6) return false;
    out[0] = (qx * ic.view[1]) / den;
    out[1] = (qy * ic.view[1]) / den;
    out[2] = qz;
    return true;
  };
  // ---- the canvas's transform at song time t: CSS matrix (px, y down) and plane → stage (H, y up)
  const windowAt = (p: Plan, t: number) => {
    let i = 0;
    while (i + 1 < POSES.length && t >= p.poseT[i + 1]) i++;
    const P = t < p.poseT[0] ? IDENT : p.poseFrom[i].map((v, j) => v + (POSES[i].p[j] - v) * POSES[i].k((t - p.poseT[i]) / (POSES[i].dur * ROW)));
    let [s, ax, ay, az, x, y, z] = P;
    const c = p.c;
    // accents: the kick, the snare, the punch of 19:00, the tremble of the inhale, the recoil of the burst
    const live = t < p.land0 ? 1 : 0;
    s *= 1 + 0.012 * pulse(c.kick, t, 0.08) * live;
    const sn = pulse(c.snare, t, 0.07) * live;
    ax += 1.4 * sn;
    az += 0.8 * sn * (Math.floor(t / (4 * ROW)) % 2 ? 1 : -1);
    const punch = hit(t, p.stab64, 0.04, 0.35);
    z += 0.3 * punch;
    ax += 10 * punch;
    const roll = Math.min(1.5, swell(c.snare, t, 0.1, rowT(79.5))) * (t < p.hit ? 1 : 0);
    ax += 1.6 * roll * Math.sin(t * 83);
    ay += 1.6 * roll * Math.sin(t * 71 + 1);
    az += 1.0 * roll * Math.sin(t * 97 + 2);
    const kick = hit(t, p.hit, 0.02, 0.4);
    z -= 0.3 * kick;
    s -= 0.05 * kick;
    ax += 9 * kick;
    const d = Math.PI / 180;
    const css = mul(tr(x * Hcss, -y * Hcss, z * Hcss), mul(ry(ay * d), mul(rx(ax * d), mul(rz(az * d), sc(s, s, 1)))));
    // plane (H units, y up) → CSS local px (y down) → CSS stage px → stage H units (y up)
    const F = sc(1 / Hcss, -1 / Hcss, 1 / Hcss), Fi = sc(Hcss, -Hcss, Hcss);
    const identity = Math.abs(s - 1) < 1e-4 && Math.abs(ay % 360) < 1e-3 && Math.abs(ax) < 1e-3 && Math.abs(az) < 1e-3 && Math.abs(z) < 1e-4 && Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4;
    return { css, W: mul(F, mul(css, Fi)), identity };
  };

  /** the window's corners on the outside canvas (px), counter-clockwise; null when behind the eye */
  const corners = (W: M4, aspect: number, ow: number, oh: number): number[] | null => {
    const out: number[] = [];
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [X, Y, Z] = app(W, [(u * aspect) / 2, v / 2, 0]);
      const den = dH - Z;
      if (den < 0.1 * dH) return null;
      const k = dH / den;
      out.push(((X * k * 2) / aspect + 1) * 0.5 * ow, (Y * k * 2 + 1) * 0.5 * oh);
    }
    return out;
  };

  const pass = (gg: Gfx, pp: PingPong, w: number, h: number, pr: Program, set: (p: Program) => void) => {
    if (!pr.use()) return;
    pp.ensure(gg, w, h);
    bindTarget(gg, pp.write);
    set(pr);
    fullscreen(gg);
    pp.swap();
  };
  const copy = (gg: Gfx, src: Target, dst: Target) => {
    const gx = gg.gl;
    gx.bindFramebuffer(gx.READ_FRAMEBUFFER, src.fb);
    gx.bindFramebuffer(gx.DRAW_FRAMEBUFFER, dst.fb);
    gx.blitFramebuffer(0, 0, src.w, src.h, 0, 0, dst.w, dst.h, gx.COLOR_BUFFER_BIT, gx.NEAREST);
    gx.bindFramebuffer(gx.READ_FRAMEBUFFER, null);
    gx.bindFramebuffer(gx.DRAW_FRAMEBUFFER, null);
  };
  /** one step of the offsets, in one context (the substeps' reference slice is in `refs`) */
  const threadStep = (c: Ctx, n: number, h: number, reset = false) =>
    pass(c.g, c.thread, TW, TW, c.sim, (pr) => {
      const { e } = start();
      pr.tex('st', c.thread.read.tex[0], 0)
        .set('refs', refs)
        .set('nsub', n)
        .set('h', h)
        .set('reset', reset ? 1 : 0)
        .set('init', e[0], e[1], e[2], R0)
        .set('tW', TW);
    });
  const thomas = (reset = false, h = THOMAS_H) =>
    pass(g2, B.home!, OW, OH, B.thomas!, (p) => p.tex('st', B.home!.read.tex[0], 0).set('h', h).set('b', THOMAS_B).set('reset', reset ? 1 : 0));

  /** back to 18:00: the line at its start in both contexts, the Thomas homes settled (computed once) */
  const resetSim = () => {
    cpuReset();
    for (const c of [A, B]) threadStep(c, 0, 0, true);
    if (!B.seedHome) {
      thomas(true, 0.15);
      for (let i = 0; i < 320; i++) thomas(false, 0.15);
      B.seedHome = ensureTarget(g2, null, OW, OH, { formats: [gl2.RGBA32F], filter: gl2.NEAREST });
      copy(g2, B.home!.read, B.seedHome);
    }
    B.home!.ensure(g2, OW, OH);
    copy(g2, B.seedHome, B.home!.read);
  };

  /** the Thomas attractor turns about the vertical (and a little about x): depth by parallax; whipped at 19:48 */
  const thomasTurn = (p: Plan, t: number) => {
    const a = 0.22 * (t - T0) + 1.2 * easeOut((t - p.hit) / (6 * ROW)) * (t > p.hit ? 1 : 0) + 0.9 * spring((t - rowT(112)) / (4 * ROW)), b = 0.35;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    // Ry(a) · Rx(b), column-major
    return [ca, 0, -sa, sa * sb, cb, ca * sb, sa * cb, -sb, ca * cb];
  };

  const camUniforms = (pr: Program, p: Plan, t: number) => {
    const ic = innerCam(p, t);
    pr.set('iRot', ic.rot).set('iView', ic.view).set('iRef', ic.ref).set('iPlus', ic.plus).set('iRefAbs', ic.refAbs).set('burst', 0.16);
    return ic;
  };

  const outStep = (p: Plan, t: number, reset: boolean) =>
    pass(g2, B.outer!, OW, OH, B.out!, (pr) => {
      camUniforms(pr, p, t);
      pr.tex('st', B.thread.read.tex[0], 0)
        .tex('sq', B.home!.read.tex[0], 1)
        .tex('op', B.outer!.read.tex[0], 2)
        .tex('od', B.outer!.read.tex[1], 3)
        .set('tW', TW)
        .set('oW', OW)
        .set('per', PER)
        .set('W', windowAt(p, t).W)
        .set('tRel', t - p.hit)
        .set('dt', 1 / RATE)
        .set('th', THOMAS_AT)
        .set('thR', thomasTurn(p, t))
        .set('kick', 1.0)
        .set('drag', 0.38)
        .set('reset', reset ? 1 : 0);
    });

  /** histogram (decaying by weights) + splat + tonemap of one context */
  const draw = (c: Ctx, f: FrameCtx, p: Plan, t: number, target: Target | null, decay: number, splatOn: boolean, toneSet: (pr: Program) => void) => {
    const gg = c.g, gx = gg.gl;
    const w = Math.ceil(f.w / 2), h = Math.ceil(f.h / 2);
    const fresh = !c.hist || c.hist.w !== w || c.hist.h !== h;
    c.hist = ensureTarget(gg, c.hist, w, h, { formats: [gx.RGBA32F], filter: gx.LINEAR });
    if (fresh) {
      // mips: the outside's glow, the canvas's lit edges
      gx.bindTexture(gx.TEXTURE_2D, c.hist.tex[0]);
      gx.texParameteri(gx.TEXTURE_2D, gx.TEXTURE_MIN_FILTER, gx.LINEAR_MIPMAP_LINEAR);
    }
    bindTarget(gg, c.hist);
    gx.enable(gx.BLEND);
    // the histogram decays by `decay` per frame through the weights of new splats (W *= 1/decay; the
    // tonemap normalises by the total weight), folded back into the bins only when W gets large — no full
    // RGBA32F read-modify-write every frame
    // (an empty histogram that stays empty — the outside before the burst, drawing only the window's
    // afterimages — needs neither a clear nor mips)
    const idle = !fresh && !splatOn && c.empty;
    const cleared = fresh || decay <= 0;
    if (cleared && !idle) {
      gx.clearColor(0, 0, 0, 0);
      gx.clear(gx.COLOR_BUFFER_BIT);
      c.acc = 0;
      c.W = 1;
      c.empty = true;
    } else if (decay < 1) c.W /= decay;
    if ((c.W > 1e4 || !warmed) && c.tone.use()) {
      // hist *= 1/W (any program will do, its output is ignored; keep the target off its sampler)
      gx.activeTexture(gx.TEXTURE0);
      gx.bindTexture(gx.TEXTURE_2D, c.thread.read.tex[0]);
      gx.blendFunc(gx.ZERO, gx.CONSTANT_ALPHA);
      gx.blendColor(0, 0, 0, 1 / c.W);
      fullscreen(gg);
      c.acc /= c.W;
      c.W = 1;
    }
    if (decay < 1 && splatOn && c.splat.use()) {
      gx.blendFunc(gx.ONE, gx.ONE);
      const ic = camUniforms(c.splat, p, t);
      c.splat.set('aspect', f.aspect).set('soft', c === B ? 1 : 0).set('wgt', c.W);
      gx.bindVertexArray(gg.vao);
      if (c === A) {
        // the thread: its 65536 points, the line through them, and the +1's trail
        c.splat
          .tex('st', A.thread.read.tex[0], 0)
          .tex('trail', trailTex, 1)
          .set('tW', TW)
          .set('tRel', t - p.hit)
          .set('depthK', dev.depthK)
          .set('look', dev.gain, 0.12, 0.2 * pulse(p.c.stab, t, 0.3) + 0.12 * inhaleAt(p, t), dev.plusGain)
          .set('CP', pal.plus);
        pal.thread.forEach((col, i) => c.splat.set(`C${i}`, col));
        // the +1's trail: where the eye saw it — its path at even steps of τ, each point seen by the camera of
        // its own moment (between two steps: the camera of each, blended; its centre rides with the ensemble,
        // taken at the very same τ, or magnified the tail would whip across the canvas). While the camera
        // rides along the +1 only twitches at the line's tip — a short tail; once the camera lets go it draws
        // the loops. Its light (w) fades with age.
        const k = Math.max(0, Math.min(cpuK, Math.floor((t - T0) * RATE + 1e-6)));
        const last = subK[k] - 1, te = subT[last];
        const tauK = (kk: number) => subT[subK[kk] - 1];
        const reach = 0.06 + 0.94 * (1 - ic.track) ** 2;
        const herm = (src: Float64Array, j0: number, j1: number, u: number, hh: number, out: number[]) => {
          const P0 = at3(src, j0), P1 = at3(src, j1);
          if (!(hh > 0)) {
            for (let i = 0; i < 3; i++) out[i] = P0[i];
            return;
          }
          const u2 = u * u, u3 = u2 * u, F0 = lorenz(P0), F1 = lorenz(P1);
          const a0 = 2 * u3 - 3 * u2 + 1, b0 = (u3 - 2 * u2 + u) * hh, a1 = -2 * u3 + 3 * u2, b1 = (u3 - u2) * hh;
          for (let i = 0; i < 3; i++) out[i] = a0 * P0[i] + b0 * F0[i] + a1 * P1[i] + b1 * F1[i];
        };
        let j = last, kq = k, broken = false;
        const P = [0, 0, 0], Rf = [0, 0, 0], rel = [0, 0, 0], v0 = [0, 0, 0], v1 = [0, 0, 0];
        for (let q = TRAIL - 1; q >= 0; q--) {
          const tq = te - (TRAIL - 1 - q) * DTR, o = 4 * q, age = (TRAIL - 1 - q) / (TRAIL - 1) / reach;
          if (tq < 0 || broken || age >= 1) {
            trailData[o + 3] = 0;
            continue;
          }
          while (j > 0 && subT[j] > tq) j--;
          const j1 = Math.min(j + 1, last), hh = subT[j1] - subT[j], u = hh > 0 ? (tq - subT[j]) / hh : 0;
          herm(subP, j, j1, u, hh, P);
          herm(subR, j, j1, u, hh, Rf);
          // the step it happened in, and how far through it
          while (kq > 0 && tauK(kq - 1) >= tq) kq--;
          const span = kq > 0 ? tauK(kq) - tauK(kq - 1) : 0;
          const f = span > 0 ? (tq - tauK(kq - 1)) / span : 1;
          const c1 = kq === k ? ic : camAt(p, kq), c0 = camAt(p, Math.max(0, kq - 1));
          // the camera's centre at τq: CA + (centroid − CA)·track, the centroid as the reference plus its
          // (slowly changing) offset from it
          const tr = c0.track + (c1.track - c0.track) * f;
          for (let i = 0; i < 3; i++) {
            const o0 = cenH[3 * Math.max(0, kq - 1) + i] - refH[3 * Math.max(0, kq - 1) + i], o1 = cenH[3 * kq + i] - refH[3 * kq + i];
            rel[i] = P[i] - (CA[i] + (Rf[i] + o0 + (o1 - o0) * f - CA[i]) * tr);
          }
          if (!viewOf(c1, rel, v1) || (f < 1 && !viewOf(c0, rel, v0))) {
            trailData[o + 3] = 0;
            broken = true;
            continue;
          }
          for (let i = 0; i < 3; i++) trailData[o + i] = f >= 1 ? v1[i] : v0[i] + (v1[i] - v0[i]) * f;
          // a jump (a whip of the camera between two steps) ends it
          if (q < TRAIL - 1 && trailData[o + 7] > 0 && Math.hypot(trailData[o] - trailData[o + 4], trailData[o + 1] - trailData[o + 5]) > 0.3) {
            trailData[o + 3] = 0;
            broken = true;
            continue;
          }
          trailData[o + 3] = 1 - age;
        }
        gx.activeTexture(gx.TEXTURE1);
        gx.bindTexture(gx.TEXTURE_2D, trailTex);
        gx.texSubImage2D(gx.TEXTURE_2D, 0, 0, 0, TRAIL, 1, gx.RGBA, gx.FLOAT, trailData);
        // the points: while the line is short on screen, a strided subset worth as much (65536 blends into
        // a handful of bins serialise: ≈ 10 ms at 18:00)
        const lpx = extH[k] * ic.view[0] * (ic.view[1] / ic.view[2]) * h * 2;
        const stride = lpx < 256 ? Math.min(4096, 2 ** Math.max(0, Math.floor(Math.log2((TW * TW) / (8 * Math.max(1, lpx)))))) : 1;
        c.splat.set('poff', 0, 0).set('mode', 0).set('stride', stride);
        gx.drawArrays(gx.POINTS, 0, (TW * TW) / stride);
        c.splat.set('mode', 1);
        gx.drawArrays(gx.LINES, 0, 2 * (TW * TW - 1));
        // the +1: its trail and its head, a stroke two bins wide
        for (let q = 0; q < 4; q++) {
          c.splat.set('poff', ((q & 1) * 2) / w, ((q >> 1) * 2) / h).set('mode', 2);
          gx.drawArrays(gx.LINES, 0, 2 * (TRAIL - 1));
          c.splat.set('mode', 3);
          gx.drawArrays(gx.POINTS, 0, 1);
        }
        c.acc += TW * TW * 0.6 * c.W;
      } else {
        c.splat
          .tex('op', B.outer!.read.tex[0], 0)
          .tex('od', B.outer!.read.tex[1], 1)
          .tex('sig', sigTex, 2)
          .tex('sq', B.home!.read.tex[0], 3)
          .set('stW', OW)
          .set('sigN', sigN)
          .set('sigR', SIGIL_R)
          .set('dH', dH)
          .set('conv', smoothstep(p.land0, p.land1, t))
          .set('OC', pal.out.flat())
          .set('CS', pal.sigil)
          .set('CH', pal.heat)
          .set('CP', pal.plus)
          .set('heatK', Math.exp(-Math.max(0, t - p.hit) / 0.16))
          .set('settle', smoothstep(0.7, 2.2, t - p.hit));
        // landing on the sigil: points on one thin curve only fight over the same bins — a shrinking
        // random subset (the index order is random along the thread) draws the same picture
        const n = Math.round(OW * OH * (1 - 0.6 * smoothstep(p.land0, p.land1, t)));
        c.splat.set('streak', 0);
        for (let b = 0; b < BANDS; b++) {
          c.splat.set('band', -1 + (2 * b) / BANDS, b === BANDS - 1 ? 2 : -1 + (2 * (b + 1)) / BANDS);
          gx.drawArrays(gx.POINTS, 0, n);
        }
        // the +1 leads the escape: a comet's streak (a line: no round point profile)
        c.splat.set('streak', 1).set('band', -10, 10).set('soft', 0);
        gx.drawArrays(gx.LINES, 0, 2);
        c.acc += n * 0.6 * c.W;
      }
      c.empty = false;
    }
    gx.disable(gx.BLEND);
    if (!idle) {
      gx.bindTexture(gx.TEXTURE_2D, c.hist.tex[0]);
      gx.generateMipmap(gx.TEXTURE_2D);
    }
    // tonemap
    bindTarget(gg, target);
    if (!c.tone.use()) return;
    const ow = target ? target.w : gx.drawingBufferWidth, oh = target ? target.h : gx.drawingBufferHeight;
    c.tone
      .tex('hist', c.hist.tex[0], 0)
      .set('htexel', 1 / w, 1 / h)
      .set('res', ow, oh)
      .set('kNorm', (w * h) / Math.max(1, c.acc))
      .set('mode', c === A ? 0 : 1);
    toneSet(c.tone);
    fullscreen(gg);
  };

  const noGhost = new Float32Array(32);
  return {
    id: 'S12',
    title: 'Canvas',
    fps: 60,
    // the particles are binned one per CSS pixel anyway: tonemap + post at that resolution
    scale: 0.5,
    programs: () => [A.sim, A.splat, A.tone, B.sim, B.splat, B.tone, B.out!, B.thomas!],
    post: (f) => {
      const p = plan(f.audio);
      const blow = Math.max(pulse(p.c.stab, f.t, 0.3), hit(f.t, p.hit, 0.01, 0.3));
      return { bloom: 0.26 + 0.2 * blow, bloomRadius: 1.15, vignette: 0.15, grain: 0.02, exposure: 0.1 + 0.3 * blow, ca: 2.5 * blow, look: [1.1, 1.3, 0, 0] };
    },
    init() {
      const tab = sigilTables()[SIGIL_FULL];
      sigN = tab.x.length - 1;
      const d = new Float32Array(sigN * 2);
      for (let i = 0; i < sigN; i++) (d[2 * i] = tab.x[i]), (d[2 * i + 1] = tab.y[i]);
      sigTex = gl2.createTexture();
      gl2.bindTexture(gl2.TEXTURE_2D, sigTex);
      gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RG32F, sigN, 1, 0, gl2.RG, gl2.FLOAT, d);
      for (const q of [gl2.TEXTURE_MIN_FILTER, gl2.TEXTURE_MAG_FILTER]) gl2.texParameteri(gl2.TEXTURE_2D, q, gl2.NEAREST);
      trailTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, trailTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TRAIL, 1, 0, gl.RGBA, gl.FLOAT, trailData);
      for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.NEAREST);
      start();
    },
    enter() {
      active = true;
      steps_ = -1;
      const st = g.canvas.parentElement!;
      Hcss = st.clientHeight || 945;
      dH = (parseFloat(getComputedStyle(st).perspective) || 2000) / Hcss;
      // the window stands on a mirror: its reflection turns with it (the screen is a facade)
      g.canvas.style.setProperty('-webkit-box-reflect', 'below 0px linear-gradient(transparent 55%, rgba(255,255,255,0.2))');
    },
    leave() {
      active = false;
      g.canvas.style.transform = '';
      g.canvas.style.removeProperty('-webkit-box-reflect');
      if (stage) stage.style.transform = '';
      oc.style.display = 'none';
    },
    render(f: FrameCtx, hdr: Target | null) {
      const t = f.t;
      // a render without enter() is the loader's (or a re-warm's) pipeline warm-up: exercise every pass of
      // both contexts at the current size — above all the outside's, whose histogram, mips and drawing
      // buffer would otherwise be (re)allocated on the cut at 18:00 (≈ 15–20 ms, a dropped frame)
      const warming = !warmed || !active;
      const p = plan(f.audio);
      const c = p.c;
      const tHit = p.hit;

      // ---- the canvas in the stage
      const win = windowAt(p, t);
      if (active) g.canvas.style.transform = win.identity ? '' : `matrix3d(${win.css.map((x) => +x.toFixed(6)).join(',')})`;
      // the burst shakes the whole stage (both layers together, so they stay aligned)
      const shake = (0.012 * hit(t, tHit, 0.004, 0.22) + 0.005 * hit(t, p.stab64, 0.004, 0.18) + 0.003 * pulse(c.stab, t, 0.15)) * Hcss;
      if (active && stage) stage.style.transform = shake > 0.05 ? `translate(calc(-50% + ${(shake * Math.sin(t * 157)).toFixed(2)}px), calc(-50% + ${(shake * Math.sin(t * 131 + 2)).toFixed(2)}px))` : '';
      // the outside at one pixel per CSS pixel, like its histogram (the compositor scales it up)
      const ow = Math.ceil(f.w / 2), oh = Math.ceil(f.h / 2);
      if (oc.width !== ow || oc.height !== oh) (oc.width = ow), (oc.height = oh);

      // ---- simulation, lock-step in both contexts
      const N = Math.max(0, Math.min(MAXSTEPS - 1, Math.floor((t - T0) * RATE + 1e-6)));
      const outFrom = Math.floor((tHit - T0) * RATE) - 2; // the outside's particles start just before the hit
      if (f.jumped || steps_ < 0 || N < steps_ || warming) {
        // (the warm-up leaves the state at the start: the cut at 18:00 needs no reset)
        if (!(pristine && N === 0) || warming) resetSim();
        steps_ = 0;
      }
      if (N > 0) pristine = false;
      const allOut = Math.ceil((tHit + 0.2 - T0) * RATE); // every particle has left the canvas by then
      while (steps_ < N) {
        steps_++;
        const { n, h } = cpuStep(p, steps_);
        if (steps_ <= allOut && n > 0) for (const cx of [A, B]) threadStep(cx, n, h);
        if (steps_ >= outFrom) {
          thomas();
          outStep(p, stepT(steps_), steps_ === outFrom);
        }
      }
      if (warming) outStep(p, t, true); // pipeline warm-up

      // ---- the canvas: particles that have not left yet, a ghost of those that have
      const after = t - tHit;
      const kick = pulse(c.kick, t, 0.1), orch = pulse(c.stab, t, 0.3);
      // light trails: the thread leaves a short wake as it lurches
      const tauA = after > 0 ? 0.25 : 0.07;
      const decayA = f.dt > 0 ? Math.exp(-f.dt / tauA) : 1;
      const fadeA = (1 - smoothstep(tHit + 1.2, p.land0 + 0.5, t)) * (after > 0 ? 0.35 + 0.65 * Math.exp(-after / 0.15) : 1);
      const bgK = 1 - smoothstep(p.land0, p.land1 - 0.3, t);
      const inh = inhaleAt(p, t);
      const flashA = hit(t, tHit, 0.008, 0.07);
      draw(A, f, p, t, hdr, f.jumped || warming ? 0 : decayA, !(t > tHit + 0.25), (pr) =>
        pr
          .set('ref', dev.ref)
          .set('floor_', 0.3)
          .set('expo', dev.expo)
          .set('gain', (1 + 0.25 * kick + 0.4 * orch + 0.4 * inh) * fadeA)
          .set('bgA', BG[0])
          .set('bgB', BG[1])
          .set('bgK', bgK * (1 + 0.6 * orch))
          .set('frame', FRAME.map((x) => x * bgK * (0.5 + 0.8 * kick + 1.5 * orch + 2 * flashA)).concat([(1.5 * (hdr?.h ?? f.h)) / 945]))
          .set('flash', 1, 0.85, 0.95, 2 * flashA)
          .set('edgeK', dev.edge * bgK),
      );

      // ---- the outside: the window's afterimages before the hit, the particles after
      const outside = after > -0.02 || warming;
      const ghost = new Float32Array(32), gI = [0, 0, 0, 0];
      // 0: the full-screen frame the canvas leaves behind at 18:00
      const g0 = 0.9 * Math.exp(-Math.max(0, t - T0) / 0.6) * (t >= T0 ? 1 : 0);
      if (g0 > 0.003) {
        ghost.set([0, 0, ow, 0, ow, oh, 0, oh], 0);
        gI[0] = g0;
      }
      // 1–3: where the window was 1, 2, 3 frames-worth ago — visible only when it moves fast
      const q0 = corners(win.W, f.aspect, ow, oh);
      for (let k = 1; k <= 3 && q0 && t < tHit + 0.1; k++) {
        const q = corners(windowAt(p, t - 0.045 * k).W, f.aspect, ow, oh);
        if (!q) continue;
        let disp = 0;
        for (let j = 0; j < 8; j++) disp = Math.max(disp, Math.abs(q[j] - q0[j]));
        const I = 0.55 * 0.62 ** (k - 1) * smoothstep(0.004, 0.04, disp / oh) * (t > T0 + 0.02 ? 1 : 0);
        if (I > 0.003) {
          ghost.set(q, k * 8);
          gI[k] = I;
        }
      }
      const showOut = outside || gI.some((x) => x > 0);
      if (active) oc.style.display = showOut ? 'block' : 'none';
      if (showOut) {
        const cHit = corners(windowAt(p, tHit).W, f.aspect, ow, oh);
        const cx = cHit ? (cHit[0] + cHit[2] + cHit[4] + cHit[6]) / 4 : ow / 2, cy = cHit ? (cHit[1] + cHit[3] + cHit[5] + cHit[7]) / 4 : oh / 2;
        const ringA = (t0: number, v: number, sp: number) => {
          const x = t - t0;
          return x < 0 ? [cx, cy, 0, 0] : [cx, cy, oh * sp * (1 - Math.exp(-x / 0.35)), v * Math.exp(-x / 0.4)];
        };
        const conv = smoothstep(p.land0, p.land1, t);
        const decayB = f.dt > 0 ? Math.exp(-f.dt / (0.04 + 0.12 * Math.exp(-Math.max(0, after) / 0.5))) : 1;
        const flashB = hit(t, tHit, 0.006, 0.12);
        draw(B, f, p, t, null, f.jumped || warming || !wasOutside || !outside ? 0 : decayB, outside, (pr) =>
          pr
            .set('ref', 160)
            .set('floor_', 0.3)
            .set('expo', 0.75)
            .set('gain', (1 + 0.8 * hit(t, tHit, 0.01, 0.5) + 0.3 * kick + 0.4 * pulse(c.crash, t, 0.3) * (after > 0 ? 1 : 0)) * (1 + dev.land * conv))
            .set('glow', 0.45 - 0.43 * conv, 1.0, 0.25 - 0.05 * conv)
            .set('look', 1.1 - 0.02 * conv, 1.3)
            .set('flash', 1, 0.55, 0.85, 0.7 * flashB)
            .set('ring', [...ringA(tHit, 1.6, 1.4), ...ringA(tHit + 0.07, 0.8, 0.9)])
            .set('ghost', gI.some((x) => x > 0) ? ghost : noGhost)
            .set('ghostI', gI)
            .set('ghostC', FRAME.map((x) => x * 1.4)),
        );
      }
      wasOutside = outside;
      if (warming) {
        // the loader renders this scene once before the hit: make sure every pipeline of the outside exists;
        // then leave everything as the cut at 18:00 wants it — the simulation at its seed, the outside's
        // histogram empty with its mips — so that first frame does only a frame's work
        resetSim();
        steps_ = 0;
        pristine = true;
        bindTarget(g2, B.hist);
        gl2.clearColor(0, 0, 0, 0);
        gl2.clear(gl2.COLOR_BUFFER_BIT);
        gl2.bindTexture(gl2.TEXTURE_2D, B.hist!.tex[0]);
        gl2.generateMipmap(gl2.TEXTURE_2D);
        B.acc = 0;
        B.W = 1;
        B.empty = true;
        wasOutside = false;
        bindTarget(g, hdr);
        warmed = true;
      }
    },
  };
}

export default createCanvas;
