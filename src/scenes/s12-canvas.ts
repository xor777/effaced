// S12 · Canvas (PLAN §4, §8): the lift E → F, the FACADE theme in lydian. The <canvas> itself shrinks
// into a window and turns in CSS 3D — flat, zero thickness: the screen is a facade too. Inside it a
// million particles fly on the Lorenz attractor — the butterfly, wings face-on, an eye-spot of rings on
// each wing round its fixed point. At the strongest accent (D-4, 19:32) they burst out
// of it, past its border, into a second full-screen canvas "outside" (its own WebGL2 context, composited
// with `plus-lighter`), where they swirl on a Thomas attractor wrapped around the canvas; in the last
// bar they settle on the creature's sigil, which S13 grows into a flame.
//
// The music drives every move (onsets from s12-s13-cues.ts, the same with and without sound):
//   18:00  orchestra hit F, the tonic lifts: the full-screen canvas snaps into a window (a spring) and
//          leaves its own frame behind as an afterimage on the outside layer; from now on it stands on
//          a mirror (-webkit-box-reflect: its reflection turns with it) and its border glows;
//   bars   each crash is a gesture of the window (a whip, a swing, a full turn on 18:48, a punch towards
//          us on the orchestra hit of 19:00), and the window's fast moves leave afterimage frames;
//          inside, the cloud morphs on the G/F bars (18:16, 18:48) from the Lorenz butterfly into a
//          Halvorsen — the triangle — in a vortex, and back on the F bars; the inner camera sways on
//          the hits (the wings stay face-on) and rises to look down the axis while the triangle shows;
//          the kick makes it breathe;
//   19:16  the inhale (snare and timpani roll): the window recedes and trembles, the cloud contracts and
//          heats up;
//   19:32  the burst: the canvas flashes, the particles explode out of it white-hot, shock rings and a
//          flash on the outside, the stage shakes; they cool into colour on the Thomas attractor;
//   19:44  they land on the sigil (S13's first frame).
//
// Both contexts start from the same settled cloud. The canvas integrates it all along (RK4, a fixed
// number of steps per second of song time); the outside only wakes up two steps before the hit: a
// settled attractor is a stationary distribution, so its cloud then is the same cloud — a particle
// leaves one canvas and appears in the other in the same picture, without the outside paying for the
// 11 s before. The outside is projected with the stage's own CSS perspective and the canvas's own
// matrix3d, so the two layers line up exactly (checked against getBoundingClientRect). Everything the
// launch depends on (inner camera, breathing, the window) is a pure function of song time.

import { type Gfx, type Program, type Target, createGfx, program, ensureTarget, bindTarget, fullscreen, PingPong } from '../gfx/gl.ts';
import type { Scene, FrameCtx } from './types.ts';
import { markerTimes, hit, smoothstep } from '../timeline/events.ts';
import { ROW, ROWS } from '../timeline/script.ts';
import { sigilTables } from '../audio/synth/scope.ts';
import { SIGIL_R, SIGIL_COL, BANDS, p3 } from './s13-erasure.ts'; // same sigil size and light, same banded splatting
import { cues, pulse, swell, type Cues, type Ev } from './s12-s13-cues.ts';

const NW = 1024, NH = 1024; // 1M particles
const RATE = 60; // simulation steps per second of song time (both contexts) — the scene runs at 60 Hz
const H_BASE = 0.005; // Lorenz time per step
const H_HAL = 0.0045; // Halvorsen time per step
const BURN = 300, H_BURN = 0.01; // settling steps of the Lorenz cloud (once, then kept as a seed)
const BURN_HAL = 400;
const THOMAS_B = 0.2, THOMAS_H = 3.2 / RATE; // Thomas: dissipation b, attractor time per step
const THOMAS_AT = [0, 0.02, -0.3, 0.2]; // its centre in the stage (H units) and its scale (H per unit)
const P18 = 0x18 * ROWS, P1A = 0x1a * ROWS;
const T0 = P18 * ROW;
const rowT = (r: number) => T0 + r * ROW;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
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

interface Ctx {
  g: Gfx;
  sim: Program;
  splat: Program;
  tone: Program;
  out?: Program;
  thomas?: Program;
  inner: PingPong;
  hal?: PingPong;
  outer?: PingPong;
  home?: PingPong;
  /** settled states, computed once: a reset is a copy, not a burn-in (no hitch at 18:00) */
  seed: Target | null;
  seedHal: Target | null;
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
    inner: new PingPong({ formats: [gg.gl.RGBA32F], filter: gg.gl.NEAREST }),
    hal: outside ? undefined : new PingPong({ formats: [gg.gl.RGBA32F], filter: gg.gl.NEAREST }),
    outer: outside ? new PingPong({ formats: [gg.gl.RGBA32F, gg.gl.RGBA32F], filter: gg.gl.NEAREST }) : undefined,
    home: outside ? new PingPong({ formats: [gg.gl.RGBA32F], filter: gg.gl.NEAREST }) : undefined,
    seed: null,
    seedHal: null,
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
  let steps_ = -1; // simulation steps done (both contexts), -1 = needs a reset
  let pristine = false; // the state is the seed (0 steps), as the warm-up leaves it
  let warmed = false;
  let active = false;
  let wasOutside = false;
  let dH = 2000 / 945; // CSS perspective in stage heights
  let Hcss = 945;
  const pal = {
    // inside, by velocity: towards us cyan, away magenta, across violet; fast #FACADE, white-hot
    in: [[0.05, 0.55, 1.0], [1.0, 0.08, 0.45], [0.42, 0.1, 0.95], p3('#FACADE'), [1.0, 0.96, 0.92]],
    // outside, round the Thomas lobes: magenta, #FACADE gold, cyan, violet (saturated P3)
    out: [[1.0, 0.12, 0.55], [1.0, 0.62, 0.22], [0.05, 0.72, 0.95], [0.48, 0.16, 1.0]],
    heat: [1.6, 1.5, 1.35],
    sigil: SIGIL_COL,
  };
  const BG = [p3('#24152E').map((x) => x * 1.1), p3('#0B0710')];
  // dev knobs (globalThis.__s12)
  const dev = { ref: 80, expo: 1.2, gain: 0.9, pitch: 0.25, yaw: -0.8, xk: 0.26, depthK: 1.0 };
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
    /** morph toggles: time, direction */
    morph: [number, number][];
    /** hits inside the scene (crash + orchestra), for the inner camera's whips */
    whips: Ev[];
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
    const p: Plan = {
      c,
      hit: tHit,
      land0: rowT(108),
      land1: rowT(126),
      poseT,
      poseFrom,
      morph: [[near(16), 1], [near(32), -1], [near(48), 1], [near(64), -1]],
      whips: merged.filter((e) => e.t > T0 + 0.01 && e.t < tHit - 0.01),
      stab64: near(64),
    };
    memo = { audio, p };
    return p;
  };

  /** Lorenz ↔ Halvorsen: 0..1 */
  const morphAt = (p: Plan, t: number) => clamp01(p.morph.reduce((m, [te, d]) => m + d * ease((t - te) / (6 * ROW)), 0));
  /** the inhale 19:16–19:31 */
  const inhaleAt = (p: Plan, t: number) => easeIn((t - rowT(80)) / (p.hit - rowT(80))) * (t < p.hit ? 1 : 0);

  // ---- inner camera (the picture inside the canvas) at song time t — a pure function of t
  const innerCam = (p: Plan, t: number) => {
    const l = t - T0;
    const m = morphAt(p, t);
    // the butterfly stays face-on: the view sways (each hit a whip, alternately left and right) instead of
    // circling it; while the triangle shows, it turns and the camera rises to look down its axis
    let whip = 0;
    p.whips.forEach((e, i) => {
      if (e.t <= t) whip += (i % 2 ? -1 : 1) * 0.5 * e.v * (1 - Math.exp(-(t - e.t) / 0.16));
    });
    const yaw = dev.yaw + 0.3 * Math.sin(0.45 * l) + whip + 1.6 * m;
    const pitch = dev.pitch + 0.06 * Math.sin(l * 0.37) + 1.2 * m;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Rx(pitch) · [x, z, −y] · Rz(yaw), as a GLSL mat3 (column-major)
    const rzm = [cy, sy, 0, -sy, cy, 0, 0, 0, 1];
    const swap = [1, 0, 0, 0, 0, -1, 0, 1, 0];
    const rxm = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
    const m3 = (a: number[], b: number[]) => {
      const o = new Array(9).fill(0);
      for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k];
      return o;
    };
    const zoom = (1 + 0.12 * smoothstep(0, 4, l)) * (1 + 0.1 * m);
    const breath = (1 + 0.06 * pulse(p.c.kick, t, 0.09) + 0.14 * pulse(p.c.stab, t, 0.3)) * (1 - 0.3 * inhaleAt(p, t));
    return { rot: m3(rxm, m3(swap, rzm)), cam: [0, 0, 0.35, 1.02 * zoom], dist: 4.2, breath };
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

  const pass = (gg: Gfx, pp: PingPong, pr: Program, set: (p: Program) => void) => {
    if (!pr.use()) return;
    pp.ensure(gg, NW, NH);
    bindTarget(gg, pp.write);
    set(pr);
    fullscreen(gg);
    pp.swap();
  };
  const copy = (gg: Gfx, src: Target, dst: Target) => {
    const gx = gg.gl;
    gx.bindFramebuffer(gx.READ_FRAMEBUFFER, src.fb);
    gx.bindFramebuffer(gx.DRAW_FRAMEBUFFER, dst.fb);
    gx.blitFramebuffer(0, 0, NW, NH, 0, 0, NW, NH, gx.COLOR_BUFFER_BIT, gx.NEAREST);
    gx.bindFramebuffer(gx.READ_FRAMEBUFFER, null);
    gx.bindFramebuffer(gx.DRAW_FRAMEBUFFER, null);
  };
  const base = (c: Ctx, reset = false, h = H_BASE) =>
    pass(c.g, c.inner, c.sim, (p) => p.tex('st', c.inner.read.tex[0], 0).set('h', h).set('reset', reset ? 1 : 0).set('kind', 0));
  const halvorsen = (reset = false) =>
    pass(g, A.hal!, A.sim, (p) => p.tex('st', A.hal!.read.tex[0], 0).set('h', H_HAL).set('reset', reset ? 1 : 0).set('kind', 1));
  const thomas = (reset = false, h = THOMAS_H) =>
    pass(g2, B.home!, B.thomas!, (p) => p.tex('st', B.home!.read.tex[0], 0).set('h', h).set('b', THOMAS_B).set('reset', reset ? 1 : 0));

  /** back to the settled state of 18:00 (computed the first time) */
  const resetSim = () => {
    for (const c of [A, B]) {
      const spec = { formats: [c.g.gl.RGBA32F], filter: c.g.gl.NEAREST };
      if (!c.seed) {
        base(c, true, H_BURN);
        for (let i = 0; i < BURN; i++) base(c, false, H_BURN);
        c.seed = ensureTarget(c.g, null, NW, NH, spec);
        copy(c.g, c.inner.read, c.seed);
      }
      c.inner.ensure(c.g, NW, NH);
      copy(c.g, c.seed, c.inner.read);
    }
    if (!A.seedHal) {
      halvorsen(true);
      for (let i = 0; i < BURN_HAL; i++) halvorsen();
      A.seedHal = ensureTarget(g, null, NW, NH, { formats: [gl.RGBA32F], filter: gl.NEAREST });
      copy(g, A.hal!.read, A.seedHal);
    }
    A.hal!.ensure(g, NW, NH);
    copy(g, A.seedHal, A.hal!.read);
    if (!B.seedHome) {
      thomas(true, 0.15);
      for (let i = 0; i < 320; i++) thomas(false, 0.15);
      B.seedHome = ensureTarget(g2, null, NW, NH, { formats: [gl2.RGBA32F], filter: gl2.NEAREST });
      copy(g2, B.home!.read, B.seedHome);
    }
    B.home!.ensure(g2, NW, NH);
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
    pr.set('iRot', ic.rot).set('iCam', ic.cam).set('iDist', ic.dist).set('iBreath', ic.breath).set('burst', 0.16);
  };

  const outStep = (p: Plan, t: number, reset: boolean) =>
    pass(g2, B.outer!, B.out!, (pr) => {
      camUniforms(pr, p, t);
      pr.tex('st', B.inner.read.tex[0], 0)
        .tex('sq', B.home!.read.tex[0], 1)
        .tex('op', B.outer!.read.tex[0], 2)
        .tex('od', B.outer!.read.tex[1], 3)
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
    if (fresh && c === B) {
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
      gx.bindTexture(gx.TEXTURE_2D, c.inner.read.tex[0]);
      gx.blendFunc(gx.ZERO, gx.CONSTANT_ALPHA);
      gx.blendColor(0, 0, 0, 1 / c.W);
      fullscreen(gg);
      c.acc /= c.W;
      c.W = 1;
    }
    if (decay < 1 && splatOn && c.splat.use()) {
      gx.blendFunc(gx.ONE, gx.ONE);
      camUniforms(c.splat, p, t);
      c.splat.set('stW', NW).set('aspect', f.aspect).set('soft', c === B ? 1 : 0).set('wgt', c.W);
      if (c === A) {
        const m = morphAt(p, t);
        const dm = Math.abs(morphAt(p, t + 0.05) - m) / 0.05;
        c.splat
          .tex('st', A.inner.read.tex[0], 0)
          .tex('sh', A.hal!.read.tex[0], 1)
          .set('tRel', t - p.hit)
          .set('xk', dev.xk)
          .set('depthK', dev.depthK)
          .set('morph', m, 3.2, 0.3 * inhaleAt(p, t) + 0.25 * pulse(p.c.stab, t, 0.3) + 0.1 * dm, 0);
        pal.in.forEach((col, i) => c.splat.set(`C${i}`, col));
      } else {
        c.splat
          .tex('op', B.outer!.read.tex[0], 0)
          .tex('od', B.outer!.read.tex[1], 1)
          .tex('sig', sigTex, 2)
          .tex('sq', B.home!.read.tex[0], 3)
          .set('sigN', sigN)
          .set('sigR', SIGIL_R)
          .set('dH', dH)
          .set('conv', smoothstep(p.land0, p.land1, t))
          .set('OC', pal.out.flat())
          .set('CS', pal.sigil)
          .set('CH', pal.heat)
          .set('heatK', Math.exp(-Math.max(0, t - p.hit) / 0.16))
          .set('settle', smoothstep(0.7, 2.2, t - p.hit));
      }
      // landing on the sigil: a million points on one thin curve only fight over the same bins — a
      // shrinking random subset (the index order is random) draws the same picture
      const n = c === B ? Math.round(NW * NH * (1 - 0.8 * smoothstep(p.land0, p.land1, t))) : NW * NH;
      gx.bindVertexArray(gg.vao);
      for (let b = 0; b < BANDS; b++) {
        c.splat.set('band', -1 + (2 * b) / BANDS, b === BANDS - 1 ? 2 : -1 + (2 * (b + 1)) / BANDS);
        gx.drawArrays(gx.POINTS, 0, n);
      }
      c.acc += n * 0.6 * c.W;
      c.empty = false;
    }
    gx.disable(gx.BLEND);
    if (c === B && !idle) {
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
      const tab = sigilTables()[6];
      sigN = tab.x.length - 1;
      const d = new Float32Array(sigN * 2);
      for (let i = 0; i < sigN; i++) (d[2 * i] = tab.x[i]), (d[2 * i + 1] = tab.y[i]);
      sigTex = gl2.createTexture();
      gl2.bindTexture(gl2.TEXTURE_2D, sigTex);
      gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RG32F, sigN, 1, 0, gl2.RG, gl2.FLOAT, d);
      for (const q of [gl2.TEXTURE_MIN_FILTER, gl2.TEXTURE_MAG_FILTER]) gl2.texParameteri(gl2.TEXTURE_2D, q, gl2.NEAREST);
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
      const N = Math.max(0, Math.floor((t - T0) * RATE + 1e-6));
      const outFrom = Math.floor((tHit - T0) * RATE) - 2; // the outside's particles start just before the hit
      if (f.jumped || steps_ < 0 || N < steps_ || N - steps_ > 4 * RATE || warming) {
        // (the warm-up leaves the state at the seed: the cut at 18:00 needs no copies)
        if (!(pristine && N === 0) || warming) resetSim();
        steps_ = 0;
      }
      if (N > 0) pristine = false;
      const allOut = Math.ceil((tHit + 0.2 - T0) * RATE); // every particle has left the canvas by then
      while (steps_ < N) {
        steps_++;
        if (steps_ <= allOut) {
          base(A);
          if (morphAt(p, T0 + steps_ / RATE) > 0 || morphAt(p, T0 + (steps_ + RATE) / RATE) > 0) halvorsen();
        }
        if (steps_ >= outFrom) {
          if (steps_ <= allOut) base(B);
          thomas();
          outStep(p, T0 + steps_ / RATE, steps_ === outFrom);
        }
      }
      if (warming) outStep(p, t, true); // pipeline warm-up

      // ---- the canvas: particles that have not left yet, a ghost of those that have
      const after = t - tHit;
      const kick = pulse(c.kick, t, 0.1), orch = pulse(c.stab, t, 0.3);
      const m = morphAt(p, t);
      const dm = Math.abs(morphAt(p, t + 0.05) - m) / 0.05;
      // light trails: a longer memory while the cloud flies between its shapes
      const tauA = after > 0 ? 0.6 : 0.14 + 0.25 * Math.min(1, dm);
      const decayA = f.dt > 0 ? Math.exp(-f.dt / tauA) : 1;
      const fadeA = 1 - smoothstep(tHit + 1.2, p.land0 + 0.5, t);
      const bgK = 1 - smoothstep(p.land0, p.land1 - 0.3, t);
      const inh = inhaleAt(p, t);
      const flashA = hit(t, tHit, 0.008, 0.07);
      draw(A, f, p, t, hdr, f.jumped || warming ? 0 : decayA, !(t > tHit + 0.25), (pr) =>
        pr
          .set('ref', dev.ref)
          .set('floor_', 0.3)
          .set('expo', dev.expo)
          .set('gain', (dev.gain + 0.35 * kick + 0.4 * orch + 0.5 * inh) * fadeA)
          .set('bgA', BG[0])
          .set('bgB', BG[1])
          .set('bgK', bgK * (1 + 0.6 * orch))
          .set('frame', FRAME.map((x) => x * bgK * (0.5 + 0.8 * kick + 1.5 * orch + 2 * flashA)).concat([(1.5 * (hdr?.h ?? f.h)) / 945]))
          .set('flash', 1, 0.85, 0.95, 2 * flashA),
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
            .set('gain', (1 + 0.8 * hit(t, tHit, 0.01, 0.5) + 0.3 * kick + 0.4 * pulse(c.crash, t, 0.3) * (after > 0 ? 1 : 0)) * (1 + 2.4 * conv))
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
