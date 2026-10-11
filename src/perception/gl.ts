// Minimal WebGL2 for the perception lab: one fullscreen-triangle program per illusion, uniforms set
// by name with type inferred from the active-uniform table. Self-contained (does not use src/gfx).

import { PRELUDE, FULLSCREEN_VS } from './shaders/common.glsl.ts';
import type { Space } from './color.ts';

export interface Ctx {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  vao: WebGLVertexArrayObject;
  /** actual drawing-buffer colour space after the request */
  space: Space;
}

export function createCtx(canvas: HTMLCanvasElement, want: Space): Ctx {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('ERROR: NO WEBGL2');
  const ctx: Ctx = { gl, canvas, vao: gl.createVertexArray()!, space: 'srgb' };
  setSpace(ctx, want);
  return ctx;
}

/** request a drawing-buffer colour space; returns what the browser actually gave us */
export function setSpace(ctx: Ctx, want: Space): Space {
  const gl = ctx.gl as WebGL2RenderingContext & { drawingBufferColorSpace?: string };
  try {
    if ('drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = want;
  } catch {
    /* unsupported value */
  }
  ctx.space = gl.drawingBufferColorSpace === 'display-p3' ? 'display-p3' : 'srgb';
  return ctx.space;
}

export type UVal = number | boolean | ArrayLike<number>;

export class Pass {
  prog: WebGLProgram;
  uniforms = new Map<string, { loc: WebGLUniformLocation; type: number; size: number }>();
  readonly ctx: Ctx;
  name: string;
  /** `vsBody` (optional, without #version): a custom vertex shader, e.g. for point sprites */
  constructor(ctx: Ctx, fsBody: string, name: string, vsBody?: string) {
    this.ctx = ctx;
    this.name = name;
    const gl = ctx.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s) ?? '';
        const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(4)} ${l}`).join('\n');
        console.error(`[${name}] shader compile failed:\n${log}\n${numbered}`);
        throw new Error(`[${name}] ${log}`);
      }
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsBody ? PRELUDE + vsBody : FULLSCREEN_VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, PRELUDE + fsBody));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`[${name}] link: ${gl.getProgramInfoLog(p)}`);
    this.prog = p;
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!;
      const key = info.name.replace(/\[0\]$/, '');
      this.uniforms.set(key, { loc: gl.getUniformLocation(p, info.name)!, type: info.type, size: info.size });
    }
  }

  /** bind the program and set uniforms (samplers take a texture unit) */
  set(u: Record<string, UVal>) {
    const gl = this.ctx.gl;
    gl.useProgram(this.prog);
    for (const [k, v] of Object.entries(u)) {
      const e = this.uniforms.get(k);
      if (!e) continue; // optimised out or not used by this shader
      const a = typeof v === 'number' ? [v] : typeof v === 'boolean' ? [v ? 1 : 0] : v;
      switch (e.type) {
        case gl.FLOAT: gl.uniform1fv(e.loc, a as Float32List); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(e.loc, a as Float32List); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(e.loc, a as Float32List); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(e.loc, a as Float32List); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(e.loc, false, a as Float32List); break;
        case gl.INT: case gl.BOOL: case gl.SAMPLER_2D: gl.uniform1iv(e.loc, Array.from(a as ArrayLike<number>, Math.round)); break;
      }
    }
  }

  draw(u: Record<string, UVal>) {
    this.set(u);
    const gl = this.ctx.gl;
    gl.bindVertexArray(this.ctx.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** `n` buffer-less points (the vertex shader reads gl_VertexID) */
  drawPoints(u: Record<string, UVal>, n: number) {
    this.set(u);
    const gl = this.ctx.gl;
    gl.bindVertexArray(this.ctx.vao);
    gl.drawArrays(gl.POINTS, 0, n);
  }
}
