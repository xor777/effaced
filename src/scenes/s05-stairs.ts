// S05 · Staircase · 09–0A (PLAN §4). A Penrose staircase on a tower of the facade city, seen from
// the "magic" viewpoint, while the strings and choir climb a Shepard scale that never arrives.
//
// The staircase is a real 3D object built by forced perspective: four straight flights around a
// square, every flight a little smaller than the one before, and the last landing placed exactly on
// the view ray of the first step (S5 = E + μ(S1 − E)). Every camera on the line through S1 and S5 sees
// a closed loop, so the camera may ride that line.
//
// It is drawn to read as stairs at a glance: few, big, steep steps (27 round the loop), light treads,
// a dark stringer band under the sawtooth of every side face, ink at the nosings — and a single file
// of twelve small figures (architectural-model people) climbing it, Escher's "Ascending and
// Descending": one step per Shepard note, all in step, round and round and never down.
//
//   09:00  one bar of plain camera: a push along the magic line, the city big behind the tower
//   09:16  the vertigo: the stairs climb (the tower grows under them, its windows stream down) while
//          the camera dollies in and zooms out on the magic line — the stairs hold still in the frame
//          and the city rushes away. It moves in lurches on the kicks and accelerates into the snare
//          roll of 0A bar 3. The walkers climb a tread per note; the first one's tread is lit (the
//          creature's step) and the light climbs round with it. The treads can also slide up like an
//          escalator (dev knob `esc`, treads per note; the walkers ride it), off by default: under
//          walking figures a moving stair reads as sliding, not climbing.
//   0A:48  the stop hit: a white frame, a hard cut off the magic line (the loop is open), three rows
//          of stillness, then the flights fall (the walkers with them) and a 90° turn shows the city
//          edge-on — paper.
//
// Dev knobs (globalThis.__s05.o = { … }, live): walkers (count, 12) · wh (figure height in risers, 4.4)
// · step (s, 0.66) · walk (treads per step, 1) · esc (escalator treads per note, 0) · size (world
// height framed at the stairs, 16) · inkpx / ink / band (line width px, strength, stringer band in
// risers) · yaw (deg: swing the camera off the magic line to see the real, open loop).

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
  // dev knobs (see the header): globalThis.__s05.o = { walkers, wh, step, walk, esc, size, … }
  const dbg: { o: Record<string, number> } = import.meta.env.DEV ? ((globalThis as any).__s05 ??= { o: {} }) : { o: {} };
  const knob = (k: string, v: number) => dbg.o[k] ?? v;
  // Few, big, steep steps: 3 + 3 treads on the far flights, the near ones as long as the closure needs
  // (≈ 9 each), 27 treads round the loop. Rise/run ≈ 0.35, so the risers and the sawtooth of the side
  // faces read from the magic elevation.
  const SOLVE = { theta: 0.85, D: 60, n01: [3, 3] as [number, number], run: 1.3, rise: 0.45, width: 1.6 };
  const solve = (o: V) => penroseStairs(o, SOLVE.theta, SOLVE.D, [...SOLVE.n01], SOLVE.run, SOLVE.rise, SOLVE.width);
  // the tower stands on cell (0, 4) of the city (its centre at x 1.0, z 27.8); the loop's first step at 21 units
  const st0 = solve([0, 0, 0]);
  const ORIGIN: V = [1.03 - st0.center[0], 21.0, 27.8 - st0.center[2]];
  const ST = solve(ORIGIN);
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
  // the drawing of the stairs: light treads, darker risers, a dark stringer band under the sawtooth
  // of the side faces, ink at every nosing; the walkers in one flat colour
  const TREAD = hexP3('#f6eee8', 0.86), RISER = hexP3('#decade', 0.36), STRINGER = hexP3('#a88aa6', 0.36);
  const INK = hexP3('#3a2840', 1);
  const WALKER = hexP3('#5a3f5e', 0.55);
  const FA = new Float32Array(16), FB = new Float32Array(16), FC = new Float32Array(16), FD = new Float32Array(16);
  const MAXW = 16;
  const WB = new Float32Array(4 * MAXW), WL = new Float32Array(4 * MAXW), WR = new Float32Array(4 * MAXW), WC = new Float32Array(4 * MAXW);
  const WS = new Float32Array(4 * MAXW), WALL = new Float32Array(4); // bounding spheres: each walker, all of them
  const D_PLAIN = 88, D_LOCK = 66, D_END = 17; // camera distance along the seam line
  const RISE = 70; // climb scale: ≈ 1300 units above the city by the stop
  let lastStop = -1;
  let lastRig = 0;
  let cNear = ST.mu;

  // ---- the loop as a path: global tread coordinate S → a point on the centre line of the treads
  const FL = ST.flights;
  const lam = FL.map((f) => f.rise / FL[0].rise);
  /** flight of global coordinate S (S may run past the seam: ≥ N stays on the last flight's run-on, < 0 on the first) */
  const flightOf = (S: number) => {
    let k = 0;
    while (k < 3 && S >= FL[k + 1].s0) k++;
    return k;
  };
  /** world xz of the centre line at S on flight k (straight part → winder arc → straight on beyond) and the direction */
  function place(k: number, S: number): { p: V; d: [number, number] } {
    const fl = FL[k];
    const ls = S - fl.s0;
    const u = fl.u, side: V = [-u[2], 0, u[0]];
    const R = fl.width / 2;
    if (ls < fl.n) return { p: add(fl.start, mul(u, ls * fl.run)), d: [u[0], u[2]] };
    if (ls < fl.n + fl.cn) {
      const th = ((ls - fl.n) * fl.run) / R - Math.PI / 2;
      const c = Math.cos(th), s = Math.sin(th);
      return {
        p: add(fl.start, add(mul(u, fl.n * fl.run + R * c), mul(side, R + R * s))),
        d: [-s * u[0] + c * side[0], -s * u[2] + c * side[2]],
      };
    }
    return { p: add(fl.start, add(mul(u, fl.n * fl.run + R), mul(side, R + (ls - fl.n - fl.cn) * fl.run))), d: [side[0], side[2]] };
  }
  /** top of the tread whose front edge is at S (flight-local ramp, extrapolated past the ends) */
  const ramp = (k: number, S: number) => FL[k].start[1] + (S - FL[k].s0) * FL[k].rise;
  /** size of the steps at S: the flight's own scale, turning to the next one through the winder corner;
   *  past the seam it is the size that matches the far start of the loop as seen from the camera */
  function scaleAt(k: number, S: number) {
    const fl = FL[k];
    const ls = S - fl.s0;
    const l1 = k < 3 ? lam[k + 1] : cNear;
    if (ls <= fl.n) return lam[k];
    if (ls >= fl.n + fl.cn) return l1;
    return lam[k] * (l1 / lam[k]) ** ((ls - fl.n) / fl.cn);
  }
  const smooth = (a: number, b: number, x: number) => ease((x - a) / (b - a));
  const sat01 = (x: number) => Math.min(1, Math.max(0, x));

  /**
   * The walkers: a single file, one step per Shepard note. Walker i stands on physical tread
   * b_i + (notes so far) of the moving frame (tread j spans S ∈ [j + m, j + 1 + m]; m is the escalator,
   * 0 unless the `esc` knob moves it). The whole walker is drawn in one copy of the seam: near (the
   * last flight's run-on) while its trailing foot is still on the first tread, far once it has left it
   * — the same hand-over at a riser the treads use, so it passes the seam unbroken and never descends.
   * Its size follows the steps under it; past the seam it is the size that matches the far start as
   * seen from the camera.
   */
  function walkers(nw: number, steps: number, p: number, walk: number, m: number, rig: number) {
    const N = ST.N;
    const phi = m - Math.floor(m);
    // A step climbs one tread in three movements, like a slow procession on deep steps: one foot
    // paces forward on the tread, the other goes up the riser, the first joins it. Foot positions in
    // treads from the back edge of the start tread; at rest both feet stand just past the nosing.
    const REST = 0.35, MID = REST + 0.45 * walk, UP = REST + walk;
    // foot A: REST → MID (a pace on the tread), then MID → UP (up the riser); foot B: REST → UP
    const a1 = p < 0.5;
    const xa0 = a1 ? REST : MID, xa1 = a1 ? MID : UP;
    const xa = xa0 + (xa1 - xa0) * (a1 ? smooth(0, 0.35, p) : smooth(0.6, 0.95, p));
    const xb = REST + (UP - REST) * smooth(0.25, 0.7, p);
    const la = a1 ? 0.35 * Math.sin(Math.PI * sat01(p / 0.35)) : Math.sin(Math.PI * sat01((p - 0.6) / 0.35));
    const lb = Math.sin(Math.PI * sat01((p - 0.25) / 0.45));
    const H = knob('wh', 4.4) * FL[0].rise; // figure height in risers of the first flight
    for (let i = 0; i < nw; i++) {
      const j0 = Math.round(1 + (i * N) / nw) + walk * steps; // physical tread at the start of this step
      const aLeft = (i + steps) % 2 === 0; // which foot paces first
      const xL = aLeft ? xa : xb, xR = aLeft ? xb : xa;
      // anchor: the trailing foot; the whole walker is drawn near (+N) while it is on the first tread
      const xT = Math.min(xL, xR);
      let A = j0 + xT + m;
      A -= Math.floor(A / N) * N;
      const shift = A < 1 + phi ? N : 0;
      const at = (x: number) => A + (x - xT) + shift; // S of tread position x in the chosen copy
      const xBody = 0.5 * (xL + xR);
      const Sb = at(xBody);
      const kb = shift ? 3 : flightOf(Sb);
      const body = place(kb, Sb);
      const s = H * scaleAt(kb, Sb);
      const ell = 0.5 * s; // leg length = hip height at rest
      const off: V = [FD[kb * 4], FD[kb * 4 + 1] + rig, FD[kb * 4 + 2]];
      const side: V = [-body.d[1], 0, body.d[0]];
      const fwd: V = [body.d[0], 0, body.d[1]];
      // a foot at x stands on the top of its tread (the tread whose back edge is at floor(x));
      // moving over a nosing it lifts clear of it
      const top = (x: number) => ramp(kb, at(Math.floor(x)) + 1);
      const foot = (x: number, x0: number, x1: number, lift: number, sgn: number) => {
        const q = place(kb, at(x));
        const k = x1 > x0 + 1e-6 ? (x - x0) / (x1 - x0) : 1;
        const y = top(x0) + (top(x1) - top(x0)) * smooth(0, 0.45, k) + 0.4 * FL[kb].rise * lift;
        return add(add([q.p[0], y, q.p[2]], mul(side, sgn * 0.075 * s)), off);
      };
      const fa = (sgn: number) => foot(xa, xa0, xa1, la, sgn), fb = (sgn: number) => foot(xb, REST, UP, lb, sgn);
      const fL = aLeft ? fa(1) : fb(1);
      const fR = aLeft ? fb(-1) : fa(-1);
      // the hip: as high as the legs reach (≤ 4 % stretch), never above its height at rest
      const bxz: V = [body.p[0] + off[0], 0, body.p[2] + off[2]];
      let hipY = 0.5 * (fL[1] + fR[1]) + ell;
      for (const f of [fL, fR]) {
        const d = Math.hypot(f[0] - bxz[0], f[2] - bxz[2]);
        hipY = Math.min(hipY, f[1] + Math.sqrt(Math.max((1.04 * ell) ** 2 - d * d, 0.5 * ell * ell)));
      }
      const B: V = [bxz[0], hipY - ell, bxz[2]];
      const lean = 0.05 + 0.12 * Math.sin(Math.PI * p);
      const hip = add(B, [0, ell, 0]);
      const chest = add(hip, add([0, 0.24 * s, 0], mul(fwd, lean * 0.24 * s)));
      WB.set([B[0], B[1], B[2], s], i * 4);
      WL.set([fL[0], fL[1], fL[2], 0], i * 4);
      WR.set([fR[0], fR[1], fR[2], 0], i * 4);
      WC.set([chest[0], chest[1], chest[2], lean], i * 4);
      const c = add(B, [0, 0.5 * s, 0]);
      WS.set([c[0], c[1], c[2], Math.max(0.6 * s, len(sub(fL, c)), len(sub(fR, c))) + 0.1 * s], i * 4);
    }
    // one sphere round them all (a box's circumsphere)
    const lo: V = [1e9, 1e9, 1e9], hi: V = [-1e9, -1e9, -1e9];
    for (let i = 0; i < nw; i++)
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], WS[i * 4 + a] - WS[i * 4 + 3]);
        hi[a] = Math.max(hi[a], WS[i * 4 + a] + WS[i * 4 + 3]);
      }
    const mid = mul(add(lo, hi), 0.5);
    WALL.set([mid[0], mid[1], mid[2], nw ? 0.5 * len(sub(hi, lo)) : 0]);
  }

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
      // ---- music: Shepard (ch15) one note every 8 rows, galop kicks, backbeat + the roll of 0A bar 3, the stop
      const shep = onsets(f, 15, g0, gStop, shepFallback(g0, gStop)).map((x) => x - (f.t - t));
      const kicks = onsets(f, 1, g0, g2).map((x) => x - (f.t - t));
      const snares = onsets(f, 2, g0, gStop).map((x) => x - (f.t - t));
      const tStopL = stopLocal(f);
      const tStop = t - tStopL; // < 0 before the hit
      const tt = Math.min(t, tStopL - 1e-3); // time frozen at the hit
      const kick = tStop < 0 ? pulse(kicks, t, 0.14) : 0;
      const snare = tStop < 0 ? pulse(snares, t, 0.1) : 0;
      const si = lastIndex(shep, tt);
      // the step of this note: 0 → 1 over STEP seconds from the note-on
      const STEP = knob('step', 0.66);
      const pStep = si < 0 ? 1 : Math.min(1, (tt - shep[si]) / STEP);
      const steps = Math.max(0, si);
      // the light flares as the first walker lands on its next tread
      const notePulse = tStop < 0 ? pulse(shep.map((x) => x + 0.7 * STEP), t, 0.25) : 0;
      // the escalator: ESC treads per Shepard note, moving with the walkers' step; a lit tread rides it
      const ESC = knob('esc', 0);
      const m = ESC * (si < 0 ? 0 : si + smooth(0.12, 0.88, pStep));
      const phi = m - Math.floor(m);

      // ---- the climb: one plain bar, then the vertigo in lurches on the kicks (and the roll)
      const tV = T(grow(0x09, 16));
      const u = lurch([...kicks, ...snares.filter((x) => x >= T(grow(0x0a, 32)))].sort((a, b) => a - b), tt, tV, tStopL);
      // the height above the city grows ×1.65 per bar: the city visibly halves, bar after bar
      const H = tt < tV ? 0 : RISE * (1.65 ** (6 * u) - 1);
      const lift: V = [0, H, 0];
      const S5 = add(ST.S5, lift), center = add(ST.center, lift);
      const SIZE = knob('size', 16); // world height the frame holds at the stairs
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
      // the walkers past the seam are drawn near: the size that matches the far start from here
      if (tStop < 0) cNear = len(sub(pos, S5)) / len(sub(pos, add(ST.S1, lift)));

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
      if (dbg.o.yaw) {
        const a = dbg.o.yaw * (Math.PI / 180), c = Math.cos(a), s = Math.sin(a);
        const r = sub(pos, target);
        pos = add(target, [r[0] * c - r[2] * s, r[1], r[0] * s + r[2] * c]);
      }
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
      const nw = Math.min(MAXW, Math.round(knob('walkers', 12)));
      const walk = knob('walk', 1);
      walkers(nw, steps, pStep, walk, m, rig);


      // ---- the lit tread (the creature's step): the tread the first walker stands on — it lights up
      // as the walker lands on it, so the light climbs round and round with the file (with no walkers
      // it rides the escalator); the near copy at the seam
      const j0 = nw > 0 ? 1 + walk * (steps + (pStep >= 0.7 ? 1 : 0)) : 0;
      const M = (((j0 + Math.floor(m)) % ST.N) + ST.N) % ST.N;
      let Sm = M + 0.5 + phi;
      if (Sm >= ST.N) Sm -= ST.N;
      const near = Sm < 1 + phi;
      const mk = near ? 3 : flightOf(Sm);
      const Sw = near ? Sm + ST.N : Sm;
      const mp = place(mk, Sw).p;
      const markOn = tStop >= HOLD ? 0 : tStop >= 0 ? 3.0 : 1.6 + 2.4 * notePulse;
      const mpos: V = [mp[0] + FD[mk * 4], ramp(mk, Sw + 0.5) + 0.1 + rig + FD[mk * 4 + 1], mp[2] + FD[mk * 4 + 2]];

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
          .set('uBoxMax', bmax[0] + pad, bmax[1] + pad, bmax[2] + pad)
          .set('uWN', nw)
          .set('uWB', WB)
          .set('uWL', WL)
          .set('uWR', WR)
          .set('uWC', WC)
          .set('uWS', WS)
          .set('uWAll', WALL)
          .set('uTreadAlb', ...TREAD)
          .set('uRiserAlb', ...RISER)
          .set('uStringer', ...STRINGER)
          .set('uWalkCol', ...WALKER)
          .set('uInkCol', ...INK)
          .set('uInk', knob('inkpx', 1.1), knob('ink', 0.7), knob('band', 0.45), 0);
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
  for (let x = a; x < b; x += 8) r.push(x);
  return r;
}

export default createStairs;
