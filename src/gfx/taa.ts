// Temporal anti-aliasing + upscaling for half-resolution raymarchers (PLAN §7.1, §7.4).
//
//   scene raymarch (internal res, jittered)  ──► [colour RGBA16F, depth R32F]
//   TAA resolve (output res): reprojection with the camera, 3×3 Gaussian reconstruction of the
//   jittered samples, variance clip in YCoCg, Catmull-Rom history ──► history + the scene's hdr
//
// Usage (a raymarch scene with `scale: 1`, so `hdr` is the full output resolution):
//
//   const taa = new TAA(g, { ratio: 0.5 });          // internal = ½ of the output in each axis
//   programs: () => [myProg, ...taa.programs()],
//   render(f, hdr) {
//     const cam = lookAt([0, 2, 0], [0, 2, 10], 50);  // or build a TaaCamera yourself
//     taa.begin(f, hdr!, cam);                         // binds the internal MRT target, picks the jitter
//     myProg.use(); taa.uniforms(myProg); myProg.set(...); fullscreen(g);
//     taa.resolve(hdr!);                               // writes hdr (and the history)
//   }
//
// The scene shader includes "lib/taa": it declares the camera uniforms and gives
//   vec3 camRay(vec2 fragCoord)      — jittered primary ray direction (unit)
// and must write two outputs:
//   layout(location = 0) out vec4 o;      // linear HDR colour
//   layout(location = 1) out float oDepth; // distance along the (unit) ray, world units; sky = 1e5
//
// Geometry that travels with the camera (a rig: S05's staircase climbs with us) may write its depth
// NEGATIVE and the scene sets `taa.rigDelta` to the rig's world motion since the last frame: those
// pixels reproject in rig space and stay sharp while the world streams past.
//
// Reprojection uses only the camera (no motion vectors): moving objects rely on the neighbourhood
// clip (they get a little softer while they move, they don't ghost). Call `reset()` on a camera cut;
// seeks (`f.jumped`) reset automatically.

import { type Gfx, type Program, type Target, program, ensureTarget, bindTarget, fullscreen } from './gl.ts';
import type { FrameCtx } from '../scenes/types.ts';

export type Vec3 = [number, number, number];

/** A pinhole camera: orthonormal basis + tangents of the half field of view. */
export interface TaaCamera {
  pos: Vec3;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
  /** tan(fovY / 2); tanX follows from the target's aspect */
  tanY: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** camera at `pos` looking at `target`, vertical field of view in degrees, roll in radians */
export function lookAt(pos: Vec3, target: Vec3, fovYdeg: number, roll = 0, worldUp: Vec3 = [0, 1, 0]): TaaCamera {
  const fwd = norm(sub(target, pos));
  let right = norm(cross(fwd, worldUp));
  let up = cross(right, fwd);
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const r2: Vec3 = [right[0] * c + up[0] * s, right[1] * c + up[1] * s, right[2] * c + up[2] * s];
    up = [up[0] * c - right[0] * s, up[1] * c - right[1] * s, up[2] * c - right[2] * s];
    right = r2;
  }
  return { pos, right, up, fwd, tanY: Math.tan((fovYdeg * Math.PI) / 360) };
}

/** Halton low-discrepancy sequence, base b, index i ≥ 1 */
export function halton(i: number, b: number): number {
  let f = 1, r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}

export interface TaaOptions {
  /** internal / output resolution per axis (default 0.5) */
  ratio?: number;
  /** jitter sequence length (default 16) */
  samples?: number;
  /** blend weight of a perfectly placed new sample (default 0.12; lower = smoother, more lag) */
  alpha?: number;
  /** variance-clip width in standard deviations (default 1.1; higher = less flicker, more ghosting) */
  gamma?: number;
  /**
   * share the render targets with the other TAA instances (default true). A secondary instance at
   * another size (e.g. a low-res pass) should use its own targets, or the shared ones get reallocated.
   */
  pool?: boolean;
}

const progs = new WeakMap<Gfx, Program>();
/**
 * Render targets are pooled per context: only one scene draws at a time, so all TAA instances share
 * one internal target and one history pair (≈ 100 MB at 3024×1890 instead of that per scene). A new
 * owner starts from an empty history (scene changes are cuts anyway).
 */
interface Pool {
  input: Target | null;
  hist: [Target | null, Target | null];
  owner: TAA | null;
}
const pools = new WeakMap<Gfx, Pool>();

export class TAA {
  g: Gfx;
  ratio: number;
  samples: number;
  alpha: number;
  gamma: number;
  /** jitter of the current frame in internal pixels, each component in [-0.5, 0.5] */
  jitter: [number, number] = [0, 0];
  /** world motion since the previous frame of rig-attached geometry (pixels with negative depth) */
  rigDelta: Vec3 = [0, 0, 0];
  private prog: Program;
  private pool: Pool;
  private cur = 0;
  private fbos = new Map<string, WebGLFramebuffer>();
  private texIds = new WeakMap<WebGLTexture, number>();
  private nextTexId = 1;
  private cam: TaaCamera | null = null;
  private prev: TaaCamera | null = null;
  private n = 0;
  private needReset = true;
  private outAspect = 1;

  constructor(g: Gfx, opts: TaaOptions = {}) {
    this.g = g;
    this.ratio = opts.ratio ?? 0.5;
    this.samples = opts.samples ?? 16;
    this.alpha = opts.alpha ?? 0.12;
    this.gamma = opts.gamma ?? 1.1;
    // one resolve program per context, shared by every TAA instance
    let p = progs.get(g);
    if (!p) progs.set(g, (p = program(g, 'post/taa')));
    this.prog = p;
    let pool = opts.pool === false ? null : pools.get(g);
    if (!pool) {
      pool = { input: null, hist: [null, null], owner: null };
      if (opts.pool !== false) pools.set(g, pool);
    }
    this.pool = pool;
  }

  /** the scene renders into this (MRT: colour RGBA16F, depth R32F), sized ratio × output */
  get input(): Target | null {
    return this.pool.input;
  }
  private get hist() {
    return this.pool.hist;
  }

  programs(): Program[] {
    return [this.prog];
  }

  /** forget the history (camera cut) */
  reset() {
    this.needReset = true;
  }

  /**
   * Start a frame: (re)size the internal target to `ratio` × `out`, advance the jitter, remember the
   * camera, bind the internal target. Returns it (scenes may read its size).
   */
  begin(f: FrameCtx, out: Target, cam: TaaCamera): Target {
    const g = this.g, gl = g.gl;
    const w = Math.max(1, Math.round(out.w * this.ratio)), h = Math.max(1, Math.round(out.h * this.ratio));
    const P = this.pool;
    const prevIn = P.input;
    P.input = ensureTarget(g, P.input, w, h, { formats: [gl.RGBA16F, gl.R32F], filter: gl.NEAREST });
    const h0 = P.hist[0];
    P.hist[0] = ensureTarget(g, P.hist[0], out.w, out.h, { formats: [gl.RGBA16F] });
    P.hist[1] = ensureTarget(g, P.hist[1], out.w, out.h, { formats: [gl.RGBA16F] });
    if (prevIn !== P.input || h0 !== P.hist[0] || f.jumped || P.owner !== this) this.needReset = true;
    if (h0 !== P.hist[0]) this.dropFbos();
    P.owner = this;
    this.n = (this.n % this.samples) + 1;
    this.jitter = [halton(this.n, 2) - 0.5, halton(this.n, 3) - 0.5];
    this.prev = this.cam ?? cam;
    this.cam = cam;
    this.outAspect = out.w / out.h;
    bindTarget(g, P.input);
    return P.input;
  }

  /** set the camera / jitter uniforms of lib/taa on a scene program (call after use()) */
  uniforms(p: Program) {
    const c = this.cam!;
    const inp = this.input!;
    p.set('camPos', c.pos)
      .set('camRight', c.right)
      .set('camUp', c.up)
      .set('camFwd', c.fwd)
      .set('camTan', c.tanY * this.outAspect, c.tanY)
      .set('taaJitter', this.jitter[0], this.jitter[1])
      .set('taaRes', inp.w, inp.h);
  }

  /** current camera (as passed to begin) */
  get camera(): TaaCamera {
    return this.cam!;
  }

  /** resolve the internal frame into `out` (the scene's hdr target) and the history */
  resolve(out: Target) {
    const g = this.g, gl = g.gl;
    const read = this.hist[this.cur]!, write = this.hist[1 - this.cur]!;
    const fb = this.fbo(write, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, out.w, out.h);
    gl.disable(gl.BLEND);
    if (this.prog.use()) {
      const c = this.cam!, p = this.prev!;
      const inp = this.input!;
      this.prog
        .tex('cur', inp.tex[0], 0)
        .tex('curDepth', inp.tex[1], 1)
        .tex('hist', read.tex[0], 2)
        .set('inRes', inp.w, inp.h)
        .set('outRes', out.w, out.h)
        .set('jitter', this.jitter[0], this.jitter[1])
        .set('cPos', c.pos)
        .set('cRight', c.right)
        .set('cUp', c.up)
        .set('cFwd', c.fwd)
        .set('cTan', c.tanY * this.outAspect, c.tanY)
        .set('pPos', p.pos)
        .set('pRight', p.right)
        .set('pUp', p.up)
        .set('pFwd', p.fwd)
        .set('pTan', p.tanY * this.outAspect, p.tanY)
        .set('alpha', this.alpha)
        .set('gamma', this.gamma)
        .set('reset', this.needReset ? 1 : 0)
        .set('rigDelta', this.rigDelta);
      fullscreen(g);
    }
    this.needReset = false;
    this.cur = 1 - this.cur;
    bindTarget(g, out);
  }

  /** the resolved image of the last frame (output resolution) — e.g. for feedback effects */
  get output(): Target {
    return this.hist[this.cur]!;
  }

  private texId(t: WebGLTexture) {
    let id = this.texIds.get(t);
    if (!id) this.texIds.set(t, (id = this.nextTexId++));
    return id;
  }

  /** an FBO writing the history (attachment 0) and the scene's hdr (attachment 1) in one pass */
  private fbo(hist: Target, out: Target): WebGLFramebuffer {
    const gl = this.g.gl;
    const key = `${this.texId(hist.tex[0])}:${this.texId(out.tex[0])}`;
    let fb = this.fbos.get(key);
    if (!fb) {
      if (this.fbos.size > 8) this.dropFbos();
      fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hist.tex[0], 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, out.tex[0], 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      this.fbos.set(key, fb);
    }
    return fb;
  }

  private dropFbos() {
    for (const fb of this.fbos.values()) this.g.gl.deleteFramebuffer(fb);
    this.fbos.clear();
  }
}
