// S02 · Cage (PLAN §4): the gamut triangle of S01 turns out to be one of the 1200 faces of the
// 600-cell, rotating in 4D. Stereographic projection, edges as HDR ribbons.
// (Next: the frame fills into a raymarched TPMS lattice and pulls back behind CRT glass.)

import { mat4 } from 'gl-matrix';
import { type Gfx, type Target, program, ensureTarget, bindTarget, fullscreen } from '../gfx/gl.ts';
import type { Scene, FrameCtx } from './types.ts';
import { smoothstep } from '../timeline/events.ts';

const PHI = (1 + Math.sqrt(5)) / 2;
type V4 = [number, number, number, number];

/** the 120 vertices of the 600-cell on the unit 3-sphere */
export function cell600(): V4[] {
  const v: V4[] = [];
  for (let i = 0; i < 4; i++)
    for (const s of [-1, 1]) {
      const p: V4 = [0, 0, 0, 0];
      p[i] = s;
      v.push(p);
    }
  for (let m = 0; m < 16; m++) v.push([0, 1, 2, 3].map((i) => (m >> i) & 1 ? 0.5 : -0.5) as V4);
  // even permutations of ½(±φ, ±1, ±1/φ, 0)
  const even: number[][] = [];
  const perm = (a: number[], k = 0) => {
    if (k === a.length) {
      let inv = 0;
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (a[i] > a[j]) inv++;
      if (inv % 2 === 0) even.push([...a]);
      return;
    }
    for (let i = k; i < a.length; i++) {
      [a[k], a[i]] = [a[i], a[k]];
      perm(a, k + 1);
      [a[k], a[i]] = [a[i], a[k]];
    }
  };
  perm([0, 1, 2, 3]);
  const base = [PHI, 1, 1 / PHI, 0];
  for (const p of even)
    for (let s = 0; s < 8; s++) {
      const q: V4 = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        let x = base[i] / 2;
        if (i < 3 && (s >> i) & 1) x = -x;
        q[p[i]] = x;
      }
      v.push(q);
    }
  return v;
}

export function edges600(v: V4[]): [number, number][] {
  const e: [number, number][] = [];
  const L = 1 / PHI;
  for (let i = 0; i < v.length; i++)
    for (let j = i + 1; j < v.length; j++) {
      const d = Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2], v[i][3] - v[j][3]);
      if (Math.abs(d - L) < 1e-6) e.push([i, j]);
    }
  return e;
}

const qmul = (a: V4, b: V4): V4 => [
  a[3] * b[0] + b[3] * a[0] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] + b[3] * a[1] + a[2] * b[0] - a[0] * b[2],
  a[3] * b[2] + b[3] * a[2] + a[0] * b[1] - a[1] * b[0],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const project = (p: V4, qL: V4, qR: V4): [number, number, number] => {
  const n = Math.hypot(...p);
  const q = qmul(qmul(qL, p.map((x) => x / n) as V4), qR);
  const d = Math.max(1 - q[3], 1e-4);
  return [q[0] / d, q[1] / d, q[2] / d];
};
const sub3 = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mix3 = (a: number[], b: number[], k: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

const qaxis = (ax: number[], a: number): V4 => {
  const n = Math.hypot(ax[0], ax[1], ax[2]);
  const s = Math.sin(a / 2) / n;
  return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(a / 2)];
};

// the cage and its highlighted face, computed once (shared with S01, which lands its gamut triangle
// on this face's first-frame position so the cut is invisible)
let GEO: { V: V4[]; E: [number, number][]; face: [number, number, number]; rgb: [number, number, number] } | null = null;
function cageGeometry() {
  if (GEO) return GEO;
  const V = cell600();
  const E = edges600(V);
  if (V.length !== 120 || E.length !== 720) console.warn(`600-cell: ${V.length} vertices, ${E.length} edges`);
  // pick the face: three mutually adjacent vertices, the one nearest the far side of the projection
  const adj = new Set(E.map(([i, j]) => `${i},${j}`));
  const isE = (i: number, j: number) => adj.has(i < j ? `${i},${j}` : `${j},${i}`);
  let face: [number, number, number] = [0, 0, 0];
  let best = Infinity;
  for (const [i, j] of E)
    for (let k = 0; k < V.length; k++)
      if (k !== i && k !== j && isE(i, k) && isE(j, k)) {
        const w = V[i][3] + V[j][3] + V[k][3];
        if (w < best) {
          best = w;
          face = [i, j, k];
        }
      }
  GEO = { V, E, face, rgb: face };
  // which face vertex wears which primary: as in S01's diagram, counter-clockwise R → G → B on screen
  // with green on top (computed at 16:10; the order does not depend on the aspect)
  const ndc = startNdc(face, 1.6);
  const ccw = (ndc[1][0] - ndc[0][0]) * (ndc[2][1] - ndc[0][1]) - (ndc[1][1] - ndc[0][1]) * (ndc[2][0] - ndc[0][0]) > 0;
  const ord = ccw ? [0, 1, 2] : [0, 2, 1];
  const top = ord.reduce((a, b) => (ndc[b][1] > ndc[a][1] ? b : a), ord[0]);
  while (ord[1] !== top) ord.push(ord.shift()!); // rotate the cycle until green (2nd) is the top vertex
  GEO.rgb = [face[ord[0]], face[ord[1]], face[ord[2]]];
  return GEO;
}

/** the camera at local time t (shared by the render and the start-frame helper) */
function cageCamera(face: [number, number, number], V: V4[], t: number, aspect: number) {
  const spin = 0.12 * t + 0.02 * t * t;
  const qL = qaxis([1, 0.3, 0.2], spin);
  const qR = qaxis([0.2, 1, -0.4], spin * 0.618);
  // camera: starts square on the face (it fills the frame like the S01 triangle), then pulls back
  // and orbits to show the whole cage
  const [pa, pb, pc] = face.map((i) => project(V[i], qL, qR));
  const fc = mix3(mix3(pa, pb, 0.5), pc, 1 / 3);
  const fn = norm3(cross3(sub3(pb, pa), sub3(pc, pa)));
  const size = Math.max(Math.hypot(...sub3(pa, pb)), Math.hypot(...sub3(pb, pc)), Math.hypot(...sub3(pc, pa)));
  const side = Math.sign(fn[0] * fc[0] + fn[1] * fc[1] + fn[2] * fc[2]) || 1;
  const close = fc.map((x, i) => x + fn[i] * side * size * 1.25) as [number, number, number];
  const dist = 6.5, yaw = 0.12 * t + 0.6, pitch = 0.3 + 0.1 * Math.sin(t * 0.3);
  const orbit: [number, number, number] = [
    dist * Math.cos(pitch) * Math.sin(yaw),
    dist * Math.sin(pitch),
    dist * Math.cos(pitch) * Math.cos(yaw),
  ];
  const pull = smoothstep(1.5, 9, t);
  const eye = mix3(close, orbit, pull);
  const target = mix3(fc, [0, 0, 0], smoothstep(1.5, 7, t));
  const view = mat4.create(), proj = mat4.create();
  mat4.lookAt(view, eye, target, [0, 1, 0]);
  mat4.perspective(proj, (50 * Math.PI) / 180, aspect, 0.05, 200);
  return { qL, qR, view, proj };
}

function startNdc(idx: number[], aspect: number): [number, number][] {
  const { V, face } = GEO!;
  const { qL, qR, view, proj } = cageCamera(face, V, 0, aspect);
  const m = mat4.multiply(mat4.create(), proj, view);
  return idx.map((i) => {
    const p = project(V[i], qL, qR);
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return [x / w, y / w];
  });
}

/** S02's first frame: NDC of the face's red, green and blue corners (S01 flies its triangle there) */
export function cageFaceStart(aspect: number): [number, number][] {
  const g = cageGeometry();
  return startNdc(g.rgb, aspect);
}

export function createCage(g: Gfx): Scene {
  const gl = g.gl;
  const edgeProg = program(g, 'scenes/s02-edges', 'scenes/s02-edges.vert');
  const faceProg = program(g, 'scenes/s02-face', 'scenes/s02-face.vert');
  const tpms = program(g, 'scenes/s02-tpms');
  const crt = program(g, 'post/crt');
  let inner: Target | null = null;
  const { V, E, face, rgb } = cageGeometry();
  const hotEdge = (i: number, j: number) => face.includes(i) && face.includes(j);
  let vao: WebGLVertexArrayObject | null = null;

  return {
    id: 'S02',
    title: 'Cage',
    // the cut from S01 keeps S01's look (exact colours, its bloom/vignette/grain), then eases into AgX
    post: (f: FrameCtx) => {
      const k = smoothstep(0.8, 4, f.local);
      return { exact: 1 - k, bloom: 0.12 + 0.02 * k, bloomRadius: 1 + 0.1 * k, vignette: 0.25 + 0.15 * k, grain: 0.02 + 0.01 * k, exposure: 0 };
    },
    programs: () => [edgeProg, faceProg, tpms, crt],
    init() {
      const data = new Float32Array(E.length * 9);
      E.forEach(([i, j], n) => {
        data.set(V[i], n * 9);
        data.set(V[j], n * 9 + 4);
        data[n * 9 + 8] = hotEdge(i, j) ? 1 : 0;
      });
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const attr = (name: string, size: number, off: number) => {
        const l = gl.getAttribLocation(edgeProg.prog!, name);
        if (l < 0) return;
        gl.enableVertexAttribArray(l);
        gl.vertexAttribPointer(l, size, gl.FLOAT, false, 36, off);
        gl.vertexAttribDivisor(l, 1);
      };
      attr('a', 4, 0);
      attr('b', 4, 16);
      attr('hot', 1, 32);
      gl.bindVertexArray(null);
    },
    render(f: FrameCtx, hdr) {
      const t = f.local;
      // 4D: a slow isoclinic double rotation that speeds up as the scene goes on; the camera starts
      // square on the face (where S01 lands its triangle), pulls back and orbits
      const { qL, qR, view, proj } = cageCamera(face, V, t, hdr!.w / hdr!.h);

      // the wireframe fills into a TPMS lattice, which then turns out to be behind CRT glass
      const lattice = smoothstep(7.5, 10.5, t);
      const zoom =
        t < 11.5 ? 1 : t < 13.6 ? 1 - 0.58 * smoothstep(11.5, 13.6, t) : 0.42 + 1.2 * smoothstep(13.6, 15.36, t) ** 2;
      if (lattice > 0) {
        const sc = 0.5;
        inner = ensureTarget(g, inner, hdr!.w * sc, hdr!.h * sc, { formats: [gl.RGBA16F] });
        bindTarget(g, inner);
        if (tpms.use()) {
          const tt = t - 7.5;
          // fly down a channel that no wall crosses for the whole gyroid → Schwarz P morph: on the
          // line (π/2 − 0.5, 0, z)/SCALE the gyroid field stays ≥ 0.40 and the P field ≥ 0.48, far
          // above the wall half-thickness (≤ 0.13). The old diagonal path crossed walls, and every
          // crossing flashed a frame or two of wall. Small sways stay well inside the channel.
          const CH_X = (Math.PI / 2 - 0.5) / 3.2;
          const ro: [number, number, number] = [CH_X + 0.025 * Math.sin(tt * 0.7), 0.025 * Math.sin(tt * 0.5), tt * 1.6];
          // look across the channel at the walls streaming past (as before), not down the empty tube
          const fwd = norm3([0.5 + 0.15 * Math.sin(tt * 0.31), 0.1 * Math.cos(tt * 0.4), 1]);
          const right = norm3(cross3([0, 1, 0], fwd));
          const up = cross3(fwd, right);
          tpms
            .set('res', inner.w, inner.h)
            .set('t', f.t)
            .set('ro', ro)
            .set('cam', [...right, ...up, ...fwd])
            .set('morph', smoothstep(9, 14, t))
            .set('thick', 0.1 + 0.03 * Math.sin(tt * 0.7))
            .set('glow', 1.2)
            .set('beat', f.S[0] ?? 0)
            .set('fade', lattice);
          fullscreen(g);
        }
        bindTarget(g, hdr);
        if (crt.use()) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          crt
            .tex('src', inner.tex[0], 0)
            .set('res', hdr!.w, hdr!.h)
            .set('zoom', zoom)
            .set('curve', 0.08 * smoothstep(10.5, 12.5, t))
            .set('mask', 0.65 * smoothstep(11, 13, t) * (1 - smoothstep(14.4, 15.3, t)))
            .set('t', f.t);
          fullscreen(g);
          gl.disable(gl.BLEND);
        }
      }
      if (lattice >= 1) return;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const faceK = 1 - smoothstep(2, 7, t);
      // S01 hands over a flat triangle: the face and the edges bend onto S³ over the first seconds
      const curve = smoothstep(0.2, 2.5, t);
      if (faceK > 0 && faceProg.use()) {
        faceProg
          .set('A', V[rgb[0]])
          .set('B', V[rgb[1]])
          .set('C', V[rgb[2]])
          .set('view', view as Float32Array)
          .set('proj', proj as Float32Array)
          .set('qL', qL)
          .set('qR', qR)
          .set('k', 0.62 * faceK)
          .set('curve', curve);
        gl.drawArrays(gl.TRIANGLES, 0, 32 * 33 * 3);
      }
      if (edgeProg.use() && vao) {
        edgeProg
          .set('view', view as Float32Array)
          .set('proj', proj as Float32Array)
          .set('qL', qL)
          .set('qR', qR)
          .set('res', hdr!.w, hdr!.h)
          .set('width', 1.3 * (hdr!.h / 1080))
          .set('hotK', 1 - smoothstep(4, 10, t))
          .set('baseK', (0.35 * smoothstep(0.5, 4, t) + 0.05 * smoothstep(0, 1, t)) * (1 - smoothstep(7.5, 9.3, t)))
          .set('curve', curve);
        gl.bindVertexArray(vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (24 + 1) * 2, E.length);
        gl.bindVertexArray(null);
      }
      gl.disable(gl.BLEND);
    },
  };
}

export default createCage;
