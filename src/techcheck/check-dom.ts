// J. DOM / CSS visual tests:
//  J1 WebGL wireframe cube + DOM table glued to a face via CSS matrix3d (CSS3DRenderer approach)
//  J2 the WebGL <canvas> itself shrinking/rotating in CSS 3D while rendering (fps impact)
//  J3 mix-blend-mode: difference DOM text over the WebGL canvas
//  J4 SVG feTurbulence + feDisplacementMap on DOM text (cost)
//  J5 @property animation
import { mat4, vec4 } from 'gl-matrix';
import type { Ctx } from './main.ts';
import { FS_TRI_VS, makeProgram } from './glutil.ts';
import { raymarchFS } from './shaders.ts';
import { $, cadence, fmt, nonce, rafSamples, r3, sleep, mean } from './util.ts';

// ------------------------------------------------------------------------------------------ shared animation loop

type Tick = (t: number) => void;
const ticks = new Set<Tick>();
let paused = false;
let loopOn = false;
function loop() {
  if (loopOn) return;
  loopOn = true;
  const f = (t: number) => {
    if (!paused) for (const k of ticks) k(t);
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}
export function setPaused(p: boolean) {
  paused = p;
}

const epsilon = (v: number) => (Math.abs(v) < 1e-10 ? 0 : v);
/** three.js CSS3DRenderer.getCameraCSSMatrix: view matrix with the Y row negated (CSS y points down). */
function cameraCSSMatrix(m: mat4): string {
  const e = m;
  return `matrix3d(${[
    e[0], -e[1], e[2], e[3],
    e[4], -e[5], e[6], e[7],
    e[8], -e[9], e[10], e[11],
    e[12], -e[13], e[14], e[15],
  ].map(epsilon).join(',')})`;
}
/** three.js CSS3DRenderer.getObjectCSSMatrix: world matrix with the Y column negated, centred on the element. */
function objectCSSMatrix(m: mat4): string {
  const e = m;
  return `translate(-50%,-50%) matrix3d(${[
    e[0], e[1], e[2], e[3],
    -e[4], -e[5], -e[6], -e[7],
    e[8], e[9], e[10], e[11],
    e[12], e[13], e[14], e[15],
  ].map(epsilon).join(',')})`;
}

// ------------------------------------------------------------------------------------------ J1

const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aCol;
uniform mat4 uMVP; out vec3 vCol;
void main(){ gl_Position = uMVP * vec4(aPos, 1.); vCol = aCol; }`;
const LINE_FS = `#version 300 es
precision highp float; in vec3 vCol; out vec4 o;
void main(){ o = vec4(vCol, 1.); }`;

const HALF = 100; // cube half-size in world units (= CSS px of the glued element at scale 1)
const HUD_PX = 2 * HALF;
const FOV = (50 * Math.PI) / 180;

interface J1 {
  /** per-frame max bbox error (CSS px) while measuring */
  errs: number[];
  start(): void;
  stop(): void;
}

function setupJ1(): J1 {
  const stage = $('#j1-stage');
  const canvas = $('#j1-canvas') as HTMLCanvasElement;
  const view = $('#j1-view');
  const cam = $('#j1-cam');
  const hud = $('#j1-hud');
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  cam.style.width = `${W}px`;
  cam.style.height = `${H}px`;
  hud.style.width = `${HUD_PX}px`;
  hud.style.height = `${HUD_PX}px`;
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })!;
  const prog = makeProgram(gl, LINE_VS, LINE_FS);
  const verts: number[] = [];
  const line = (a: number[], b: number[], c: number[]) => verts.push(...a, ...c, ...b, ...c);
  const grey = [0.55, 0.55, 0.6];
  const mag = [1, 0, 1];
  const s = HALF;
  const corners = [-s, s];
  for (const y of corners) for (const z of corners) line([-s, y, z], [s, y, z], grey);
  for (const x of corners) for (const z of corners) line([x, -s, z], [x, s, z], grey);
  for (const x of corners) for (const y of corners) line([x, y, -s], [x, y, s], grey);
  // +Z face: outline + 25 px grid (the DOM element has the same grid as a CSS background)
  for (let k = 0; k <= 8; k++) {
    const v = -s + k * 25;
    line([v, -s, s], [v, s, s], mag);
    line([-s, v, s], [s, v, s], mag);
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  const nVerts = verts.length / 6;

  const proj = mat4.perspective(mat4.create(), FOV, W / H, 10, 5000);
  const fovPx = proj[5] * H * 0.5; // = 0.5·H / tan(fov/2)
  view.style.perspective = `${fovPx}px`;
  const viewM = mat4.create();
  const model = mat4.create();
  const faceM = mat4.create();
  const vp = mat4.create();
  const mvp = mat4.create();
  const errs: number[] = [];
  const tmp = vec4.create();

  const project = (m: mat4, x: number, y: number, z: number) => {
    vec4.transformMat4(tmp, [x, y, z, 1], m);
    return [(tmp[0] / tmp[3] * 0.5 + 0.5) * W, (0.5 - (tmp[1] / tmp[3]) * 0.5) * H];
  };

  const setState = (time: number) => {
    const t = time / 1000;
    const eye: [number, number, number] = [300 * Math.sin(t * 0.21), 140 * Math.sin(t * 0.33), 520 + 60 * Math.cos(t * 0.21)];
    mat4.lookAt(viewM, eye, [0, 0, 0], [0, 1, 0]);
    mat4.identity(model);
    mat4.rotateY(model, model, Math.sin(t * 0.5) * 0.9);
    mat4.rotateX(model, model, 0.35 * Math.sin(t * 0.7));
    mat4.translate(faceM, model, [0, 0, HALF]);
    mat4.multiply(vp, proj, viewM);
    mat4.multiply(mvp, vp, model);
    // GL
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.03, 0.03, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMVP'), false, mvp);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.LINES, 0, nVerts);
    gl.bindVertexArray(null);
    // CSS (same matrices)
    cam.style.transform = `translateZ(${fovPx}px) ${cameraCSSMatrix(viewM)} translate(${W / 2}px,${H / 2}px)`;
    hud.style.transform = objectCSSMatrix(faceM);
  };

  const measure = () => {
    // expected bbox of the face from the GL matrices vs the DOM's own bounding box
    const fm = mat4.multiply(mat4.create(), vp, faceM);
    const pts = [project(fm, -HALF, -HALF, 0), project(fm, HALF, -HALF, 0), project(fm, HALF, HALF, 0), project(fm, -HALF, HALF, 0)];
    const ex = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    const sr = stage.getBoundingClientRect();
    const r = hud.getBoundingClientRect();
    const got = [r.left - sr.left, r.top - sr.top, r.right - sr.left, r.bottom - sr.top];
    errs.push(Math.max(...ex.map((v, i) => Math.abs(v - got[i]))));
  };

  let measuring = false;
  ticks.add((t) => {
    setState(t);
    if (measuring) measure();
  });
  return {
    errs,
    start() {
      errs.length = 0;
      measuring = true;
    },
    stop() {
      measuring = false;
    },
  };
}

// ------------------------------------------------------------------------------------------ J2 + J3

interface J2 {
  mode: 'flat' | '3d';
  blend: boolean;
}
function setupJ2(): J2 {
  const canvas = $('#j2-canvas') as HTMLCanvasElement;
  const text = $('#j3-text');
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })!;
  const prog = makeProgram(gl, FS_TRI_VS, raymarchFS('tpms', 0, nonce()));
  const st: J2 = { mode: 'flat', blend: false };
  ticks.add((time) => {
    const t = time / 1000;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), canvas.width, canvas.height);
    gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (st.mode === '3d') {
      const sc = 0.62 + 0.3 * Math.sin(t * 0.8);
      canvas.style.transform = `rotateY(${(Math.sin(t * 0.6) * 55).toFixed(3)}deg) rotateX(${(Math.sin(t * 0.43) * 20).toFixed(3)}deg) scale(${sc.toFixed(4)})`;
    } else canvas.style.transform = 'none';
    text.style.display = st.blend ? '' : 'none';
  });
  return st;
}

// ------------------------------------------------------------------------------------------ J4

interface J4 {
  mode: 'none' | 'static' | 'animated';
}
function setupJ4(): J4 {
  const el = $('#j4-text');
  const turb = document.getElementById('tc-turb');
  const disp = document.getElementById('tc-disp');
  const st: J4 = { mode: 'animated' };
  ticks.add((time) => {
    const t = time / 1000;
    el.style.filter = st.mode === 'none' ? 'none' : 'url(#tc-warp)';
    if (st.mode === 'animated' && turb && disp) {
      turb.setAttribute('baseFrequency', `${(0.01 + 0.004 * Math.sin(t * 0.9)).toFixed(5)} ${(0.04 + 0.01 * Math.sin(t * 1.3)).toFixed(5)}`);
      disp.setAttribute('scale', (20 + 10 * Math.sin(t * 2.1)).toFixed(3));
    }
  });
  return st;
}

// ------------------------------------------------------------------------------------------ check

export async function checkDom(c: Ctx) {
  loop();
  const j1 = setupJ1();
  const j2 = setupJ2();
  const j4 = setupJ4();
  await sleep(300);

  const alive = (await rafSamples(400)).stamps.length > 10;
  if (!alive) c.add('Renderer liveness', 'rAF not running', 'WARN', 'timing/animation rows below are marked pending — re-run ?only=G,J with the tab in front');

  // ---- J1 alignment
  c.progress('J · matrix3d alignment');
  j1.start();
  const r1 = await rafSamples(3000);
  j1.stop();
  if (r1.throttled || j1.errs.length < 10) c.add('J1 matrix3d alignment', 'pending — run in Chrome with the tab in front', 'SKIP', `renderer throttled: only ${j1.errs.length} frames`);
  else {
    const mx = Math.max(...j1.errs);
    c.add(
      'J1 DOM face vs GL face: bbox error while animating',
      `max ${fmt(mx, 3)} px · mean ${fmt(mean(j1.errs), 3)} px over ${j1.errs.length} frames`,
      mx < 0.5 ? 'PASS' : mx < 1.5 ? 'WARN' : 'FAIL',
      'GL-projected corners vs getBoundingClientRect() of the matrix3d element (perspective = 0.5·H/tan(fov/2)); eyeball: magenta GL grid must sit on the cyan CSS grid',
      { errs: j1.errs.slice(0, 40).map(r3) },
    );
  }

  // ---- J2/J3 canvas in CSS 3D
  const phase = async (label: string, setup: () => void) => {
    setup();
    await sleep(300);
    const r = await rafSamples(2500);
    return { label, cs: cadence(r.stamps) };
  };
  c.progress('J · canvas in CSS 3D');
  const p2 = [
    await phase('flat canvas', () => {
      j2.mode = 'flat';
      j2.blend = false;
    }),
    await phase('canvas rotating/scaling in CSS 3D', () => {
      j2.mode = '3d';
      j2.blend = false;
    }),
    await phase('CSS 3D + mix-blend-mode:difference text', () => {
      j2.mode = '3d';
      j2.blend = true;
    }),
  ];
  const throttledRow = (label: string) => c.add(label, 'pending — run in Chrome with the tab in front', 'SKIP', 'renderer throttled (frames ~1/s)');
  for (const p of p2) {
    if (p.cs.medianMs > 100) {
      throttledRow(`J2 ${p.label}`);
      continue;
    }
    c.add(
      `J2 ${p.label} (TPMS ${(($('#j2-canvas') as HTMLCanvasElement).width)}×${($('#j2-canvas') as HTMLCanvasElement).height} each frame)`,
      `${fmt(p.cs.hz, 1)} Hz · σ ${fmt(p.cs.jitterMs, 2)} ms · drops ${(p.cs.dropFrac * 100).toFixed(1)}%`,
      p.cs.dropFrac < 0.05 ? 'PASS' : 'WARN',
      '',
      p.cs,
    );
  }
  c.add('J3 mix-blend-mode: difference', CSS.supports('mix-blend-mode', 'difference') ? 'supported' : 'unsupported', CSS.supports('mix-blend-mode', 'difference') ? 'PASS' : 'FAIL', 'eyeball: white text inverts the colours of the canvas under it, including while the canvas rotates');

  // ---- J4 SVG filter cost
  c.progress('J · SVG feTurbulence + feDisplacementMap');
  const p4: { label: string; cs: ReturnType<typeof cadence> }[] = [];
  for (const m of ['none', 'static', 'animated'] as const) {
    p4.push(await phase(`SVG filter: ${m}`, () => (j4.mode = m)));
  }
  for (const p of p4) {
    if (p.cs.medianMs > 100) {
      throttledRow(`J4 ${p.label}`);
      continue;
    }
    c.add(`J4 ${p.label}`, `${fmt(p.cs.hz, 1)} Hz · σ ${fmt(p.cs.jitterMs, 2)} ms · drops ${(p.cs.dropFrac * 100).toFixed(1)}%`, p.cs.dropFrac < 0.05 ? 'PASS' : 'WARN', p.label.endsWith('animated') ? 'baseFrequency+scale change every frame → filter re-rasterised each frame' : '', p.cs);
  }
  j4.mode = 'animated';

  // ---- J5 @property
  {
    const el = $('#j5-prop');
    const reg = typeof CSS.registerProperty === 'function';
    const vals: string[] = [];
    for (let i = 0; i < 4; i++) {
      vals.push(getComputedStyle(el).getPropertyValue('--tc-angle').trim());
      await sleep(137);
    }
    const nums = vals.map((v) => parseFloat(v));
    const interpolates = nums.every((n) => Number.isFinite(n)) && new Set(vals).size >= 3 && nums.some((n) => n > 1 && n < 359);
    c.add(
      'J5 @property --tc-angle (<angle>) keyframe animation',
      `samples: ${vals.join(', ')}`,
      interpolates ? 'PASS' : alive ? 'FAIL' : 'SKIP',
      `CSS.registerProperty: ${reg}; registered custom properties interpolate (unregistered ones flip at 50%)`,
    );
  }
  // leave everything animating in the "full" configuration for eyeballing
  j2.mode = '3d';
  j2.blend = true;
}
