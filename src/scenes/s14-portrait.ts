// S14 · Portrait and S15 · Effaced (PLAN §4, restaged): the creature writes its name — EFFACED in its own
// compass-and-ruler glyphs (src/gfx/glyphs.ts, src/shaders/lib/glyphs.glsl) — and is effaced.
//
// The word lies in a plane seen by a slow camera that always looks at the light point (the +1, inside the A,
// the centre of the frame): a gentle push-in and a slow turn through the whole of S14, so the word is never a
// flat sticker. The strokes are alive: a current runs along the pen, the heartbeat sends pulses along them,
// every bell note sends a wave of light out of the point across the word, the embers never quite settle.
//
// S14 (1C:00–1E:63)
//   assembly  The point exhales 65536 embers on the heartbeats (1C:00/12/24/36). They settle onto the strokes, the
//             word developing from the point outwards, ring by ring: A · F C · F E · E D. While a ring lands, a
//             pen-light draws its letters' constructions (compass circles swept, ruler lines ruled — the A is
//             Euclid I.1); each bell note of FADE sends the wave that lights the ring (1C:16, 1C:32, 1C:48, 1D:00).
//             Four sparks rule the baseline and the cap line out of the middle (1C:04–1C:22).
//   hold      1D:00–1D:20: the word, calm (the bell's waves at 1D:08 and 1D:16 pass through it).
//   erasure   one step per channel leaving (the drop-out): E 1D:20, F 1D:32, D 1D:44 — then F C E close up on
//             the A and FACE stands alone while the rules burn (1D:56) — then F 1E:04, A 1E:16, C 1E:28, E 1E:40
//             (the choir). Each letter flares, crumbles from its far side, and its embers arc into the point
//             with streaks; the letters left flinch and flare. 1E:52: the bell alone, the point.
// S15 (1F:00 + tail): the oscilloscope beam of S00 grows the creature's sigil out of the point through the final
//   cadence (whole at the A major, 1F:32) and collapses back into it (1F:44–1F:60). The point lingers as the
//   last light; "65536 + 1"; the point goes out with the music's tail. Darkness. The title becomes #FACE.
//
// Exact colours, no post (the hand-offs are pixel-exact): the word pass encodes itself.
// Dev (DEV builds): globalThis.__s14 — the timing tables, camera, colours, live.

import { type Gfx, type Target, type Program, program, ensureTarget, bindTarget, clearTarget, fullscreen } from '../gfx/gl.ts';
import { Beam } from '../gfx/beam.ts';
import { sampleWordStrokes, WORD } from '../gfx/glyphs.ts';
import type { Scene, FrameCtx } from './types.ts';
import { ROW, ROWS } from '../timeline/script.ts';
import { CH } from '../music/roster.ts';
import { sigilTables } from '../audio/synth/scope.ts';
import { toBuffer, hex2rgb, encode3, type Vec3 } from '../perception/color.ts';

const P1C = 0x1c * ROWS;
const S14_ROWS = 3 * ROWS;
const S15_SEC = ROWS * ROW + 12; // 1F + the 12 s tail (script.ts TAIL)
const SR = 48000; // beam samples per second (as S00 at the audio rate)
const TABLE = 4096;
const N_EMBERS = 256 * 256;

/** frame heights per cap height: EFFACED spans 7.8 caps ≈ 1.29 H of the 1.6 H wide frame */
const CAP = 0.165;
/** rings of letters by distance from the point (E F F A C E D): each lands in a window, lights on a bell note */
const RANK = [3, 2, 1, 0, 1, 2, 3];
const LAND = [[2, 14], [12, 30], [26, 46], [40, 58]];
const LIGHT = [16, 32, 48, 64]; // FADE on the bell: A 1C:16, D 1C:32, E 1C:48, F 1D:00
const WAVE = 0.5; // the bell's wave: cap units per row (the shader's bellWave)
/** the erasure: the row of the step that takes each letter (the drop-out, 12 rows apart); the rules go at 120 */
const ERASE = [84, 96, 132, 144, 156, 168, 108];
const RULES_BURN = 120;
const STEP = 9; // rows a step takes to crumble
const LOCK = 64;
/** FACE closes up on the A once E F … D are gone (cap units) */
const CLOSE = { from: 113, to: 128, x: [0, 0, 0.08, 0, -0.08, -0.18, 0] };

/** the camera: a push-in and a slow turn, always looking at the point (rows since 1C:00) */
export const CAMERA = {
  focal: 2.6, // frame heights
  zoom: [0.93, 1.0, 1.07], // at 1C:00, at the end of the hold (1D:20), at 1F:00
  yaw: [0.17, -0.15], // radians, 1C:00 → 1F:00
  pitch: [0.1, 0.03],
  sway: 0.012,
};

export const TIMING = { CAP, RANK, LAND, LIGHT, ERASE, RULES_BURN, STEP, CLOSE };

/** the beam through 1F (seconds since the cut) */
export const BEAM = {
  growTo: 32 * ROW, // whole at the A major (1F:32)
  collapseFrom: 44 * ROW,
  collapseTo: 60 * ROW, // the harp's last C♯
  fE: 82.407, // the traversal follows the bass: E2, then A2
  fA: 110,
  exposure: 1.6,
  energy: 1,
};
/** the point: rest glow once it holds the embers, its fade with the music's tail (6 s hold, 6 s fade) */
const POINT = { gathered: 0.08, outFrom: S15_SEC - 6, outTo: S15_SEC - 0.3 };
const TEXT = { at: 9.5, out: 15, fade: 2, text: '65536 + 1', gray: 0.42, sizePx: 12, below: 0.075 };

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const env = (r: number, ev: [number, number][], a: number, d: number) =>
  ev.reduce((e, [r0, v]) => (r < r0 ? e : e + v * Math.min(1, (r - r0) / a) * Math.exp(-Math.max(0, r - r0 - a) / d)), 0);
const lin = (h: string) => toBuffer(hex2rgb(h), 'srgb', 'display-p3').map((x) => Math.min(1, Math.max(0, x))) as Vec3;
const scale = (c: Vec3, k: number) => c.map((x) => x * k) as Vec3;

const COL = {
  ink: [0.92, 0.87, 0.8] as Vec3, // the lit stroke: the point's warm white
  glow: scale(lin('#DECADE'), 0.08), // its glow: the demo's air
  hot: [1.0, 0.72, 0.5] as Vec3, // a crumbling edge
  cons: scale(lin('#ACCEDE'), 0.32), // construction hairlines: cold light
  dot: [0.6939, 0.6939, 0.6939] as Vec3, // sRGB 0.85: S13's light point
};
/** the embers resting on the strokes (twinkling), relative to a flying one */
const SETTLE = 0.16;

const SCORE_KICK: [number, number][] = [[0, 1], [12, 0.91], [24, 0.77], [36, 0.59]]; // act5.ts: softer each time
const SCORE_BELL = [0, 16, 32, 48, 64, 72, 80, 88, 112, 120, 128, 144, 160, 180]; // FADE ×3 on the bell

export function createPortraitPair(g: Gfx): [Scene, Scene] {
  const gl = g.gl;
  const word = program(g, 'scenes/s14-word');
  const embers = program(g, 'scenes/s14-embers', 'scenes/s14-embers.vert');
  const beam = new Beam(g);
  let table: WebGLTexture | null = null;
  let beamT: Target | null = null;
  let text: HTMLElement | null = null;
  let warmed = false;
  let beamWarmed = false;
  let lastTc = 0;
  const igniteA = new Float32Array(7), reactA = new Float32Array(7), consA = new Float32Array(7), consP = new Float32Array(7);
  const woff = new Float32Array(14);
  const landS = new Float32Array(RANK.map((r) => LAND[r][0])), landE = new Float32Array(RANK.map((r) => LAND[r][1]));
  const eraseS = new Float32Array(ERASE);
  const camR = new Float32Array(9), camC = new Float32Array(3);

  // ---- the music (rows since 1C:00): the real note-ons when there is a render, the score otherwise (silent)
  let memo: { audio: FrameCtx['audio']; kick: [number, number][]; bells: Float32Array } | null = null;
  const cues = (f: FrameCtx) => {
    if (memo && memo.audio === f.audio) return memo;
    const pick = (ch: number) => (f.audio?.notes ?? []).filter((n) => n.ch === ch && n.grow >= P1C && n.grow < P1C + S14_ROWS);
    const ks = pick(CH.kick);
    const vmax = Math.max(1, ...ks.map((n) => (n.vol < 0 ? 64 : n.vol)));
    const kick: [number, number][] = ks.length ? ks.map((n) => [(n.t - P1C * ROW) / ROW, (n.vol < 0 ? 64 : n.vol) / vmax]) : SCORE_KICK;
    const bs = pick(CH.bell).map((n) => (n.t - P1C * ROW) / ROW);
    const bells = new Float32Array(16).fill(1e4);
    (bs.length >= 8 ? bs : SCORE_BELL).slice(0, 16).forEach((r, i) => (bells[i] = r));
    memo = { audio: f.audio, kick, bells };
    return memo;
  };

  // ---- the camera at row r (it never stops: through S15 too, though only the point is left to see)
  const camera = (r: number) => {
    const C = CAMERA;
    const zoom = C.zoom[0] + (C.zoom[1] - C.zoom[0]) * ss(0, 84, r) + (C.zoom[2] - C.zoom[1]) * ss(84, S14_ROWS, r);
    const u = ss(-20, S14_ROWS + 20, r);
    const yaw = C.yaw[0] + (C.yaw[1] - C.yaw[0]) * u;
    const pitch = C.pitch[0] + (C.pitch[1] - C.pitch[0]) * u + C.sway * Math.sin((r * 2 * Math.PI) / 96);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Ry(yaw) · Rx(pitch), camera → world, column-major
    const m = [cy, 0, -sy, sy * sp, cp, cy * sp, sy * cp, -sp, cy * cp];
    camR.set(m);
    const dist = C.focal / zoom;
    camC.set([m[6] * dist, m[7] * dist, m[8] * dist]); // R · (0, 0, dist)
  };

  // ---- S14's state at row r
  const state = (r: number, kick: [number, number][]) => {
    for (let k = 0; k < 7; k++) {
      const [s0, s1] = LAND[RANK[k]];
      // the bell's wave lights the letter when it reaches it
      const b = LIGHT[RANK[k]] + Math.abs(WORD.x[k]) / WAVE;
      const up = ss(b, b + 1.5, r);
      igniteA[k] = up + 0.6 * up * Math.exp(-Math.max(0, r - b - 1.5) / 5);
      // the pen-light draws the construction while the letter lands; it fades once the letter is lit
      consP[k] = ss(s0, s0 + 12, r);
      consA[k] = ss(s0, s0 + 2, r) * (1 - ss(Math.max(s1, b), b + 8, r));
      // its last flare before it crumbles; flinching and flaring as the others go
      let react = 0.6 * ss(ERASE[k] - 4, ERASE[k], r) * (1 - ss(ERASE[k], ERASE[k] + STEP, r));
      let dx = CLOSE.x[k] * ss(CLOSE.from, CLOSE.to, r), dy = 0;
      for (let j = 0; j < 7; j++) {
        if (j === k || ERASE[j] >= ERASE[k]) continue;
        const t = r - ERASE[j];
        if (t < 0) continue;
        react += 0.35 * Math.min(1, t / 0.6) * Math.exp(-t / 5);
        const kick = Math.sin(t * 0.9) * Math.exp(-t / 4);
        dx += Math.sign(WORD.x[k] - WORD.x[j]) * 0.035 * kick;
        dy += 0.012 * kick;
      }
      reactA[k] = react;
      woff[2 * k] = dx;
      woff[2 * k + 1] = dy;
    }
    const phase = r < LOCK ? 1 : r >= Math.min(...ERASE, RULES_BURN) - 1 ? 2 : 0;
    // the rules: drawn out of the middle, a faint residue once the word is lit, burnt from the ends
    const half = -WORD.box[0] + 0.5;
    const drawn = ss(4, 22, r), burnt = ss(RULES_BURN, RULES_BURN + STEP, r);
    const ruler = [
      half * drawn * (1 - burnt),
      burnt >= 1 ? 0 : 0.55 - 0.33 * ss(22, LOCK, r),
      drawn > 0 && drawn < 1 ? 1.2 : burnt > 0 && burnt < 1 ? 1.4 : 0,
      burnt > 0 ? 1 : 0,
    ];
    // the point: flares on the heartbeat; gathers the embers as the letters crumble into it
    let erased = 0;
    for (const e0 of ERASE) erased += ss(e0, e0 + STEP, r);
    erased /= ERASE.length;
    const arrive = env(r, ERASE.map((e0) => [e0 + 7, 1] as [number, number]), 3, 6);
    const halo = 0.12 * env(r, kick, 1.5, 5) + POINT.gathered * erased + 0.05 * arrive;
    return { phase, ruler, halo, arrive };
  };

  // ---- the beam (S15): the sigil centred on its inner circle (the +1 ring of the glyph), so it grows out of
  // the point and collapses into it (scope.ts sigilPath: circle 2π, triangle 3·√3, stem 0.7, inner circle 0.6π,
  // back up 0.7; arc-length parametrised)
  const tabs = sigilTables();
  const total = 2 * Math.PI + 3 * Math.sqrt(3) + 0.7 + 0.6 * Math.PI + 0.7;
  const i0 = Math.round(((2 * Math.PI + 3 * Math.sqrt(3) + 0.7) / total) * TABLE);
  const i1 = Math.round(((2 * Math.PI + 3 * Math.sqrt(3) + 0.7 + 0.6 * Math.PI) / total) * TABLE);
  let cx = 0, cy = 0;
  for (let i = i0; i < i1; i++) (cx += tabs[6].x[i]), (cy += tabs[6].y[i]);
  cx /= i1 - i0;
  cy /= i1 - i0;
  const sizeAt = (tc: number) => ss(0, BEAM.growTo, tc) * (1 - ss(BEAM.collapseFrom, BEAM.collapseTo, tc));
  const xy = (tc: number): [number, number] => {
    const grow = ss(0, BEAM.growTo, tc), coll = ss(BEAM.collapseFrom, BEAM.collapseTo, tc);
    const size = grow * (1 - coll);
    const lv = 6 * Math.pow(size, 0.6); // a circle out of the point, resolving into the sigil (Fourier levels 0 → 6)
    const j = Math.min(5, Math.floor(lv)), fj = lv - j;
    const ph = tc < BEAM.growTo ? BEAM.fE * tc : BEAM.fE * BEAM.growTo + BEAM.fA * (tc - BEAM.growTo);
    const u = (ph - Math.floor(ph)) * TABLE;
    const k = Math.floor(u), fk = u - k;
    const at = (t: { x: Float32Array; y: Float32Array }, c: 'x' | 'y') => t[c][k] + (t[c][k + 1] - t[c][k]) * fk;
    const x = at(tabs[j], 'x') + (at(tabs[j + 1], 'x') - at(tabs[j], 'x')) * fj - cx * Math.min(1, lv);
    const y = at(tabs[j], 'y') + (at(tabs[j + 1], 'y') - at(tabs[j], 'y')) * fj - cy * Math.min(1, lv);
    const rot = 0.9 * (1 - grow) ** 2 - 1.4 * coll * coll; // unwinding as it grows, winding up as it collapses
    const c = Math.cos(rot), s = Math.sin(rot);
    return [size * (c * x - s * y), size * (s * x + c * y)];
  };
  const drawBeam = (f: FrameCtx, tc: number, warm: boolean): Target | null => {
    if (!warm && (tc > BEAM.collapseTo + 1.5 || tc < 0)) return null;
    beamT = ensureTarget(g, beamT, Math.ceil(f.w / 2), Math.ceil(f.h / 2), { formats: [gl.RGBA16F], filter: gl.LINEAR });
    clearTarget(g, beamT);
    const reset = f.jumped || tc < lastTc || warm;
    let n0 = Math.floor((reset ? Math.max(0, tc - 1 / 60) : lastTc) * SR);
    const n1 = Math.floor(tc * SR);
    if (n1 - n0 > 32000) n0 = n1 - 32000;
    beam.begin();
    for (let i = n0; i <= n1; i++) beam.push(...xy(i / SR));
    if (beam.n < 2) beam.push(0, 0);
    // the bell's G♯ (1F:16) and C♯ (1F:32) swell the trace
    const bell = env(tc, [[16 * ROW, 0.76], [32 * ROW, 0.85]], 0.25, 1.5);
    const fadeOut = 1 - ss(BEAM.collapseTo - 0.6, BEAM.collapseTo, tc);
    const energy = warm ? 0 : BEAM.energy * ss(0, 0.5, tc) * (0.3 + 0.7 * sizeAt(tc)) * (1 + 0.4 * bell) * fadeOut;
    beam.render(Math.max(0, f.dt), beamT, f.aspect, reset, 0.82, energy);
    return beamT;
  };

  // shared uniforms of the word pass and the embers
  const common = (p: Program, r: number, phase: number, bells: Float32Array) =>
    p
      .set('cap', CAP)
      .set('S14', r, phase, STEP, 0)
      .set('landS', landS)
      .set('landE', landE)
      .set('eraseS', eraseS)
      .set('woff', woff)
      .set('bells', bells)
      .set('camR', camR)
      .set('camC', camC)
      .set('camF', CAMERA.focal);

  // ---- the word pass (S14) / the black with the beam and the point (S15)
  const drawWord = (
    f: FrameCtx, r: number, on: boolean, st: ReturnType<typeof state>, c: ReturnType<typeof cues>,
    x: { beam?: Target | null; halo: number; dot: number },
  ) => {
    bindTarget(g, null);
    if (!word.use()) return;
    const kr = [1e4, 1e4, 1e4, 1e4];
    c.kick.slice(0, 4).forEach(([k], i) => (kr[i] = k));
    common(word, r, st.phase, c.bells)
      .set('res', f.w, f.h)
      .set('wordOn', on ? 1 : 0)
      .set('ignite', igniteA)
      .set('react', reactA)
      .set('cons', consA)
      .set('consP', consP)
      .set('kicksR', kr)
      .set('ruler', st.ruler)
      .set('inkC', COL.ink)
      .set('glowC', COL.glow)
      .set('hotC', COL.hot)
      .set('consC', COL.cons)
      .set('dotCol', COL.dot)
      .set('dotRA', (2.5 * f.h) / 945, x.dot)
      .set('halo', x.halo, (14 * f.h) / 945)
      .set('dither', 1)
      .tex('beamTex', x.beam?.tex[0] ?? null, 1)
      .set('beamU', x.beam ? 1 : 0, BEAM.exposure, 0.41 * 1.15 * Math.max(sizeAt(f.local), sizeAt(f.local - 0.3)) + 0.03);
    fullscreen(g);
  };

  /** the embers: points, then (in the erasure) their streaks as line pairs */
  const drawEmbers = (f: FrameCtx, r: number, phase: number, c: ReturnType<typeof cues>) => {
    if (!table || !embers.use()) return;
    const kicks = [1e4, 1e4, 1e4, 1e4];
    c.kick.slice(0, 4).forEach(([kr], i) => (kicks[i] = kr));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    common(embers.tex('table', table, 0), r, phase, c.bells)
      .set('res', f.w, f.h)
      .set('kicks', kicks)
      .set('emb', 0.75, (2.6 * f.h) / 945, 2.6, 6)
      .set('settle', SETTLE)
      .set('hotE', 0.85, 0.8, 0.86)
      .set('coolE', encode3(lin('#ACCEDE')))
      .set('inkE', encode3(COL.ink))
      .set('lines', 0);
    gl.bindVertexArray(g.vao);
    gl.drawArrays(gl.POINTS, 0, N_EMBERS);
    if (phase === 2 || !warmed) {
      embers.set('lines', 1);
      gl.drawArrays(gl.LINES, 0, 2 * N_EMBERS);
    }
    gl.disable(gl.BLEND);
  };

  if (import.meta.env.DEV) {
    const hook = { TIMING, CAMERA, BEAM, COL, POINT, TEXT, word, embers };
    (globalThis as unknown as { __s14: typeof hook }).__s14 = hook;
  }

  const make = (id: 'S14' | 'S15', title: string): Scene => ({
    id,
    title,
    post: false,
    programs: () => (id === 'S15' ? beam.programs() : [word, embers]),
    init() {
      if (id === 'S15') return beam.init();
      // the ember table: 65536 places spread evenly over the strokes (seeded: the same word every time)
      let seed = 0xeffaced;
      const rand = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const data = sampleWordStrokes(N_EMBERS, rand);
      table = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, table);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 256, 256, 0, gl.RGBA, gl.FLOAT, data);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    },
    enter() {
      if (id !== 'S15') return;
      document.title = '#FACE';
      text = document.createElement('div');
      text.textContent = TEXT.text;
      const gray = Math.round(TEXT.gray * 255);
      text.style.cssText =
        `position:absolute;left:0;right:0;top:${50 + TEXT.below * 100}%;text-align:center;` +
        `font:400 ${TEXT.sizePx}px/1 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:0.04em;` +
        `color:rgb(${gray},${gray},${gray});opacity:0;pointer-events:none`;
      document.getElementById('stage')!.appendChild(text);
    },
    leave() {
      text?.remove();
      text = null;
      if (id === 'S15') document.title = 'EFFACED';
    },
    render(f: FrameCtx) {
      const c = cues(f);
      if (id === 'S14') {
        const r = f.localRow;
        camera(r);
        const st = state(r, c.kick);
        drawWord(f, r, true, st, c, { halo: st.halo, dot: 1 });
        // first draw (the loader's warm-up): build the ember pipelines (points and lines) with every ember culled
        drawEmbers(f, r, warmed ? st.phase : -1, c);
        warmed = true;
        return;
      }
      const tc = f.local;
      const b = drawBeam(f, tc, !beamWarmed); // first S15 draw (the loader's warm-up): the beam's pipelines, no light
      beamWarmed = true;
      lastTc = tc;
      // the point lingers with the 65536 and goes out with the music's tail; one flare as it takes the sigil in
      const dot = 1 - ss(POINT.outFrom, POINT.outTo, tc);
      const r = S14_ROWS + tc / ROW;
      camera(r);
      const st = state(r, c.kick);
      const x = tc - BEAM.collapseTo;
      const flare = x >= 0 ? 0.16 * Math.min(1, x / 0.15) * Math.exp(-x / 1.4) : 0;
      drawWord(f, r, false, st, c, { beam: b, halo: (POINT.gathered + 0.05 * st.arrive + flare) * dot, dot });
      if (text) {
        const fade = TEXT.fade;
        text.style.opacity = String(Math.min(1, Math.max(0, (tc - TEXT.at) / fade)) * (1 - Math.min(1, Math.max(0, (tc - TEXT.out) / fade))));
      }
    },
  });
  return [make('S14', 'Portrait'), make('S15', 'Effaced')];
}

export default createPortraitPair;
