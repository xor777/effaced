// S14 · Portrait and S15 · Effaced (PLAN §4, restaged as the erasure ending).
//
// S14 (1C:00–1E:63): the light point S13 collapsed into exhales the embers of the flame on each heartbeat;
// they settle into a dark, saturated teal face while the white blooms out of the point, a spark draws the
// 65537-gon and the eyes open on the bell's E (1C:48). A few seconds of stillness, then the face is
// effaced, one step per channel leaving (1D:20 … 1E:40): the dark closes in from the outside and each
// band crumbles back into its embers, which stream into the point — the eyes last. 1E:52: the bell alone,
// black and the point: 65536 embers + 1.
// S15 (1F:00 + tail): the oscilloscope beam of S00 returns. It grows the creature's sigil out of the
// point through the final cadence (E major, full at the A major 1F:32), then collapses back into it
// (1F:44–1F:60). The point lingers as the last light and goes out with the music's tail. Darkness.
//
// The portrait is the perception renderer's (src/perception: exact colours, no post); the beam is the
// engine's (src/gfx/beam.ts), rendered into a half-resolution target that the portrait pass composites.
//
// Dev (DEV builds): globalThis.__s14 — live knobs (__s14.P = the FaceParams, __s14.eraseRow, __s14.beam…).

import { type Gfx, type Target, ensureTarget, bindTarget, clearTarget } from '../gfx/gl.ts';
import { Beam } from '../gfx/beam.ts';
import type { Scene, FrameCtx } from './types.ts';
import { createRenderer, drawFace, warmFace } from '../perception/render.ts';
import { defaults } from '../perception/params.ts';
import { faceS14, SCORE_CUES, type FaceCues } from '../perception/timeline.ts';
import { ROW, ROWS } from '../timeline/script.ts';
import { CH } from '../music/roster.ts';
import { sigilTables } from '../audio/synth/scope.ts';

const P1C = 0x1c * ROWS;
const SR = 48000; // beam samples per second (as S00 at the audio rate)
const TABLE = 4096;

/** the beam through 1F (seconds since the cut): grows out of the point over the E major, is whole at the
 *  A major (1F:32), collapses back into the point (1F:44–1F:60). Traversal = the bass: E2, then A2. */
export const BEAM = {
  growTo: 32 * ROW,
  collapseFrom: 44 * ROW,
  collapseTo: 60 * ROW,
  fE: 82.407,
  fA: 110,
  exposure: 1.6,
  energy: 1,
};

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createPortraitPair(g: Gfx): [Scene, Scene] {
  const gl = g.gl;
  const P = defaults();
  const r = createRenderer({ gl, canvas: g.canvas, vao: g.vao, space: 'display-p3' });
  P.face.s14Rows = 3 * ROWS; // the cue: 1C:00–1F:00
  P.face.s15 = ROWS * ROW + 12; // 1F + the 12 s tail (script.ts TAIL)
  const beam = new Beam(g);
  let beamT: Target | null = null;
  let text: HTMLElement | null = null;
  let warmed = false;
  let beamWarmed = false;
  let lastTc = 0;

  // the sigil (S00's figure, S13's flame seed), centred on its inner circle — "the +1" ring of the glyph —
  // so the figure grows out of the point and collapses into it (scope.ts sigilPath: outer circle 2π,
  // triangle 3·√3, stem 0.7, inner circle 0.6π, back up 0.7; arc-length parametrised)
  const tabs = sigilTables();
  const total = 2 * Math.PI + 3 * Math.sqrt(3) + 0.7 + 0.6 * Math.PI + 0.7;
  const i0 = Math.round(((2 * Math.PI + 3 * Math.sqrt(3) + 0.7) / total) * TABLE);
  const i1 = Math.round(((2 * Math.PI + 3 * Math.sqrt(3) + 0.7 + 0.6 * Math.PI) / total) * TABLE);
  let cx = 0, cy = 0;
  for (let i = i0; i < i1; i++) (cx += tabs[6].x[i]), (cy += tabs[6].y[i]);
  cx /= i1 - i0;
  cy /= i1 - i0;

  const sizeAt = (tc: number) => ss(0, BEAM.growTo, tc) * (1 - ss(BEAM.collapseFrom, BEAM.collapseTo, tc));

  /** the beam's XY at time tc (s since the cut) */
  const xy = (tc: number): [number, number] => {
    const grow = ss(0, BEAM.growTo, tc);
    const coll = ss(BEAM.collapseFrom, BEAM.collapseTo, tc);
    const size = grow * (1 - coll);
    // resolution: a circle out of the point, resolving into the sigil as it grows (Fourier levels 0 → 6)
    const lv = 6 * Math.pow(size, 0.6);
    const j = Math.min(5, Math.floor(lv)), fj = lv - j;
    const ph = tc < BEAM.growTo ? BEAM.fE * tc : BEAM.fE * BEAM.growTo + BEAM.fA * (tc - BEAM.growTo);
    const u = (ph - Math.floor(ph)) * TABLE;
    const k = Math.floor(u), fk = u - k;
    const at = (t: { x: Float32Array; y: Float32Array }, c: 'x' | 'y') => t[c][k] + (t[c][k + 1] - t[c][k]) * fk;
    const x = at(tabs[j], 'x') + (at(tabs[j + 1], 'x') - at(tabs[j], 'x')) * fj - cx * Math.min(1, lv);
    const y = at(tabs[j], 'y') + (at(tabs[j + 1], 'y') - at(tabs[j], 'y')) * fj - cy * Math.min(1, lv);
    // unwinding as it grows, winding up as it collapses (like the embers, like S13's collapse)
    const rot = 0.9 * (1 - grow) ** 2 - 1.4 * coll * coll;
    const c = Math.cos(rot), s = Math.sin(rot);
    return [size * (c * x - s * y), size * (s * x + c * y)];
  };

  // the music the portrait reacts to (rows since 1C:00): the real note-ons when there is a render,
  // the score's rows otherwise (silent dev mode)
  let memo: { audio: FrameCtx['audio']; cues: FaceCues } | null = null;
  const cuesFor = (f: FrameCtx): FaceCues => {
    if (memo && memo.audio === f.audio) return memo.cues;
    const notes = f.audio?.notes ?? [];
    const pick = (ch: number, to: number): [number, number][] => {
      const ns = notes.filter((n) => n.ch === ch && n.grow >= P1C && n.grow < to);
      const vmax = Math.max(1, ...ns.map((n) => (n.vol < 0 ? 64 : n.vol)));
      return ns.map((n) => [(n.t - P1C * ROW) / ROW, (n.vol < 0 ? 64 : n.vol) / vmax]);
    };
    const kick = pick(CH.kick, P1C + 3 * ROWS);
    const bell = pick(CH.bell, P1C + 4 * ROWS);
    const cues = { kick: kick.length ? kick : SCORE_CUES.kick, bell: bell.length >= 8 ? bell : SCORE_CUES.bell };
    memo = { audio: f.audio, cues };
    return cues;
  };

  if (import.meta.env.DEV) {
    const F = P.face;
    const hook = {
      /** the live FaceParams (lab names); changes show on the next frame */
      P: F,
      /** S15 beam timing / exposure (seconds since the cut) */
      beam: BEAM,
      /** rows from 1C:00 until the face is complete (64 = 1D:00) */
      get assembleRows() { return F.assembleRows; },
      set assembleRows(v: number) { F.assembleRows = Math.round(Math.min(160, Math.max(16, v))); },
      /** first erasure step, rows from 1C:00 (84 = 1D:20, the echo leaves); one step per 12 rows */
      get eraseRow() { return F.eraseRow; },
      set eraseRow(v: number) { F.eraseRow = Math.round(v); },
      get embers() { return F.embers; },
      set embers(v: number) { F.embers = v; },
      get sat() { return F.sat; },
      set sat(v: number) { F.sat = v; },
      /** the cues in use (rows since 1C:00) */
      get cues() { return memo?.cues ?? SCORE_CUES; },
      reset() { Object.assign(F, defaults().face, { s14Rows: 3 * ROWS, s15: ROWS * ROW + 12 }); },
      /** the perception renderer (inspection) */
      r,
    };
    (globalThis as unknown as { __s14: typeof hook }).__s14 = hook;
  }

  /** S15: run the beam into its half-resolution target; null once it has faded */
  const drawBeam = (f: FrameCtx, tc: number, warm: boolean): Target | null => {
    if (!warm && (tc > BEAM.collapseTo + 1.5 || tc < 0)) return null;
    beamT = ensureTarget(g, beamT, Math.ceil(f.w / 2), Math.ceil(f.h / 2), { formats: [gl.RGBA16F], filter: gl.LINEAR });
    clearTarget(g, beamT);
    const reset = f.jumped || tc < lastTc || warm;
    const from = reset ? Math.max(0, tc - 1 / 60) : lastTc;
    let n0 = Math.floor(from * SR);
    const n1 = Math.floor(tc * SR);
    if (n1 - n0 > 32000) n0 = n1 - 32000;
    beam.begin();
    for (let i = n0; i <= n1; i++) {
      const [x, y] = xy(i / SR);
      beam.push(x, y);
    }
    if (beam.n < 2) beam.push(0, 0);
    const size = sizeAt(tc);
    let bell = 0; // the bell's G♯ (1F:16) and C♯ (1F:32) swell the trace
    for (const [row, v] of cuesFor(f).bell) {
      const x = tc - (row - 3 * ROWS) * ROW;
      if (x >= 0) bell += v * Math.min(1, x / 0.25) * Math.exp(-x / 1.5);
    }
    const fadeOut = 1 - ss(BEAM.collapseTo - 0.6, BEAM.collapseTo, tc);
    const energy = warm ? 0 : BEAM.energy * ss(0, 0.5, tc) * (0.3 + 0.7 * size) * (1 + 0.4 * bell) * fadeOut;
    beam.render(Math.max(0, f.dt), beamT, f.aspect, reset, 0.82, energy);
    bindTarget(g, null);
    return beamT;
  };

  const make = (id: 'S14' | 'S15', title: string): Scene => ({
    id,
    title,
    post: false,
    programs: () => (id === 'S15' ? beam.programs() : []),
    init: id === 'S15' ? () => beam.init() : undefined,
    enter() {
      if (id === 'S15') {
        document.title = '#FACE';
        text = document.createElement('div');
        text.textContent = P.face.text;
        const gray = Math.round(P.face.textGray * 255);
        text.style.cssText =
          `position:absolute;left:0;right:0;top:${50 + P.face.textOffset * 100}%;text-align:center;` +
          `font:400 ${P.face.textSizePx}px/1 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:0.04em;` +
          `color:rgb(${gray},${gray},${gray});opacity:0;pointer-events:none`;
        document.getElementById('stage')!.appendChild(text);
      }
    },
    leave() {
      text?.remove();
      text = null;
      if (id === 'S15') document.title = 'EFFACED';
    },
    render(f: FrameCtx) {
      const res: [number, number] = [f.w, f.h];
      const warm = !warmed;
      if (warm) {
        // the design cache, the ember table and the ember pipeline, built during the loader's warm-up
        warmFace(r, P, res, 'display-p3');
        warmed = true;
      }
      if (id === 'S14') {
        drawFace(r, P, P.face.preRoll + f.local, res, 'display-p3', cuesFor(f));
        return;
      }
      const tc = f.local;
      const b = drawBeam(f, tc, !beamWarmed); // first S15 draw (the loader's warm-up): the beam's pipelines, no light
      beamWarmed = true;
      lastTc = tc;
      // the point takes the sigil in: one last flare as the beam collapses into it
      const x = tc - BEAM.collapseTo;
      const flare = x >= 0 ? P.face.life * 0.16 * Math.min(1, x / 0.15) * Math.exp(-x / 1.4) : 0;
      const ff = drawFace(r, P, P.face.preRoll + faceS14(P.face) + tc, res, 'display-p3', cuesFor(f), {
        beam: b?.tex[0] ?? null,
        beamExposure: BEAM.exposure,
        // the sigil spans ±1.1 (centred on its inner circle) × 0.41 H; trails of the last 0.3 s + the glow
        beamRadius: 0.41 * 1.15 * Math.max(sizeAt(tc), sizeAt(tc - 0.3)) + 0.03,
        halo: flare * (1 - ss(P.face.s15 - P.face.pointOut, P.face.s15 - 0.3, tc)),
      });
      if (text) text.style.opacity = String(ff.text);
    },
  });
  return [make('S14', 'Portrait'), make('S15', 'Effaced')];
}

export default createPortraitPair;
