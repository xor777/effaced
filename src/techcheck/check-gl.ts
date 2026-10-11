// A. WebGL2 basics · B. Extensions · C. Float render targets & blending
import type { Ctx } from './main.ts';
import { FS_TRI_VS, type GL, makeProgram, makeTex, makeFbo, drainErrors } from './glutil.ts';
import { fmt } from './util.ts';

function scratchGL(attrs: WebGLContextAttributes = {}): { gl: GL; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const gl = canvas.getContext('webgl2', attrs);
  if (!gl) throw new Error('getContext("webgl2") returned null');
  return { gl, canvas };
}
function release(gl: GL) {
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

// ------------------------------------------------------------------------------------------ A

export async function checkBasics(c: Ctx) {
  // default attributes
  const { gl } = scratchGL();
  c.add('WebGL2 context', 'created', 'PASS');
  c.add('Default context attributes', JSON.stringify(gl.getContextAttributes()), 'INFO', '', gl.getContextAttributes());

  // the attributes the demo would request
  const demoAttrs: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  };
  try {
    const d = scratchGL(demoAttrs);
    const got = d.gl.getContextAttributes() ?? {};
    const mism = (Object.keys(demoAttrs) as (keyof WebGLContextAttributes)[]).filter((k) => got[k] !== demoAttrs[k]);
    c.add(
      'Demo context attributes honored',
      mism.length ? `differs: ${mism.map((k) => `${k}=${String(got[k])}`).join(', ')}` : 'all honored',
      mism.length ? 'WARN' : 'PASS',
      'requested alpha:false antialias:false depth:false stencil:false preserveDrawingBuffer:false high-performance',
      got,
    );
    release(d.gl);
  } catch (e) {
    c.add('Demo context attributes', String(e), 'FAIL');
  }

  try {
    const d = scratchGL({ desynchronized: true });
    const ds = d.gl.getContextAttributes()?.desynchronized;
    c.add('desynchronized: true (low-latency canvas)', String(ds), 'INFO', 'do NOT use: a desynchronized canvas bypasses the compositor frame → DOM overlays (matrix3d HUD, blend text) would no longer be frame-locked');
    release(d.gl);
  } catch {
    /* ignore */
  }

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  c.add('UNMASKED_VENDOR', String(vendor), 'INFO', dbg ? '' : 'WEBGL_debug_renderer_info missing → masked');
  const isApple = /Apple/i.test(String(renderer));
  c.add('UNMASKED_RENDERER', String(renderer), isApple ? 'PASS' : 'WARN', /Metal/i.test(String(renderer)) ? 'ANGLE Metal backend' : '');
  c.add('VERSION', String(gl.getParameter(gl.VERSION)), 'INFO');
  c.add('SHADING_LANGUAGE_VERSION', String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)), 'INFO');

  const lim = (name: string, pname: GLenum, min: number, note = '') => {
    const v = gl.getParameter(pname);
    const n = typeof v === 'number' ? v : Array.isArray(v) || ArrayBuffer.isView(v) ? Math.min(...(Array.from(v as ArrayLike<number>))) : NaN;
    const shown = typeof v === 'number' ? String(v) : `[${Array.from(v as ArrayLike<number>).join(', ')}]`;
    c.add(name, shown, n >= min ? 'PASS' : 'WARN', `need ≥ ${min}${note ? ' · ' + note : ''}`);
    return v;
  };
  lim('MAX_TEXTURE_SIZE', gl.MAX_TEXTURE_SIZE, 8192, '3024 native, 4096² particle state');
  lim('MAX_RENDERBUFFER_SIZE', gl.MAX_RENDERBUFFER_SIZE, 8192);
  lim('MAX_VIEWPORT_DIMS', gl.MAX_VIEWPORT_DIMS, 8192);
  lim('MAX_3D_TEXTURE_SIZE', gl.MAX_3D_TEXTURE_SIZE, 256, 'LUTs / volume noise');
  lim('MAX_ARRAY_TEXTURE_LAYERS', gl.MAX_ARRAY_TEXTURE_LAYERS, 256);
  lim('MAX_DRAW_BUFFERS', gl.MAX_DRAW_BUFFERS, 4, 'MRT: HDR + depth + velocity = 3');
  lim('MAX_COLOR_ATTACHMENTS', gl.MAX_COLOR_ATTACHMENTS, 4);
  lim('MAX_SAMPLES', gl.MAX_SAMPLES, 4);
  lim('MAX_FRAGMENT_UNIFORM_VECTORS', gl.MAX_FRAGMENT_UNIFORM_VECTORS, 256, 'uniform float S[17] etc.');
  lim('MAX_VERTEX_UNIFORM_VECTORS', gl.MAX_VERTEX_UNIFORM_VECTORS, 256);
  lim('MAX_UNIFORM_BLOCK_SIZE', gl.MAX_UNIFORM_BLOCK_SIZE, 16384);
  lim('MAX_VARYING_VECTORS', gl.MAX_VARYING_VECTORS, 15);
  lim('MAX_VARYING_COMPONENTS', gl.MAX_VARYING_COMPONENTS, 60);
  lim('MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS', gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS, 64);
  lim('MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS', gl.MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS, 4);
  lim('MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS', gl.MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS, 4);
  lim('MAX_TEXTURE_IMAGE_UNITS', gl.MAX_TEXTURE_IMAGE_UNITS, 16);
  lim('MAX_COMBINED_TEXTURE_IMAGE_UNITS', gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS, 32);
  lim('MAX_VERTEX_TEXTURE_IMAGE_UNITS', gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS, 16, 'vertex pulling from state textures');
  lim('MAX_VERTEX_ATTRIBS', gl.MAX_VERTEX_ATTRIBS, 16);
  lim('MAX_FRAGMENT_INPUT_COMPONENTS', gl.MAX_FRAGMENT_INPUT_COMPONENTS, 60);
  const pts = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
  c.add('ALIASED_POINT_SIZE_RANGE', `[${pts[0]}, ${pts[1]}]`, pts[1] >= 64 ? 'PASS' : 'WARN', 'max gl_PointSize for sprite splats');
  const lw = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) as Float32Array;
  c.add('ALIASED_LINE_WIDTH_RANGE', `[${lw[0]}, ${lw[1]}]`, 'INFO', lw[1] <= 1 ? 'wide lines unsupported → draw HDR lines (600-cell edges) as quads' : '');
  c.add('MAX_ELEMENT_INDEX', String(gl.getParameter(gl.MAX_ELEMENT_INDEX)), 'INFO');
  c.add('MAX_SERVER_WAIT_TIMEOUT', String(gl.getParameter(gl.MAX_SERVER_WAIT_TIMEOUT)), 'INFO', 'clientWaitSync max (ns)');

  for (const [stage, sname] of [
    [gl.FRAGMENT_SHADER, 'FS'],
    [gl.VERTEX_SHADER, 'VS'],
  ] as const) {
    const hf = gl.getShaderPrecisionFormat(stage, gl.HIGH_FLOAT)!;
    const hi = gl.getShaderPrecisionFormat(stage, gl.HIGH_INT)!;
    c.add(
      `${sname} highp float / int`,
      `float 2^±${hf.rangeMax} p${hf.precision} · int ±2^${hi.rangeMax}`,
      hf.precision >= 23 && hi.rangeMax >= 30 ? 'PASS' : 'WARN',
      'highp int: rangeMax 30 is full 32-bit per spec',
    );
  }
  const mf = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT)!;
  c.add('FS mediump float', `2^±${mf.rangeMax} p${mf.precision}`, 'INFO', mf.precision >= 23 ? 'mediump == highp here (no fp16 ALU savings via precision qualifiers)' : 'mediump is real fp16');
  release(gl);
}

// ------------------------------------------------------------------------------------------ B

export async function checkExtensions(c: Ctx) {
  const { gl } = scratchGL();
  const all = gl.getSupportedExtensions() ?? [];
  const has = (n: string) => all.includes(n);
  const want: [string, 'req' | 'imp' | 'nice', string][] = [
    ['EXT_color_buffer_float', 'req', 'float render targets (RGBA16F/32F, R11F_G11F_B10F)'],
    ['EXT_color_buffer_half_float', 'imp', 'explicit half-float RT support'],
    ['OES_texture_float_linear', 'imp', 'bilinear on RGBA32F (flame histogram/state)'],
    ['EXT_float_blend', 'imp', 'additive blending into RGBA32F'],
    ['KHR_parallel_shader_compile', 'imp', 'non-blocking compile in the loader'],
    ['EXT_disjoint_timer_query_webgl2', 'imp', 'GPU timing (dev HUD, dynamic resolution)'],
    ['WEBGL_multi_draw', 'nice', 'batched draws'],
    ['OES_draw_buffers_indexed', 'nice', 'per-attachment blend state (additive on one MRT target)'],
    ['EXT_texture_filter_anisotropic', 'nice', 'ground textures at grazing angles'],
    ['EXT_texture_norm16', 'nice', 'R16/RGBA16 unorm (precise LUTs)'],
    ['WEBGL_render_shared_exponent', 'nice', 'RGB9_E5 renderable'],
    ['WEBGL_clip_cull_distance', 'nice', ''],
    ['WEBGL_provoking_vertex', 'nice', ''],
    ['EXT_depth_clamp', 'nice', ''],
    ['EXT_clip_control', 'nice', 'reversed-Z'],
    ['EXT_conservative_depth', 'nice', ''],
    ['WEBGL_polygon_mode', 'nice', 'wireframe debug'],
    ['WEBGL_blend_func_extended', 'nice', 'dual-source blending'],
    ['WEBGL_draw_instanced_base_vertex_base_instance', 'nice', ''],
    ['WEBGL_multi_draw_instanced_base_vertex_base_instance', 'nice', ''],
    ['OVR_multiview2', 'nice', ''],
    ['WEBGL_compressed_texture_astc', 'nice', ''],
    ['WEBGL_compressed_texture_etc', 'nice', ''],
    ['WEBGL_compressed_texture_s3tc', 'nice', ''],
    ['WEBGL_stencil_texturing', 'nice', ''],
    ['EXT_texture_mirror_clamp_to_edge', 'nice', ''],
    ['WEBGL_debug_renderer_info', 'nice', ''],
    ['WEBGL_debug_shaders', 'nice', 'read translated (MSL) shader source'],
    ['WEBGL_lose_context', 'nice', 'context-loss testing'],
  ];
  for (const [name, level, note] of want) {
    const ok = has(name);
    c.add(name, ok ? 'yes' : 'no', ok ? 'PASS' : level === 'req' ? 'FAIL' : level === 'imp' ? 'WARN' : 'INFO', `${level === 'req' ? 'REQUIRED · ' : ''}${note}`);
  }
  const known = new Set(want.map((w) => w[0]));
  const others = all.filter((n) => !known.has(n));
  c.add(`All supported extensions (${all.length})`, others.length ? `+ ${others.join(', ')}` : '(all listed above)', 'INFO', '', all);
  release(gl);
}

// ------------------------------------------------------------------------------------------ C

const VAL_FS = `#version 300 es
precision highp float;
uniform vec4 uVal; out vec4 o;
void main(){ o = uVal; }`;

const MRT_FS = `#version 300 es
precision highp float;
layout(location=0) out vec4 oColor;
layout(location=1) out float oDepth;
layout(location=2) out vec2 oVel;
void main(){ oColor = vec4(5.0, 2.0, 0.5, 1.0); oDepth = 123.456; oVel = vec2(-0.75, 0.25); }`;

const SAMPLE_FS = `#version 300 es
precision highp float;
uniform highp sampler2D uT; out vec4 o;
void main(){ o = texture(uT, vec2(0.5, 0.5)); }`;

function readRGBA(gl: GL, attachment = 0): Float32Array {
  const px = new Float32Array(4);
  gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
  return px;
}
const v4 = (a: ArrayLike<number>, n = 4) => `(${Array.from(a).slice(0, n).map((x) => +x.toPrecision(7)).join(', ')})`;
const close = (a: ArrayLike<number>, b: number[], rel: number) => b.every((x, i) => Math.abs(a[i] - x) <= rel * Math.max(1, Math.abs(x)));

export async function checkFloatRT(c: Ctx) {
  const { gl } = scratchGL({ antialias: false, depth: false });
  const cbf = gl.getExtension('EXT_color_buffer_float');
  if (!cbf) {
    c.add('EXT_color_buffer_float', 'missing', 'FAIL', 'ERROR: NO FLOAT RENDER TARGETS');
    release(gl);
    return;
  }
  const rse = gl.getExtension('WEBGL_render_shared_exponent');
  const valProg = makeProgram(gl, FS_TRI_VS, VAL_FS);
  const uVal = gl.getUniformLocation(valProg, 'uVal');
  const S = 4;

  const drawVal = (val: number[], times = 1) => {
    gl.useProgram(valProg);
    gl.uniform4fv(uVal, val);
    for (let i = 0; i < times; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // --- write/readback per format
  const formats: [string, GLenum, GLenum, GLenum, number[], number, number][] = [
    // name, internal, format, type, value, channels, tolerance
    ['RGBA16F', gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, [3.5, -2.25, 1000, 0.125], 4, 1e-3],
    ['RGBA32F', gl.RGBA32F, gl.RGBA, gl.FLOAT, [123456.79, -2.5e-5, 1e10, 0.1], 4, 1e-6],
    ['R32F', gl.R32F, gl.RED, gl.FLOAT, [123.456, 0, 0, 1], 1, 1e-6],
    ['RG16F', gl.RG16F, gl.RG, gl.HALF_FLOAT, [-0.75, 0.25, 0, 1], 2, 1e-3],
    ['R11F_G11F_B10F', gl.R11F_G11F_B10F, gl.RGB, gl.FLOAT, [3.5, 1000, 0.125, 1], 3, 0.04],
    ['RGB9_E5 (render)', gl.RGB9_E5, gl.RGB, gl.FLOAT, [3.5, 100, 0.5, 1], 3, 0.02],
  ];
  for (const [name, internal, format, type, val, ch, tol] of formats) {
    try {
      const tex = makeTex(gl, S, S, internal, format, type);
      const { fbo, status } = makeFbo(gl, [tex]);
      if (status !== 'COMPLETE') {
        const optional = name.startsWith('RGB9_E5');
        c.add(`${name} renderable`, status, optional ? 'INFO' : 'FAIL', optional ? `WEBGL_render_shared_exponent ${rse ? 'enabled' : 'missing'}` : '');
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(tex);
        continue;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, S, S);
      drawVal(val);
      const px = readRGBA(gl);
      const errs = drainErrors(gl);
      const ok = close(px, val.slice(0, ch), tol) && !errs.length;
      c.add(`${name} write >1 & read back`, `${v4(px, ch)}`, ok ? 'PASS' : 'FAIL', `wrote ${v4(val, ch)}${errs.length ? ' · GL ' + errs.join(',') : ''}`);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
    } catch (e) {
      c.add(`${name} write/read`, String(e), 'FAIL');
    }
  }

  // --- MRT: HDR color + depth-as-R32F + RG16F velocity
  try {
    const t0 = makeTex(gl, S, S, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    const t1 = makeTex(gl, S, S, gl.R32F, gl.RED, gl.FLOAT);
    const t2 = makeTex(gl, S, S, gl.RG16F, gl.RG, gl.HALF_FLOAT);
    const { fbo, status } = makeFbo(gl, [t0, t1, t2]);
    if (status !== 'COMPLETE') c.add('MRT RGBA16F + R32F + RG16F', status, 'FAIL');
    else {
      const p = makeProgram(gl, FS_TRI_VS, MRT_FS);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, S, S);
      gl.useProgram(p);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const a = readRGBA(gl, 0);
      const b = readRGBA(gl, 1);
      const d = readRGBA(gl, 2);
      const ok = close(a, [5, 2, 0.5, 1], 1e-3) && close(b, [123.456], 1e-6) && close(d, [-0.75, 0.25], 1e-3);
      c.add('MRT ×3: RGBA16F color + R32F depth + RG16F velocity', `c${v4(a)} z${v4(b, 1)} v${v4(d, 2)}`, ok ? 'PASS' : 'FAIL', 'expects c(5,2,.5,1) z(123.456) v(-.75,.25)');
      gl.deleteProgram(p);
      // single-output shader into the 3-target FBO
      drainErrors(gl);
      gl.useProgram(valProg);
      gl.uniform4fv(uVal, [1, 1, 1, 1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const e1 = drainErrors(gl);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE, gl.NONE]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const e2 = drainErrors(gl);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      c.add(
        'MRT: shader with fewer outputs than enabled draw buffers',
        `${e1.length ? e1.join(',') : 'no error'} · with drawBuffers([C0,NONE,NONE]): ${e2.length ? e2.join(',') : 'no error'}`,
        'INFO',
        e1.length ? 'engine rule: every pass into the MRT must write all outputs, or switch unused buffers to NONE per pass' : 'missing outputs tolerated',
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    [t0, t1, t2].forEach((t) => gl.deleteTexture(t));
  } catch (e) {
    c.add('MRT ×3', String(e), 'FAIL');
  }

  // --- additive blending
  const blendTest = (label: string, internal: GLenum, format: GLenum, type: GLenum) => {
    const tex = makeTex(gl, S, S, internal, format, type);
    const { fbo, status } = makeFbo(gl, [tex]);
    const res: Record<string, number | string> = {};
    if (status !== 'COMPLETE') return { status };
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, S, S);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    drainErrors(gl);
    const run = (val: number, n: number) => {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawVal([val, val, val, val], n);
      const err = drainErrors(gl);
      return { v: readRGBA(gl)[0], err };
    };
    const a = run(0.37, 100);
    const b = run(1.0, 3000);
    const t = run(1 / 1024, 4096);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    res.sum_0_37x100 = a.v;
    res.sum_1x3000 = b.v;
    res.sum_1over1024x4096 = t.v;
    return { status, a, b, t, res, label };
  };

  // RGBA16F additive
  {
    const r = blendTest('RGBA16F', gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    if (!r.a) c.add('RGBA16F additive blend', r.status, 'FAIL');
    else {
      const relErr = Math.abs(r.a.v - 37) / 37;
      c.add(
        'RGBA16F additive (0.37 × 100)',
        `${fmt(r.a.v, 4)} (${(relErr * 100).toFixed(1)}% off)`,
        r.a.err.length ? 'FAIL' : relErr < 0.005 ? 'PASS' : 'WARN',
        `expect 37 · blending works, but each add rounds to the fp16 grid (ulp ${1 / 32} at 32) → accumulated drift${r.a.err.length ? ' · GL ' + r.a.err : ''}`,
      );
      c.add(
        'RGBA16F additive (1.0 × 3000)',
        fmt(r.b!.v, 1),
        r.b!.v === 2048 ? 'WARN' : Math.abs(r.b!.v - 3000) < 1 ? 'PASS' : 'WARN',
        'fp16 integers exact only to 2048 → counts saturate (ulp 2 above 2048)',
      );
      const sat = r.t!.v;
      c.add(
        'RGBA16F tiny increments (1/1024 × 4096)',
        fmt(sat, 4),
        Math.abs(sat - 4) < 0.01 ? 'PASS' : 'WARN',
        `expect 4.0; fp16 stalls once ulp/2 ≥ increment → splat weights must stay ≳ value/2048 (fractal-flame density → use RGBA32F)`,
        r.res,
      );
    }
  }

  // RGBA32F additive: before EXT_float_blend (must error), then after
  {
    const tex = makeTex(gl, S, S, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    const { fbo } = makeFbo(gl, [tex]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, S, S);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    drainErrors(gl);
    drawVal([1, 1, 1, 1]);
    const errs = drainErrors(gl);
    c.add(
      'RGBA32F blend before getExtension("EXT_float_blend")',
      errs.length ? errs.join(',') : 'no error',
      'INFO',
      errs.length ? 'extension must be enabled explicitly' : 'Chrome implicitly enables EXT_float_blend together with EXT_color_buffer_float — still call getExtension() for clarity',
    );
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
  }
  const fb = gl.getExtension('EXT_float_blend');
  if (!fb) c.add('EXT_float_blend', 'missing', 'WARN', 'no additive into RGBA32F → flame histograms must use RGBA16F with weights');
  else {
    const r = blendTest('RGBA32F', gl.RGBA32F, gl.RGBA, gl.FLOAT);
    if (!r.a) c.add('RGBA32F additive blend', r.status, 'FAIL');
    else {
      c.add('RGBA32F additive (0.37 × 100)', fmt(r.a.v, 5), !r.a.err.length && Math.abs(r.a.v - 37) < 1e-3 ? 'PASS' : 'FAIL', r.a.err.join(','));
      c.add('RGBA32F additive (1.0 × 3000)', fmt(r.b!.v, 1), Math.abs(r.b!.v - 3000) < 1e-3 ? 'PASS' : 'FAIL');
      c.add('RGBA32F tiny increments (1/1024 × 4096)', fmt(r.t!.v, 6), Math.abs(r.t!.v - 4) < 1e-4 ? 'PASS' : 'FAIL', 'density histogram precision', r.res);
    }
  }

  // --- linear filtering of float textures
  const sampProg = makeProgram(gl, FS_TRI_VS, SAMPLE_FS);
  const filterTest = (label: string, internal: GLenum, type: GLenum, data: ArrayBufferView) => {
    const src = makeTex(gl, 2, 1, internal, gl.RGBA, type, gl.LINEAR, data);
    const dst = makeTex(gl, 1, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    const { fbo } = makeFbo(gl, [dst]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, 1, 1);
    gl.useProgram(sampProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(gl.getUniformLocation(sampProg, 'uT'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = readRGBA(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(src);
    gl.deleteTexture(dst);
    return px[0];
  };
  const f32 = new Float32Array([0, 0, 0, 1, 10, 10, 10, 1]);
  const before = filterTest('RGBA32F', gl.RGBA32F, gl.FLOAT, f32);
  const lin = gl.getExtension('OES_texture_float_linear');
  const after = filterTest('RGBA32F', gl.RGBA32F, gl.FLOAT, f32);
  c.add(
    'RGBA32F LINEAR filtering',
    `before ext ${fmt(before, 3)} · after ${fmt(after, 3)}`,
    lin && Math.abs(after - 5) < 1e-3 ? 'PASS' : 'WARN',
    'sample midpoint of [0,10] → expect 5 (0 = texture incomplete without OES_texture_float_linear)',
  );
  const h16 = new Uint16Array([0, 0, 0, 0x3c00, 0x4900, 0x4900, 0x4900, 0x3c00]); // 10.0 = 0x4900
  const half = filterTest('RGBA16F', gl.RGBA16F, gl.HALF_FLOAT, h16);
  c.add('RGBA16F LINEAR filtering', fmt(half, 3), Math.abs(half - 5) < 1e-2 ? 'PASS' : 'FAIL', 'core in WebGL2');

  // --- MSAA float renderbuffer + resolve
  try {
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, S, S);
    const msFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.viewport(0, 0, S, S);
    drawVal([7.5, 0.5, 0.25, 1]);
    const dst = makeTex(gl, S, S, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    const { fbo: rFbo } = makeFbo(gl, [dst]);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, rFbo);
    gl.blitFramebuffer(0, 0, S, S, 0, 0, S, S, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rFbo);
    const px = readRGBA(gl);
    const errs = drainErrors(gl);
    c.add(
      `MSAA ${samples}× RGBA16F renderbuffer + blit resolve`,
      v4(px),
      st === gl.FRAMEBUFFER_COMPLETE && close(px, [7.5, 0.5, 0.25, 1], 1e-3) && !errs.length ? 'PASS' : 'FAIL',
      'HDR anti-aliased line/edge rendering (600-cell)' + (errs.length ? ' · ' + errs : ''),
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(msFbo);
    gl.deleteFramebuffer(rFbo);
    gl.deleteRenderbuffer(rb);
    gl.deleteTexture(dst);
  } catch (e) {
    c.add('MSAA float renderbuffer', String(e), 'FAIL');
  }

  // --- implementation-preferred readback format for RGBA16F
  {
    const tex = makeTex(gl, S, S, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    const { fbo } = makeFbo(gl, [tex]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const f = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT);
    const t = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
    c.add('RGBA16F IMPLEMENTATION_COLOR_READ_FORMAT/TYPE', `0x${f.toString(16)} / 0x${t.toString(16)}`, 'INFO', t === gl.HALF_FLOAT ? 'half-float readback supported' : 'use RGBA/FLOAT readback');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
  }
  release(gl);
}
