// S03 · City of Facades · 05–06 (PLAN §4). The band enters at 05:00: we come through the CRT glass
// into daylight, low over the Penrose floor of an avenue lined with carved flats. The title gate
// ahead spells EFFACED in neon, one letter per note of the lead's FACADE theme; we pass under its arch
// on the downbeat of 06, rise, pass the credits gate on the theme's peak (06:32) and see the city
// go on for ever. Kick → windows flash, snare → camera micro-shake.

import { type Gfx, fullscreen } from '../gfx/gl.ts';
import type { Scene, FrameCtx } from './types.ts';
import { smoothstep as smooth } from '../timeline/events.ts';
import { TAA, lookAt, type Vec3 } from '../gfx/taa.ts';
import {
  onsets, pulse, lastIndex, grow, textAtlas, spline, setCityLook, setCitySigns, hexP3, ignite, sharedProgram,
  type CityLook, type TextAtlas, type Sign,
} from '../gfx/city.ts';

/**
 * Text carved into the two gates — edit freely. Line 0 is the title gate (one letter lights per lead
 * note in 05). Line 1 is the credits tablet on the second gate: one row per role, '\n' between rows,
 * shrunk to fit the gate. In 06 each row lights in two steps — the role, then the names — on the lead
 * notes nearest to CREDIT_CUES (rows of 06).
 */
export const CREDITS = ['EFFACED', 'code — opus\nmusic — opus, xor777\ngfx — opus, xor777'];
const CREDIT_CUES = [0, 6, 12, 16, 24, 28]; // role, names · role, names · role, names

const AVENUE = 0; // x cell of the avenue (x ∈ [0, 7))
const GATES = [7, 11]; // z rows of the gates (title, credits)

// camera: [t, x, y, z, look x, look y, look z]
const CAM: number[][] = [
  [0.0, 3.5, 1.2, -1.0, 3.5, 2.5, 30],
  [2.5, 3.45, 1.65, 13.0, 3.5, 3.3, 45],
  [5.0, 3.5, 2.3, 29.0, 3.5, 3.6, 55],
  [7.68, 3.5, 2.75, 45.0, 3.55, 4.6, 69],
  // 06: rise and settle in front of the credits gate while its three rows light (readable to 06:52)
  [9.2, 3.5, 5.7, 54.5, 3.5, 6.9, 69],
  [11.5, 3.5, 6.5, 58.0, 3.52, 6.95, 69],
  [13.3, 3.55, 7.1, 60.2, 3.58, 7.3, 69],
  // then crane up over it: the city goes on for ever
  [14.6, 3.7, 12.6, 66.0, 3.9, 9.6, 92],
  [15.36, 3.9, 15.6, 72.0, 4.2, 9.0, 112],
];

export function createCity(g: Gfx): Scene {
  const gl = g.gl;
  const prog = sharedProgram(g, 'scenes/s03-city');
  const taa = new TAA(g, { ratio: 0.45 });
  let atlas: TextAtlas | null = null;

  const look: CityLook = {
    sunDir: [-0.72, 0.36, -0.6],
    sunCol: hexP3('#ffd3a6', 6.5),
    skyHor: hexP3('#ffb8b0', 3.4),
    skyZen: hexP3('#b8a0e0', 1.6),
    fogCol: hexP3('#ffb8c0', 0.36),
    fog: [0.022, 4.5, 1.1, 0.3],
    ground: hexP3('#e8b4b8', 0.45),
    pal: [hexP3('#efe2dc', 0.7), hexP3('#d6aabb', 0.6), hexP3('#6a4858', 0.3)],
    stucco: [hexP3('#e8a7b6', 0.74), hexP3('#c7b0d6', 0.74), hexP3('#efd2b0', 0.76), hexP3('#f0e2d6', 0.78)],
    trim: hexP3('#f3ebe3', 0.82),
    neon: hexP3('#ff4f9a', 9.0),
    win: hexP3('#ffd9a8', 1.6),
    cloud: [0.9, 0.6, 0.02, 1.5],
    ambient: 0.8,
  };

  const scene: Scene & { look?: CityLook } = {
    look, // dev: tweak from the console via __demo.scenes.get('S03').look
    id: 'S03',
    title: 'City of Facades',
    scale: 1,
    fps: 60,
    post: (f: FrameCtx) => ({
      // the CRT glass gives way to daylight: a white bloom settling in the first second
      exposure: 2.2 * Math.exp(-f.local / 0.28),
      bloom: 0.09 + 0.25 * Math.exp(-f.local / 0.5),
      bloomRadius: 1.0,
      vignette: 0.3,
      grain: 0.03,
      ca: 1.2,
      look: [1.25, 1.4, 0, 0],
    }),
    programs: () => [prog, ...taa.programs()],
    init() {
      atlas ??= textAtlas(g, CREDITS);
    },
    render(f: FrameCtx, hdr) {
      if (!hdr || !atlas) return;
      const t = f.local;
      const g0 = grow(0x05), g1 = grow(0x06), g2 = grow(0x07);
      // ---- music
      const kicks = onsets(f, 1, g0, g2, kickFallback(g0, g2));
      const snares = onsets(f, 2, g0, g2, snareFallback(g0, g2));
      const lead5 = onsets(f, 10, g0, g1, [0, 6, 8, 12, 16, 30, 44].map((r) => g0 + r));
      const lead6 = onsets(f, 10, g1, g2, [0, 6, 8, 12, 16, 24, 28, 32].map((r) => g1 + r));
      const kick = pulse(kicks, f.t, 0.16);
      const kickN = lastIndex(kicks, f.t) + 1;
      const snare = pulse(snares, f.t, 0.09);

      // ---- camera, with a snare-driven micro shake (rotation only — the lane is narrow)
      const c = spline(CAM, t);
      const pos: Vec3 = [c[0], c[1], c[2]];
      const tgt: Vec3 = [c[3], c[4], c[5]];
      const sh = snare * 0.006;
      const n1 = Math.sin(f.t * 91.7) + Math.sin(f.t * 57.3), n2 = Math.sin(f.t * 77.1 + 1) + Math.sin(f.t * 43.9);
      const dist = Math.hypot(tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]);
      tgt[0] += n1 * sh * dist;
      tgt[1] += n2 * sh * dist;
      const roll = 0.012 * Math.sin(t * 0.4) + n2 * sh * 0.5;
      const cam = lookAt(pos, tgt, 52 - 6 * smooth(8, 15, t), roll);

      // ---- signs: the title lights one letter per lead note, the credits one word per note
      const signs: Sign[] = [
        { cell: [AVENUE, GATES[0]], line: 0, height: Math.min(1.0, 6.0 / atlas.lines[0][3]), y: 6.3, level: 1, ...ignite(lead5, f.t) },
        { cell: [AVENUE, GATES[1]], line: 1, height: Math.min(1.9, 6.1 / atlas.lines[1][3]), y: 6.95, level: 1, ...ignite(lead6, f.t, creditCounts(lead6, g1)) },
      ];

      taa.begin(f, hdr, cam);
      if (prog.use()) {
        taa.uniforms(prog);
        setCityLook(prog, look, f.t);
        setCitySigns(prog, atlas, signs, 3);
        prog
          .set('uTime', f.t)
          .set('uFrame', f.frame % 1024)
          .set('uWin', 0.22, kick * 1.5, kickN, 0.14)
          .set('uFloor', 3.5, 52.0, 0.36, 1.0)
          .set('uGlass', 0.7 * Math.exp(-t / 0.16) * (t < 0.6 ? 1 : 0))
          .set('uAvenue', AVENUE)
          .set('uGates', [GATES[0], GATES[1], -999, -999]);
        gl.disable(gl.BLEND);
        fullscreen(g);
      }
      taa.resolve(hdr);
    },
  };
  return scene;
}

/** characters lit after each credit step: per row, the role (first word), then the whole row */
const CREDIT_STEPS = (() => {
  const out: number[] = [];
  let base = 0;
  for (const row of CREDITS[1].split('\n')) {
    const role = row.trimStart().split(/\s/)[0];
    out.push(base + row.indexOf(role) + role.length, base + row.length);
    base += row.length;
  }
  return out;
})();

/** for each lead onset in 06: how many characters of the credits are lit (steps on the nearest cue) */
function creditCounts(lead: number[], g1: number): number[] {
  return lead.map((t) => {
    const row = t / 0.12 - g1;
    const k = CREDIT_CUES.filter((c) => c <= row + 1).length - 1;
    return CREDIT_STEPS[Math.max(0, Math.min(CREDIT_STEPS.length - 1, k))];
  });
}

// fallbacks (the galop of 05–06) for when no note data exists at all
function kickFallback(a: number, b: number) {
  const r: number[] = [];
  for (let x = a; x < b; x += 16) r.push(x, x + 6, x + 8, x + 10);
  return r;
}
function snareFallback(a: number, b: number) {
  const r: number[] = [];
  for (let x = a; x < b; x += 8) r.push(x + 4);
  return r;
}

export default createCity;
