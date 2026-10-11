// S08 · Flow (replaces the lilac chaser) · 0F:00–11:63. The adapting stimulus of the act's illusion.
//
// S07 hands over grey (186) and the fixation cross, its twelve pearls erased one per row. Here they come
// back one per row with the harp's 12-row wheel, in the chaser's order — and then the ring opens: it is
// one ring of a lattice of pearls in log-polar space that fills the frame down to the cross, and the
// whole lattice starts to stream into the vanishing point and turn clockwise. From 0F:32 to the last row
// of 11 it moves at ONE constant velocity (the music never changes speed or direction — it only lights
// the pearls: the harp's wheel runs a glint round the spiral arms, the tick and the bell put a sheen on
// them). Twenty seconds of that is a strong adaptation: at 12:00 S09 stops the render on a still wheel
// of Hopf fibres at the same centre, and the still seems to swell and turn the other way — the motion
// aftereffect (the "waterfall illusion"), while F:0x… stands still.
//
// The flow is scale-invariant (a translation in ρ = ln r, φ): every ring passes in one beat and every
// pearl keeps its size relative to its distance from the centre, so the motion has the same temporal
// frequency at every eccentricity. Until 10:32 the phrases change the material (gloss, nacre, beads on
// strings, glass hoops) and light sweeps follow the bell; the last 11.5 s are the clean flow.
//
// dev / calibration: globalThis.__s08 (FLOW below) — speed, spin, direction, period, contrast, mode, size.

import { type Gfx, program, fullscreen } from '../gfx/gl.ts';
import type { Scene, FrameCtx } from './types.ts';
import { smoothstep } from '../timeline/events.ts';
import { ROW, ROWS } from '../timeline/script.ts';
import { CH } from '../music/roster.ts';
import { frameCounter, tickFrameCounter } from '../meta/overlay.ts';
import { defaults } from '../perception/params.ts';
import { lilacColors } from '../perception/render.ts';
import { toBuffer, hex2rgb } from '../perception/color.ts';

/** the flow's parameters — shared with S09, whose still drifts the opposite way */
export const FLOW = {
  /** rings that pass per beat (4 rows); the radial temporal frequency is speed / 0.48 s */
  speed: 1,
  /** pearl steps per 12-row wheel (rotation); 0 = a pure tunnel */
  spin: 1,
  /** +1: into the centre (receding), −1: out of it (looming) */
  dir: 1,
  /** +1: clockwise (as the chaser), −1: counter-clockwise */
  turn: 1,
  /** ring spacing in ln r (≈ the angular spacing 2π/12 for round cells) */
  period: 0.42,
  /** shading contrast of the pearls once the flow runs (0 = the chaser's flat discs) */
  contrast: 1,
  /** 'spiral' (alternate rings offset half a pearl: arms) or 'tunnel' (aligned rings, no spin) */
  mode: 'spiral' as 'spiral' | 'tunnel',
  /** pearl radius relative to its distance from the centre (the chaser's 0.05 / 0.32) */
  size: 0.05 / 0.32,
};
if (import.meta.env.DEV) (globalThis as any).__s08 = FLOW;

const C0 = 0x0f * ROWS; // the cycle starts (E-4)
const N = 12;

export function createFlow(g: Gfx): Scene {
  const prog = program(g, 'scenes/s08-flow');
  const P = defaults().lilac;
  const lc = lilacColors(P, 'display-p3');
  const lin = (h: string) => toBuffer(hex2rgb(h), 'srgb', 'display-p3');
  const dark = lin('#241A40');
  const sheen = lin('#DECADE');
  const decade = lin('#DECADE');
  /** 0 → 1 over [a, b], 1 → 0 over [c, d] */
  const env = (x: number, a: number, b: number, c: number, d: number) => smoothstep(a, b, x) * (1 - smoothstep(c, d, x));
  /** the bell's BEADED pearls (revolution starts 4, 6, … 14: 0F:48, 10:08, 10:32, 10:56, 11:16, 11:40) */
  let bells: { audio: FrameCtx['audio']; t: number[] } | null = null;
  const bellTimes = (f: FrameCtx) => {
    if (bells && bells.audio === f.audio) return bells.t;
    const n = f.audio?.notes?.filter((x) => x.ch === CH.bell && x.grow >= C0 && x.grow < C0 + 192).map((x) => x.t);
    bells = { audio: f.audio, t: n && n.length ? n : [48, 72, 96, 120, 144, 168].map((r) => (C0 + r) * ROW) };
    return bells.t;
  };
  let hint: HTMLElement | null = null;

  /** ∫₀ᵗ smoothstep(a, b, τ) dτ — the flow's offset during the run-up, so speed changes stay smooth */
  const ramp = (t: number, a: number, b: number) => {
    if (t <= a) return 0;
    if (t >= b) return 0.5 * (b - a) + (t - b);
    const u = (t - a) / (b - a);
    return (b - a) * (u * u * u - 0.5 * u * u * u * u);
  };

  return {
    id: 'S08',
    title: 'Flow',
    post: false,
    programs: () => [prog],
    enter() {
      frameCounter(true); // started in S07; idempotent, so a direct seek here shows it too
      hint = document.createElement('div');
      hint.textContent = 'look at the center';
      hint.style.cssText =
        'position:absolute;left:0;right:0;top:60%;text-align:center;font:400 1.9vh/1 system-ui,sans-serif;opacity:0;letter-spacing:.04em;pointer-events:none';
      hint.style.color = lc.hintCss;
      document.getElementById('stage')!.appendChild(hint);
    },
    leave() {
      hint?.remove();
      hint = null;
    },
    render(f: FrameCtx) {
      const lr = f.row - C0; // rows since 0F:00
      const tr = lr * ROW;
      const tunnel = FLOW.mode === 'tunnel';
      // velocities (ln r per s, rad per s): one ring per beat in, one pearl per wheel clockwise
      const vr = (-FLOW.dir * FLOW.speed * FLOW.period) / (4 * ROW);
      const vp = tunnel ? 0 : (-FLOW.turn * FLOW.spin * (2 * Math.PI)) / N / (12 * ROW);
      const s = ramp(tr, 14 * ROW, 32 * ROW); // the run-up: rows 14 → 32, then constant to 11:63
      const open = smoothstep(12, 30, lr);
      // the music lights the pearls, never moves them
      const harp = Math.min(1, (f.S[CH.arp - 1] ?? 0) * 3) || (f.audio ? 0 : 0.6);
      const bell = Math.min(1, (f.S[CH.bell - 1] ?? 0) * 2.5);
      const tick = Math.min(1, (f.S[CH.hats - 1] ?? 0) * 3);
      const wheel = ((Math.floor(lr) % N) + N) % N; // the harp's note of this row = the spoke that flares
      const glint = (wheel + (lr - Math.floor(lr))) % N;
      const hush = 1 - smoothstep(0x11 * ROWS + 46 - C0, 0x11 * ROWS + 50 - C0, lr); // 11:48: the wheel stops

      // phrases: what the pearls are made of changes, where they are never does. The variety lives
      // between the run-up and 10:32 (the wheel and the bar meet again: bell A, D pedal); the last 96 rows
      // (11.5 s) are the clean flow the aftereffect needs, lit only by the bell and the harp.
      //   0F:32 gloss #BEADED · 0F:48 bell B: a light sweeps round, nacre · 0F:60 the rings are threaded
      //   (beads on strings) · 10:08 bell E: a sweep, the beads turn into glass hoops — S09's fibres to
      //   come · 10:24–10:32 back to gloss, clean to the end
      const nacre = env(lr, 44, 52, 88, 96);
      const strings = env(lr, 58, 64, 88, 96);
      const hoop = env(lr, 70, 78, 88, 96);
      const glass = env(lr, 72, 80, 88, 96);
      const varied = 1 - smoothstep(88, 96, lr);
      const tint = lc.disc.map((x, i) => x + (decade[i] - x) * glass);
      // bell: before 10:32 a light sweeps once round the lattice (clockwise, with the flow); after, a sheen
      let swA = 0, swAmt = 0;
      for (const tb of bellTimes(f)) {
        const dt = f.t - tb;
        if (dt < 0 || dt > 3 || (tb - C0 * ROW) / ROW > 92) continue;
        swA = Math.PI / 2 - (2 * Math.PI * dt) / (12 * ROW);
        swAmt = 0.75 * Math.exp(-dt / 1.1) * Math.min(1, dt / 0.06);
      }
      const breath = 1 + 0.06 * varied * open * Math.sin((2 * Math.PI * lr) / 48);
      if (prog.use()) {
        prog
          .set('res', f.w, f.h)
          .set('bg', lc.bg)
          .set('tint', tint)
          .set('dark', dark)
          .set('light', 1, 1, 1)
          .set('sheenC', sheen)
          .set('lat', P.ringRadius, FLOW.period, N, tunnel ? 0 : 0.5)
          .set('off', vr * s, vp * s)
          .set('look', FLOW.size * breath, (P.blurSigma / P.ringRadius) * (1 - 0.85 * open), FLOW.contrast * open, 0.035)
          .set('reveal', lr, lr - 12, 0)
          .set('fx', glint, 0.9 * harp * open * hush, 0.35 * bell + 0.12 * tick, 0.06 * tick)
          .set('mat', nacre, hoop, glass, strings)
          .set('sweep', swA, swAmt, 0.45)
          .set('Ldir', -0.45, 0.6, 0.66)
          .set('crossSz', P.crossSize, P.crossThickness)
          .set('crossCol', lc.cross);
        fullscreen(g);
      }
      tickFrameCounter();
      // the hint, once, early and faint (PLAN appendix A)
      if (hint) {
        const h0 = 18, h1 = 50, hf = 6;
        hint.style.opacity = String(Math.max(0, Math.min(1, (lr - h0) / hf, (h1 - lr) / hf)));
      }
    },
  };
}

export default createFlow;
