// S14's embers: 65536 point sprites (256², the +1 is the light point) that leave the fixation point on
// the heartbeats and settle into the face (shaders/face.glsl.ts: EMBER_*). Fully analytic in time, so
// any frame can be drawn after a seek; the only state is the table of targets, drawn once from the
// face design on the GPU and redrawn when the design changes (lab sliders).

import { Pass, type Ctx, type UVal } from './gl.ts';
import { EMBER_TABLE_FS, EMBER_VS, EMBER_FS } from './shaders/face.glsl.ts';

export const EMBER_SIDE = 256;
export const EMBER_COUNT = EMBER_SIDE * EMBER_SIDE;

export class Embers {
  private ctx: Ctx;
  private table: Pass;
  private pass: Pass;
  private tex: WebGLTexture;
  private fb: WebGLFramebuffer;
  private key = '';

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    const gl = ctx.gl;
    if (!gl.getExtension('EXT_color_buffer_float')) console.warn('[embers] no float render targets');
    this.table = new Pass(ctx, EMBER_TABLE_FS, 'S14 ember table');
    this.pass = new Pass(ctx, EMBER_FS, 'S14 embers', EMBER_VS);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, EMBER_SIDE, EMBER_SIDE, 0, gl.RGBA, gl.FLOAT, null);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
    this.fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** (re)draw the target table if the face design changed; restores the framebuffer and viewport */
  ensure(design: Record<string, UVal>) {
    const key = JSON.stringify(design, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as Float32Array) : v));
    if (key === this.key) return;
    this.key = key;
    const gl = this.ctx.gl;
    const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, EMBER_SIDE, EMBER_SIDE);
    gl.disable(gl.BLEND);
    this.table.draw({ ...design, res: [EMBER_SIDE, EMBER_SIDE], dither: 0, candidates: 12 });
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
  }

  /** draw over the current target (premultiplied: light on the dark field, ink on the white) */
  draw(u: Record<string, UVal>) {
    const gl = this.ctx.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    this.pass.drawPoints({ ...u, table: 0 }, EMBER_COUNT);
    gl.disable(gl.BLEND);
  }
}
