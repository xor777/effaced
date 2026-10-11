// S05 · Staircase · 09–0A (PLAN §4). A Penrose staircase on a tower of the facade city, seen from
// the "magic" viewpoint, while the strings and choir climb a Shepard scale that never arrives.
//
// The staircase is a real 3D object built by forced perspective: four straight flights around a
// square, every flight a little smaller than the one before, and the last landing placed exactly on
// the view ray of the first step (S5 = E + μ(S1 − E)). Every camera on the line through S1 and S5 sees
// a closed loop, so the camera may ride that line.
//
//   09:00  one bar of plain camera: a push along the magic line, the city big behind the tower
//   09:16  the vertigo: the stairs climb (the tower grows under them, its windows stream down) while
//          the camera dollies in and zooms out on the magic line — the stairs hold still in the frame
//          and the city rushes away. It moves in lurches on the kicks and accelerates into the snare
//          roll of 0A bar 3. Two treads per Shepard note slide up like an escalator — the corners are
//          winder treads that turn with them, so the whole loop moves; a lit tread rides them round
//          and round, for ever upwards.
//   0A:48  the stop hit: a white frame, a hard cut off the magic line (the loop is open), three rows
//          of stillness, then the flights fall and a 90° turn shows the city edge-on — paper.

import { type Gfx, program, fullscreen } from '../gfx/gl.ts';
import type { Scene, FrameCtx } from './types.ts';
import { TAA, lookAt, type Vec3 } from '../gfx/taa.ts';
import { onsets, pulse, lastIndex, grow, setCityLook, hexP3, type CityLook } from '../gfx/city.ts';

type V = Vec3;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);

export interface Flight {
  start: V; // centre line at the foot of the first tread
  n: number; // treads along the straight part (may be fractional)
  u: V; // horizontal direction of travel
  run: number;
  rise: number;
  width: number;
  /** global tread index at the start of this flight */
  s0: number;
  /** treads in the winder corner that follows the straight part (a quarter turn about the inner corner) */
  cn: number;
}

/**
 * Solve the forced-perspective loop. Four flights, each followed by a winder corner (the treads turn
 * the corner as wedges, so nothing on the loop is a flat landing and the escalator moves everywhere).
 * Flights 1–2 have `n01` treads of `r0` × `h0`; flights 3–4 get the (fractional) lengths that close the
 * loop for an eye at elevation `theta`, distance `D` (looking along +z), with the whole loop an
 * integer number of treads so the moving treads pass the seam unbroken. Every flight is scaled by
 * μ^(k/4) so the near end matches the far start at the seam.
 */
export function penroseStairs(origin: V, theta: number, D: number, n01: [number, number], r0: number, h0: number, w0: number, alpha = Math.PI / 4) {
  const back: V = [0, Math.sin(theta), -Math.cos(theta)];
  const left = (u: V): V => [-u[2], 0, u[0]];
  const us: V[] = [];
  let u0: V = [Math.cos(alpha), 0, Math.sin(alpha)];
  for (let k = 0; k < 4; k++) {
    us.push(u0);
    u0 = left(u0);
  }
  const n = [n01[0], n01[1], n01[0], n01[1]];
  let C: V = [0, 0, 0];
  let mu = 0.9;
  let runs = [r0, r0, r0, r0];
  let res = { flights: [] as Flight[], S5: [0, 0, 0] as V, mu: 1, center: [0, 0, 0] as V, N: 0 };
  for (let it = 0; it < 80; it++) {
    const E = add(C, mul(back, D));
    let lam = [1, 1, 1, 1], cn = [0, 0, 0, 0];
    for (let j = 0; j < 40; j++) {
      lam = [0, 1, 2, 3].map((k) => mu ** (k / 4));
      runs = [r0 * lam[0], r0 * lam[1], runs[2], runs[3]];
      cn = [0, 1, 2, 3].map((k) => (Math.PI / 4) * (w0 * lam[k]) / runs[k]);
      const R = n.reduce((s, nk, k) => s + (nk + cn[k]) * h0 * lam[k], 0);
      mu = 1 - R / E[1];
    }
    const w = lam.map((l) => w0 * l);
    const target = mul(E, 1 - mu); // S5 = E + μ(S1 − E), S1 = 0
    let acc: V = [0, 0, 0];
    for (let k = 0; k < 4; k++) acc = add(acc, add(mul(us[k], w[k] / 2), mul(left(us[k]), w[k] / 2)));
    const L = [n[0] * runs[0], n[1] * runs[1], 0, 0];
    acc = add(acc, add(mul(us[0], L[0]), mul(us[1], L[1])));
    const rem = sub(target, acc);
    const a = us[2], b = us[3];
    const det = a[0] * b[2] - a[2] * b[0];
    L[2] = (rem[0] * b[2] - rem[2] * b[0]) / det;
    L[3] = (a[0] * rem[2] - a[2] * rem[0]) / det;
    // natural tread counts of flights 3–4, scaled so the loop is a whole number of treads
    const m2 = L[2] / (r0 * lam[2]), m3 = L[3] / (r0 * lam[3]);
    const cs = cn.reduce((x, y) => x + y, 0);
    const N = Math.round(n[0] + n[1] + m2 + m3 + cs);
    const k = (N - n[0] - n[1] - cs) / (m2 + m3);
    n[2] = m2 * k;
    n[3] = m3 * k;
    runs = [runs[0], runs[1], L[2] / n[2], L[3] / n[3]];
    const flights: Flight[] = [];
    let S: V = [0, 0, 0];
    let s0 = 0;
    const corners: V[] = [S];
    for (let q = 0; q < 4; q++) {
      flights.push({ start: S, n: n[q], u: us[q], run: runs[q], rise: h0 * lam[q], width: w[q], s0, cn: cn[q] });
      const nx = add(S, add(mul(us[q], L[q] + w[q] / 2), mul(left(us[q]), w[q] / 2)));
      S = [nx[0], S[1] + (n[q] + cn[q]) * h0 * lam[q], nx[2]];
      s0 += n[q] + cn[q];
      corners.push(S);
    }
    C = mul(add(add(corners[0], corners[1]), add(corners[2], corners[3])), 0.25);
    res = { flights, S5: S, mu, center: C, N: s0 };
  }
  // into the world
  for (const f of res.flights) f.start = add(f.start, origin);
  return { flights: res.flights, S1: origin, S5: add(res.S5, origin), mu: res.mu, center: add(res.center, origin), N: Math.round(res.N) };
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) ** 3);

/**
 * Progress 0..1 through [t0, t1) that moves in lurches on the given onsets (each eased over `dur`,
 * later ones weigh more: the climb accelerates) on top of a slow continuous drift.
 */
function lurch(onsetsT: number[], t: number, t0: number, t1: number, dur = 0.22, grow = 1.045, drift = 0.22): number {
  const lin = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const ev = onsetsT.filter((x) => x >= t0 - 1e-4 && x < t1);
  if (!ev.length) return lin;
  let w = 1, sum = 0, acc = 0;
  for (const x of ev) {
    sum += w;
    acc += w * easeOut((t - x) / dur);
    w *= grow;
  }
  return drift * lin + (1 - drift) * (acc / sum);
}

export function createStairs(g: Gfx): Scene {
  const gl = g.gl;
  const prog = program(g, 'scenes/s05-stairs');
  const taa = new TAA(g, { ratio: 0.45 });
  // the tower stands on cell (0, 4) of the city; the loop's first step at 21 units
  const ORIGIN: V = [2.2, 21.0, 25.0];
  const ST = penroseStairs(ORIGIN, 0.85, 60, [5, 5], 0.85, 0.21, 1.5);
  const seamDir = (() => {
    const d = sub(ST.S5, ST.S1);
    return mul(d, 1 / len(d));
  })();
  const look: CityLook = {
    sunDir: [-0.42, 0.78, -0.46],
    sunCol: hexP3('#ffe2c4', 6.0),
    skyHor: hexP3('#ffbcc0', 3.2),
    skyZen: hexP3('#d8acdc', 1.7),
    fogCol: hexP3('#ffb8c4', 0.32),
    fog: [0.02, 5.0, 1.0, 0.3],
    ground: hexP3('#e8b8bc', 0.45),
    pal: [hexP3('#f2e8e2', 0.7), hexP3('#d6aabb', 0.6), hexP3('#6a4858', 0.3)],
    stucco: [hexP3('#e8a7b6', 0.74), hexP3('#c7b0d6', 0.74), hexP3('#efd2b0', 0.76), hexP3('#f0e2d6', 0.78)],
    trim: hexP3('#f3ebe3', 0.82),
    neon: hexP3('#ff4f9a', 9.0),
    win: hexP3('#ffd9a8', 1.6),
    cloud: [0.5, 0.8, 0.02, 1.25],
  };
  const FA = new Float32Array(16), FB = new Float32Array(16), FC = new Float32Array(16), FD = new Float32Array(16);
  const SIZE = 17; // world height the frame holds at the stairs
  const D_PLAIN = 88, D_LOCK = 66, D_END = 17; // camera distance along the seam line
  const RISE = 70; // climb scale: ≈ 1300 units above the city by the stop
  let lastStop = -1;
  let lastRig = 0;

  const scene: Scene & { look?: CityLook; stairs?: typeof ST } = {
    look,
    stairs: ST,
    id: 'S05',
    title: 'Staircase',
    scale: 1,
    fps: 60,
    post: (f: FrameCtx) => {
      const st = f.local - stopLocal(f);
      // the stop hit: one white frame of impact, then the silence
      const flash = st >= 0 ? 1.8 * Math.exp(-st / 0.07) : 0;
      return { exposure: flash, bloom: 0.08 + 0.3 * Math.min(1, flash), bloomRadius: 1, vignette: 0.32, grain: 0.03, ca: 1.0, look: [1.25, 1.4, 0, 0] };
    },
    programs: () => [prog, ...taa.programs()],
    render(f: FrameCtx, hdr) {
      if (!hdr) return;
      const t = f.local;
      const g0 = grow(0x09), g2 = grow(0x0b), gStop = grow(0x0a, 48);
      const T = (row: number) => (row - g0) * 0.12; // global row → local seconds
      // ---- music: Shepard (ch15) one note per beat, galop kicks, backbeat + the roll of 0A bar 3, the stop
      const shep = onsets(f, 15, g0, gStop, shepFallback(g0, gStop)).map((x) => x - (f.t - t));
      const kicks = onsets(f, 1, g0, g2).map((x) => x - (f.t - t));
      const snares = onsets(f, 2, g0, gStop).map((x) => x - (f.t - t));
      const tStopL = stopLocal(f);
      const tStop = t - tStopL; // < 0 before the hit
      const tt = Math.min(t, tStopL - 1e-3); // time frozen at the hit
      const kick = tStop < 0 ? pulse(kicks, t, 0.14) : 0;
      const snare = tStop < 0 ? pulse(snares, t, 0.1) : 0;
      const si = lastIndex(shep, tt);
      const stepK = si < 0 ? 0 : si + easeOut((tt - shep[si]) / 0.14);
      const notePulse = tStop < 0 ? pulse(shep, t, 0.25) : 0;
      // the escalator: two treads per Shepard note; a lit tread rides it round and round
      const m = 2 * stepK;
      const phi = m - Math.floor(m);

      // ---- the climb: one plain bar, then the vertigo in lurches on the kicks (and the roll)
      const tV = T(grow(0x09, 16));
      const u = lurch([...kicks, ...snares.filter((x) => x >= T(grow(0x0a, 32)))].sort((a, b) => a - b), tt, tV, tStopL);
      // the height above the city grows ×1.65 per bar: the city visibly halves, bar after bar
      const H = tt < tV ? 0 : RISE * (1.65 ** (6 * u) - 1);
      const lift: V = [0, H, 0];
      const S5 = add(ST.S5, lift), center = add(ST.center, lift);
      let pos: V, target: V = center, fov: number, roll = 0;
      const fovAt = (p: V) => (2 * Math.atan(SIZE / 2 / len(sub(p, center))) * 180) / Math.PI;
      if (tt < tV) {
        // plain camera: a push along the magic line, fixed lens — the stairs grow, the city is big
        const d = D_PLAIN + (D_LOCK - D_PLAIN) * easeOut(tt / tV);
        pos = add(S5, mul(seamDir, d));
        fov = fovAt(add(S5, mul(seamDir, D_LOCK)));
      } else {
        // vertigo: dolly in + zoom out on the magic line while the stairs climb — the stairs hold
        // still in the frame, the city rushes away underneath
        const d = D_LOCK * (D_END / D_LOCK) ** u;
        pos = add(S5, mul(seamDir, d));
        fov = fovAt(pos);
      }
      // snare: a jolt of roll and lens
      const sn = lastIndex(snares, tt);
      roll += (sn % 2 ? 1 : -1) * 0.014 * snare;
      fov *= 1 - 0.03 * snare;

      const HOLD = 0.36; // three rows of stillness after the hit
      if (tStop >= HOLD) {
        // after the hold: a hard cut off the magic line — the loop is open — the flights fall and
        // we turn to 90° from the magic view: the city edge-on, paper
        if (lastStop < HOLD) taa.reset();
        const base = ST.center;
        const rel0 = sub(add(ST.S5, mul(seamDir, 30)), base);
        const k = ease((tStop - HOLD) / 1.2);
        const a = (-60 + (-90 + 60) * k) * (Math.PI / 180);
        const c = Math.cos(a), s = Math.sin(a);
        pos = add(base, [rel0[0] * c - rel0[2] * s, rel0[1] - 11 + 4 * k, rel0[0] * s + rel0[2] * c]);
        target = add(base, [0, -1 - 12 * k, 0]);
        fov = 42 + 8 * k;
        roll = 0;
      }
      lastStop = tStop;
      const cam = lookAt(pos, target, fov, roll);

      // ---- flights (+ the fall after the stop)
      const rig = tStop >= HOLD ? 0 : H;
      ST.flights.forEach((fl, k) => {
        const tf = Math.max(0, tStop - HOLD - 0.05 - 0.07 * ((k + 2) % 4));
        const drop = 20 * tf * tf;
        const out = mul(sub([fl.start[0], 0, fl.start[2]], [ST.center[0], 0, ST.center[2]]), 0.35 * tf * tf);
        FA.set([fl.start[0], fl.start[1] + rig, fl.start[2], fl.n], k * 4);
        FB.set([fl.u[0], fl.u[2], fl.run, fl.rise], k * 4);
        FC.set([fl.width, fl.s0, fl.cn, phi], k * 4);
        FD.set([out[0], -drop, out[2], 0], k * 4);
      });

      // ---- the lit tread: global tread M (it rides the escalator), found on its flight or winder
      const M = Math.floor(m) % ST.N;
      let Sm = M + 0.5 + phi;
      if (Sm >= ST.N) Sm -= ST.N;
      let mk = 0;
      while (mk < 3 && Sm >= ST.flights[mk].s0 + ST.flights[mk].n + ST.flights[mk].cn) mk++;
      const fm = ST.flights[mk];
      const top = (M + 1 + phi - fm.s0) * fm.rise;
      const lsm = Sm - fm.s0;
      const fl0: V = [FA[mk * 4], FA[mk * 4 + 1], FA[mk * 4 + 2]];
      const side: V = [-fm.u[2], 0, fm.u[0]];
      let along: V;
      if (lsm < fm.n) along = mul(fm.u, lsm * fm.run);
      else {
        const th = ((lsm - fm.n) * fm.run) / (fm.width / 2) - Math.PI / 2;
        along = add(add(mul(fm.u, fm.n * fm.run + (fm.width / 2) * Math.cos(th)), mul(side, fm.width / 2 + (fm.width / 2) * Math.sin(th))), [0, 0, 0]);
      }
      const markOn = tStop >= HOLD ? 0 : tStop >= 0 ? 3.0 : 1.6 + 2.4 * notePulse;
      const mpos = add(fl0, add(along, [0, top + 0.1, 0]));

      // bounds of the flights (+ their fall)
      const bmin: V = [1e9, 1e9, 1e9], bmax: V = [-1e9, -1e9, -1e9];
      ST.flights.forEach((fl, k) => {
        const st: V = [FA[k * 4], FA[k * 4 + 1], FA[k * 4 + 2]];
        const off: V = [FD[k * 4], FD[k * 4 + 1], FD[k * 4 + 2]];
        const ext = fl.n * fl.run + fl.width + fl.width;
        for (const sg of [-1, 1]) {
          for (const e of [0, 1]) {
            const p = add(add(st, off), add(mul(fl.u, e * ext - (e ? 0 : fl.width)), mul([-fl.u[2], 0, fl.u[0]], sg * fl.width + (k === 3 && sg > 0 ? 2 * fl.run : 0))));
            for (let i = 0; i < 3; i++) {
              bmin[i] = Math.min(bmin[i], p[i]);
              bmax[i] = Math.max(bmax[i], p[i]);
            }
          }
        }
        bmax[1] = Math.max(bmax[1], st[1] + off[1] + (fl.n + fl.cn + 1) * fl.rise + 0.2);
        bmin[1] = Math.min(bmin[1], -2.5 + off[1]);
      });
      const pad = 0.4;

      taa.begin(f, hdr, cam);
      taa.rigDelta = [0, f.jumped ? 0 : rig - lastRig, 0];
      lastRig = rig;
      if (prog.use()) {
        taa.uniforms(prog);
        setCityLook(prog, look, f.t);
        prog
          .set('uTime', f.t)
          .set('uFrame', f.frame % 1024)
          .set('uWin', 0.18, kick * 0.8, lastIndex(kicks, t) + 1, 0.08)
          .set('uFloor', 3.5, 28.0, 0.36, 0.6)
          .set('uFloorLevels', 19)
          .tex('uText', null, 3) // no signs here; keep the sampler off unit 0 (feedback-loop safety)
          .set('uFA', FA)
          .set('uFB', FB)
          .set('uFC', FC)
          .set('uFD', FD)
          .set('uTower', ST.center[0], ST.center[2], 9.0, 0)
          .set('uKick', kick)
          .set('uMark', M, ST.N, 0, 0)
          .set('uMarkPos', mpos[0], mpos[1], mpos[2], markOn)
          .set('uBoxMin', bmin[0] - pad, bmin[1] - pad, bmin[2] - pad)
          .set('uBoxMax', bmax[0] + pad, bmax[1] + pad, bmax[2] + pad);
        gl.disable(gl.BLEND);
        fullscreen(g);
      }
      taa.resolve(hdr);
    },
  };

  /** local time of the stop hit (D-4 marker at 0A:48) */
  function stopLocal(f: FrameCtx) {
    return onsets(f, 18, grow(0x0a, 32), grow(0x0b), [grow(0x0a, 48)], 'D-4')[0] - (f.t - f.local);
  }
  return scene;
}

function shepFallback(a: number, b: number) {
  const r: number[] = [];
  for (let x = a; x < b; x += 4) r.push(x);
  return r;
}

export default createStairs;
