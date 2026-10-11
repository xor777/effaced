// S10 · Compression · 14–15 (PLAN §4). Climax on the hit at 14:00: the city of facades returns under
// an #EFFACE sky, backlit, and the title gate spells E-F-F-A-C-E-D one letter per note of the lead —
// the word is the melody. Then the frame is compressed to death by a real codec (s10-dct.glsl):
// 8×8 DCT at 320×200, JPEG tables, a quantiser step that grows with the engine's bit-crush
// (14:32 → 15:63). At 15:16 we dive into one block (the "A"), at 15:32 it opens into its 64 basis
// functions — the 8×8 chart, "64" in the picture — and the frequencies die in zigzag order until only
// the DC term is left; the zoom pulls out over a world of block averages in #DECADE, ready for S11.

import { type Gfx, type Target, program, ensureTarget, bindTarget, fullscreen } from '../gfx/gl.ts';
import type { Scene, FrameCtx } from './types.ts';
import { smoothstep as smooth } from '../timeline/events.ts';
import { TAA, lookAt, type Vec3 } from '../gfx/taa.ts';
import {
  onsets, pulse, lastIndex, grow, textAtlas, spline, setCityLook, setCitySigns, hexP3, ignite, sharedProgram,
  type CityLook, type TextAtlas, type Sign,
} from '../gfx/city.ts';

const ROW = 0.12;
const AVENUE = 0;

/** For S11, which opens on this scene's last frame: the 320×200 dequantised DCT coefficients of the
 *  last frame S10 rendered (the DC term of block (bx, by), y up, sits at texel (8·bx, 8·by); the
 *  block mean is decode(DC / 8) — see s10-dct.glsl) and that frame's song time. */
let lastCoef: { tex: WebGLTexture; t: number } | null = null;
export const s10Mosaic = () => lastCoef;
const GATE = 7; // the title gate of S03 (cz = 45)
/** the engine's crush (src/audio/engine-core.ts CRUSH): ramps 14:32 → 15:63, released at 16:00 */
const CRUSH_FROM = 0x14 * 64 + 32, CRUSH_FULL = 0x15 * 64 + 63;

// camera: [t, x, y, z, look x, look y, look z] — a slow push towards the gate, settling by 15:16
const CAM: number[][] = [
  [0.0, 3.0, 2.4, 14.0, 3.5, 5.0, 45],
  [4.0, 3.2, 3.0, 22.0, 3.5, 5.6, 45],
  [9.6, 3.45, 4.6, 31.5, 3.5, 6.1, 45],
  [15.36, 3.5, 4.9, 33.0, 3.5, 6.2, 45],
];


export function createCompression(g: Gfx): Scene {
  const gl = g.gl;
  const cityProg = sharedProgram(g, 'scenes/s03-city');
  const down = program(g, 'scenes/s10-dct', '', '#define PASS_DOWN');
  const dct = program(g, 'scenes/s10-dct', '', '#define PASS_DCT');
  const idct = program(g, 'scenes/s10-dct', '', '#define PASS_IDCT');
  const comp = program(g, 'scenes/s10-dct', '', '#define PASS_COMP');
  const taa = new TAA(g, { ratio: 0.45 });
  // from 15:10 the frame is fully coded: only the 320×200 codec input matters, so the city is drawn
  // into a 960×600 target (TAA at 480×300) instead of full resolution — the tail costs a third
  const taaLow = new TAA(g, { ratio: 0.5, pool: false });
  let lowT: Target | null = null;
  let lowWarm = false;
  let atlas: TextAtlas | null = null;
  let cityT: Target | null = null, codeT: Target | null = null, coefT: Target | null = null, recT: Target | null = null;
  let zoomBlock: [number, number] = [20, 14];

  const look: CityLook = {
    // the sun sets exactly in the gate's arch
    sunDir: [0.0, 0.055, 1.0],
    sunCol: hexP3('#fff2c8', 14.0),
    ambient: 0.35,
    skyHor: hexP3('#effacE', 5.0),
    skyZen: hexP3('#a8c0a0', 1.6),
    fogCol: hexP3('#d8e8b8', 0.22),
    fog: [0.012, 5.0, 0.05, 0.86],
    ground: hexP3('#b8b890', 0.25),
    pal: [hexP3('#e8e6d4', 0.7), hexP3('#a8a890', 0.55), hexP3('#4a4a3c', 0.3)],
    stucco: [hexP3('#d8c8a8', 0.55), hexP3('#c4c0b0', 0.55), hexP3('#b8a898', 0.52), hexP3('#d4d0bc', 0.58)],
    trim: hexP3('#f2f0e4', 0.8),
    neon: hexP3('#ff3d8b', 18.0),
    win: hexP3('#ffcf8a', 2.4),
    cloud: [0.7, 1.1, 0.05, 1.15],
  };


  const scene: Scene & { look?: CityLook } = {
    look,
    id: 'S10',
    title: 'Compression',
    scale: 1,
    fps: 60,
    post: (f: FrameCtx) => {
      const crash = crashEnv(f);
      return {
        exposure: 1.6 * Math.exp(-f.local / 0.35) + 0.25 * crash,
        bloom: 0.1 + 0.12 * crash + 0.2 * Math.exp(-f.local / 0.6),
        bloomRadius: 1.1,
        vignette: 0.34,
        grain: 0.035,
        ca: 1.5,
        look: [1.2, 1.3, 0, 0],
      };
    },
    programs: () => [cityProg, down, dct, idct, comp, ...taa.programs()],
    init() {
      atlas ??= textAtlas(g, ['EFFACED']);
    },
    render(f: FrameCtx, hdr) {
      if (!hdr || !atlas) return;
      const t = f.local;
      const g0 = grow(0x14), g1 = grow(0x15), g2 = grow(0x16);
      const R = (pos: number, row: number) => (grow(pos, row) - g0) * ROW; // local seconds of pos:row
      // ---- music
      const kicks = onsets(f, 1, g0, g2);
      const snares = onsets(f, 2, g0, g2);
      const lead = onsets(f, 10, g0, grow(0x14, 32), [0, 6, 8, 16, 20, 24, 30].map((r) => g0 + r));
      const kick = pulse(kicks, f.t, 0.15);
      const snare = pulse(snares, f.t, 0.08);
      const row = (f.t / ROW);
      const crush = smooth(CRUSH_FROM, CRUSH_FULL, row);

      // ---- camera (settles before the dive), snare micro-shake
      const c = spline(CAM, t);
      const pos: Vec3 = [c[0], c[1], c[2]];
      const tgt: Vec3 = [c[3], c[4], c[5]];
      const sh = snare * 0.005 * (1 - smooth(R(0x15, 8), R(0x15, 16), t));
      const dist = Math.hypot(tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]);
      tgt[0] += Math.sin(f.t * 83.1) * sh * dist;
      tgt[1] += Math.sin(f.t * 61.7 + 2) * sh * dist;
      const cam = lookAt(pos, tgt, 46, 0.01 * Math.sin(t * 0.5));

      // ---- the title spells the lead, letter by note
      const signs: Sign[] = [{ cell: [AVENUE, GATE], line: 0, height: 1.0, y: 6.3, level: 1, ...ignite(lead, f.t) }];

      // ---- 1. the city: full resolution while it is seen, a low-res pass once only the codec sees it
      const drawCity = (tg: Target, tq: TAA) => {
        tq.begin(f, tg, cam);
        if (cityProg.use()) {
          tq.uniforms(cityProg);
          setCityLook(cityProg, look, f.t);
          setCitySigns(cityProg, atlas!, signs, 3);
          cityProg
            .set('uTime', f.t)
            .set('uFrame', f.frame % 1024)
            .set('uWin', 0.32, kick, lastIndex(kicks, f.t) + 1, 0.14)
            .set('uFloor', 3.5, 52.0, 0.36, 0.0)
            .set('uGlass', 0)
            .set('uAvenue', AVENUE)
            .set('uGates', [GATE, 11, -999, -999]);
          fullscreen(g);
        }
        tq.resolve(tg);
      };
      const lowStart = R(0x15, 10); // = when `coded` reaches 1
      const useLow = t >= lowStart;
      lowT = ensureTarget(g, lowT, 960, 600, { formats: [gl.RGBA16F] });
      // the low pass pre-rolls 0.2 s so its history has converged at the switch; it is
      // also drawn once on the first (loader warm-up) frame so its targets exist before the show
      if (t >= lowStart - 0.2 || !lowWarm) {
        drawCity(lowT, taaLow);
        lowWarm = true;
      }
      if (!useLow) {
        cityT = ensureTarget(g, cityT, hdr.w, hdr.h, { formats: [gl.RGBA16F] });
        drawCity(cityT, taa);
      }
      const src = useLow ? lowT : cityT!;

      // ---- 2. the codec
      const qs = crush <= 0 ? 0 : 0.5 * 2 ** (5.2 * crush);
      // the frequencies die one zigzag diagonal per row (16th) from 15:33: kmax = last index kept
      const dead = Math.max(0, Math.min(14, Math.floor((t - R(0x15, 32)) / ROW)));
      const kmax = DIAG_END[14 - dead];
      codeT = ensureTarget(g, codeT, 320, 200, { formats: [gl.RGBA16F], filter: gl.NEAREST });
      coefT = ensureTarget(g, coefT, 320, 200, { formats: [gl.RGBA32F, gl.RGBA32F], filter: gl.NEAREST });
      recT = ensureTarget(g, recT, 1280, 800, { formats: [gl.RGBA16F, gl.RGBA16F] });
      gl.disable(gl.BLEND);
      bindTarget(g, codeT);
      if (down.use()) {
        down.tex('src', src.tex[0], 0).set('srcRes', src.w, src.h);
        fullscreen(g);
      }
      bindTarget(g, coefT);
      if (dct.use()) {
        dct.tex('src', codeT.tex[0], 0).set('qs', qs).set('kmax', kmax);
        fullscreen(g);
        lastCoef = { tex: coefT.tex[0], t: f.t };
      }
      // DC only (from 15:46): every block is flat, the composite reads the means directly
      const dcOnly = kmax < 0.5;
      bindTarget(g, recT);
      if (!dcOnly && idct.use()) {
        idct.tex('coef', coefT.tex[0], 0).tex('err', coefT.tex[1], 1).set('res', recT.w, recT.h);
        fullscreen(g);
      }

      // ---- 3. the picture: zoom into one block, the chart, the DC mosaic
      if (t < R(0x15, 16)) zoomBlock = blockOf(cam, [3.5 + 0.0, 6.3, 45 - 0.06], hdr.w / hdr.h);
      const zin = smooth(R(0x15, 14), R(0x15, 31), t), zout = smooth(R(0x15, 55), R(0x15, 63) + 0.06, t);
      const zl = Math.log(23) * (zin - zout);
      const z = Math.exp(zl);
      const T: [number, number] = [zoomBlock[0] * 8 + 4, zoomBlock[1] * 8 + 4];
      const cx = T[0] + (160 - T[0]) / z, cy = T[1] + (100 - T[1]) / z;
      const chart = smooth(R(0x15, 30), R(0x15, 33), t) * (1 - smooth(R(0x15, 47), R(0x15, 54), t));
      const coded = smooth(R(0x14, 48), R(0x15, 10), t);
      const decade = smooth(R(0x15, 44), R(0x15, 63), t);
      bindTarget(g, hdr);
      if (comp.use()) {
        comp
          .tex('city', src.tex[0], 0)
          .tex('rec', recT.tex[0], 1)
          .tex('rerr', recT.tex[1], 2)
          .tex('coef', coefT.tex[0], 3)
          .set('res', hdr.w, hdr.h)
          .set('zoom', cx, cy, z, 1)
          .set('zoom2', zoomBlock[0], zoomBlock[1])
          .set('mode', coded, chart, chart, decade)
          .set('kmax', kmax)
          .set('dcOnly', dcOnly ? 1 : 0)
          .set('beat', kick)
          .set('tm', f.t);
        fullscreen(g);
      }
    },
  };

  /** codec block (40×25 grid, y up) under a world point */
  function blockOf(cam: ReturnType<typeof lookAt>, X: Vec3, aspect: number): [number, number] {
    const v: Vec3 = [X[0] - cam.pos[0], X[1] - cam.pos[1], X[2] - cam.pos[2]];
    const zz = v[0] * cam.fwd[0] + v[1] * cam.fwd[1] + v[2] * cam.fwd[2];
    if (zz <= 0) return [20, 12];
    const nx = (v[0] * cam.right[0] + v[1] * cam.right[1] + v[2] * cam.right[2]) / (zz * cam.tanY * aspect);
    const ny = (v[0] * cam.up[0] + v[1] * cam.up[1] + v[2] * cam.up[2]) / (zz * cam.tanY);
    const bx = Math.floor(((nx * 0.5 + 0.5) * 320) / 8), by = Math.floor(((ny * 0.5 + 0.5) * 200) / 8);
    return [Math.min(39, Math.max(0, bx)), Math.min(24, Math.max(0, by))];
  }

  /** the crash on each downbeat (ch4 F-4), for a breath of exposure and bloom */
  function crashEnv(f: FrameCtx) {
    const cr = onsets(f, 4, grow(0x14), grow(0x16), [0, 16, 32, 48, 64, 80, 96, 112].map((r) => grow(0x14) + r), 'F-4');
    return pulse(cr, f.t, 0.35) * (1 - smooth(R2(0x15, 30), R2(0x15, 34), f.local));
  }
  return scene;
}

const R2 = (pos: number, row: number) => (pos * 64 + row - 0x14 * 64) * ROW;
/** last zigzag index of each anti-diagonal u + v = d of the 8×8 block */
const DIAG_END = Array.from({ length: 15 }, (_, d) => {
  let n = 0;
  for (let i = 0; i <= d; i++) n += i <= 7 ? i + 1 : 15 - i;
  return n - 1;
});

export default createCompression;
