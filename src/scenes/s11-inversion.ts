// S11 · Inversion (PLAN §4) · 16:00–17:63. The lead plays the diatonic inversion of EFFACED; the four
// D-4 markers (16:00, 16:32, 17:00, 17:32) change the polygon: p = 3 → 5 → 17 → 257.
//
//  16:00  the DC-mosaic city of S10 is inverted around the camera (x ↦ r²x/|x|², DE-corrected): the
//         ground curls into a ball, the sky — the world's infinity — becomes its top point. On the
//         ground lies the stereographic chart of the {3,3} tiling: curled up, it is the regular
//         tetrahedral tiling of the ball. The camera climbs to that point at infinity and looks down,
//         and from there the ball IS its stereographic chart — the plane takes over, exactly.
//  16:32  p → 5 (the dodecahedron), and Gauss's 17-gon is constructed in Byrne's colours: the tree of
//         Gauss periods, seven Carlyle circles, one per note of the lead.
//  17:00  p → 17: the curvature passes through zero, the sphere opens into the Poincaré disc (inside
//         becomes outside); between integers the tiling tears — the glitch. The 17-gon is drawn:
//         radius 500 px, it misses its circle by 8.5 px.
//  17:32  p → 257: the whirl of 127 Carlyle circles of the 257-gon, its 128 perpendiculars, the
//         polygon — 0.04 px from its circle, past the threshold of perception. The tiles become circles.

import { type Gfx, type Target, program, ensureTarget, bindTarget, destroyTarget, fullscreen } from '../gfx/gl.ts';
import type { Scene, FrameCtx } from './types.ts';
import { markerTimes, smoothstep } from '../timeline/events.ts';
import { ROW, ROWS } from '../timeline/script.ts';
import { CH } from '../music/roster.ts';
import { s10Mosaic } from './s10-compression.ts';

const POS = 0x16;
const START = POS * ROWS;
const LEN = 2 * ROWS;

// ------------------------------------------------------------------------------------------------
// {p,3} in one conformal chart (see lib/hyper.glsl): the central tile's vertex at chart radius 1
export interface TileParams {
  T: [number, number, number, number];
  /** hyperbolic: radius of the boundary circle (chart units); 0 otherwise */
  bound: number;
  /** chart radius of the "equator" (sphere) / boundary (disc) — the curvature scale S */
  S: number;
}
export function tileParams(p: number, q = 3): TileParams {
  const A = Math.PI / p, B = Math.PI / q;
  const c = 1 / Math.tan(A) / Math.tan(B); // cos / cosh of the hypotenuse OQ
  const m = Math.cos(B) / Math.sin(A); // cos / cosh of the leg OM
  let rQ: number, rM: number;
  if (Math.abs(c - 1) < 1e-9) {
    rQ = 1;
    rM = Math.cos(A); // Euclidean: |OM| = |OQ|·cos(π/p)
  } else if (c < 1) {
    rQ = Math.tan(Math.acos(c) / 2);
    rM = Math.tan(Math.acos(Math.min(1, m)) / 2);
  } else {
    rQ = Math.tanh(Math.acosh(c) / 2);
    rM = Math.tanh(Math.acosh(Math.max(1, m)) / 2);
  }
  const S = 1 / rQ;
  const xM = rM / rQ;
  const xQ = Math.cos(A), yQ = Math.sin(A);
  const k = (2 * (xQ - xM)) / ((xQ - xM) ** 2 + yQ * yQ);
  const phiO = k * xM * xM + 2 * xM;
  return { T: [(2 * Math.PI) / p, xM, k, phiO], bound: c > 1 + 1e-9 ? S : 0, S };
}

// ------------------------------------------------------------------------------------------------
// Gauss periods of the n-th roots of unity (n a Fermat prime, primitive root 3) and the Carlyle circles
// that split each period into its two halves: x² − s·x + p = 0, s = the period, p = the product of
// its halves; the circle on the diameter (0,1)–(s,p) meets the x-axis in the two halves.
export interface Carlyle {
  level: number;
  cx: number;
  cy: number;
  r: number;
  roots: [number, number];
}
export function carlyle(n: number, g = 3): Carlyle[] {
  const pw = [1];
  for (let j = 1; j < n - 1; j++) pw.push((pw[j - 1] * g) % n);
  const eta = (e: number, i: number) => {
    const f = (n - 1) / e;
    let s = 0;
    for (let t = 0; t < f; t++) s += Math.cos((2 * Math.PI * pw[i + e * t]) / n);
    return s;
  };
  const out: Carlyle[] = [];
  for (let e = 1, level = 0; 2 * e <= (n - 1) / 2; e *= 2, level++)
    for (let i = 0; i < e; i++) {
      const s = eta(e, i), a = eta(2 * e, i), b = eta(2 * e, i + e);
      const p = a * b;
      out.push({ level, cx: s / 2, cy: (1 + p) / 2, r: Math.hypot(s, p - 1) / 2, roots: [a, b] });
    }
  return out;
}

const ease = (x: number) => x * x * (3 - 2 * x);
/** rows at the start of S11 rendered in S10's HDR values through S10's post (see `post`) */
const RAW_ROWS = 1;
const lerp3 = (a: number[], b: number[], k: number) => a.map((x, i) => x + (b[i] - x) * k);
/** paint strength of the tiles by generation: bold while the world turns, washes under the
 *  construction of the 17-gon, bold again when the 257 tiles become circles */
function washAt(r: number, mk: number[]): number[] {
  const bold = [0.92, 0.7, 0.5], light = [0.34, 0.22, 0.14];
  const k = smoothstep(mk[1] + 2, mk[1] + 8, r) * (1 - smoothstep(mk[3] + 2, mk[3] + 14, r));
  return lerp3(bold, light, k);
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
type V3 = [number, number, number];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mix3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// S11's camera: top-down over S10's block mosaic → down among the blocks → up to the point at
// infinity of the inverted world, looking down (= the stereographic chart). focal −1 = the chart's own.
// A C¹ Hermite spline through the keys (time-weighted Catmull-Rom tangents): it never stops on a key.
const CAM_KEYS: { row: number; pos: (L: number) => V3; fwd: V3; up: V3; focal: number }[] = [
  // 16:00: S10's last frame exactly — its 40×25 block grid fills the screen (25 cells at height 15.5
  // with focal 0.62, a block boundary on the vertical centre line, a block centre on the horizontal)
  { row: 0, pos: () => [0, 15.5, 0.5], fwd: [0, -1, 0], up: [0, 0, -1], focal: 0.62 },
  { row: 3, pos: () => [0, 11.0, 1.9], fwd: [0, -1, -0.08], up: [0, 0.08, -1], focal: 0.64 },
  { row: 11, pos: () => [0, 2.6, 4.4], fwd: [0, -0.24, -1], up: [0, 1, -0.22], focal: 0.86 },
  { row: 18, pos: (L) => [0, 0.42 * L, 2.6], fwd: [0, -0.75, -0.7], up: [0, 0.7, -0.75], focal: 0.62 },
  { row: 29.5, pos: (L) => [0, 0.997 * L, 0], fwd: [0, -1, 0], up: [0, 0, -1], focal: -1 },
];
function hermite(r: number, keys: number[][], times: number[]): number[] {
  const n = keys.length;
  let i = 0;
  while (i + 2 < n && r >= times[i + 1]) i++;
  const t0 = times[i], t1 = times[i + 1], D = t1 - t0;
  const s = clamp01((r - t0) / D);
  const tan = (j: number) =>
    j === 0 || j === n - 1 ? keys[j].map(() => 0) : keys[j].map((_, c) => (keys[j + 1][c] - keys[j - 1][c]) / (times[j + 1] - times[j - 1]));
  const m0 = tan(i), m1 = tan(i + 1);
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  return keys[i].map((a, c) => h00 * a + h10 * D * m0[c] + h01 * keys[i + 1][c] + h11 * D * m1[c]);
}
/** the camera at row r, rolled by `roll` about its view axis (the 2D plane continues that turn) */
function camAt(r: number, L: number, fEnd: number, roll: number) {
  const times = CAM_KEYS.map((k) => k.row);
  const keys = CAM_KEYS.map((k) => [...k.pos(L), ...norm(k.fwd), ...norm(k.up), k.focal < 0 ? fEnd : k.focal]);
  const v = hermite(Math.min(r, times[times.length - 1]), keys, times);
  const pos: V3 = [v[0], v[1], v[2]];
  const fwd = norm([v[3], v[4], v[5]]);
  let up = norm([v[6], v[7], v[8]]);
  let right = norm(cross(fwd, up));
  up = cross(right, fwd);
  const c = Math.cos(roll), sn = Math.sin(roll);
  const r2: V3 = [c * right[0] + sn * up[0], c * right[1] + sn * up[1], c * right[2] + sn * up[2]];
  up = [-sn * right[0] + c * up[0], -sn * right[1] + c * up[1], -sn * right[2] + c * up[2]];
  right = r2;
  return { pos, fwd, up, right, focal: v[9] };
}
/** the page turns: a slow, steady rotation (the camera's roll in 3D, the whole plane in 2D) that never
 *  stops, with a small extra turn on each polygon change (D-4) */
function spinAt(r: number, mk: number[]): number {
  const w = 0.03; // rad per row ≈ 14°/s
  const x = clamp01((r - 6) / 10);
  let a = w * (r < 6 ? 0 : r < 16 ? 10 * (x * x * x - 0.5 * x * x * x * x) : 5 + (r - 16));
  a += 0.3 * ease(clamp01((r - 20) / 14)); // a swing through the arrival at the point at infinity
  for (let i = 1; i < 4; i++) a += 0.16 * ease(clamp01((r - mk[i]) / 6));
  return a;
}

// the lead's note-ons (fallback): EFFACED inverted, NOTES.md §3 — rows from 16:00
const LEAD_FALLBACK = [0, 6, 8, 16, 20, 24, 30, 38, 40, 44, 48, 54, 56, 60, 64, 70, 72, 80, 84, 88, 94, 102, 104, 108, 112, 116, 120];

export function createInversion(g: Gfx): Scene {
  const gl = g.gl;
  const plane = program(g, 'scenes/s11-plane');
  const worldP = program(g, 'scenes/s11-world');
  const arcs = program(g, 'scenes/s11-arcs', 'scenes/s11-arcs.vert');
  const mosProg = program(g, 'scenes/s11-mos');
  const heightP = program(g, 'scenes/s11-height');
  let worldT: Target | null = null;
  let dummy: WebGLTexture | null = null; // bound to s10coef when S10 never rendered
  // S10's mosaic as a mipmapped 40×25 texture (built once from S10's last coefficients)
  let mosTex: WebGLTexture | null = null, mosFb: WebGLFramebuffer | null = null, mosFrom = -1;
  // and the blocks' heights (r: own, g: the 3×3 maximum — the march's bound), from that mosaic
  let htTex: WebGLTexture | null = null, htFb: WebGLFramebuffer | null = null;
  const buildMosaic = (coef: WebGLTexture, s10on: number, back: Target | null) => {
    if (!mosProg.use() || !mosFb) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, mosFb);
    gl.viewport(0, 0, 40, 25);
    gl.disable(gl.BLEND);
    mosProg.tex('s10coef', coef, 0);
    fullscreen(g);
    gl.bindTexture(gl.TEXTURE_2D, mosTex);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (heightP.use() && htFb) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, htFb);
      gl.viewport(0, 0, 40, 25);
      heightP.tex('mosT', mosTex, 0).set('s10on', s10on);
      fullscreen(g);
    }
    bindTarget(g, back);
  };
  const C17 = carlyle(17), C257 = carlyle(257);
  const MAXC = 136;
  const Cu = new Float32Array(MAXC * 4), Cs = new Float32Array(MAXC * 4);
  const Cu17 = new Float32Array(C17.length * 4), Cs17 = new Float32Array(C17.length * 4);
  // dev: globalThis.__s11.o = { row, p, … } pins the scene to a row and overrides parameters
  const dbg: { o: Record<string, number> } = import.meta.env.DEV ? ((globalThis as any).__s11 ??= { o: {} }) : { o: {} };
  let tear = 0; // how torn the tiling is (non-integer p): the post adds a little chromatic split

  // world scale: the {3,3} central tile has its vertex Sg world units from the origin; the ball that
  // carries the regular tiling has diameter L = S(3)·Sg
  const Sg = 11;
  const S3 = tileParams(3).S;
  const Lf = S3 * Sg;

  /** p over the scene: integer plateaus, flowing (and tearing) after each D-4 marker */
  function pAt(r: number, m: number[]): number {
    const lg = (a: number, b: number, k: number) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * k);
    if (r < m[1]) return 3;
    if (r < m[2]) return lg(3, 5, ease(clamp01((r - m[1]) / 4)));
    if (r < m[3]) return lg(5, 17, ease(clamp01((r - m[2]) / 8)));
    return lg(17, 257, ease(clamp01((r - m[3]) / 12)));
  }

  return {
    id: 'S11',
    title: 'Inversion',
    // 16:00 continues S10's last frame exactly: for the first row S11 renders S10's own HDR block values
    // through S10's own post (AgX, look 1.2/1.3, vignette, bloom, CA); then — with the blocks already
    // rising — it switches to its own exact-colour post, S10's look baked into the shaders and easing out
    post: (f) => {
      const o10 = dbg.o as Record<string, number>;
      const r = o10.row ?? f.localRow;
      if (r < (o10.raw ?? RAW_ROWS) && s10Mosaic()) return { tonemap: 'agx', look: [1.2, 1.3, 0, 0], exposure: 0, bloom: 0.1, bloomRadius: 1.1, vignette: 0.34, grain: 0.035, ca: 1.5 };
      const k = smoothstep(0, 8, r);
      return {
        tonemap: 'clip',
        bloom: 0.1 + (0.03 - 0.1) * k,
        bloomRadius: 1.1 - 0.1 * k,
        vignette: 0.22 * k,
        grain: o10.grain ?? 0.035 - 0.005 * k,
        ca: Math.max(1.5 * (1 - k), 3 * tear),
      };
    },
    programs: () => [plane, worldP, arcs, mosProg, heightP],
    init() {
      dummy = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, dummy);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      mosTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, mosTex);
      gl.texStorage2D(gl.TEXTURE_2D, 6, gl.RGBA16F, 40, 25);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
      mosFb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, mosFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mosTex, 0);
      htTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, htTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, 40, 25);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      htFb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, htFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, htTex, 0);
      buildMosaic(dummy!, 0, null); // warms their pipelines and the mipmap path (and is the fallback city)
      // first draws build the Metal pipelines (20–100 ms each): do them now, into a tiny target of the
      // same format, so neither 16:00 (world) nor 16:32 (plane) stutters
      const warm = ensureTarget(g, null, 4, 4, { formats: [gl.RGBA16F] });
      bindTarget(g, warm);
      gl.disable(gl.BLEND);
      const tp = tileParams(3);
      if (worldP.use()) {
        worldP.set('res', 4, 4).set('ro', [0, 2, 4]).set('cam', [1, 0, 0, 0, 1, 0, 0, 0, -1]).set('focal', 1).set('kappa', 0.02)
          .set('hk', 1).set('Sg', Sg).set('T', tp.T).set('p', 3).set('wash', [1, 1, 1]).tex('mosT', mosTex, 2).tex('hT', htTex, 3);
        fullscreen(g);
      }
      const warm2 = ensureTarget(g, null, 4, 4, { formats: [gl.RGBA16F] });
      if (plane.use()) {
        bindTarget(g, warm2);
        plane.set('res', 4, 4).set('R', 1).set('T', tp.T).set('p', 3).tex('world', warm.tex[0], 0).tex('s10coef', dummy, 1);
        fullscreen(g);
      }
      if (arcs.use()) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        arcs.set('res', 4, 4).set('U', 1).set('hw', 1).set('mode', 0);
        gl.bindVertexArray(g.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
        gl.disable(gl.BLEND);
      }
      const px = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px); // a real sync point
      bindTarget(g, null);
      destroyTarget(g, warm);
      destroyTarget(g, warm2);
    },
    render(f: FrameCtx, hdr) {
      const o = dbg.o as Record<string, number>;
      const r = o.row ?? f.localRow;
      const W = hdr!.w, H = hdr!.h;
      const Rpx = 500 * (H / 1890);

      // markers (rows from 16:00) and the lead's notes
      const mk = markerTimes(f.audio, 'D-4', START, START + LEN, [0, 32, 64, 96].map((x) => START + x)).map((x) => x / ROW - START);
      while (mk.length < 4) mk.push([0, 32, 64, 96][mk.length]);
      const leadAll = f.audio?.notes?.filter((n) => n.ch === CH.lead && n.grow >= START && n.grow < START + LEN).map((n) => n.t / ROW - START);
      const lead = leadAll && leadAll.length ? leadAll : LEAD_FALLBACK;

      const p = o.p ?? pAt(r, mk);
      // how fast p flows (log speed per row): the tiles' colours crossfade only while it moves
      const flowK = o.p !== undefined ? 0 : smoothstep(0, 0.04, Math.abs(Math.log(pAt(r + 0.25, mk) / pAt(r - 0.25, mk))) / 0.5);
      const tp = tileParams(p);
      tear = Math.min(1, Math.abs(p - Math.round(p)) * 4) * (p < 40 ? 1 : 0.4);
      const spin = spinAt(r, mk);

      // ---------------------------------------------------------------------------------------- world
      const worldMix = o.worldMix ?? 1 - smoothstep(mk[1] - 2, mk[1], r);
      // S10's last frame (its DCT coefficients), if S10 has rendered at all in this session
      const m10 = s10Mosaic();
      const s10tex = m10?.tex ?? dummy;
      const s10on = m10 ? 1 : 0;
      if (m10 && m10.t !== mosFrom) {
        buildMosaic(m10.tex, 1, hdr);
        mosFrom = m10.t;
      }
      const rawRows = o.raw ?? RAW_ROWS;
      const raw = s10on && r < rawRows ? 1 : 0;
      // (always allocated: the plane's sampler must never fall back to the bound hdr target)
      worldT = ensureTarget(g, worldT, W * 0.5, H * 0.5, { formats: [gl.RGBA16F] });
      if (worldMix > 0) {
        bindTarget(g, worldT);
        if (worldP.use()) {
          const kappa = (1 / Lf) * ease(clamp01((r - 5) / 19));
          const cam = camAt(r, Lf, (Rpx / H) * S3, spin);
          gl.disable(gl.BLEND);
          worldP
            .set('res', worldT.w, worldT.h)
            .set('ro', cam.pos)
            .set('cam', [...cam.right, ...cam.up, ...cam.fwd])
            .set('focal', cam.focal)
            .set('kappa', kappa)
            .set('hk', (0.5 * clamp01(r / 4.5) + 0.5 * smoothstep(0, 4.5, r)) * (1 - smoothstep(13, 27, r)))
            .set('morph', smoothstep(4, 22, r))
            .set('exactK', smoothstep(22, 29, r))
            .set('Sg', Sg)
            .set('T', tp.T)
            .set('p', p)
            .set('fogC', [0.93, 0.97, 0.84])
            .set('wash', washAt(r, mk))
            .set('s10on', s10on)
            .set('raw', raw)
            .set('flatK', raw ? 1 : 1 - smoothstep(rawRows, 5, r))
            .set('vigK', 1 - smoothstep(0, 8, r))
            .set('gK', smoothstep(0.5, 5, r))
            .set('fogK', smoothstep(0, 8, r))
            .set('lodOn', o.nolod ? 0 : 1)
            .tex('mosT', mosTex, 2)
            .tex('hT', htTex, 3);
          fullscreen(g);
        }
        bindTarget(g, hdr);
      }

      // ---------------------------------------------------------------------------------------- plane
      if (!plane.use()) return;
      // the constructions: the 17-gon from 16:32, the 257-gon's whirl from 17:32 (the 17-gon fades under it)
      const big = r >= mk[3];
      const fade17 = 1 - smoothstep(mk[3], mk[3] + 10, r);
      let pen: [number, number] = [0, 1];
      let penOn = 0;
      // the 17-gon's circles: one per lead note after 16:32 (the seven notes of bars 3–4), each sweeping
      // until the next note so the compass never rests; the 257-gon's whirl: level by level
      const notes17 = lead.filter((x) => x >= mk[1] + 2 && x < mk[2]);
      const fill = (set: Carlyle[], isBig: boolean, cu: Float32Array, cs: Float32Array) => {
        for (let i = 0; i < set.length; i++) {
          const c = set[i];
          let t0: number, dur: number;
          if (!isBig) {
            t0 = notes17[i] ?? mk[1] + 6 + i * 4;
            dur = Math.max(3.5, (notes17[i + 1] ?? mk[2]) - t0);
          } else {
            t0 = mk[3] + 0.5 + c.level * 1.9 + (i - (1 << c.level) + 1) * (1.9 / (1 << c.level));
            dur = 2.2;
          }
          const x = clamp01((r - t0) / dur);
          const sweep = 0.5 * (x + ease(x)); // never quite stops: the compass leaves and lands moving
          const a0 = Math.atan2(1 - c.cy, 0 - c.cx); // the compass starts at (0, 1)
          const alpha = isBig
            ? 0.85 * smoothstep(t0 - 0.3, t0, r) * (1 - 0.6 * smoothstep(mk[3] + 16, mk[3] + 24, r))
            : smoothstep(t0 - 0.3, t0, r) * fade17;
          const k = i * 4;
          cu[k] = c.cx; cu[k + 1] = c.cy; cu[k + 2] = c.r; cu[k + 3] = sweep;
          cs[k] = a0; cs[k + 1] = c.level % 3; cs[k + 2] = alpha; cs[k + 3] = smoothstep(t0 + dur * 0.8, t0 + dur + 0.5, r) * alpha;
          if (sweep > 0 && sweep < 1) {
            const ang = a0 + sweep * 2 * Math.PI;
            pen = [c.cx + c.r * Math.cos(ang), c.cy + c.r * Math.sin(ang)];
            penOn = 1;
          }
        }
      };
      fill(C17, false, Cu17, Cs17);
      if (big) fill(C257, true, Cu, Cs);
      // the polygons: perpendiculars, vertices, edges
      // the pen keeps moving: perpendiculars, then the edges all the way round until the next change
      const polyAt = (n: number, t0: number, isBig: boolean) => [
        r >= t0 ? n : 0,
        n * clamp01((r - t0 - (isBig ? 4 : 6)) / (isBig ? 13.5 : 25)),
        ((n - 1) / 2) * clamp01((r - t0) / (isBig ? 7 : 9)),
        smoothstep(t0 + 1, t0 + 4, r) * (isBig ? 0.6 : 1),
      ];
      const tPoly = mk[3] + 14;
      const poly17 = polyAt(17, mk[2], false).map((v, i) => (i === 3 ? v * fade17 : v));
      const poly257 = big ? polyAt(257, tPoly, true) : [0, 0, 0, 0];
      // between circles the pen draws the polygon: its tip moves on round the circle
      for (const [P, n] of [[poly17, 17], [poly257, 257]] as [number[], number][]) {
        if (P[0] > 0 && P[1] > 0 && P[1] < n) {
          const k = Math.floor(P[1]), fr = P[1] - k, a0 = (2 * Math.PI * k) / n, a1 = (2 * Math.PI * (k + 1)) / n;
          pen = [2 * (Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * fr), 2 * (Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * fr)];
          penOn = 1;
        }
      }
      const baseA = smoothstep(mk[1], mk[1] + 3, r);
      const axisK = 0.5 * (clamp01((r - mk[1]) / 3) + ease(clamp01((r - mk[1]) / 3)));
      const circK = clamp01((r - mk[1] - 2) / 4.5);
      if (circK > 0 && circK < 1) { pen = [2 * Math.cos(circK * 2 * Math.PI), 2 * Math.sin(circK * 2 * Math.PI)]; penOn = 1; }
      // the bell climbs E-F-G-A on the four polygon changes: the n-gon circle rings with it
      const bellK = Math.min(1, (f.S[CH.bell - 1] ?? 0) * 2.5);

      gl.disable(gl.BLEND);
      plane
        .set('res', W, H)
        .set('R', Rpx)
        .set('T', tp.T)
        .set('p', p)
        .set('bound', tp.bound)
        .set('tileK', 1)
        .set('flowK', flowK)
        .set('wash', washAt(r, mk))
        .set('worldMix', worldMix)
        .set('poly', poly257)
        .set('poly17', poly17)
        .set('perp17', (0.85 - 0.55 * smoothstep(mk[2] + 14, mk[2] + 30, r)) * fade17)
        .set('base', [axisK, circK, baseA, penOn * 0.8])
        .set('ring', bellK)
        .set('perpA', 0.85 - 0.55 * smoothstep(tPoly + 8, tPoly + 14, r))
        .set('spin', spin)
        .set('pen', pen);
      plane.tex('world', worldT.tex[0], 0).tex('s10coef', s10tex, 1).set('s10on', s10on).set('raw', raw).set('mosK', 1 - smoothstep(0, 0.6, r));
      fullscreen(g);

      // the compass: arcs (and then the roots' dots) as instanced ribbons, blended over the plane
      if (r >= mk[1] && arcs.use()) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(g.vao);
        arcs.set('res', W, H).set('U', Rpx / 2).set('spin', spin);
        const draw = (cu: Float32Array, cs: Float32Array, count: number, hw: number) => {
          arcs.set('hw', hw * (H / 1890)).set('C', cu).set('Cs', cs).set('mode', 0);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (512 + 1) * 2, count);
          arcs.set('mode', 1);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, count);
        };
        if (fade17 > 0) draw(Cu17, Cs17, C17.length, 2.0);
        if (big) draw(Cu, Cs, Math.min(MAXC, C257.length), 1.2);
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
      }
    },
  };
}

export default createInversion;
