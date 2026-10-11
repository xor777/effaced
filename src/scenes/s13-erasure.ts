// S13 · Erasure (PLAN §4): a fractal flame grows out of the creature's sigil, fills the screen and
// collapses into one single point — the fixation point of S14. 1B:60–63: one beat of silence, black
// and the point, drawn exactly like the first frame of S14.
//
// Chaos game on the GPU (Draves & Reckase): 786k persistent walkers, one step per pass, two per frame
// at 60 Hz; each step is splatted into an RGBA32F histogram (Σ colour, Σ count) that decays across
// frames (per second, not per frame), then log-density tonemapped. Transform 0 is a condensation map onto the sigil (the same contour the scope voice
// draws in S00, src/audio/synth/scope.ts), so the attractor is the sigil plus all its images.
//
// The flame spells the word. Every note of the lead (ch10) is a letter A–F, and every letter has its
// own flame — a genome of six transforms (affine + 16 flam3 variations): E the sigil budding at its
// triangle, F flares, A an aureole of rings, C a cyclone, D nested discs, B lace. EFFACED in 1A is
// spelt as seven shapes, repeated letters come back turned. The section hits re-cut the symmetry
// (3 → 5 → 17 → 257, the Fermat primes of the creature; 1A:00/16/32/48), turn the palette and whip the
// camera; the tom run 1A:56–63 dives into the flame and the orchestra hit of 1B:00 throws us back out
// into E phrygian (cold palette). 1B:32–47 the heartbeat folds it: every kick a contraction, the
// symmetry climbs to 257 — the flame becomes a ring — and the unison E (1B:48) implodes it to a point.

import { type Gfx, type Target, program, ensureTarget, bindTarget, fullscreen, PingPong } from '../gfx/gl.ts';
import type { Scene, FrameCtx } from './types.ts';
import { markerTimes, smoothstep } from '../timeline/events.ts';
import { ROW, ROWS } from '../timeline/script.ts';
import { sigilTables } from '../audio/synth/scope.ts';
import { cues, pulse, steps, swell, lastAt, type Ev } from './s12-s13-cues.ts';

const SW = 1024, SH = 768; // 786k walkers, two splatted steps each per frame at 60 Hz…
const TAU_K = (1024 * 1024) / (SW * SH); // …and a histogram that remembers that much longer: the same samples per bin
/**
 * Splatted steps per frame. The scene runs at 60 Hz: the flame now fills the screen on the big letters
 * (C, A, F) and the dives, and a frame-filling flame costs more than 8 ms on the M4 — at 120 Hz it would
 * oscillate. 60 Hz × 2 = 120 Hz × 1 samples/s; the decay is per second (dt), so the picture is the same.
 */
const ITER = 2;
const BURN = 10;
/**
 * Points are splatted in horizontal bands, one draw each, the vertex shader culling everything outside:
 * a tile-based GPU then only loads and stores the bins of one band whenever its tiler fills up, instead
 * of the whole histogram — measured ~40 % less for a frame-filling flame (vertex work ×4 is cheap).
 */
export const BANDS = 4;
const P1A = 0x1a * ROWS, P1B = 0x1b * ROWS, P1C = 0x1c * ROWS;
const TA = P1A * ROW, TB = P1B * ROW;
/** sigil radius on screen at the start (H units) — S12's particles land on exactly this */
export const SIGIL_R = 0.2;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** sRGB hex → linear Display P3 (the working space) */
export const p3 = (h: string) => {
  const [r, g, b] = hex(h).map(lin);
  return [0.8224621 * r + 0.177538 * g, 0.0331941 * r + 0.9668058 * g, 0.0170827 * r + 0.0723974 * g + 0.9105199 * b];
};
/**
 * The sigil's light (linear P3), shared with S12: its particles land in this colour and the flame's
 * transform 0 (colour coordinate 0) plots it — the hand-over at 1A:00 is the same picture.
 */
export const SIGIL_COL = p3('#FACADE').map((x) => x * 1.15);

// palettes: [0] the sigil, [1..5] the flame (a cycle). Linear P3; the saturated ones lie outside sRGB.
const PAL_LYD = [SIGIL_COL, [1.0, 0.16, 0.52], [1.0, 0.56, 0.12], p3('#EFFACE'), [0.08, 0.72, 0.9], [0.42, 0.12, 1.0]].flat();
const PAL_PHR = [p3('#DECADE'), [0.95, 0.03, 0.2], [0.16, 0.06, 0.95], p3('#ACCEDE'), [0.02, 0.62, 0.95], [0.55, 0.1, 0.9]].flat();
const PAL_HOT = [[1, 1, 1], [1.0, 0.75, 0.9], [1.0, 0.9, 0.8], [0.95, 0.95, 1.0], [0.9, 0.8, 1.0], [1.0, 0.85, 0.95]].flat();

// ---------------------------------------------------------------------------------------------
// Genomes. A flat vector, so morphs are plain lerps: a header [w0 (the sigil's weight), zoom, spin (the
// view turned, rad), P(mirror), twist, bulge, hue] + 6 × transform [w, rot, sx, sy, skew, ox, oy, colour,
// speed, 16 variation weights]
const V = { lin: 0, sin: 1, sph: 2, swirl: 3, horse: 4, julia: 5, bubble: 6, disc: 7, spiral: 8, hyper: 9, heart: 10, polar: 11, hank: 12, ex: 13, eyefish: 14, cyl: 15 };
type VarName = keyof typeof V;
const NXF = 6;
const XL = 9 + 16;
const HL = 7;
const GL = HL + NXF * XL;
interface XfSpec {
  w: number;
  rot?: number;
  s?: number;
  sy?: number;
  sk?: number;
  o?: [number, number];
  col?: number;
  cs?: number;
  v: Partial<Record<VarName, number>>;
}
interface GenomeSpec {
  w0: number;
  zoom?: number;
  spin?: number;
  hue?: number;
  mir?: number;
  twist?: number;
  bulge?: number;
  xf: XfSpec[];
}
const genome = (g: GenomeSpec): Float32Array => {
  const a = new Float32Array(GL);
  a.set([g.w0, g.zoom ?? 1, g.spin ?? 0, g.mir ?? 0, g.twist ?? 0, g.bulge ?? 0, g.hue ?? 0]);
  g.xf.forEach((x, j) => {
    const o = HL + j * XL;
    a.set([x.w, x.rot ?? 0, x.s ?? 1, x.sy ?? x.s ?? 1, x.sk ?? 0, x.o?.[0] ?? 0, x.o?.[1] ?? 0, x.col ?? 0.5, x.cs ?? 0.5], o);
    for (const [k, w] of Object.entries(x.v)) a[o + 9 + V[k as VarName]] = w!;
  });
  return a;
};
const tri = (k: number, r: number, a0 = Math.PI / 2): [number, number] => [r * Math.cos(a0 + (k * 2 * Math.PI) / 3), r * Math.sin(a0 + (k * 2 * Math.PI) / 3)];

/** the sigil alone: S12's landing, S13's first frame */
const SIGIL = genome({ w0: 1, xf: [] });

/** one flame per letter of the creature's alphabet: each its own shape, size, turn and colours */
const FAMILY: Record<string, GenomeSpec> = {
  // E · the seed: the sigil buds at the three vertices of its triangle, a spiral and an inversion
  E: {
    w0: 0.2,
    xf: [
      ...[0, 1, 2].map((k): XfSpec => ({ w: 0.14, rot: 0.55, s: 0.46, o: tri(k, 0.52), col: 0.25 + 0.2 * k, cs: 0.6, v: { lin: 0.66, sph: 0.1, julia: 0.14, bubble: 0.1 } })),
      { w: 0.16, rot: 0.42, s: 0.84, col: 0.85, cs: 0.35, v: { lin: 0.9, disc: 0.1 } },
      { w: 0.1, rot: 0.25, s: 0.45, col: 1, cs: 0.6, v: { sph: 0.7, julia: 0.3 } },
    ],
  },
  // F · flares: the copies thrown outwards along hyperbolae, a swirl pulls them into tongues
  F: {
    w0: 0.1,
    zoom: 1.6,
    spin: 0.5,
    hue: 0.2,
    twist: 0.18,
    xf: [
      ...[0, 1, 2].map((k): XfSpec => ({ w: 0.13, rot: 1.05, s: 0.55, sy: 0.4, o: tri(k, 0.7), col: 0.2 + 0.25 * k, cs: 0.65, v: { lin: 0.4, hyper: 0.35, swirl: 0.25 } })),
      { w: 0.22, rot: 0.28, s: 0.9, sy: 0.82, col: 0.95, cs: 0.3, v: { lin: 0.7, swirl: 0.3 } },
      { w: 0.12, rot: -0.6, s: 0.5, col: 0.6, cs: 0.7, v: { hank: 0.4, lin: 0.3, polar: 0.3 } },
    ],
  },
  // A · the aureole: spheres and bubbles — the circle of the sigil multiplied into rings
  A: {
    w0: 0.12,
    zoom: 1.5,
    spin: -0.4,
    hue: 0.45,
    bulge: 0.15,
    xf: [
      ...[0, 1, 2].map((k): XfSpec => ({ w: 0.1, rot: 0.2, s: 0.5, o: tri(k, 0.7, -Math.PI / 2), col: 0.3 + 0.2 * k, cs: 0.6, v: { bubble: 0.6, sph: 0.25, lin: 0.15 } })),
      { w: 0.2, rot: Math.PI / 5, s: 0.95, col: 0.9, cs: 0.25, v: { lin: 0.85, bubble: 0.15 } },
      { w: 0.16, rot: 0.1, s: 0.7, col: 0.15, cs: 0.6, v: { sph: 0.55, eyefish: 0.45 } },
    ],
  },
  // C · the cyclone: two arms of sigils wound on a log-spiral
  C: {
    w0: 0.07,
    zoom: 1.85,
    spin: -0.6,
    hue: 0.65,
    twist: 0.25,
    xf: [
      { w: 0.62, rot: 0.27, s: 0.94, col: 0.9, cs: 0.15, v: { lin: 1 } },
      { w: 0.2, s: 0.22, o: [0.95, 0], col: 0.3, cs: 0.7, v: { lin: 0.7, julia: 0.3 } },
      { w: 0.11, rot: Math.PI, s: 0.3, o: [-0.95, 0], col: 0.55, cs: 0.7, v: { lin: 1 } },
    ],
  },
  // D · Droste discs: the flame nested inside its own discs, small and dense
  D: {
    w0: 0.12,
    zoom: 0.68,
    spin: 1.0,
    hue: 0.85,
    xf: [
      { w: 0.45, rot: 0.6, s: 0.72, col: 0.9, cs: 0.3, v: { disc: 0.4, lin: 0.6 } },
      ...[0, 1, 2].map((k): XfSpec => ({ w: 0.08, rot: -0.4, s: 0.28, o: tri(k, 0.75), col: 0.35 + 0.15 * k, cs: 0.6, v: { lin: 1 } })),
      { w: 0.1, rot: Math.PI, s: 0.62, col: 0.1, cs: 0.5, v: { sph: 0.6, heart: 0.4 } },
    ],
  },
  // B · lace: Julia threads and a handkerchief, fine and wide
  B: {
    w0: 0.1,
    zoom: 1.3,
    spin: 0.8,
    hue: 0.3,
    mir: 0.5,
    xf: [
      ...[0, 1, 2].map((k): XfSpec => ({ w: 0.12, rot: 0.9, s: 0.7, o: tri(k, 0.55), col: 0.25 + 0.25 * k, cs: 0.6, v: { julia: 0.75, lin: 0.25 } })),
      { w: 0.2, rot: 0.15, s: 0.88, col: 0.85, cs: 0.3, v: { lin: 0.8, ex: 0.2 } },
      { w: 0.12, rot: -0.3, s: 0.55, col: 0.05, cs: 0.6, v: { hank: 0.5, sin: 0.5 } },
    ],
  },
};
FAMILY.G = FAMILY.E; // (the lead has no G in 1A–1B; the letter that isn't hex falls back to the seed)

/** the letter's flame, the n-th time it comes (repeats are turned and mirrored), in its register */
function letterGenome(letter: string, n: number, midi: number): Float32Array {
  const g = genome(FAMILY[letter] ?? FAMILY.E);
  const turn = ((n % 3) * 2 * Math.PI) / 3 + (n % 2) * 0.35;
  const flip = n % 2 ? -1 : 1;
  const reach = 1 + 0.1 * ((midi - 72) / 5); // higher notes reach further out
  for (let j = 0; j < NXF; j++) {
    const o = HL + j * XL;
    g[o + 1] *= flip; // rotations reversed
    const [x, y] = [g[o + 5] * reach, g[o + 6] * reach];
    g[o + 5] = Math.cos(turn) * x - Math.sin(turn) * y;
    g[o + 6] = Math.sin(turn) * x + Math.cos(turn) * y;
    g[o + 7] = (g[o + 7] + 0.17 * n) % 1;
  }
  return g;
}

const lerpG = (out: Float32Array, a: Float32Array, b: Float32Array, k: number) => {
  for (let i = 0; i < GL; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  return out;
};
const easeOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) ** 3);
/** a spring step: 0 → 1 with one overshoot */
const spring = (x: number) => (x <= 0 ? 0 : 1 - Math.exp(-5 * x) * Math.cos(7 * x));
const NOTE = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];

// symmetry per section (rows from 1A:00): [n, P(rotate)]
const SYM: [number, number, number][] = [
  [0, 3, 0.4], [16, 5, 0.45], [32, 17, 0.3], [48, 257, 0.22],
  [64, 3, 0.6], [80, 5, 0.5], [96, 17, 0.45], [104, 257, 0.5], [112, 257, 1],
];

export function createErasure(g: Gfx): Scene {
  const gl = g.gl;
  const iter = program(g, 'scenes/s13-iter');
  const splat = program(g, 'scenes/s13-splat', 'scenes/s13-splat.vert');
  const tone = program(g, 'scenes/s13-tone');
  const end = program(g, 'scenes/s13-end');
  const state = new PingPong({ formats: [gl.RGBA32F], filter: gl.NEAREST });
  let hist: Target | null = null;
  let sigTex: WebGLTexture | null = null;
  let sigN = 0;
  let acc = 0; // total weight of the splats in the (decaying) histogram
  let W = 1; // weight of this frame's splats (see the decay below)
  let seed = 1;
  let warmed = false;
  const X = new Float32Array(7 * 6 * 4);
  const CP = new Float32Array(7);
  const G = new Float32Array(GL);
  const PAL = new Float32Array(18);
  // dev: hold one letter's flame (`__s13.pin = 'C'`), edit FAMILY live
  const dev = { pin: '' as string, FAMILY };
  if (import.meta.env.DEV) (globalThis as unknown as { __s13: typeof dev }).__s13 = dev;

  // ---- music → the score of the flame (memoised per render)
  interface Plan {
    notes: Ev[];
    /** genome per note, and the state the morph into it starts from */
    target: Float32Array[];
    start: Float32Array[];
    hits: Ev[]; // crash + orchestra hits: whips, palette turns
    unison: number;
    silence: number;
  }
  let memo: { audio: FrameCtx['audio']; pin: string; p: Plan } | null = null;
  const MORPH = 0.2; // s
  const plan = (f: FrameCtx): Plan => {
    if (memo && memo.audio === f.audio && memo.pin === dev.pin) return memo.p;
    const c = cues(f.audio);
    const notes = c.lead.filter((n) => n.t >= TA - 1e-3 && n.t < (P1B + 47) * ROW);
    const count: Record<string, number> = {};
    const target = notes.map((n) => {
      const L = dev.pin || NOTE[n.midi % 12];
      count[L] = (count[L] ?? -1) + 1;
      return letterGenome(L, dev.pin ? 0 : count[L], n.midi);
    });
    const start: Float32Array[] = [];
    let cur = SIGIL;
    notes.forEach((n, i) => {
      if (i > 0) cur = lerpG(new Float32Array(GL), start[i - 1], target[i - 1], easeOut((n.t - notes[i - 1].t) / MORPH));
      start.push(cur);
    });
    const u = c.lead.find((n) => n.t >= (P1B + 46) * ROW);
    const hits = [...c.crash, ...c.stab].filter((e) => e.t >= TA - 1e-3 && e.t < P1C * ROW).sort((a, b) => a.t - b.t);
    // merge hits on the same row (crash + orchestra hit = one blow, the louder)
    const merged: Ev[] = [];
    for (const e of hits) {
      const last = merged[merged.length - 1];
      if (last && e.t - last.t < 0.03) last.v = Math.max(last.v, e.v);
      else merged.push({ ...e });
    }
    const p: Plan = {
      notes,
      target,
      start,
      hits: merged,
      unison: u ? u.t : (P1B + 48) * ROW,
      silence: markerTimes(f.audio, 'E-4', P1B + 32, P1C, [P1B + 60])[0],
    };
    memo = { audio: f.audio, pin: dev.pin, p };
    return p;
  };

  /** the genome at time t: the morph chain through the notes, grown out of the sigil */
  const genomeAt = (p: Plan, t: number, grow: number) => {
    const i = lastAt(p.notes, t);
    if (i < 0) G.set(SIGIL);
    else lerpG(G, p.start[i], p.target[i], easeOut((t - p.notes[i].t) / MORPH));
    if (grow < 1) lerpG(G, SIGIL, G, grow);
    return G;
  };

  /** genome → uniforms (X, CP); `cx`: the collapse (0..1) pulls every transform in; `efface`: the sigil wanes */
  const upload = (gn: Float32Array, cx: number, efface: number) => {
    X.fill(0);
    // 0: the sigil
    X[4 * 1 + 2] = 0; // colour 0
    X[4 * 1 + 3] = 1; // speed
    const w = [gn[0] * (1 - efface)];
    for (let j = 0; j < NXF; j++) {
      const o = HL + j * XL, k = (j + 1) * 24;
      const rot = gn[o + 1] + 2.5 * cx * cx, sx = gn[o + 2] * (1 - 0.3 * cx), sy = gn[o + 3] * (1 - 0.3 * cx), sk = gn[o + 4];
      const c = Math.cos(rot), s = Math.sin(rot);
      X.set([c * sx, c * sk - s * sy, s * sx, s * sk + c * sy, gn[o + 5], gn[o + 6], gn[o + 7], gn[o + 8]], k);
      for (let v = 0; v < 16; v++) X[k + 8 + v] = gn[o + 9 + v];
      w.push(Math.max(0, gn[o]));
    }
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    let run = 0;
    for (let i = 0; i < 7; i++) CP[i] = run += w[i] / sum;
    CP[6] = 2; // never above
  };

  const resetWalkers = () => {
    state.ensure(g, SW, SH);
    bindTarget(g, state.read);
    gl.clearColor(1e9, 0, 0, 0); // out of range → reseeded by the first step
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const step = (shrinkX: number, shrinkY: number, sym: number[], reset: boolean) => {
    if (!iter.use()) return;
    bindTarget(g, state.write);
    iter
      .tex('st', state.read.tex[0], 0)
      .tex('sig', sigTex, 1)
      .set('sigN', sigN)
      .set('X', X)
      .set('CP', CP)
      .set('shrink', shrinkX, shrinkY, 0, 0)
      .set('sym', sym[0], sym[1], sym[2], 0)
      .set('seed', (seed = (seed * 1664525 + 1013904223) >>> 0))
      .set('reset', reset ? 1 : 0);
    fullscreen(g);
    state.swap();
  };

  return {
    id: 'S13',
    title: 'Erasure',
    fps: 60,
    // the histogram has one bin per CSS pixel: tonemap and post at that resolution too (the composite
    // upsamples) — the same picture for half the fill
    scale: 0.5,
    programs: () => [iter, splat, tone, end],
    post: (f) => {
      const p = plan(f);
      if (f.t >= p.unison + 9 * ROW) return false; // 1B:57 on: exact colours, the handover to S14
      const fadeEnd = 1 - smoothstep(p.unison, p.unison + 9 * ROW, f.t);
      const c = cues(f.audio);
      const blow = Math.max(pulse(p.hits, f.t, 0.35), pulse(c.kick, f.t, 0.12) * 0.4);
      return {
        tonemap: 'agx',
        exposure: 0.25 + 0.35 * blow * fadeEnd,
        bloom: (0.12 + 0.1 * smoothstep(TA, TA + 0.6, f.t) + 0.25 * blow) * fadeEnd + 0.02, // (softer on the hand-over frame: S12 lands the sigil crisp)
        bloomRadius: 1.2,
        vignette: 0.3 * fadeEnd,
        grain: 0.025 * fadeEnd,
        ca: 3 * blow * fadeEnd,
        look: [1.08, 1.32, 0, 0],
      };
    },
    init() {
      const tab = sigilTables()[6];
      sigN = tab.x.length - 1;
      const d = new Float32Array(sigN * 2);
      for (let i = 0; i < sigN; i++) (d[2 * i] = tab.x[i]), (d[2 * i + 1] = tab.y[i]);
      sigTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, sigTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, sigN, 1, 0, gl.RG, gl.FLOAT, d);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    },
    render(f: FrameCtx, hdr: Target | null) {
      const p = plan(f);
      const c = cues(f.audio);
      const t = f.t;
      const exact = hdr === null;

      // ---- the end: black and the point (exact colours, also exercised once while loading)
      const drawEnd = (halo: number) => {
        if (!end.use()) return;
        end
          .set('res', f.w, f.h)
          .set('dotCol', 0.6939, 0.6939, 0.6939) // sRGB 0.85 gray: S14's light dot
          .set('dotRA', (2.5 * f.h) / 945, 1)
          .set('halo', halo, (14 * f.h) / 945);
        fullscreen(g);
      };
      if (exact || !warmed) {
        bindTarget(g, null);
        drawEnd(0.35 * (1 - smoothstep(p.unison + 9 * ROW, p.silence - 0.02, t)) ** 2);
        if (exact) return;
      }

      // ---- the score of the flame
      const r = (t - TA) / ROW; // rows from 1A:00
      // ignition: the sigil bursts into the flame on the first note (1A:00), full by the 2nd beat
      const grow = dev.pin ? 1 : spring((t - TA) / (5 * ROW)) * 0.94 + 0.06 * smoothstep(0, 16 * ROW, t - TA);
      const gn = genomeAt(p, t, Math.min(1, grow));
      // the heartbeat 1B:32–47 folds the flame, the unison E (1B:48) crushes it into the point
      const beats = steps(c.kick, t, 0.07, true, (P1B + 31.5) * ROW);
      const fold = Math.min(1, 0.28 * beats);
      const crush = smoothstep(p.unison + 0.5 * ROW, p.unison + 6 * ROW, t);
      const cx = Math.min(1, 0.55 * fold + crush);
      // symmetry by section; within the heartbeat it climbs to a full ring
      let si = 0;
      while (si + 1 < SYM.length && r >= SYM[si + 1][0]) si++;
      const sym = [SYM[si][1], SYM[si][2] * Math.min(1, grow), gn[3]]; // (the sigil alone at 1A:00, as S12 lands it)
      if (r >= 96) sym[1] = Math.max(sym[1], 0.4 + 0.6 * fold);
      // a new section snaps in through a glitch: fractional n for a moment (the polygons of S11 breaking)
      if (si > 0 && !dev.pin) {
        const k = easeOut((r - SYM[si][0]) / 2.5);
        if (k < 1) sym[0] = SYM[si - 1][1] + (SYM[si][1] - SYM[si - 1][1]) * k;
      }
      // the flame effaces the sigil it grew from: its own weight wanes through the scene
      upload(gn, cx, 0.6 * smoothstep(TA + 0.5, TA + 9, t) * (1 - cx));

      // ---- camera: whips on the hits, a pulse on the kick, the dive on the tom run, the collapse
      const hitsUp = steps(p.hits, t, 0.18);
      const snareJ = steps(c.snare, t, 0.05, true, TA) * 0.02;
      const dive = steps(c.toms, t, 0.09, false) / Math.max(1, c.toms.length); // 0 → 1 over 1A:56–63
      const out = spring((t - TB) / (4 * ROW)); // 1B:00 throws us back out
      const diveK = t < TB ? dive : dive * (1 - out);
      const kick = pulse(c.kick, t, 0.09);
      const breath = 1 + 0.045 * kick + 0.06 * pulse(p.hits, t, 0.25);
      const base = SIGIL_R + (0.34 - SIGIL_R) * Math.min(1.08, grow);
      const zoomL = gn[1] + (1 - gn[1]) * fold; // the heartbeat takes the letters' sizes away
      // the unison: one blow outwards, then the implosion (ease-in, the last of it fast)
      const blowOut = pulse([{ t: p.unison, midi: 0, v: 1 }], t, 0.12, 0.03);
      // each heartbeat a contraction (systole), released in the gap
      const thump = t > (P1B + 31.5) * ROW ? pulse(c.kick, t, 0.11, 0.02) : 0;
      // 1A:00, the last EFFACED, glorious: the flame flares out over the whole screen and settles
      const flare = t >= TA ? (1 - Math.exp(-(t - TA) / 0.06)) * Math.exp(-(t - TA) / 0.45) : 0;
      const S = base * zoomL * breath * (1 + 1.1 * flare) * (1 - 0.16 * thump) * (1 + 0.18 * blowOut) * (1 + 1.8 * diveK) * (1 - 0.55 * fold) * (1 - crush) ** 2.2;
      const psi = gn[2] + 0.06 * (t - TA) + 0.55 * hitsUp * (1 - 0.6 * crush) + snareJ - 1.1 * diveK + 2.4 * cx * cx;
      // the dive goes through the inner circle of the sigil — the "+1" — into the flame's own core
      const dv = [0, 0.1 * diveK];
      const cs = Math.cos(psi), sn = Math.sin(psi);
      const off = [-(cs * dv[0] - sn * dv[1]) * S, -(sn * dv[0] + cs * dv[1]) * S];
      const twist = gn[4] + 0.9 * diveK + 1.2 * fold - 0.5 * crush;
      const bulge = gn[5] - 0.25 * diveK;

      // palette: lydian 1A, phrygian 1B, white heat in the collapse; each blow turns it a fifth of a turn
      const toB = smoothstep(TB - 0.05, TB + 2 * ROW, t);
      const heat = 0.7 * Math.min(1, 0.2 * fold + 1.3 * crush);
      for (let i = 0; i < 18; i++) PAL[i] = (PAL_LYD[i] * (1 - toB) + PAL_PHR[i] * toB) * (1 - heat) + PAL_HOT[i] * heat;
      const palShift = gn[6] + 0.2 * steps(p.hits, t, 0.3, false, TA + 0.05);

      // ---- chaos game: reseed + burn-in on a jump, then ITER splatted steps per frame
      // the histogram has one bin per CSS pixel (half the device resolution): 4× the samples per bin, and
      // points splat ~1.5× faster into the smaller target
      const w = Math.ceil(f.w / 2), h = Math.ceil(f.h / 2);
      const fresh = !hist || hist.w !== w || hist.h !== h;
      hist = ensureTarget(g, hist, w, h, { formats: [gl.RGBA32F], filter: gl.LINEAR });
      const reset = f.jumped || fresh || !warmed || !state.a;
      const shr = 1 - cx;
      if (reset) {
        resetWalkers();
        for (let i = 0; i < BURN + 2; i++) step(shr, shr, sym, i === 0);
        bindTarget(g, hist);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        acc = 0;
        W = 1;
      }
      const running = f.dt > 0 || reset;
      const tau = (0.07 + 0.05 * diveK + 0.12 * fold * (1 - crush)) * TAU_K;
      const decay = reset ? 0 : Math.exp(-Math.max(0, f.dt) / tau);
      const iters = reset ? 2 : running ? ITER : 0; // (a cut: a short pre-roll — S13 is entered at 1A:00 on a downbeat)

      // The histogram decays by exp(−dt/τ) per frame — not by rewriting it every frame (a full RGBA32F
      // read-modify-write) but by giving every new frame of splats the weight W *= 1/decay; the tonemap
      // normalises by the total weight. Folded back into the bins once W gets large (every ~1–3 s).
      gl.enable(gl.BLEND);
      if (running && !reset) W /= decay;
      if (W > 1e4 || !warmed) {
        bindTarget(g, hist);
        if (end.use()) {
          gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
          gl.blendColor(0, 0, 0, 1 / W);
          fullscreen(g);
        }
        acc /= W;
        W = 1;
      }
      // A flame that shrinks to a point would pile every walker into the same few bins, and additive
      // blending into one pixel serialises (the collapse took ~60 ms a frame): a small flame plots a
      // random subset (any subset of the walkers is a sample of the same attractor), ∝ its area.
      const nPts = Math.round(SW * SH * Math.min(1, Math.max(0.012, (S / 0.15) ** 2)));
      // (when the flame is a few pixels wide, a few splats per bin make the same picture)
      const bands = nPts < SW * SH * 0.25 ? 1 : BANDS;
      for (let i = 0; i < iters; i++) {
        gl.disable(gl.BLEND);
        step(shr, shr, sym, false);
        bindTarget(g, hist);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        if (splat.use()) {
          splat
            .tex('st', state.read.tex[0], 0)
            .set('stW', SW)
            .set('cam', S * cs, S * sn, off[0], off[1])
            .set('fin', twist, bulge, palShift, 1)
            .set('aspect', f.aspect)
            .set('burn', BURN)
            .set('PAL', PAL)
            .set('wgt', W);
          gl.bindVertexArray(g.vao);
          for (let b = 0; b < bands; b++) {
            splat.set('band', bands === 1 ? -2 : -1 + (2 * b) / BANDS, b === bands - 1 ? 2 : -1 + (2 * (b + 1)) / BANDS);
            gl.drawArrays(gl.POINTS, 0, nPts);
          }
        }
        acc += nPts * W;
      }
      gl.disable(gl.BLEND);

      // ---- tonemap into the HDR target
      bindTarget(g, hdr);
      const dotK = smoothstep(p.unison + 2 * ROW, p.unison + 8 * ROW, t);
      const roll = Math.min(1, swell(c.snare, t, 0.1, (P1B + 31.5) * ROW) * 0.25);
      if (tone.use()) {
        // a dive spreads the walkers over a larger plane: the same light per visible bin
        const zoom = Math.max(0.5, (1 + 1.8 * diveK) * zoomL) ** 2;
        tone
          .tex('hist', hist.tex[0], 0)
          .set('res', hdr!.w, hdr!.h)
          .set('htexel', 1 / w, 1 / h)
          .set('kNorm', (w * h) / Math.max(1, acc))
          .set('ref', (34 + 300 * crush) / zoom)
          .set('floor_', 0.3 / zoom)
          .set('expo', 2.2 / 3.4)
          .set('satur', 1.45 - 0.45 * crush)
          .set('gain', (1.05 + 0.3 * kick + 0.5 * pulse(p.hits, t, 0.2) + 0.4 * roll + 1.5 * crush) * (1 - smoothstep(p.unison + 5 * ROW, p.unison + 9 * ROW, t)))
          .set('dotP', (2.5 * hdr!.h) / 945, 4 * dotK)
          // the unison: the light leaves as a ring while the flame falls in
          .set('ring', (Math.max(0, t - p.unison) / 0.5) ** 0.6 * hdr!.h * 0.9, t > p.unison ? 2.2 * Math.exp(-(t - p.unison) / 0.3) : 0);
        fullscreen(g);
      }
      warmed = true;
    },
  };
}

export default createErasure;
