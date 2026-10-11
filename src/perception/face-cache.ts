// The face design is static once it is complete (S14's hold and erasure), so it is evaluated once per
// resolution into an R16F texture read with texelFetch at gl_FragCoord. Only the eyes (while closed /
// opening) are evaluated live. Rebuilt when the canvas size or the design changes (lab sliders).

import { Pass, type Ctx, type UVal } from './gl.ts';
import { FACE_CACHE_FS } from './shaders/face.glsl.ts';

export class FaceCache {
  private ctx: Ctx;
  private pass: Pass;
  private tex: WebGLTexture | null = null;
  private fb: WebGLFramebuffer | null = null;
  private w = 0;
  private h = 0;
  private key = '';

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    this.pass = new Pass(ctx, FACE_CACHE_FS, 'S14 design cache');
  }

  private alloc(w: number, h: number) {
    const gl = this.ctx.gl;
    if (this.tex && this.w === w && this.h === h) return;
    if (this.tex) gl.deleteTexture(this.tex);
    this.fb ??= gl.createFramebuffer()!;
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, w, h);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.w = w;
    this.h = h;
    this.key = '';
  }

  /** make the cache hold the design for these uniforms at `res` (`build` false: only allocate), bind it
   *  to texture `unit`; restores the framebuffer and the viewport */
  use(u: Record<string, UVal>, res: [number, number], unit: number, build = true) {
    const gl = this.ctx.gl;
    this.alloc(res[0], res[1]);
    const key = JSON.stringify(u, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as Float32Array) : v));
    if (build && this.key !== key) {
      this.key = key;
      const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      const vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
      gl.viewport(0, 0, this.w, this.h);
      gl.disable(gl.BLEND);
      this.pass.draw({ ...u, res, dither: 0 });
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.activeTexture(gl.TEXTURE0);
  }
}
