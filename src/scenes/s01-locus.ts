// S01 · Boundary (PLAN §4): the beam draws the CIE 1931 spectral locus — the literal edge of human
// colour vision — it fills with colour, the sRGB triangle appears and then widens to Display P3,
// the gamut of this very screen. Everything outside is hatched. The bell plays C-A-G-E: three notes
// light the three vertices, the fourth (E) puts a point outside the triangle.

import { type Gfx, type Target, program, fullscreen, ensureTarget, bindTarget } from '../gfx/gl.ts';
import { Beam } from '../gfx/beam.ts';
import type { Scene, FrameCtx } from './types.ts';
import { markerTimes, hit, smoothstep } from '../timeline/events.ts';
import { ROW, ROWS } from '../timeline/script.ts';
import { CH } from '../music/roster.ts';
import { cageFaceStart } from './s02-cage.ts';

// CIE 1931 2° spectral locus, chromaticity (x, y) at 380..700 nm in 5 nm steps (standard tables).
// The analytic multi-lobe CMF fit (lib/color.glsl) is fine for colours, but its tails are too
// inaccurate for chromaticity at the ends of the spectrum, so the outline uses the table.
// prettier-ignore
const XY = [
  0.1741,0.0050, 0.1740,0.0050, 0.1738,0.0049, 0.1736,0.0049, 0.1733,0.0048, 0.1730,0.0048, 0.1726,0.0048,
  0.1721,0.0048, 0.1714,0.0051, 0.1703,0.0058, 0.1689,0.0069, 0.1669,0.0086, 0.1644,0.0109, 0.1611,0.0138,
  0.1566,0.0177, 0.1510,0.0227, 0.1440,0.0297, 0.1355,0.0399, 0.1241,0.0578, 0.1096,0.0868, 0.0913,0.1327,
  0.0687,0.2007, 0.0454,0.2950, 0.0235,0.4127, 0.0082,0.5384, 0.0039,0.6548, 0.0139,0.7502, 0.0389,0.8120,
  0.0743,0.8338, 0.1142,0.8262, 0.1547,0.8059, 0.1929,0.7816, 0.2296,0.7543, 0.2658,0.7243, 0.3016,0.6923,
  0.3373,0.6589, 0.3731,0.6245, 0.4087,0.5896, 0.4441,0.5547, 0.4788,0.5202, 0.5125,0.4866, 0.5448,0.4544,
  0.5752,0.4242, 0.6029,0.3965, 0.6270,0.3725, 0.6482,0.3514, 0.6658,0.3340, 0.6801,0.3197, 0.6915,0.3083,
  0.7006,0.2993, 0.7079,0.2920, 0.7140,0.2859, 0.7190,0.2809, 0.7230,0.2770, 0.7260,0.2740, 0.7283,0.2717,
  0.7300,0.2700, 0.7311,0.2689, 0.7320,0.2680, 0.7327,0.2673, 0.7334,0.2666, 0.7340,0.2660, 0.7344,0.2656,
  0.7346,0.2654, 0.7347,0.2653,
];
const LOCUS: [number, number][] = [];
for (let i = 0; i < XY.length; i += 2) LOCUS.push([XY[i], XY[i + 1]]);
const chroma = (nm: number): [number, number] => {
  const f = (nm - 380) / 5, i = Math.max(0, Math.min(LOCUS.length - 2, Math.floor(f))), k = f - i;
  return [LOCUS[i][0] + (LOCUS[i + 1][0] - LOCUS[i][0]) * k, LOCUS[i][1] + (LOCUS[i + 1][1] - LOCUS[i][1]) * k];
};
const LOCUS_FLAT = new Float32Array(66 * 2);
LOCUS.forEach(([x, y], i) => LOCUS_FLAT.set([x, y], i * 2));

/** point along the closed locus outline (spectral part then the purple line), u in 0..1 */
function locusAt(u: number): [number, number] {
  const n = LOCUS.length;
  const f = Math.min(0.99999, Math.max(0, u)) * n; // n segments incl. the closing one
  const i = Math.floor(f), k = f - i;
  const a = LOCUS[i], b = LOCUS[(i + 1) % n];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/**
 * The affine map from screen units (x in ±aspect/2, y in ±0.5) to chromaticity, as a column-major
 * mat3. Static: the diagram view (centre xy, chromaticity units per screen height). Flying (k > 0):
 * the map that puts the P3 corners R, G, B at their places interpolated towards `to` (NDC of S02's
 * red, green, blue face corners) — interpolating the corners keeps the triangle a triangle.
 */
const P3_RGB: [number, number][] = [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]];
function frameMatrix(view: [number, number, number], to: [number, number][] | null, k: number, aspect: number): number[] {
  if (!to || k <= 0) return [view[2], 0, 0, 0, view[2], 0, view[0], view[1], 1];
  const s = P3_RGB.map(([x, y], i): [number, number] => {
    const a = [(x - view[0]) / view[2], (y - view[1]) / view[2]];
    const b = [(to[i][0] * aspect) / 2, to[i][1] / 2];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  });
  // xy = M s + o through the three corner pairs
  const [R, G, B] = P3_RGB, [sR, sG, sB] = s;
  const d1 = [sR[0] - sB[0], sR[1] - sB[1]], d2 = [sG[0] - sB[0], sG[1] - sB[1]];
  const det = d1[0] * d2[1] - d2[0] * d1[1] || 1e-9;
  const inv = [d2[1] / det, -d1[1] / det, -d2[0] / det, d1[0] / det]; // inverse of [d1 d2] (column-major)
  const e1 = [R[0] - B[0], R[1] - B[1]], e2 = [G[0] - B[0], G[1] - B[1]];
  // M = [e1 e2] · inv, column-major [m00 m10 m01 m11]
  const m00 = e1[0] * inv[0] + e2[0] * inv[1], m10 = e1[1] * inv[0] + e2[1] * inv[1];
  const m01 = e1[0] * inv[2] + e2[0] * inv[3], m11 = e1[1] * inv[2] + e2[1] * inv[3];
  const ox = B[0] - (m00 * sB[0] + m01 * sB[1]), oy = B[1] - (m10 * sB[0] + m11 * sB[1]);
  return [m00, m10, 0, m01, m11, 0, ox, oy, 1];
}

const POS = 0x01; // S01 starts at 01:00
const START_ROW = POS * ROWS;
const P02 = START_ROW + ROWS; // 02:00: the bell repeats C-A-G-E, the harp starts its arpeggios

// pitch → wavelength along the visible spectrum: the harp's low notes are red, its high notes violet
const nmOf = (midi: number) => Math.max(400, Math.min(690, 690 - ((midi - 41) / (79 - 41)) * 290));
// the cage springing open: overshoots ~24 % and settles in half a second
const spring = (x: number) => (x <= 0 ? 0 : 1 - Math.exp(-9 * x) * Math.cos(20 * x));
// harp fallback (no audio data): every 2 rows through 02, an F-A-C-E arpeggio
const HARP_FALLBACK = Array.from({ length: 32 }, (_, i) => ({ grow: P02 + 2 * i, midi: [53, 57, 60, 64, 65, 64, 60, 57][i % 8] }));

export function createLocus(g: Gfx): Scene {
  const prog = program(g, 'scenes/s01-locus');
  // the static diagram (locus test + outline distance + colours), baked once per size: the per-pixel
  // loop over 65 segments cost ~8 ms a frame at 3024×1890 (user's bench), the texel read ~nothing
  const bakeProg = program(g, 'scenes/s01-locus', '', '#define BAKE 1');
  let bake: Target | null = null;
  let bakeView: [number, number, number] = [0, 0, 1];
  const pulses = new Float32Array(8 * 4);
  const beam = new Beam(g);
  let beamIdle = false;
  const cue: { audio: FrameCtx['audio'] | undefined; bell: number[]; harp: { t: number; midi: number }[] } = { audio: undefined, bell: [], harp: [] };
  beam.style = { sigmaPx: 1.4, tau: 0.25, intensity: 120, tint: [0.62, 0.55, 0.75] };
  let lastU = 0;
  // where the anomaly sits: just inside the locus at 505 nm — a green no screen here can show
  const [ax, ay] = chroma(505);
  const anomalyXY: [number, number] = [ax + (0.3127 - ax) * 0.12, ay + (0.329 - ay) * 0.12];

  return {
    id: 'S01',
    title: 'Boundary',
    post: { tonemap: 'clip', bloom: 0.12, bloomRadius: 1.0, vignette: 0.25, grain: 0.02 },
    programs: () => [prog, bakeProg, ...beam.programs()],
    init: () => beam.init(),
    render(f: FrameCtx, hdr) {
      const t = f.t;
      // the four bell notes of the first CAGE (F-4 markers in 01); default: one per bar
      const m = markerTimes(f.audio, 'F-4', START_ROW, START_ROW + 2 * ROWS, [0, 16, 32, 48].map((r) => START_ROW + r));
      const [m0, m1, m2, m3] = [m[0], m[1] ?? m[0] + 1.92, m[2] ?? m[0] + 3.84, m[3] ?? m[0] + 5.76];
      const s0 = START_ROW * ROW;
      // 02: the bell's second C-A-G-E (ch13) and the harp (ch14), from the track or the score's rows;
      // picked out of the track's ~5000 notes once per render, not every frame (garbage → GC hitches)
      if (cue.audio !== f.audio) {
        const notes = (ch: number) => f.audio?.notes?.filter((n) => n.ch === ch && n.grow >= P02 && n.grow < P02 + ROWS);
        const bellN = notes(CH.bell);
        cue.bell = bellN && bellN.length >= 4 ? bellN.map((n) => n.t) : [0, 16, 32, 48].map((r) => (P02 + r) * ROW);
        const harpN = notes(CH.pluck);
        cue.harp = harpN?.length ? harpN.map((n) => ({ t: n.t, midi: n.midi })) : HARP_FALLBACK.map((n) => ({ t: n.grow * ROW, midi: n.midi }));
        cue.audio = f.audio;
      }
      const [b0, b1, b2, b3] = cue.bell;
      const harp = cue.harp;

      // view: the diagram, framed for 16:10. From the last bell note (E, 02:48) everything but the
      // Display P3 triangle dissolves, and in the last bar the triangle flies onto the 600-cell face
      // that S02 opens on (same corners, same colours): the cut to S02 is invisible.
      const view0: [number, number, number] = [0.36, 0.42, 1.0];
      const view = view0;
      const tEnd = (P02 + ROWS) * ROW;
      const solo = smoothstep(b3, b3 + 8 * ROW, t);
      const fly = smoothstep(0, 1, smoothstep(b3 + 2 * ROW, tEnd - ROW / 2, t));
      const frame = frameMatrix(view0, fly > 0 ? cageFaceStart(f.aspect) : null, fly, f.aspect);

      // 1. the beam traces the outline over the first bar
      const ub = smoothstep(s0, s0 + 16 * ROW, t);
      const reset = f.jumped;
      if (reset) lastU = ub;
      beam.begin();
      const toSig = (x: number, y: number): [number, number] => [((x - view[0]) / view[2]) * 2 / 0.82, ((y - view[1]) / view[2]) * 2 / 0.82];
      const steps = 240;
      const from = Math.min(lastU, ub);
      for (let i = 0; i <= steps; i++) {
        const [x, y] = locusAt(from + ((ub - from) * i) / steps);
        const [sx, sy] = toSig(x, y);
        beam.push(sx, sy);
      }
      lastU = ub;
      const beamOn = 1 - smoothstep(s0 + 14 * ROW, s0 + 24 * ROW, t);
      const gl = g.gl;

      // 2. the diagram (the view is static: bake when the size changes — the loader's warm-up does it)
      if (!bake || bake.w !== hdr!.w || bake.h !== hdr!.h) {
        if (!bakeProg.use()) return;
        bake = ensureTarget(g, bake, hdr!.w, hdr!.h, { formats: [gl.RGBA16F], filter: gl.LINEAR });
        bakeView = view0;
        bindTarget(g, bake);
        bakeProg.set('res', bake.w, bake.h).set('L', LOCUS_FLAT).set('nL', LOCUS.length).set('view', bakeView);
        gl.disable(gl.BLEND);
        fullscreen(g);
        bindTarget(g, hdr);
      }
      // the 8 most recent harp notes of 02 as pulses on the outline
      pulses.fill(0);
      let k = 0;
      for (let i = harp.length - 1; i >= 0 && k < 8; i--) {
        const age = t - harp[i].t;
        if (age < 0 || age > 1.2) continue;
        const [px, py] = chroma(nmOf(harp[i].midi));
        pulses.set([px, py, hit(t, harp[i].t, 0.01, 0.3) * (1 - solo), age], 4 * k++);
      }
      // the cage springs open from sRGB to Display P3 on the bell's C (02:00), the bell's A and G
      // flash the vertices and re-trace the edges, its E (02:48) makes the anomaly flare
      const open = spring(t - b0);
      const flash = hit(t, b0, 0.01, 0.4);
      if (prog.use()) {
        prog
          .tex('bake', bake.tex[0], 0)
          .set('bakeView', bakeView)
          .set('frame', frame)
          .set('solo', solo)
          .set('pulse', pulses)
          .set('res', hdr!.w, hdr!.h)
          .set('t', t)
          .set('view', view)
          .set('fill', 0.02 + 0.7 * smoothstep(m0, m0 + 7.0, t))
          .set('outline', 0.9 * smoothstep(s0 + 10 * ROW, s0 + 20 * ROW, t))
          .set('vtx', [m0, m1, m2].map((mt) => (hit(t, mt, 0.02) * (1 + 3 * Math.exp(-Math.max(0, t - mt) / 0.35)) + 2.5 * flash + 2.5 * hit(t, b1, 0.01, 0.3)) * (1 - solo)))
          .set('edgeK', [
            0.6 * hit(t, m1, 0.6) + 0.9 * flash + 0.8 * hit(t, b2, 0.01, 0.35) + 3.0 * solo,
            0.6 * hit(t, m2, 0.6) + 0.9 * flash + 0.8 * hit(t, b2 + 2 * ROW, 0.01, 0.35) + 3.0 * solo,
            0.6 * hit(t, m2 + 0.3, 0.6) + 0.9 * flash + 0.8 * hit(t, b2 + 4 * ROW, 0.01, 0.35) + 3.0 * solo,
          ])
          .set('p3', open)
          .set('hatch', smoothstep(m2, m2 + 2.5, t))
          .set('anomaly', [
            anomalyXY[0],
            anomalyXY[1],
            (hit(t, m3, 0.02) * (0.8 + 2.5 * Math.exp(-Math.max(0, t - m3) / 0.5)) + 3 * hit(t, b3, 0.01, 0.5)) * (1 - smoothstep(b3 + 4 * ROW, b3 + 12 * ROW, t)),
          ])
          .set('grid', 1);
        gl.disable(gl.BLEND);
        fullscreen(g);
      }
      // the phosphor has faded ~2 s after the beam is off (tau 0.25 s): stop paying for it
      const idle = t > s0 + 24 * ROW + 2;
      if (!idle) beam.render(f.dt, hdr!, f.aspect, reset || beamIdle, 0.82, (beamOn * 800) / steps);
      beamIdle = idle;
    },
  };
}

export default createLocus;
