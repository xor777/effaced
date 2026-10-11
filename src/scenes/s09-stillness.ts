// S09 · Stillness (PLAN §4, §5). 12:00 (E-4): the render REALLY stops — one frame is drawn and then
// Scene.freeze() skips all GPU work, so the canvas keeps that frame while the music goes on and the
// frame counter F:0x… stands still. The frame: a wheel of Hopf fibres seen down the axis, centred on
// S08's fixation cross, painted with Kitaoka's peripheral-drift inks ("Rotating Snakes"). After 20 s of
// S08's flow (into the centre, clockwise) the motion aftereffect makes this still picture swell and
// turn counter-clockwise for several seconds — and the inks drift that same way, so the two illusions
// add up and the "stopped" picture keeps moving. 12:32 the render returns — slowly: the inks begin to creep
// that same way, light and depth come in — and from 13:00 (E-4) the same fibration is alive in 3D —
// now the inks really flow along the fibres — and a depth-of-field pass (Vogel-spiral gather) sweeps
// through it: the picture is a hybrid image, HP(fibres) + LP(a face with closed eyes). In focus there
// is only mathematics; out of focus the fibres average out and the face is all that is left.

import { mat4 } from 'gl-matrix';
import { type Gfx, type Target, type Program, program, ensureTarget, bindTarget, fullscreen } from '../gfx/gl.ts';
import type { Scene, FrameCtx } from './types.ts';
import { smoothstep } from '../timeline/events.ts';
import { ROW, ROWS } from '../timeline/script.ts';
import { CH } from '../music/roster.ts';
import { frameCounter, tickFrameCounter } from '../meta/overlay.ts';
import { COMMON } from '../perception/shaders/common.glsl.ts';
import { FACE_LIB } from '../perception/shaders/face.glsl.ts';
import { defaults } from '../perception/params.ts';
import { faceDesignUniforms, lilacColors } from '../perception/render.ts';
import { toBuffer, hex2rgb } from '../perception/color.ts';
import { FLOW } from './s08-flow.ts';

const P12 = 0x12 * ROWS, P13 = 0x13 * ROWS, P14 = 0x14 * ROWS;
const SEG = 192, SIDES = 10;
const STILL_PASSES = 4; // × 4 MSAA = 16 samples for the frame that has to hold for 7.68 s
const QSCALE = 4; // the defocus works at quarter resolution

// the fibration: nested tori (base points on four latitudes of S²), fibres per torus
const TORI = [
  { a: 0.62, n: 12 },
  { a: 1.02, n: 16 },
  { a: 1.38, n: 22 },
  { a: 1.9, n: 14 }, // the outermost: hoops through the hole and around everything
];
const INK_LEN = 0.3; // R³ length of one ink period on the still
const R0 = 0.019; // tube radius on S³

type V3 = [number, number, number];
type Q = [number, number, number, number]; // w x y z
const qmul = (a: Q, b: Q): Q => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));

/** the fibre over the base point (polar α, azimuth β) at Hopf parameter t, as a quaternion z1 + z2 j */
const fibrePoint = (al: number, be: number, t: number): Q => {
  const c = Math.cos(al / 2), s = Math.sin(al / 2);
  return [c * Math.cos(t + be), c * Math.sin(t + be), s * Math.cos(t), s * Math.sin(t)];
};
/** stereographic projection S³ → R³ from the pole (0, 0, 0, 1) */
const stereo = (q: Q): V3 => {
  const d = 1 - q[3];
  return [q[0] / d, q[1] / d, q[2] / d];
};

export function createStillness(g: Gfx): Scene {
  const gl = g.gl;
  const tube = program(g, 'scenes/s09-tube', 'scenes/s09-tube.vert');
  const acc = program(g, 'scenes/s09-acc');
  const still = program(g, 'scenes/s09-still');
  const down = program(g, 'scenes/s09-down');
  const dof = program(g, 'scenes/s09-dof');
  const blur = program(g, 'scenes/s09-blur');
  const hybrid = program(g, 'scenes/s09-hybrid');
  const face = program(
    g,
    COMMON + FACE_LIB + /* glsl */ `
in vec2 uv;
out vec4 o;
uniform vec2 center;
uniform float scale;
void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  pxF = 1.0 / (res.y * scale);
  vec2 p = (q - center) / scale;
  // only the head: the neck and the shoulders fade out where the fibration ends
  o = vec4(faceDesign(p) * (1.0 - smoothstep(0.5, 0.85, length(p * vec2(0.95, 0.8) - vec2(0.0, 0.05)))), 0.0, 0.0, 1.0);
}`,
  );

  // perception-lab parameters: S08's field and cross, the face and its hybrid settings
  const P = defaults();
  const lc = lilacColors(P.lilac, 'display-p3');
  const inks = ['#000000', '#6E5FA8', '#FFFFFF', '#BEADED'].map((h) => toBuffer(hex2rgb(h), 'srgb', 'display-p3'));
  const lin = (h: string) => toBuffer(hex2rgb(h), 'srgb', 'display-p3');
  const tints = ['#EFFACE', '#FACADE', '#BEADED', '#ACCEDE'].map(lin).flat();
  const faceBase = lin('#DECADE');
  const bgDark = lin('#0C0B0E');

  // fibres
  const fib = TORI.flatMap((T, j) =>
    Array.from({ length: T.n }, (_, k) => ({ al: T.a, be: (2 * Math.PI * (k + 0.5 * j)) / T.n, torus: j, periods: 0 })),
  );
  const inst = new Float32Array(fib.length * 12);
  let vao: WebGLVertexArrayObject | null = null;
  let vbo: WebGLBuffer | null = null;

  // targets
  let msFb: WebGLFramebuffer | null = null;
  let msRb: WebGLRenderbuffer[] = [];
  let msW = 0, msH = 0;
  let resolved: Target | null = null, accT: Target | null = null, halfT: Target | null = null;
  let q0: Target | null = null, q1: Target | null = null, q2: Target | null = null, q3: Target | null = null;
  let faceT: Target | null = null;
  let stillDrawn = false;
  let warmed = false;
  const view = mat4.create(), proj = mat4.create(), vp = mat4.create();
  // dev / calibration (PLAN §5): __s09.blur = 0…1 holds the defocus, .hk the hybrid exchange,
  // .show = 'face' | 'lp' | 'q1' | 'sharp' displays an intermediate buffer
  // .freezeRows = how long the render stays stopped (rows after 12:00)
  const dbg: { show: string; blur: number | null; hk: number | null; freezeRows: number } = { show: '', blur: null, hk: null, freezeRows: 32 };
  if (import.meta.env.DEV) (globalThis as any).__s09 = dbg;

  const times = (f: FrameCtx) => {
    const m = (f.audio as unknown as { markers?: { row: number; t: number; note: string }[] })?.markers ?? [];
    const near = (row: number) => m.find((x) => x.note === 'E-4' && Math.abs(x.row - row) <= 2)?.t ?? row * ROW;
    const freeze = near(P12);
    // the render stops for 32 rows (3.84 s: the aftereffect itself lasts ~3–6 s), then wakes up slowly;
    // the E-4 of 13:00 (alive) is where the music starts to build and the defocus schedule is anchored
    return { freeze, awake: freeze + dbg.freezeRows * ROW, alive: near(P13), end: P14 * ROW };
  };

  /** fibres for the 4D turn qR (right multiplication maps fibres to fibres) → instance data */
  const layout = (qR: Q, first: boolean) => {
    fib.forEach((F, i) => {
      const p = [0, 1, 2].map((k) => stereo(qmul(fibrePoint(F.al, F.be, (2 * Math.PI * k) / 3), qR)));
      const a = sub(p[0], p[2]), b = sub(p[1], p[2]);
      const axb = cross(a, b);
      const l2 = dot(axb, axb);
      const c = sub(p[2], scale(cross(sub(scale(b, dot(a, a)), scale(a, dot(b, b))), axb), -1 / (2 * l2)));
      const R = Math.hypot(...sub(p[0], c));
      const n = norm(cross(sub(p[1], p[0]), sub(p[2], p[0])));
      const e1 = norm(sub(p[0], c)), e2 = cross(n, e1);
      // every fibre drifts the same way, against S08's turn — with the motion aftereffect it adapted. A
      // fibre's parameter runs counter-clockwise round the centre on screen (checked for every fibre at
      // these camera angles), and the eye drifts towards increasing u: periods > 0 ⇒ counter-clockwise.
      if (first) F.periods = Math.max(6, Math.round((2 * Math.PI * R) / INK_LEN)) * (FLOW.turn >= 0 ? 1 : -1);
      const ok = l2 > 1e-12 && R < 14;
      inst.set([...c, ok ? R : 0, ...e1, F.periods, ...e2, F.torus], i * 12);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  };

  const ensureMS = (w: number, h: number) => {
    if (msFb && msW === w && msH === h) return;
    if (msFb) {
      gl.deleteFramebuffer(msFb);
      msRb.forEach((r) => gl.deleteRenderbuffer(r));
    }
    msFb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFb);
    msRb = [gl.RGBA16F, gl.DEPTH_COMPONENT24].map((fmt, i) => {
      const rb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, fmt, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, i ? gl.DEPTH_ATTACHMENT : gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      return rb;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    msW = w;
    msH = h;
  };

  /** camera at time `l` seconds after the awakening (12:32; constant before), `la` after 13:00 */
  const camera = (f: FrameCtx, l: number, jitter: [number, number], la = 0) => {
    // it starts at rest and gathers speed: nothing jumps when the still wakes up
    const az = 0.55 + 0.012 * l * l + 0.001 * l * l * l;
    // the still looks almost straight down the axis: concentric rings round the fixation point, like the
    // flow it follows; alive, the camera sinks to the side and the rings become tori
    const el = 1.25 - 0.67 * smoothstep(1, 10, l);
    const D = 7.7 - 0.13 * smoothstep(0, 4, l) * l;
    const sn = (f.S[CH.snare - 1] ?? 0) * smoothstep(32, 64, la / ROW) * 0.004;
    const eye: V3 = [D * Math.cos(el) * Math.cos(az), D * Math.cos(el) * Math.sin(az), D * Math.sin(el)];
    const target: V3 = [sn * Math.sin(l * 83), sn * Math.cos(l * 71), -0.15 * smoothstep(1, 10, l)];
    mat4.lookAt(view, eye, target, [0, 0, 1]);
    mat4.perspective(proj, (36 * Math.PI) / 180, msW / msH, 0.1, 100);
    if (jitter[0] || jitter[1]) {
      const j = mat4.fromTranslation(mat4.create(), [(2 * jitter[0]) / msW, (2 * jitter[1]) / msH, 0]);
      mat4.multiply(proj, j, proj);
    }
    mat4.multiply(vp, proj, view);
    return { eye, fwd: norm(sub(target, eye)), D };
  };

  /**
   * draw the fibres into the MSAA target and resolve; flatK 1 = the still. `low`: when the defocus is
   * wide open nothing sharp survives — draw straight into a half-resolution target instead (no MSAA)
   */
  const drawFibres = (f: FrameCtx, l: number, flatK: number, flow: number, jitter: [number, number], low = false, la = 0) => {
    const cam = camera(f, l, jitter, la);
    if (low) bindTarget(g, halfT);
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, msFb);
      gl.viewport(0, 0, msW, msH);
    }
    const bg = lc.bg.map((x, i) => x + (bgDark[i] - x) * (1 - flatK));
    gl.clearColor(bg[0], bg[1], bg[2], 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (tube.use() && vao) {
      gl.enable(gl.DEPTH_TEST);
      tube
        .set('VP', vp as Float32Array)
        .set('r0', R0)
        .set('SEG', SEG)
        .set('SIDES', SIDES)
        .set('eye', cam.eye)
        .set('fwd', cam.fwd)
        .set('flatK', flatK)
        .set('snakeK', 0.18 + 0.5 * flatK)
        .set('flow', flow)
        .set('K0', inks[0]).set('K1', inks[1]).set('K2', inks[2]).set('K3', inks[3])
        .set('TINT', tints)
        .set('Ldir', [-0.35, 0.45, 0.82]);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, SEG * SIDES * 6, fib.length);
      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);
    }
    if (low) return cam;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolved!.fb);
    gl.blitFramebuffer(0, 0, msW, msH, 0, 0, msW, msH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    return cam;
  };

  const pass = (p: Program, dst: Target, set: (p: Program) => void) => {
    if (!p.use()) return;
    bindTarget(g, dst);
    set(p);
    fullscreen(g);
  };

  /**
   * the still: supersampled, exact colours, straight to the screen. It depends on nothing but the frame
   * size, so it is rendered once (the loader's warm-up already does it) and kept: at 12:00 the freeze
   * costs one composite pass, not a 16-sample render.
   */
  let stillKey = '';
  const drawStill = (f: FrameCtx) => {
    layout([1, 0, 0, 0], true);
    const key = `${msW}x${msH}:${FLOW.turn >= 0}`; // (re-render when the size or S08's turn changes)
    if (stillKey !== key) renderStill(f);
    stillKey = key;
    bindTarget(g, null);
    if (still.use()) {
      still
        .tex('src', accT!.tex[0], 0)
        .set('res', f.w, f.h)
        .set('crossSz', P.lilac.crossSize, P.lilac.crossThickness)
        .set('crossCol', lc.cross);
      fullscreen(g);
    }
  };
  const renderStill = (f: FrameCtx) => {
    accT = ensureTarget(g, accT, msW, msH, { formats: [gl.RGBA16F] });
    bindTarget(g, accT);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < STILL_PASSES; i++) {
      // jitter on a rotated 2×2 grid (the MSAA pattern fills in between)
      const a = 0.4 + (i * Math.PI) / 2;
      drawFibres(f, 0, 1, 0, [0.35 * Math.cos(a), 0.35 * Math.sin(a)]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      pass(acc, accT!, (p) => p.tex('src', resolved!.tex[0], 0).set('w', 1 / STILL_PASSES));
      gl.disable(gl.BLEND);
    }
  };

  return {
    id: 'S09',
    title: 'Stillness',
    // alive it is a slow, dreamy picture with MSAA fibres + defocus + hybrid + post at 3024×1890: 60 Hz
    // (the frozen part costs nothing at any rate)
    fps: 60,
    freeze(f) {
      const tm = times(f);
      if (f.t < tm.freeze || f.t >= tm.awake) {
        stillDrawn = false;
        return false;
      }
      return stillDrawn && !f.jumped; // the first frame of the window is drawn, then nothing at all
    },
    post: (f) => {
      const tm = times(f);
      if (f.t < tm.awake) return false;
      const k = smoothstep(tm.awake, tm.awake + 28 * ROW, f.t);
      return { tonemap: 'clip', exposure: 0, bloom: 0.13 * k, bloomRadius: 1.1, vignette: 0.35 * k, grain: 0.03 * k, ca: 0 };
    },
    programs: () => [tube, acc, still, down, dof, blur, hybrid, face],
    init() {
      vao = gl.createVertexArray();
      vbo = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
      for (let i = 0; i < 3; i++) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 48, i * 16);
        gl.vertexAttribDivisor(i, 1);
      }
      gl.bindVertexArray(null);
      layout([1, 0, 0, 0], true);
    },
    enter() {
      frameCounter(true);
      stillDrawn = false;
    },
    leave() {
      frameCounter(false);
    },
    render(f: FrameCtx, hdr: Target | null) {
      const tm = times(f);
      const w = f.w, h = f.h;
      ensureMS(w, h);
      resolved = ensureTarget(g, resolved, w, h, { formats: [gl.RGBA16F] });
      halfT = ensureTarget(g, halfT, Math.ceil(w / 2), Math.ceil(h / 2), { formats: [gl.RGBA16F], depth: true });
      const qw = Math.ceil(w / QSCALE), qh = Math.ceil(h / QSCALE);
      const qspec = { formats: [gl.RGBA16F] };
      const freshFace = !faceT || faceT.w !== qw || faceT.h !== qh;
      q0 = ensureTarget(g, q0, qw, qh, qspec);
      q1 = ensureTarget(g, q1, qw, qh, qspec);
      q2 = ensureTarget(g, q2, qw, qh, qspec);
      q3 = ensureTarget(g, q3, qw, qh, qspec);
      faceT = ensureTarget(g, faceT, qw, qh, qspec);
      if (freshFace) {
        // the face (eyes closed), low-passed analytically: every contour is an erf edge of sigma lowSigma
        const fu = faceDesignUniforms({ ...P.face, eyesOpen: false });
        pass(face, faceT, (p) => {
          p.set('res', qw, qh).set('dither', 0).set('center', 0, 0.02).set('scale', 0.6);
          // only the head: no nimbus, no 65537-gon ring, no garment (their low frequencies would show
          // where no fibre masks them)
          p.set('featK', 1).set('modelling', 1).set('tones', fu.tones[0], 0, 0, 0).set('strands', 0);
          p.set('edgeS', P.hybrid.lowSigma).set('featS', P.hybrid.lowSigma).set('frame', fu.frame).set('eyesOpen', 0);
        });
      }

      const frozen = f.t >= tm.freeze && f.t < tm.awake;
      if (frozen || !warmed) {
        drawStill(f);
        stillDrawn = true;
        tickFrameCounter(); // the last frame the counter will see until the awakening
        if (frozen) {
          warmed = true;
          return;
        }
      }
      if (f.t < tm.freeze) {
        bindTarget(g, hdr);
        return;
      }
      tickFrameCounter();

      // ---- awake (12:32), then alive (13:00): the fibration in 3D, flowing; the DOF sweeps; the hybrid
      // image. Everything starts from the still and from rest — the inks creep the way the aftereffect
      // (and their own drift) already made them seem to go, then light, depth and motion grow
      const l = Math.max(0, f.t - tm.awake);
      const rw = l / ROW; // rows since the awakening
      const r = (f.t - tm.alive) / ROW; // rows since 13:00 (negative while waking)
      const wake = smoothstep(2, 30, rw);
      const turn = 0.55 * smoothstep(12, 92, rw) ** 1.3;
      const ax = norm([0.35, 1, 0.25]);
      const s = Math.sin(turn / 2);
      layout([Math.cos(turn / 2), ax[0] * s, ax[1] * s, ax[2] * s], false);
      const flow = 0.12 * l * l + 0.012 * l * l * l; // the inks start to move along the fibres, faster and faster
      // defocus schedule: two breaths (bars 2, 3), then the full reveal over the reverse crash (bar 4)
      const bump = (a: number, b: number, c: number, x: number) => smoothstep(a, b, x) * (1 - smoothstep(b, c, x));
      const blurK = dbg.blur ?? Math.max(0.6 * bump(16, 25, 33, r), 0.85 * bump(32, 41, 49, r), smoothstep(48, 60, r));
      const dofAll = smoothstep(0.25, 0.7, blurK);
      const low = dofAll > 0.999;
      const cam = drawFibres(f, l, 1 - wake, flow, [0, 0], low, Math.max(0, f.t - tm.alive));
      const src = low ? halfT! : resolved!;
      // focus racks out to infinity while the aperture opens: nothing is left in the focal plane, the
      // nearest hoops blur most, the circle of confusion grows ~ linearly (and so does the gather radius)
      const izf = (1 - blurK) / cam.D;
      const coc: [number, number, number] = [4 + 140 * blurK, izf, 3 + 23 * blurK];

      pass(down, q0!, (p) => p.tex('src', src.tex[0], 0).set('texel', (low ? 0.5 : 1) / src.w, (low ? 0.5 : 1) / src.h));
      pass(dof, q1!, (p) => p.tex('src', q0!.tex[0], 0).set('texel', 1 / qw, 1 / qh).set('coc', coc).set('frame', f.frame));
      const sig = 0.02 * qh; // low-pass of the fibres: σ = 0.02 H
      pass(blur, q2!, (p) => p.tex('src', q1!.tex[0], 0).set('dir', 1 / qw, 0).set('sigma', sig));
      pass(blur, q3!, (p) => p.tex('src', q2!.tex[0], 0).set('dir', 0, 1 / qh).set('sigma', sig));
      pass(hybrid, hdr!, (p) =>
        p
          .tex('sharp', src.tex[0], 0)
          .tex('dofQ', q1!.tex[0], 1)
          .tex('lpQ', q3!.tex[0], 2)
          .tex('faceQ', faceT!.tex[0], 3)
          .set('res', hdr!.w, hdr!.h)
          .set('coc', coc)
          .set('dofAll', dofAll)
          .set('hk', dbg.hk ?? smoothstep(14, 40, rw))
          .set('base', faceBase)
          .set('faceAB', 0.008, 0.26)
          .set('tm', wake)
          .set('gain', 1 + 0.18 * wake * (f.S[CH.kick - 1] ?? 0))
          .set('crossSz', P.lilac.crossSize, P.lilac.crossThickness)
          .set('crossCol', [...lc.cross, 1 - smoothstep(4, 20, rw)]),
      );
      if (dbg.show) {
        const src = { face: faceT, q0, q1, lp: q3, sharp: resolved }[dbg.show];
        if (src) pass(acc, hdr!, (p) => p.tex('src', src.tex[0], 0).set('w', dbg.show === 'face' ? 0.6 : 1));
      }
      warmed = true;
    },
  };
}

export default createStillness;
