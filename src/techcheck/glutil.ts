// Minimal WebGL2 helpers for the techcheck page (deliberately independent from src/gfx).
import { sleep } from './util.ts';

export type GL = WebGL2RenderingContext;

/** Fullscreen triangle from gl_VertexID, no buffers. */
export const FS_TRI_VS = `#version 300 es
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

export function compileShader(gl: GL, type: GLenum, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader returned null (context lost?)');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

export function linkProgram(gl: GL, vs: WebGLShader, fs: WebGLShader, tfVaryings?: string[]): WebGLProgram {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  if (tfVaryings) gl.transformFeedbackVaryings(p, tfVaryings, gl.SEPARATE_ATTRIBS);
  gl.linkProgram(p);
  return p;
}

function annotate(src: string, log: string): string {
  const m = /ERROR:\s*\d+:(\d+)/.exec(log);
  if (!m) return log;
  const line = +m[1];
  const lines = src.split('\n');
  const ctx = lines
    .slice(Math.max(0, line - 3), line + 2)
    .map((l, i) => `${Math.max(1, line - 2) + i}: ${l}`)
    .join('\n');
  return `${log}\n${ctx}`;
}

/** Returns null if OK, or an error string with annotated source. Blocks (sync round trip). */
export function programError(gl: GL, p: WebGLProgram, vs: WebGLShader, fs: WebGLShader, vsSrc = '', fsSrc = ''): string | null {
  if (gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
  const parts: string[] = [];
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) parts.push('VS: ' + annotate(vsSrc, gl.getShaderInfoLog(vs) ?? ''));
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) parts.push('FS: ' + annotate(fsSrc, gl.getShaderInfoLog(fs) ?? ''));
  parts.push('LINK: ' + (gl.getProgramInfoLog(p) ?? ''));
  return parts.join('\n');
}

export function makeProgram(gl: GL, vsSrc: string, fsSrc: string, tfVaryings?: string[]): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = linkProgram(gl, vs, fs, tfVaryings);
  const err = programError(gl, p, vs, fs, vsSrc, fsSrc);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (err) {
    gl.deleteProgram(p);
    throw new Error(err);
  }
  return p;
}

export function makeTex(
  gl: GL,
  w: number,
  h: number,
  internal: GLenum,
  format: GLenum,
  type: GLenum,
  filter: GLenum = gl.NEAREST,
  data: ArrayBufferView | null = null,
): WebGLTexture {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return t;
}

/** Immutable storage texture (texStorage2D) — what an engine should use for render targets. */
export function makeRT(gl: GL, w: number, h: number, internal: GLenum, filter: GLenum = gl.LINEAR): WebGLTexture {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return t;
}

export function fboStatusName(gl: GL, s: GLenum): string {
  const names: Record<number, string> = {
    [gl.FRAMEBUFFER_COMPLETE]: 'COMPLETE',
    [gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT]: 'INCOMPLETE_ATTACHMENT',
    [gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT]: 'MISSING_ATTACHMENT',
    [gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS]: 'INCOMPLETE_DIMENSIONS',
    [gl.FRAMEBUFFER_UNSUPPORTED]: 'UNSUPPORTED',
    [gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE]: 'INCOMPLETE_MULTISAMPLE',
  };
  return names[s] ?? `0x${s.toString(16)}`;
}

/** FBO with the given color textures as attachments 0..n-1. Returns status too (doesn't throw). */
export function makeFbo(gl: GL, texs: WebGLTexture[]): { fbo: WebGLFramebuffer; status: string } {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const bufs: GLenum[] = [];
  texs.forEach((t, i) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    bufs.push(gl.COLOR_ATTACHMENT0 + i);
  });
  gl.drawBuffers(bufs);
  const status = fboStatusName(gl, gl.checkFramebufferStatus(gl.FRAMEBUFFER));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, status };
}

export function glErrorName(gl: GL, e: GLenum): string {
  const n: Record<number, string> = {
    [gl.NO_ERROR]: 'NO_ERROR',
    [gl.INVALID_ENUM]: 'INVALID_ENUM',
    [gl.INVALID_VALUE]: 'INVALID_VALUE',
    [gl.INVALID_OPERATION]: 'INVALID_OPERATION',
    [gl.INVALID_FRAMEBUFFER_OPERATION]: 'INVALID_FRAMEBUFFER_OPERATION',
    [gl.OUT_OF_MEMORY]: 'OUT_OF_MEMORY',
    [gl.CONTEXT_LOST_WEBGL]: 'CONTEXT_LOST_WEBGL',
  };
  return n[e] ?? `0x${e.toString(16)}`;
}

export function drainErrors(gl: GL): string[] {
  const out: string[] = [];
  for (let i = 0; i < 16; i++) {
    const e = gl.getError();
    if (e === gl.NO_ERROR) break;
    out.push(glErrorName(gl, e));
  }
  return out;
}

export interface TimingResult {
  /** median GPU ms per iteration from EXT_disjoint_timer_query_webgl2 (consecutive differences), null if unavailable */
  gpu: number | null;
  /** wall ms per iteration: N submissions + one readPixels sync, divided by N */
  wall: number;
  /** raw query results (ms). On ANGLE-Metal they are cumulative from the command-buffer start. */
  gpuRaw: number[];
  gpuDiffs: number[];
  disjoint: boolean;
}

/**
 * GPU timing that survives three traps found on Chrome/ANGLE-Metal/Apple GPUs:
 *  1. gl.finish() does not block → sync with a 1×1 readPixels instead;
 *  2. TBDR hidden-surface removal collapses repeated opaque draws into the same target → callers must
 *     alternate targets (fn(i) uses i & 1);
 *  3. TIME_ELAPSED results are cumulative from the start of the Metal command buffer → use differences.
 */
export class GpuTimer {
  ext: any | null;
  gl: GL;
  private syncFbo: WebGLFramebuffer;
  private px = new Uint8Array(4);
  constructor(gl: GL) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const t = makeTex(gl, 1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.syncFbo = makeFbo(gl, [t]).fbo;
  }
  get available(): boolean {
    return !!this.ext;
  }
  /**
   * Blocks until all previously submitted GPU work has completed. The 1×1 target is cleared first:
   * ANGLE-Metal tracks per-resource GPU use, so reading an idle texture returns immediately; a fresh
   * write makes the read wait for a command buffer that is ordered after everything before it.
   */
  sync() {
    const gl = this.gl;
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const cc = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    if (scissor) gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.syncFbo);
    gl.viewport(0, 0, 1, 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    gl.clearColor(cc[0], cc[1], cc[2], cc[3]);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
  }
  /** Wall time of fn() + sync (single shot), ms. */
  once(fn: () => void): number {
    this.sync();
    const t = performance.now();
    fn();
    this.sync();
    return performance.now() - t;
  }

  async measure(fn: (i: number) => void, iters: number, warmup = 2, opts: { gpu?: boolean; wall?: boolean } = {}): Promise<TimingResult> {
    const gl = this.gl;
    for (let i = 0; i < warmup; i++) fn(i);
    this.sync();
    let wall = NaN;
    if (opts.wall !== false) {
      const t0 = performance.now();
      for (let i = 0; i < iters; i++) fn(i);
      this.sync();
      wall = (performance.now() - t0) / iters;
    }
    let gpu: number | null = null;
    const raw: number[] = [];
    const diffs: number[] = [];
    let disjoint = false;
    if (this.ext && opts.gpu !== false) {
      const ext = this.ext;
      gl.getParameter(ext.GPU_DISJOINT_EXT); // clears the flag
      this.sync(); // first query starts in a fresh command buffer
      const qs: WebGLQuery[] = [];
      for (let i = 0; i < iters; i++) {
        const q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        fn(i);
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        qs.push(q);
      }
      this.sync();
      const deadline = performance.now() + 8000;
      while (performance.now() < deadline) {
        await sleep(4);
        if (gl.getQueryParameter(qs[qs.length - 1], gl.QUERY_RESULT_AVAILABLE)) break;
      }
      disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
      for (const q of qs) {
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) raw.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
      for (let i = 0; i < raw.length; i++) diffs.push(i === 0 || raw[i] < raw[i - 1] ? raw[i] : raw[i] - raw[i - 1]);
      if (!disjoint && diffs.length) {
        const s = [...diffs].sort((a, b) => a - b);
        gpu = s[s.length >> 1];
      }
    }
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    return { gpu, wall, gpuRaw: raw.map(r3), gpuDiffs: diffs.map(r3), disjoint };
  }
}

/** Draw a float texture to the default framebuffer with a simple tonemap. */
export class Presenter {
  prog: WebGLProgram;
  gl: GL;
  constructor(gl: GL) {
    this.gl = gl;
    this.prog = makeProgram(
      gl,
      FS_TRI_VS,
      `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uRes; uniform float uExp; uniform int uMode;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = max(texture(uTex, uv).rgb * uExp, 0.);
  if (uMode == 0) c = c / (1. + c);
  else if (uMode == 1) c = 1. - exp(-c);
  else c = clamp(c, 0., 1.);
  o = vec4(pow(c, vec3(1. / 2.2)), 1.);
}`,
    );
  }
  draw(tex: WebGLTexture, mode = 0, exposure = 1) {
    const gl = this.gl;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uTex'), 0);
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uRes'), w, h);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uExp'), exposure);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uMode'), mode);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/** The shared "bench" context used by the heavy GPU checks (visible canvas so the user sees what runs). */
export class Bench {
  canvas: HTMLCanvasElement;
  gl!: GL;
  timer!: GpuTimer;
  presenter!: Presenter;
  label: HTMLElement;
  lostCount = 0;

  constructor(canvas: HTMLCanvasElement, label: HTMLElement) {
    this.canvas = canvas;
    this.label = label;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lostCount++;
    });
    this.init();
  }

  init() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round((r.width || 480) * dpr));
    this.canvas.height = Math.max(1, Math.round((r.height || 270) * dpr));
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_float_blend');
    gl.getExtension('OES_texture_float_linear');
    this.timer = new GpuTimer(gl);
    this.presenter = new Presenter(gl);
  }

  /** Recreate after a context loss (replaces the canvas element). */
  ensure() {
    if (!this.gl.isContextLost()) return;
    const fresh = this.canvas.cloneNode() as HTMLCanvasElement;
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    fresh.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lostCount++;
    });
    this.init();
  }

  setLabel(s: string) {
    this.label.textContent = s;
  }
}
