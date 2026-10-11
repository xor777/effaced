// The creature's alphabet on the CPU side. The single source of truth is the data block of
// src/shaders/lib/glyphs.glsl (see its header for the constructions and the GLSL API); this module parses
// it and turns the strokes into points and polylines for particles and oscilloscope beams.
//
//   GLYPHS[L]                 primitives of letter L ('A'…'F'): ink segments/arcs + construction circles/lines
//   STROKE, NODE              half-width of the pen, radius of the marked points (cap units)
//   WORD                      EFFACED: letters, axis x per letter, box — in the word frame (cap units, origin at
//                             the centre of the A's module circle, mid-cap height y = 0, y up)
//   glyphPolylines(L, step)   the ink strokes of one letter, letter-local, one polyline per stroke
//   wordPolylines(step)       the ink strokes of EFFACED in the word frame, tagged with the letter index 0..6
//   sampleWord(n, rand)       n points spread evenly (by length) over the strokes of EFFACED, jittered across
//                             the pen: Float32Array of [x, y, letterIndex, random] × n
//   GLYPHS_GLSL               the GLSL source, for shaders not built through the engine's #include

import GLYPHS_GLSL from '../shaders/lib/glyphs.glsl?raw';

export { GLYPHS_GLSL };

export type Letter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export const LETTERS: Letter[] = ['A', 'B', 'C', 'D', 'E', 'F'];

export type Prim =
  | { kind: 'seg'; a: [number, number]; b: [number, number] }
  | { kind: 'arc'; c: [number, number]; r: number; a0: number; a1: number } // radians, ccw
  | { kind: 'circle'; c: [number, number]; r: number } // construction only
  | { kind: 'line'; p: [number, number]; angle: number }; // construction only (radians)

const block = GLYPHS_GLSL.slice(GLYPHS_GLSL.indexOf('// @glyphs-data'), GLYPHS_GLSL.indexOf('// @end'));
const nums = (name: string): number[] => {
  const m = block.match(new RegExp(`${name}\\[\\d+\\]\\s*=\\s*\\w+\\[\\d+\\]\\(([^;]*)\\);`));
  if (!m) throw new Error(`glyphs.glsl: ${name} not found`);
  return (m[1].replace(/\/\/[^\n]*/g, '').match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
};

export const STROKE = Number(block.match(/#define GLY_STROKE\s+([\d.]+)/)?.[1] ?? 0.024);
/** radius of the marked points (stroke ends and joints) */
export const NODE = Number(block.match(/#define GLY_NODE\s+([\d.]+)/)?.[1] ?? 0.05);

const D = nums('GLY_D');
const R = nums('GLY_R');
const rad = Math.PI / 180;
export const GLYPHS = Object.fromEntries(
  LETTERS.map((L, li) => {
    const out: Prim[] = [];
    for (let k = 0; k < R[2 * li + 1]; k++) {
      const [kind, a, b, c, d, e] = D.slice(6 * (R[2 * li] + k), 6 * (R[2 * li] + k) + 6);
      if (kind === 0) out.push({ kind: 'seg', a: [a, b], b: [c, d] });
      else if (kind === 1) out.push({ kind: 'arc', c: [a, b], r: c, a0: d * rad, a1: e * rad });
      else if (kind === 2) out.push({ kind: 'circle', c: [a, b], r: c });
      else out.push({ kind: 'line', p: [a, b], angle: c * rad });
    }
    return [L, out];
  }),
) as Record<Letter, Prim[]>;

const WL = nums('GLY_WL');
const WX = nums('GLY_WX');
const BOX = (block.match(/GLY_WORD_BOX\s*=\s*vec4\(([^)]*)\)/)?.[1] ?? '').split(',').map(Number);
export const WORD = {
  text: 'EFFACED',
  letters: WL.map((i) => LETTERS[i]),
  x: WX,
  /** skeleton box: x0, y0, x1, y1 */
  box: BOX as [number, number, number, number],
};

type Ink = Extract<Prim, { kind: 'seg' | 'arc' }>;
const isInk = (p: Prim): p is Ink => p.kind === 'seg' || p.kind === 'arc';
const inkLength = (p: Ink) => (p.kind === 'seg' ? Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) : p.r * (p.a1 - p.a0));
/** point and unit normal at parameter t ∈ [0, 1] along an ink stroke */
function inkAt(p: Ink, t: number): [number, number, number, number] {
  if (p.kind === 'seg') {
    const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], l = Math.hypot(dx, dy) || 1;
    return [p.a[0] + dx * t, p.a[1] + dy * t, -dy / l, dx / l];
  }
  const a = p.a0 + (p.a1 - p.a0) * t, c = Math.cos(a), s = Math.sin(a);
  return [p.c[0] + p.r * c, p.c[1] + p.r * s, c, s];
}

/** the ink strokes of a letter as polylines (letter-local), `step` = max segment length (cap units) */
export function glyphPolylines(L: Letter, step = 0.02): [number, number][][] {
  return GLYPHS[L].filter(isInk).map((p) => {
    const n = Math.max(1, Math.ceil(inkLength(p) / step));
    return Array.from({ length: n + 1 }, (_, i) => inkAt(p, i / n).slice(0, 2) as [number, number]);
  });
}

/** the ink strokes of EFFACED as polylines in the word frame, with the letter index (0..6) */
export function wordPolylines(step = 0.02): { letter: number; pts: [number, number][] }[] {
  return WORD.letters.flatMap((L, k) =>
    glyphPolylines(L, step).map((pts) => ({ letter: k, pts: pts.map(([x, y]) => [x + WORD.x[k], y - 0.5] as [number, number]) })),
  );
}

/** n points spread evenly by length over EFFACED's strokes (word frame), jittered across the pen */
export function sampleWord(n: number, rand: () => number = Math.random): Float32Array {
  const strokes = WORD.letters.flatMap((L, k) => GLYPHS[L].filter(isInk).map((p) => ({ p, k, len: inkLength(p) })));
  const total = strokes.reduce((a, s) => a + s.len, 0);
  const out = new Float32Array(n * 4);
  let si = 0, acc = strokes[0].len;
  for (let i = 0; i < n; i++) {
    const s = ((i + rand()) / n) * total; // stratified: every stroke gets its share
    while (s > acc && si < strokes.length - 1) acc += strokes[++si].len;
    const st = strokes[si];
    const t = Math.min(1, Math.max(0, 1 - (acc - s) / st.len));
    const [x, y, nx, ny] = inkAt(st.p, t);
    const off = (rand() * 2 - 1) * STROKE * 0.9;
    out.set([x + nx * off + WORD.x[st.k], y + ny * off - 0.5, st.k, rand()], i * 4);
  }
  return out;
}
