// Thin WebGL2 layer: context, programs (parallel compile + hot reload), render targets,
// a buffer-less fullscreen triangle. Deliberately small — scenes talk to raw gl for the rest.

import { resolveShader, onShadersChanged } from './shaders.ts';

export type GL = WebGL2RenderingContext;

export interface Gfx {
  gl: GL;
  canvas: HTMLCanvasElement;
  /** KHR_parallel_shader_compile, if present */
  parallel: { COMPLETION_STATUS_KHR: number } | null;
  /** empty VAO for gl_VertexID-driven draws */
  vao: WebGLVertexArrayObject;
}

export function createGfx(canvas: HTMLCanvasElement): Gfx {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    desynchronized: false,
  });
  if (!gl) throw new Error('ERROR: NO WEBGL2');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('ERROR: NO FLOAT RENDER TARGETS');
  // PLAN §7.1: the whole pipeline is linear Display P3, output encoded with the sRGB curve into a P3 canvas
  if ('drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = 'display-p3';
  if ('unpackColorSpace' in gl) gl.unpackColorSpace = 'display-p3';
  gl.getExtension('EXT_float_blend');
  gl.getExtension('OES_texture_float_linear');
  const parallel = gl.getExtension('KHR_parallel_shader_compile');
  return { gl, canvas, parallel, vao: gl.createVertexArray()! };
}

// ---------------------------------------------------------------------------------------------
// Programs

const FULLSCREEN_VS = `#version 300 es
out vec2 uv;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

interface UniformInfo {
  loc: WebGLUniformLocation;
  type: number;
  size: number;
}

/**
 * A program built from shader sources by name (see shaders.ts) or inline strings.
 * Sources are re-resolved and the program rebuilt when a .glsl file changes (dev HMR).
 * Until the first successful build `ready` is false and `use()` returns false.
 */
export class Program {
  gl: GL;
  vsName: string;
  fsName: string;
  defines: string;
  prog: WebGLProgram | null = null;
  pending: WebGLProgram | null = null;
  pendingShaders: WebGLShader[] = [];
  uniforms = new Map<string, UniformInfo>();
  ready = false;
  error = '';
  label: string;

  constructor(gl: GL, fs: string, vs = '', defines = '') {
    this.gl = gl;
    this.fsName = fs;
    this.vsName = vs;
    this.defines = defines;
    this.label = fs.startsWith('#') || fs.includes('\n') ? 'inline' : fs;
  }

  /** Start compiling (non-blocking with KHR_parallel_shader_compile). */
  compile() {
    const gl = this.gl;
    const vsSrc = this.vsName ? resolveShader(this.vsName, this.defines) : FULLSCREEN_VS;
    const fsSrc = resolveShader(this.fsName, this.defines);
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(vs, vsSrc);
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(vs);
    gl.compileShader(fs);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    this.pending = p;
    this.pendingShaders = [vs, fs];
  }

  /** Poll a pending compile; returns true once it's finished (successfully or not). */
  poll(parallel: Gfx['parallel']): boolean {
    const gl = this.gl;
    const p = this.pending;
    if (!p) return true;
    if (parallel && !gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR)) return false;
    this.finish();
    return true;
  }

  finish() {
    const gl = this.gl;
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    const [vs, fs] = this.pendingShaders;
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log =
        (gl.getShaderInfoLog(vs) || '') + (gl.getShaderInfoLog(fs) || '') + (gl.getProgramInfoLog(p) || '');
      this.error = `[${this.label}] ${log}`;
      console.error(this.error, '\n', numbered(gl.getShaderSource(fs) || ''));
      gl.deleteProgram(p);
    } else {
      if (this.prog) gl.deleteProgram(this.prog);
      this.prog = p;
      this.ready = true;
      this.error = '';
      this.uniforms.clear();
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i)!;
        const name = info.name.replace(/\[0\]$/, '');
        this.uniforms.set(name, { loc: gl.getUniformLocation(p, info.name)!, type: info.type, size: info.size });
      }
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  }

  use(): boolean {
    if (!this.prog) return false;
    this.gl.useProgram(this.prog);
    return true;
  }

  /** Set a uniform by name; silently ignores unknown (optimised-out) names. */
  set(name: string, ...v: number[]): this;
  set(name: string, v: Float32Array | number[] | Int32Array): this;
  set(name: string, ...args: any[]): this {
    const u = this.uniforms.get(name);
    if (!u) return this;
    const gl = this.gl;
    const a = args.length === 1 && typeof args[0] !== 'number' ? args[0] : args;
    switch (u.type) {
      case gl.FLOAT: u.size > 1 ? gl.uniform1fv(u.loc, a) : gl.uniform1f(u.loc, a[0]); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, a); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, a); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, a); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, a); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, a); break;
      case gl.INT: case gl.BOOL:
      case gl.SAMPLER_2D: case gl.SAMPLER_3D: case gl.SAMPLER_2D_ARRAY:
      case gl.INT_SAMPLER_2D: case gl.UNSIGNED_INT_SAMPLER_2D:
        u.size > 1 ? gl.uniform1iv(u.loc, a) : gl.uniform1i(u.loc, a[0]); break;
      case gl.INT_VEC2: gl.uniform2iv(u.loc, a); break;
      case gl.INT_VEC3: gl.uniform3iv(u.loc, a); break;
      case gl.INT_VEC4: gl.uniform4iv(u.loc, a); break;
      case gl.UNSIGNED_INT: gl.uniform1ui(u.loc, a[0]); break;
      default: throw new Error(`uniform type ${u.type} not handled (${name})`);
    }
    return this;
  }

  /** Bind a texture to unit `unit` and point sampler `name` at it. */
  tex(name: string, tex: WebGLTexture | null, unit: number, target: number = this.gl.TEXTURE_2D): this {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, tex);
    return this.set(name, unit);
  }
}

function numbered(src: string) {
  return src.split('\n').map((l, i) => `${String(i + 1).padStart(4)} ${l}`).join('\n');
}

const allPrograms = new Set<Program>();

export function program(g: Gfx, fs: string, vs = '', defines = ''): Program {
  const p = new Program(g.gl, fs, vs, defines);
  allPrograms.add(p);
  return p;
}

/**
 * Compile programs in parallel and resolve when all are linked. With KHR_parallel_shader_compile
 * the driver compiles off-thread and we only poll; `onProgress(done, total)` drives the loader.
 */
export function compileAll(g: Gfx, progs: Program[], onProgress?: (done: number, total: number) => void): Promise<void> {
  for (const p of progs) p.compile();
  return new Promise((resolve) => {
    const tick = () => {
      let done = 0;
      for (const p of progs) if (p.poll(g.parallel)) done++;
      onProgress?.(done, progs.length);
      if (done === progs.length) resolve();
      else setTimeout(tick, 4);
    };
    tick();
  });
}

// dev: rebuild every program when a .glsl file changes, keeping the demo time
onShadersChanged(() => {
  for (const p of allPrograms) {
    p.compile();
    p.finish();
  }
});

// ---------------------------------------------------------------------------------------------
// Render targets

export interface TargetSpec {
  /** internal formats per color attachment, e.g. [gl.RGBA16F] */
  formats: number[];
  depth?: boolean;
  /** gl.LINEAR (default) or gl.NEAREST */
  filter?: number;
  wrap?: number;
}

export interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture[];
  depth: WebGLRenderbuffer | null;
  w: number;
  h: number;
  spec: TargetSpec;
}

const FORMAT_INFO: Record<number, [number, number]> = {};
function formatInfo(gl: GL, f: number): [number, number] {
  if (!FORMAT_INFO[gl.RGBA16F]) {
    FORMAT_INFO[gl.RGBA16F] = [gl.RGBA, gl.HALF_FLOAT];
    FORMAT_INFO[gl.RGBA32F] = [gl.RGBA, gl.FLOAT];
    FORMAT_INFO[gl.RG16F] = [gl.RG, gl.HALF_FLOAT];
    FORMAT_INFO[gl.RG32F] = [gl.RG, gl.FLOAT];
    FORMAT_INFO[gl.R16F] = [gl.RED, gl.HALF_FLOAT];
    FORMAT_INFO[gl.R32F] = [gl.RED, gl.FLOAT];
    FORMAT_INFO[gl.R11F_G11F_B10F] = [gl.RGB, gl.HALF_FLOAT];
    FORMAT_INFO[gl.RGBA8] = [gl.RGBA, gl.UNSIGNED_BYTE];
    FORMAT_INFO[gl.R8] = [gl.RED, gl.UNSIGNED_BYTE];
  }
  return FORMAT_INFO[f];
}

export function createTarget(g: Gfx, w: number, h: number, spec: TargetSpec): Target {
  const gl = g.gl;
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const tex = spec.formats.map((f, i) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    const [fmt, type] = formatInfo(gl, f);
    gl.texImage2D(gl.TEXTURE_2D, 0, f, w, h, 0, fmt, type, null);
    const filter = spec.filter ?? gl.LINEAR;
    const wrap = spec.wrap ?? gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    return t;
  });
  gl.drawBuffers(spec.formats.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  let depth: WebGLRenderbuffer | null = null;
  if (spec.depth) {
    depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  }
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete 0x${status.toString(16)}`);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, depth, w, h, spec };
}

export function destroyTarget(g: Gfx, t: Target) {
  const gl = g.gl;
  gl.deleteFramebuffer(t.fb);
  t.tex.forEach((x) => gl.deleteTexture(x));
  if (t.depth) gl.deleteRenderbuffer(t.depth);
}

/** (Re)create a target if the size changed. */
export function ensureTarget(g: Gfx, t: Target | null, w: number, h: number, spec: TargetSpec): Target {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (t && t.w === w && t.h === h) return t;
  if (t) destroyTarget(g, t);
  return createTarget(g, w, h, spec);
}

/** Bind a target (or the screen when null) and set the viewport. */
export function bindTarget(g: Gfx, t: Target | null) {
  const gl = g.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
  gl.viewport(0, 0, t ? t.w : gl.drawingBufferWidth, t ? t.h : gl.drawingBufferHeight);
}

/** Draw the buffer-less fullscreen triangle with the currently bound program. */
export function fullscreen(g: Gfx) {
  g.gl.bindVertexArray(g.vao);
  g.gl.drawArrays(g.gl.TRIANGLES, 0, 3);
}

/** A double-buffered target for feedback effects (phosphor persistence, flame density, TAA history). */
export class PingPong {
  a: Target | null = null;
  b: Target | null = null;
  spec: TargetSpec;
  constructor(spec: TargetSpec) {
    this.spec = spec;
  }
  ensure(g: Gfx, w: number, h: number): boolean {
    const old = this.a;
    this.a = ensureTarget(g, this.a, w, h, this.spec);
    this.b = ensureTarget(g, this.b, w, h, this.spec);
    return old !== this.a;
  }
  swap() {
    const t = this.a;
    this.a = this.b;
    this.b = t;
  }
  /** read = a, write = b; call swap() after writing */
  get read() {
    return this.a!;
  }
  get write() {
    return this.b!;
  }
}

export function clearTarget(g: Gfx, t: Target | null, r = 0, gg = 0, b = 0, a = 0) {
  bindTarget(g, t);
  g.gl.clearColor(r, gg, b, a);
  g.gl.clear(g.gl.COLOR_BUFFER_BIT);
}
