// S12 · Canvas (PLAN §4, §8): the lift E → F, the FACADE theme in lydian. The <canvas> itself shrinks
// into a window and turns in CSS 3D — flat, zero thickness: the screen is a facade too. Inside it a
// million particles circle on the Aizawa attractor. At the strongest accent (D-4, 19:32) they burst out
// of it, past its border, into a second full-screen canvas "outside" (its own WebGL2 context, composited
// with `plus-lighter`), where they swirl on a Thomas attractor wrapped around the canvas; in the last
// bar they settle on the creature's sigil, which S13 grows into a flame.
//
// Both contexts start from the same settled cloud. The canvas integrates it all along (RK4, a fixed
// number of steps per second of song time); the outside only wakes up two steps before the hit: a
// settled attractor is a stationary distribution, so its cloud then is the same cloud — a particle
// leaves one canvas and appears in the other in the same picture, without the outside paying for the
// 11 s before. The outside is projected with the stage's own CSS perspective and the canvas's own
// matrix3d, so the two layers line up exactly (checked against getBoundingClientRect).

import { type Gfx, type Program, type Target, createGfx, program, ensureTarget, bindTarget, fullscreen, PingPong } from '../gfx/gl.ts';
import type { Scene, FrameCtx } from './types.ts';
import { markerTimes, hit, smoothstep } from '../timeline/events.ts';
import { ROW, ROWS } from '../timeline/script.ts';
import { CH } from '../music/roster.ts';
import { sigilTables } from '../audio/synth/scope.ts';
import { SIGIL_R, BANDS } from './s13-erasure.ts'; // same sigil size, same banded splatting

const NW = 1024, NH = 1024; // 1M particles
const RATE = 60; // simulation steps per second of song time (both contexts) — the scene runs at 60 Hz
const H_AIZ = 0.013; // Aizawa time per step
const BURN = 160; // settling steps of the Aizawa cloud (once, then kept as a seed)
const THOMAS_B = 0.2, THOMAS_H = 3.2 / RATE; // Thomas: dissipation b, attractor time per step
const THOMAS_AT = [0, 0.02, -0.3, 0.2]; // its centre in the stage (H units) and its scale (H per unit)
const P18 = 0x18 * ROWS, P1A = 0x1a * ROWS;
const T0 = P18 * ROW;

const hexLin = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return [0.8224621 * c[0] + 0.177538 * c[1], 0.0331941 * c[0] + 0.9668058 * c[1], 0.0170827 * c[0] + 0.0723974 * c[1] + 0.9105199 * c[2]];
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

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

// ---- the canvas's path through the stage: [row from 18:00, scale, rotateX°, rotateY°, translateZ (H)]
const KEYS: number[][] = [
  [-8, 1, 0, 0, 0],
  [0, 1, 0, 0, 0],
  [4, 0.97, 1, -3, 0],
  [28, 0.6, 7, -24, -0.06],
  [40, 0.6, 4, -12, -0.04],
  [56, 0.6, 2, 90, 0],
  [72, 0.6, 2, 270, 0],
  [86, 0.62, 3, 352, 0.05],
  [94, 0.66, 1, 360, 0.12],
  [96, 0.66, 0, 360, 0.12],
  [110, 0.6, 6, 366, -0.06],
  [114, 0.62, 4, 365, -0.05],
  [126, 1, 0, 360, 0],
  [136, 1, 0, 360, 0],
];
/** Catmull–Rom through KEYS at row r */
function path(r: number): number[] {
  let i = 1;
  while (i < KEYS.length - 3 && KEYS[i + 1][0] <= r) i++;
  const [k0, k1, k2, k3] = [KEYS[i - 1], KEYS[i], KEYS[i + 1], KEYS[i + 2]];
  const u = clamp01((r - k1[0]) / (k2[0] - k1[0]));
  const out: number[] = [];
  for (let j = 1; j < 5; j++) {
    const p0 = k0[j], p1 = k1[j], p2 = k2[j], p3 = k3[j];
    // non-uniform key spacing: scale the tangents by the segment length
    const d1 = k2[0] - k1[0];
    const m1 = ((p2 - p0) / (k2[0] - k0[0])) * d1, m2 = ((p3 - p1) / (k3[0] - k1[0])) * d1;
    const u2 = u * u, u3 = u2 * u;
    out.push((2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2);
  }
  return out;
}

interface Ctx {
  g: Gfx;
  sim: Program;
  splat: Program;
  tone: Program;
  out?: Program;
  thomas?: Program;
  inner: PingPong;
  outer?: PingPong;
  home?: PingPong;
  /** settled states, computed once: a reset is a copy, not a burn-in (no hitch at 18:00) */
  seed: Target | null;
  seedHome: Target | null;
  hist: Target | null;
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
    outer: outside ? new PingPong({ formats: [gg.gl.RGBA32F, gg.gl.RGBA32F], filter: gg.gl.NEAREST }) : undefined,
    home: outside ? new PingPong({ formats: [gg.gl.RGBA32F], filter: gg.gl.NEAREST }) : undefined,
    seed: null,
    seedHome: null,
    hist: null,
    acc: 0,
    W: 1,
  });
  const A = make(g, false); // the canvas
  const B = make(g2, true); // the outside
  let sigTex: WebGLTexture | null = null;
  let sigN = 0;
  let steps = -1; // simulation steps done (both contexts), -1 = needs a reset
  let warmed = false;
  let active = false;
  let wasOutside = false;
  let dH = 2000 / 945; // CSS perspective in stage heights
  let Hcss = 945;
  const pal = {
    in: ['#4A1460', '#D2508C', '#FACADE'].map(hexLin),
    out: ['#5F7FD0', '#DECADE', '#E8508F'].map(hexLin),
    heat: hexLin('#EFFACE'),
    sigil: hexLin('#DECADE'),
  };

  // ---- music
  const times = (f: FrameCtx) => ({
    hit: markerTimes(f.audio, 'D-4', P18, P1A, [P18 + 96])[0],
    land0: (P18 + 108) * ROW,
    land1: (P18 + 126) * ROW,
  });

  // ---- inner camera (the picture inside the canvas) at song time t
  const innerCam = (t: number) => {
    const l = t - T0;
    const yaw = 0.3 * l + 0.4, pitch = 0.2 + 0.08 * Math.sin(l * 0.37);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Rx(pitch) · [x, z, −y] · Rz(yaw), as a GLSL mat3 (column-major)
    const rz = [cy, sy, 0, -sy, cy, 0, 0, 0, 1];
    const swap = [1, 0, 0, 0, 0, -1, 0, 1, 0];
    const rxm = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
    const m3 = (a: number[], b: number[]) => {
      const o = new Array(9).fill(0);
      for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k];
      return o;
    };
    const zoom = 1 + 0.12 * smoothstep(0, 4, l);
    return { rot: m3(rxm, m3(swap, rz)), cam: [0, 0, 0.35, 1.02 * zoom], dist: 4.2 };
  };

  // ---- the canvas's transform at song time t: CSS matrix (px, y down) and plane → stage (H, y up)
  const windowAt = (t: number, f: FrameCtx | null, tHit: number) => {
    const r = (t - T0) / ROW;
    let [s, ax, ay, tz] = path(r);
    const kick = hit(t, tHit, 0.03, 0.4);
    tz -= 0.24 * kick;
    s -= 0.05 * kick;
    ax += 7 * kick;
    let jx = 0, jy = 0;
    if (f) {
      const sn = (f.S[CH.snare - 1] ?? 0) * smoothstep(80, 94, r) * (1 - smoothstep(96, 98, r));
      jx = 0.006 * sn * Math.sin(t * 91);
      jy = 0.006 * sn * Math.sin(t * 77 + 1);
    }
    const css = mul(tr(jx * Hcss, -jy * Hcss, tz * Hcss), mul(ry((ay * Math.PI) / 180), mul(rx((ax * Math.PI) / 180), sc(s, s, 1))));
    // plane (H units, y up) → CSS local px (y down) → CSS stage px → stage H units (y up)
    const F = sc(1 / Hcss, -1 / Hcss, 1 / Hcss), Fi = sc(Hcss, -Hcss, Hcss);
    return { css, W: mul(F, mul(css, Fi)), identity: Math.abs(s - 1) < 1e-4 && Math.abs(ay % 360) < 1e-3 && Math.abs(ax) < 1e-3 && Math.abs(tz) < 1e-4 };
  };

  const pass = (gg: Gfx, pp: PingPong, p: Program, set: (p: Program) => void) => {
    if (!p.use()) return;
    pp.ensure(gg, NW, NH);
    bindTarget(gg, pp.write);
    set(p);
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
  const aizawa = (c: Ctx, reset = false, h = H_AIZ) =>
    pass(c.g, c.inner, c.sim, (p) => p.tex('st', c.inner.read.tex[0], 0).set('h', h).set('reset', reset ? 1 : 0));
  const thomas = (reset = false, h = THOMAS_H) =>
    pass(g2, B.home!, B.thomas!, (p) => p.tex('st', B.home!.read.tex[0], 0).set('h', h).set('b', THOMAS_B).set('reset', reset ? 1 : 0));

  /** back to the settled state of 18:00 (computed the first time) */
  const resetSim = () => {
    for (const c of [A, B]) {
      const spec = { formats: [c.g.gl.RGBA32F], filter: c.g.gl.NEAREST };
      if (!c.seed) {
        aizawa(c, true);
        for (let i = 0; i < BURN; i++) aizawa(c);
        c.seed = ensureTarget(c.g, null, NW, NH, spec);
        copy(c.g, c.inner.read, c.seed);
      }
      c.inner.ensure(c.g, NW, NH);
      copy(c.g, c.seed, c.inner.read);
    }
    if (!B.seedHome) {
      thomas(true, 0.15);
      for (let i = 0; i < 320; i++) thomas(false, 0.15);
      B.seedHome = ensureTarget(g2, null, NW, NH, { formats: [gl2.RGBA32F], filter: gl2.NEAREST });
      copy(g2, B.home!.read, B.seedHome);
    }
    B.home!.ensure(g2, NW, NH);
    copy(g2, B.seedHome, B.home!.read);
  };

  /** the Thomas attractor turns slowly about the vertical (and a little about x): depth by parallax */
  const thomasTurn = (t: number) => {
    const a = 0.22 * (t - T0), b = 0.35;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    // Ry(a) · Rx(b), column-major
    return [ca, 0, -sa, sa * sb, cb, ca * sb, sa * cb, -sb, ca * cb];
  };

  const camUniforms = (p: Program, t: number) => {
    const ic = innerCam(t);
    p.set('iRot', ic.rot).set('iCam', ic.cam).set('iDist', ic.dist).set('burst', 0.16);
  };

  const outStep = (t: number, tHit: number, reset: boolean) =>
    pass(g2, B.outer!, B.out!, (p) => {
      camUniforms(p, t);
      p.tex('st', B.inner.read.tex[0], 0)
        .tex('sq', B.home!.read.tex[0], 1)
        .tex('op', B.outer!.read.tex[0], 2)
        .tex('od', B.outer!.read.tex[1], 3)
        .set('W', windowAt(t, null, tHit).W)
        .set('tRel', t - tHit)
        .set('dt', 1 / RATE)
        .set('th', THOMAS_AT)
        .set('thR', thomasTurn(t))
        .set('reset', reset ? 1 : 0);
    });

  /** splat + tonemap one context */
  const draw = (c: Ctx, f: FrameCtx, t: number, tHit: number, target: Target | null, decay: number, gain: number) => {
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
    if (fresh || decay <= 0) {
      gx.clearColor(0, 0, 0, 0);
      gx.clear(gx.COLOR_BUFFER_BIT);
      c.acc = 0;
      c.W = 1;
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
    if (decay < 1 && !(c === A && t > tHit + 0.25) && c.splat.use()) {
      gx.blendFunc(gx.ONE, gx.ONE);
      camUniforms(c.splat, t);
      c.splat.set('stW', NW).set('aspect', f.aspect).set('soft', c === B ? 1 : 0).set('wgt', c.W);
      if (c === A) {
        c.splat.tex('st', A.inner.read.tex[0], 0).set('tRel', t - tHit).set('C0', pal.in[0]).set('C1', pal.in[1]).set('C2', pal.in[2]);
      } else {
        const tm = times(f);
        c.splat
          .tex('op', B.outer!.read.tex[0], 0)
          .tex('od', B.outer!.read.tex[1], 1)
          .tex('sig', sigTex, 2)
          .tex('sq', B.home!.read.tex[0], 3)
          .set('sigN', sigN)
          .set('sigR', SIGIL_R)
          .set('dH', dH)
          .set('conv', smoothstep(tm.land0, tm.land1, t))
          .set('C0', pal.out[0]).set('C1', pal.out[1]).set('C2', pal.out[2]).set('CS', pal.sigil).set('CH', pal.heat);
      }
      // landing on the sigil: a million points on one thin curve only fight over the same bins — a
      // shrinking random subset (the index order is random) draws the same picture
      const n = c === B ? Math.round(NW * NH * (1 - 0.8 * smoothstep(times(f).land0, times(f).land1, t))) : NW * NH;
      gx.bindVertexArray(gg.vao);
      for (let b = 0; b < BANDS; b++) {
        c.splat.set('band', -1 + (2 * b) / BANDS, b === BANDS - 1 ? 2 : -1 + (2 * (b + 1)) / BANDS);
        gx.drawArrays(gx.POINTS, 0, n);
      }
      c.acc += n * 0.6 * c.W;
    }
    gx.disable(gx.BLEND);
    if (c === B) {
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
      .set('ref', c === A ? 26 : 160)
      .set('floor_', 0.3)
      .set('expo', c === A ? 0.6 : 0.75)
      .set('gain', gain)
      .set('mode', c === A ? 0 : 1)
      .set('bgA', hexLin('#24152E').map((x) => x * 0.9))
      .set('bgB', hexLin('#0B0710'))
      .set('bgK', c === A ? 1 - smoothstep(times(f).land0, times(f).land1 - 0.3, t) : 0)
      .set('glow', c === B ? 0.35 - 0.2 * smoothstep(times(f).land0, times(f).land1, t) : 0, 1.0, 0.2);
    fullscreen(gg);
  };

  return {
    id: 'S12',
    title: 'Canvas',
    fps: 60,
    // the particles are binned one per CSS pixel anyway: tonemap + post at that resolution
    scale: 0.5,
    programs: () => [A.sim, A.splat, A.tone, B.sim, B.splat, B.tone, B.out!, B.thomas!],
    post: { bloom: 0.15, bloomRadius: 1.1, vignette: 0, grain: 0.02, exposure: 0.1, look: [1.12, 1.15, 0, 0] },
    init() {
      const tab = sigilTables()[6];
      sigN = tab.x.length - 1;
      const d = new Float32Array(sigN * 2);
      for (let i = 0; i < sigN; i++) (d[2 * i] = tab.x[i]), (d[2 * i + 1] = tab.y[i]);
      sigTex = gl2.createTexture();
      gl2.bindTexture(gl2.TEXTURE_2D, sigTex);
      gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RG32F, sigN, 1, 0, gl2.RG, gl2.FLOAT, d);
      for (const p of [gl2.TEXTURE_MIN_FILTER, gl2.TEXTURE_MAG_FILTER]) gl2.texParameteri(gl2.TEXTURE_2D, p, gl2.NEAREST);
    },
    enter() {
      active = true;
      steps = -1;
      const st = g.canvas.parentElement!;
      Hcss = st.clientHeight || 945;
      dH = (parseFloat(getComputedStyle(st).perspective) || 2000) / Hcss;
    },
    leave() {
      active = false;
      g.canvas.style.transform = '';
      oc.style.display = 'none';
    },
    render(f: FrameCtx, hdr: Target | null) {
      const t = f.t;
      const tm = times(f);
      const tHit = tm.hit;

      // ---- the canvas in the stage
      const win = windowAt(t, f, tHit);
      if (active) g.canvas.style.transform = win.identity ? '' : `matrix3d(${win.css.map((x) => +x.toFixed(6)).join(',')})`;
      // the outside at one pixel per CSS pixel, like its histogram (the compositor scales it up)
      const ow = Math.ceil(f.w / 2), oh = Math.ceil(f.h / 2);
      if (oc.width !== ow || oc.height !== oh) (oc.width = ow), (oc.height = oh);

      // ---- simulation, lock-step in both contexts
      const N = Math.max(0, Math.floor((t - T0) * RATE + 1e-6));
      const outFrom = Math.floor((tHit - T0) * RATE) - 2; // the outside's particles start just before the hit
      if (f.jumped || steps < 0 || N < steps || N - steps > 4 * RATE || !warmed) {
        resetSim();
        steps = 0;
      }
      const allOut = Math.ceil((tHit + 0.2 - T0) * RATE); // every particle has left the canvas by then
      while (steps < N) {
        steps++;
        if (steps <= allOut) aizawa(A);
        if (steps >= outFrom) {
          if (steps <= allOut) aizawa(B);
          thomas();
          outStep(T0 + steps / RATE, tHit, steps === outFrom);
        }
      }
      if (!warmed) outStep(t, tHit, true); // pipeline warm-up

      // ---- the canvas: particles that have not left yet, a ghost of those that have
      const after = t - tHit;
      const kick = f.S[CH.kick - 1] ?? 0, orch = f.S[CH.stab - 1] ?? 0;
      const decayA = f.dt > 0 ? Math.exp(-f.dt / (after > 0 ? 0.6 : 0.12)) : 1;
      const fadeA = 1 - smoothstep(tHit + 1.2, tm.land0 + 0.5, t);
      draw(A, f, t, tHit, hdr, f.jumped || !warmed ? 0 : decayA, (0.9 + 0.35 * kick + 0.5 * orch) * fadeA);

      // ---- the outside
      const outside = after > -0.02 || !warmed;
      if (active) oc.style.display = outside ? 'block' : 'none';
      if (outside) {
        const decayB = f.dt > 0 ? Math.exp(-f.dt / 0.04) : 1;
        draw(B, f, t, tHit, null, f.jumped || !warmed || !wasOutside ? 0 : decayB, (1 + 0.6 * hit(t, tHit, 0.01, 0.5) + 0.25 * kick) * (1 + smoothstep(tm.land0, tm.land1, t)));
      }
      wasOutside = outside;
      if (!warmed) {
        // the loader renders this scene once before the hit: make sure every pipeline of the outside exists
        bindTarget(g, hdr);
        warmed = true;
        steps = -1;
      }
    },
  };
}

export default createCanvas;
