// Pure time → state functions for the illusion sequences. No GL, no DOM: these port 1:1 into the
// demo's scene code, where `t` comes from the audio clock (t = row * ROW since the cue started).

import { ROW, type LilacParams, type FaceParams } from './params.ts';

export const N_DISCS = 12;

export interface LilacFrame {
  /** per-disc visibility 0..1 (disc j sits at angle 90° − dir·j·30°) */
  vis: Float32Array;
  /** global step index (one disc per step); −1 before t = 0 */
  step: number;
  /** disc that went missing at the start of this step (−1 when none) */
  missing: number;
  /** seconds since the start of the current step */
  phase: number;
  /** bitmask of discs that are (fully) off — the debug readout measures when it changes */
  offMask: number;
  /** opacity of the one-time hint text 0..1 */
  hint: number;
  /** 'fadein' | 'chase' | 'ending' | 'tail' | 'done' */
  stage: string;
  /** near-threshold assist disc (index, alpha) — off by default */
  assistIdx: number;
  assistA: number;
  /** cross opacity */
  cross: number;
}

export const lilacDuration = (p: LilacParams) => p.durationRows * ROW;
export const lilacTotal = (p: LilacParams) => p.durationRows * ROW + p.tail;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function lilacFrame(t: number, p: LilacParams, vis = new Float32Array(N_DISCS)): LilacFrame {
  const step = Math.max(1e-3, p.stepTime);
  const n = Math.floor(t / step + 1e-9);
  const phase = t - n * step;
  const dur = lilacDuration(p);
  const endStep = Math.round((p.endAtRows * ROW) / step); // the ending starts exactly on a step
  const tEnd = endStep * step;
  const fade = p.fadeIn > 0 ? clamp01(t / p.fadeIn) : 1;
  vis.fill(t < 0 ? 0 : fade);

  // the chase: the disc of step k is gone during [k·step, k·step + off)
  const back = Math.ceil(p.offTime / step) + 1;
  for (let k = n; k >= n - back && k >= 0; k--) {
    if (k * step >= tEnd && p.endMode !== 'erase') continue;
    if (t - k * step < p.offTime) vis[k % N_DISCS] = 0;
  }
  let stage = t < 0 ? 'pre' : t < p.fadeIn ? 'fadein' : t < tEnd ? 'chase' : t < dur ? 'ending' : t < dur + p.tail ? 'tail' : 'done';
  if (t >= tEnd) {
    if (p.endMode === 'erase') {
      // the phantom eats the ring: from endStep on, every visited disc stays gone (one last lap)
      for (let k = endStep; k <= n && k < endStep + N_DISCS; k++) vis[k % N_DISCS] = 0;
    } else if (p.endMode === 'cut') vis.fill(0);
    else {
      const f = 1 - clamp01((t - tEnd) / Math.max(1e-3, p.endFade));
      for (let j = 0; j < N_DISCS; j++) vis[j] *= f;
    }
  }
  if (t >= dur) vis.fill(0);

  let offMask = 0;
  for (let j = 0; j < N_DISCS; j++) if (vis[j] === 0) offMask |= 1 << j;

  // optional assist: a near-threshold green disc continuing the run after the last lilac is gone
  const lastGone = p.endMode === 'erase' ? endStep + N_DISCS - 1 : endStep;
  let assistIdx = -1, assistA = 0;
  if (p.assist > 0 && n > lastGone && n <= lastGone + p.assistSteps) {
    assistIdx = n % N_DISCS;
    assistA = p.assist * (1 - (n - lastGone - 1) / Math.max(1, p.assistSteps));
  }

  const h0 = p.hintStartRows * ROW, hl = p.hintRows * ROW, hf = Math.max(1e-3, p.hintFadeRows * ROW);
  const hint = p.hint ? clamp01(Math.min((t - h0) / hf, (h0 + hl - t) / hf)) : 0;

  return {
    vis,
    step: t < 0 ? -1 : n,
    missing: t >= 0 && t < tEnd + N_DISCS * step ? n % N_DISCS : -1,
    phase,
    offMask,
    hint,
    stage,
    assistIdx,
    assistA,
    cross: t < dur + p.tail ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------------------------
// S14 · Portrait → S15 · Effaced
//
//   S13 pre-roll   black + the light point (the last frame of S13's collapse)
//   S14 assemble   rows 0 … assembleRows (1C:00–1D:00): the point exhales the embers of the flame on
//                  each heartbeat (kick); they spiral out and settle into the face, which develops from
//                  the point outwards; a spark leaves the point and draws the 65537-gon (1C:08–1C:32);
//                  the white blooms out of the point (dawnFrom–dawnTo); the eyes open on the bell's E
//   S14 hold       the face, eyes open, still (1C:54–1D:20)
//   S14 erase      one step per channel leaving (1D:20 … 1E:40, every 12 rows): the dark closes in
//                  from the outside and that band of the face crumbles into its embers, which stream
//                  into the point — the eyes last. 1E:52: the bell alone, black and the point
//   S15            (the demo draws the S00 beam: the sigil out of the point and back into it, 1F:00–1F:60)
//                  the point lingers and goes out with the music's tail; "65536 + 1"
//   ending 'afterimage' (lab only): no erasure, a hard cut to white at the end of S14 (the old finale)

/** musical events the portrait reacts to: rows since the S14 cue (1C:00), velocity 0..1 */
export interface FaceCues {
  /** the heartbeat (ch1): each one exhales a wave of embers and flares the point */
  kick: [number, number][];
  /** the bell (ch13): FADE ×3 in 1C–1E, G♯5 / C♯6 in 1F */
  bell: [number, number][];
}

/** music/score/act5.ts, for the lab and the silent demo (the demo reads the real notes when it has them) */
export const SCORE_CUES: FaceCues = {
  kick: [[0, 1], [12, 0.91], [24, 0.77], [36, 0.59]],
  bell: [
    [0, 0.97], [16, 0.94], [32, 0.94], [48, 0.97], // F A D E, one per bar
    [64, 0.91], [72, 0.85], [80, 0.85], [88, 0.91], [112, 0.82], [120, 0.79], // faster
    [128, 0.88], [144, 0.85], [160, 0.88], [180, 1], // slowest; the E alone at 1E:52
    [208, 0.76], [224, 0.85], // 1F:16 G♯5, 1F:32 C♯6
  ],
};

export interface FaceFrame {
  scene: 'S13' | 'S14' | 'S15' | 'done';
  stage: 'pre' | 'assemble' | 'hold' | 'erase' | 'end' | 'afterimage' | 'done';
  /** seconds since the current scene started */
  local: number;
  /** rows since the S14 cue (negative in the pre-roll, continues through S15) */
  row: number;
  /** the face is assembling (embers out of the point, reveal, dawn) */
  assembling: boolean;
  /** the face is being erased (dark closing in, embers into the point) */
  erasing: boolean;
  /** dawn progress 0..1 (the shader spreads it radially out of the fixation point) */
  field: number;
  /** erasure progress 0..1 (the shader sweeps it from the outside in) */
  erase: number;
  /** 1 = face drawn (S14), 0 = no face (S15) */
  face: number;
  /** S15: 1 = the white field (ending 'afterimage'), 0 = black */
  endWhite: number;
  white: number; // sRGB-encoded white level of the current field
  eyes: number; // 0 closed … 1 open
  comet: number; // the spark that draws the ring: brightness
  cometPos: [number, number]; // … its position (face units)
  sweep: number; // the ring drawn behind it: angle (rad, clockwise from the top)
  kick: number; // heartbeat envelope
  bell: number; // bell envelope
  halo: number; // fixation point glow (linear)
  dot: number; // fixation dot opacity
  dotLight: number; // 0 = dark dot, 1 = light point
  text: number; // "65536 + 1" opacity
  /** seconds since the cut (≥ 0 in S15) */
  sinceCut: number;
}

export const faceS14 = (p: FaceParams) => p.s14Rows * ROW;
export const faceTotal = (p: FaceParams) => p.preRoll + faceS14(p) + p.s15;
/** row (since the S14 cue) from which the face is complete */
export const faceLock = (p: FaceParams) => Math.max(8, Math.min(p.assembleRows, p.s14Rows));
/** the erasure steps (rows since the S14 cue), clamped to end before the cut; [] for the afterimage ending */
export function eraseSteps(p: FaceParams): number[] {
  if (p.ending !== 'erase') return [];
  const out: number[] = [];
  const first = Math.max(faceLock(p) + 2, p.eraseRow);
  for (let i = 0; i < p.eraseSteps; i++) {
    const r = first + i * p.eraseStepRows;
    if (r + p.eraseEase > p.s14Rows - 4) break;
    out.push(r);
  }
  return out;
}

const ss = (a: number, b: number, x: number) => {
  const t = b > a ? clamp01((x - a) / (b - a)) : x >= b ? 1 : 0;
  return t * t * (3 - 2 * t);
};
/** attack/decay envelope in rows */
const env = (r: number, cues: [number, number][], a: number, d: number) => {
  let e = 0;
  for (const [r0, v] of cues) {
    if (r < r0) continue;
    const x = r - r0;
    e += v * Math.min(1, x / a) * Math.exp(-Math.max(0, x - a) / d);
  }
  return e;
};
/** width of the dawn front (the shader's fieldAt) */
export const DAWN_FRONT = 0.4;
/** rows by which the dark arrives before a band crumbles; rows before the first step it starts at the frame's edge */
export const ERASE_LEAD = 3;
export const ERASE_PREROLL = 10;
/** the point's glow at rest once it holds all the embers (carried through S15) */
const HALO_FULL = 0.08;

export function faceFrame(t: number, p: FaceParams, cues: FaceCues = SCORE_CUES): FaceFrame {
  const s14 = faceS14(p);
  const tc = t - p.preRoll - s14;
  const row = (t - p.preRoll) / ROW;
  const lock = faceLock(p);
  const k = lock / 64; // the assembly is written for 64 rows
  const steps = eraseSteps(p);
  const base = {
    row, eyes: p.eyesOpen ? 1 : 0, comet: 0, cometPos: [0, 0] as [number, number], sweep: 2 * Math.PI + 0.3,
    kick: 0, bell: 0, halo: 0, erase: 0, assembling: false, erasing: false, endWhite: 0, text: 0, sinceCut: tc,
  };
  if (t < p.preRoll)
    return {
      ...base, scene: 'S13', stage: 'pre', local: t, assembling: true, field: 0, face: 1, white: p.white14, sweep: 0,
      eyes: 0, dot: 1, dotLight: 1,
    };

  const L = p.life;
  const gathered = steps.length ? HALO_FULL * L : 0;
  if (tc < 0) {
    const r = row;
    const assembling = r < lock;
    // the white blooms out of the point
    const dTo = Math.min(p.dawnTo * k, lock - 2), dFrom = Math.min(p.dawnFrom * k, dTo - 1);
    const field = assembling ? ss(dFrom, dTo, r) : 1;
    // the eyes open (S9: closed), over before the face is complete
    const eRows = Math.max(1, p.eyesRows);
    const eAt = Math.min(p.eyesRow, lock - eRows - 2);
    const eyes = p.eyesOpen ? ss(eAt, eAt + eRows, r) : 0;
    // a spark leaves the point (up to 12 o'clock), draws the 65537-gon clockwise, and goes out at the top
    const up = ss(8 * k, 16 * k, r);
    const sweep = (2 * Math.PI + 0.3) * ss(16 * k, 32 * k, r);
    const an = Math.min(sweep, 2 * Math.PI);
    const R = p.frameRadius * up;
    const comet = ss(8 * k, 9 * k, r) * (1 - ss(32 * k, 36 * k, r));
    // the erasure: a staircase, one raised-cosine step per channel leaving
    let erase = 0;
    for (const s0 of steps) erase += 0.5 - 0.5 * Math.cos(Math.PI * clamp01((r - s0) / p.eraseEase));
    erase /= Math.max(1, steps.length);
    const erasing = steps.length > 0 && r >= steps[0] - ERASE_PREROLL;
    const kick = env(r, cues.kick, 1.5, 5);
    const bell = Math.min(1.2, env(r, cues.bell, 3, 12));
    // embers arriving in the point: a soft pulse some rows after each step
    const arrive = env(r, steps.map((s0) => [s0 + 7, 1] as [number, number]), 3, 6);
    const halo = L * (0.12 * kick) + gathered * erase + L * 0.05 * arrive;
    const stage = assembling ? 'assemble' : !erasing ? 'hold' : erase < 1 ? 'erase' : 'end';
    return {
      ...base, scene: 'S14', stage, local: r * ROW, assembling, erasing, field, erase, face: 1, white: p.white14,
      eyes, comet, cometPos: [R * Math.sin(an), R * Math.cos(an)], sweep, kick, bell, halo, dot: 1, dotLight: 1,
    };
  }

  const scene = tc < p.s15 ? 'S15' : 'done';
  if (p.ending === 'afterimage') {
    const dot = p.s15Dot === 'on' ? 1 : p.s15Dot === 'off' ? 0 : 1 - clamp01(tc / Math.max(1e-3, p.s15DotFade));
    return {
      ...base, scene, stage: scene === 'S15' ? 'afterimage' : 'done', local: tc, field: 1, face: 0, endWhite: 1,
      white: p.white15, dot, dotLight: 0, text: clamp01((tc - p.textAt) / Math.max(1e-3, p.textFade)),
    };
  }
  // the point lingers, holding the 65536, and goes out with the music's tail
  const dot = 1 - ss(p.s15 - p.pointOut, p.s15 - 0.3, tc);
  const arrive = env(row, steps.map((s0) => [s0 + 7, 1] as [number, number]), 3, 6);
  const fade = Math.max(1e-3, p.textFade);
  const text = clamp01((tc - p.textAt) / fade) * (p.textOut > p.textAt ? 1 - clamp01((tc - p.textOut) / fade) : 1);
  return {
    ...base, scene, stage: scene === 'S15' ? 'end' : 'done', local: tc, field: 0, erase: 1, face: 0, white: p.white14,
    halo: (gathered + L * 0.05 * arrive) * dot, dot, dotLight: 1, text,
  };
}
