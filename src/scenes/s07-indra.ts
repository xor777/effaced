// S07 · Indra's Pearls (PLAN §4) · 0D:00–0E:63, half-time breakdown, the BEADED chorale on the bell.
//
//  0D:00  the single pearl from S06 — the big disc of a Maskit cusp-like group (a(z) = μ + 1/z,
//         b(z) = z + 2, μ = i·t, Jos Leys' t = 1.95859 + 0.01128 i), seen through a Möbius lens
//  → 0D:40 a logarithmic-spiral zoom out: the pearl is one of infinitely many, generation by
//         generation (the fold depth is revealed in time)
//  bell   each bell pearl (B 0D:16, E 0D:32, A 0D:48) sends light down the generations of one family
//         of pearls; the mirror channel (ch16, +6 rows) lights the other family — the half-turn
//         z ↦ μ − z that swaps them is the "other side"
//  0D:48  the dive back into the big pearl: it fills the screen as a mirror ball …
//  0E:00  … and its reflection unrolls into Indra's net: twelve tangent mirror pearls, the circle of
//         fifths (C at the top). Every bell note lights the pearl of its pitch class, the five
//         black-key pearls stay dark. Light is slow: each reflection arrives 6 rows (0.72 s) later —
//         exactly when the mirror channel answers. In the reflections, somebody in front of a
//         glowing screen: the +1.
//  0E:40  the camera settles on the axis; the room turns into S08's grey, the pearls into its lilac
//         discs at the same places; 0E:52–63 they are erased one per row (in phase with the chaser).
//
// From this scene the frame counter F:0x… ticks in the corner (src/meta/overlay.ts).

import { type Gfx, program, fullscreen } from '../gfx/gl.ts';
import type { Scene, FrameCtx } from './types.ts';
import { smoothstep } from '../timeline/events.ts';
import { ROW, ROWS } from '../timeline/script.ts';
import { frameCounter, tickFrameCounter } from '../meta/overlay.ts';
import { defaults as perceptionDefaults } from '../perception/params.ts';
import { lilacColors } from '../perception/render.ts';
import { CH } from '../music/roster.ts';
import { s06Last } from './s06-escher.ts';

const POS = 0x0d;
const START = POS * ROWS; // global row
const LEN = 2 * ROWS;

// ------------------------------------------------------------------------------------------------
// complex helpers
type C = [number, number];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const sub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const clog = (a: C): C => [Math.log(Math.hypot(a[0], a[1])), Math.atan2(a[1], a[0])];
const cexp = (a: C): C => {
  const e = Math.exp(a[0]);
  return [e * Math.cos(a[1]), e * Math.sin(a[1])];
};
const polar = (r: number, th: number): C => [r * Math.cos(th), r * Math.sin(th)];

/** a view of the w-plane: w = A·q + B, q = pixel offset from the screen centre */
interface View {
  A: C;
  B: C;
}
/** the logarithmic spiral between two views: the similarity view1∘view0⁻¹ raised to the power τ */
function spiral(v0: View, v1: View, tau: number, turns = 0): View {
  const k = div(v1.A, v0.A);
  if (Math.hypot(k[0] - 1, k[1]) < 1e-9) return { A: v0.A, B: add(v0.B, mul([tau, 0], sub(v1.B, v0.B))) };
  const P = div(sub(v1.B, mul(k, v0.B)), [1 - k[0], -k[1]]);
  const lk = clog(k);
  lk[1] += turns * 2 * Math.PI;
  const kt = cexp([lk[0] * tau, lk[1] * tau]);
  return { A: mul(v0.A, kt), B: add(P, mul(kt, sub(v0.B, P))) };
}
/** frame a circle (centre c, radius r in the w-plane) at screen radius `px`, centred at screen offset `at` */
const frame = (c: C, r: number, px: number, rot = 0, at: C = [0, 0]): View => {
  const A = polar(r / px, rot);
  return { A, B: sub(c, mul(A, at)) };
};

// ------------------------------------------------------------------------------------------------
type V3 = [number, number, number];
const v3sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v3norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const v3mix = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/** camera basis with the right axis flipped: we are inside the pearl's reflection, so the world is mirrored */
function mirrorCam(pos: V3, target: V3, upHint: V3): number[] {
  const fwd = v3norm(v3sub(target, pos));
  const right = v3norm(v3cross(fwd, upHint));
  const up = v3cross(right, fwd);
  return [-right[0], -right[1], -right[2], ...up, ...fwd];
}

const ease = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// the bell chorale in this scene (fallback when the track has no notes): row, MIDI
const BELL_FALLBACK: [number, number][] = [
  [16, 71], [32, 76], [48, 69], [64, 74], [80, 76], [88, 74], [96, 72], [112, 69],
];
const MIRROR_ROWS = 6; // ch16 answers each pearl 6 rows later
/** S06's post at its last frame (s06-escher.ts: bloom 0.11 + 0.08, radius 1.15, vignette 0.45, grain 0.04) */
const S06_POST = { bloom: 0.19, bloomRadius: 1.15, vignette: 0.45, grain: 0.04 };
/** S06's last pearl: unit sphere, camera at distance 3.75 + 0.15, tan(half fov) 0.45 → silhouette radius in H */
const S06_PEARL_R = 0.5 / Math.sqrt(3.9 * 3.9 - 1) / 0.45;
const fifthsIndex = (midi: number) => (((midi % 12) * 7) % 12 + 12) % 12; // C=0 G=1 D=2 A=3 E=4 B=5 … F=11

export function createIndra(g: Gfx): Scene {
  const gl = g.gl;
  const prog = program(g, 'scenes/s07-indra');
  let entered = false;

  // the Maskit group (Jos Leys' parameter) and the lens: z = zc + 1/w, ∞ of the screen ↔ zc
  const KT: C = [1.95859103011179, 0.0112785606117658];
  const a = KT[0];
  const zc: C = [0.0, 3.46]; // inside Im z > a: that pearl becomes the outside of the picture

  // S08's geometry and colours (the hand-off must be exact)
  const P8 = perceptionDefaults().lilac;
  const col8 = lilacColors(P8, 'display-p3');

  // necklace: ring radius 1, twelve tangent pearls, in the plane z = H
  const H = 3.1;
  const Rr = 1;
  const rpTangent = Rr * Math.sin(Math.PI / 12);
  const P = new Float32Array(36);
  const NET = new Float32Array(4); // centre xyz, radius
  const E = new Float32Array(24);
  const cas = new Float32Array(16);
  const vis = new Float32Array(12);

  // dev: globalThis.__s07.o = { row, … } pins the scene to a row and overrides parameters
  const dbg: { o: Record<string, number> } = import.meta.env.DEV ? ((globalThis as any).__s07 ??= { o: {} }) : { o: {} };

  let notesFor: FrameCtx['audio'] | undefined = undefined;
  let bellCache: { t: number; midi: number }[] = [];
  let mirCache: number[] = [];
  function bellNotes(f: FrameCtx): { t: number; midi: number }[] {
    const notes = f.audio?.notes?.filter((n) => n.ch === CH.bell && n.grow >= START && n.grow < START + LEN);
    if (notes && notes.length) return notes.map((n) => ({ t: n.t, midi: n.midi }));
    return BELL_FALLBACK.map(([r, m]) => ({ t: (START + r) * ROW, midi: m }));
  }
  function mirrorTimes(f: FrameCtx, bell: { t: number }[]): number[] {
    const notes = f.audio?.notes?.filter((n) => n.ch === CH.stab && n.grow >= START && n.grow < START + LEN + MIRROR_ROWS);
    if (notes && notes.length) return notes.map((n) => n.t);
    return bell.map((b) => b.t + MIRROR_ROWS * ROW);
  }

  return {
    id: 'S07',
    title: "Indra's Pearls",
    // the post starts as S06's (its pearl's glow is that bloom) and eases into S07's own over ~1.7 s; at
    // the end it blends AgX → exact colours (`exact`) to land on S08's picture
    post: (f) => {
      const r = (dbg.o as Record<string, number>).row ?? f.localRow;
      const a = smoothstep(0, 14, r);
      const end = smoothstep(106, 117, r);
      const lerp = (x: number, y: number) => x + (y - x) * a;
      return {
        tonemap: 'agx',
        exact: end,
        exposure: 0,
        bloom: lerp(S06_POST.bloom, 0.12) * (1 - end),
        bloomRadius: lerp(S06_POST.bloomRadius, 1.1),
        vignette: lerp(S06_POST.vignette, 0.3) * (1 - end),
        grain: lerp(S06_POST.grain, 0.03) * (1 - end),
      };
    },
    programs: () => [prog],
    enter() {
      entered = true;
      frameCounter(true);
    },
    leave() {
      entered = false; // the counter keeps ticking into S08/S09 (S09 freezes it)
    },
    render(f: FrameCtx, hdr) {
      if (entered) tickFrameCounter();
      if (!prog.use()) return;
      const o = dbg.o as Record<string, number>;
      const r = o.row ?? f.localRow; // rows since 0D:00
      const t = o.row !== undefined ? (START + o.row) * ROW : f.t;
      const W = hdr!.w, Hh = hdr!.h;
      const halfDiag = 0.5 * Math.hypot(W, Hh);

      // --- under w = 1/(z − zc) the half-plane Im z < 0 becomes the big pearl, Im z > a the outside of
      //     the frame circle; the net fills the lune between them
      const big = { c: [0, 1 / (2 * zc[1])] as C, r: 1 / (2 * zc[1]) };
      const rim = { c: [0, 1 / (2 * (zc[1] - a))] as C, r: 1 / (2 * (zc[1] - a)) };

      // --- 2D camera: the opening pearl, the whole net, the dive back in (logarithmic spirals)
      const vOpen = frame(big.c, big.r, S06_PEARL_R * Hh, 0);
      const vWhole = frame(rim.c, rim.r, 0.47 * Hh, 0.35);
      const vDive = frame(big.c, big.r, 1.04 * halfDiag, 0.9);
      // (the zoom out waits two rows: S06's pearl is still dissolving into this one)
      const v: View = r < 48 ? spiral(vOpen, vWhole, ease(clamp01((r - 2) / 38))) : spiral(vWhole, vDive, Math.pow(clamp01((r - 48) / 16), 1.6));

      const mode = r < 64 ? 0 : 1;
      const unroll = ease(clamp01((r - 64) / 12));

      // --- bell: cascades in 2D, pearl lights in 3D
      // the note lists depend only on the render: pick them once, not every frame (GC hitches)
      if (notesFor !== f.audio) {
        bellCache = bellNotes(f);
        mirCache = mirrorTimes(f, bellCache);
        notesFor = f.audio;
      }
      const bell = bellCache, mir = mirCache;
      const events: { t: number; side: number; amp: number }[] = [];
      bell.forEach((b) => events.push({ t: b.t, side: 0, amp: 1 }));
      mir.forEach((m, i) => events.push({ t: m, side: i % 2 ? 1 : -1, amp: 0.6 })); // ch16 pans left, right, …
      events.sort((x, y) => x.t - y.t);
      const past = events.filter((e) => e.t <= t).slice(-4);
      cas.fill(0);
      const waveK = 1 - smoothstep(57, 63.5, r); // the dive ends on the bare pearl (it continues in 3D)
      past.forEach((e, i) => cas.set([t - e.t, e.side, e.amp * waveK, 0], i * 4));

      E.fill(0);
      for (const b of bell) {
        if (b.t > t) continue;
        const k = fifthsIndex(b.midi);
        E[k * 2] = t - b.t;
        E[k * 2 + 1] = 1;
      }

      // --- the necklace (zig-zag tangent pearls → the Fuchsian circle deforms into a fractal necklace)
      const handoff = smoothstep(100, 116, r);
      const zig = 0.18 * smoothstep(70, 84, r) * (1 - handoff);
      const rpk = rpTangent; // tangent at zig = 0
      const shrink = 1 - (1 - (P8.discRadius / P8.ringRadius) * Rr / rpk) * handoff;
      const rp = Math.hypot(rpk, zig) * shrink;
      for (let k = 0; k < 12; k++) {
        const th = Math.PI / 2 - (k * 2 * Math.PI) / 12;
        P.set([Rr * Math.cos(th), Rr * Math.sin(th), H + (k % 2 ? zig : -zig)], k * 3);
      }
      // a sphere round the whole necklace (with a hair of margin): camera rays that miss it skip the
      // per-pearl tests in the shader
      let reach = 0;
      for (let k = 0; k < 12; k++) reach = Math.max(reach, Math.hypot(P[k * 3], P[k * 3 + 1], P[k * 3 + 2] - H));
      NET[2] = H;
      NET[3] = (reach + rp) * 1.001 + 1e-4;

      // --- 3D camera: from the unrolled pearl (on the axis, looking up the necklace) out around it and back
      const wander = smoothstep(74, 88, r) * (1 - smoothstep(91, 104, r));
      const az = -2.2 + 0.03 * (r - 64);
      const polarAng = 0.85 * wander;
      const dist = H + 0.5 * wander;
      const ringC: V3 = [0, 0, H];
      const camPos: V3 = [
        ringC[0] + dist * Math.sin(polarAng) * Math.cos(az),
        ringC[1] + dist * Math.sin(polarAng) * Math.sin(az),
        ringC[2] - dist * Math.cos(polarAng),
      ];
      const cam = mirrorCam(camPos, ringC, [0, 1, 0]);
      const focal = (0.5 + 0.5 * ease(clamp01((r - 64) / 12))) * Hh * (1 + 0.1 * wander);
      // the +1 sits behind the camera at the widest point of the orbit
      const azM = -2.2 + 0.03 * 28;
      const scrDir = v3norm([Math.sin(0.85) * Math.cos(azM), Math.sin(0.85) * Math.sin(azM), -Math.cos(0.85)]);

      // --- hand-off to S08
      const exact = smoothstep(106, 117, r);
      for (let j = 0; j < 12; j++) vis[j] = r < 116 + j ? 1 : 0;

      gl.disable(gl.BLEND);
      prog
        .set('res', W, Hh)
        .set('kt', KT)
        .set('lens0', [zc[0], zc[1], 1, 0])
        .set('lens1', [1, 0, 0, 0])
        .set('view', [v.A[0], v.A[1], v.B[0], v.B[1]])
        .set('reveal', big.r * 0.9 * Math.exp(-Math.max(0, r - 1) / 4.0))
        .set('pulse', [Math.min(1, (f.S[CH.pluck - 1] ?? 0) * 3), Math.min(1, (f.S[CH.kick - 1] ?? 0) * 2)])
        .set('cas', cas)
        .set('gdelay', ROW * 0.5)
        .set('mode', mode)
        .set('unroll', unroll)
        .set('ballR', 1.04 * halfDiag)
        .set('focal', focal)
        .set('camPos', camPos)
        .set('camRot', cam)
        .set('P', P)
        .set('rp', rp)
        .set('net', NET)
        .set('E', E)
        .set('delay', MIRROR_ROWS * ROW)
        .set('bounces', 8)
        .set('scr', [...scrDir, 2.5])
        .set('room', smoothstep(100, 114, r))
        .set('exact', exact)
        .set('bg8', col8.bg)
        .set('disc8', col8.disc)
        .set('lil', [P8.ringRadius, P8.discRadius, P8.blurSigma, smoothstep(112, 126, r)])
        .set('vis', vis);
      // S06's last frame, if it is the one just before this cue (not a stale copy from a seek)
      const s6 = s06Last();
      const s6ok = s6 && s6.t > START * ROW - 0.35 && s6.t <= START * ROW + 1e-3;
      prog.tex('s06', s6ok ? s6!.tex : null, 0).set('s06k', s6ok ? 1 - smoothstep(0, 5, r) : 0);
      fullscreen(g);
    },
  };
}

export default createIndra;
