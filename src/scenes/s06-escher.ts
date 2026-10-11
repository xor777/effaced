// S06 · Escher Gallery (PLAN §4, 0B:00–0C:63): the theme returns and we fly into the tunnel memory
// of the S04 gallery. The tunnel is log-polar, so flying through it is already the Droste map: its
// far end opens onto the city, the city's window shows the gallery, whose screen shows the tunnel…
// 256× per turn, like Escher's "Print Gallery" (de Smit & Lenstra). The twist α ramps in to make
// it Escher's spiral; in the last bars the plane curls onto the Riemann sphere — a pearl (S07) —
// while the music winds down to the one held 'ooh'.

import { type Gfx, type Target, program, fullscreen, bindTarget, ensureTarget } from '../gfx/gl.ts';
import { memories, MEM_TUNNEL } from '../gfx/billboards.ts';
import { gallery, HALL, memZ, type View } from './s04-gallery.ts';
import type { Scene, FrameCtx } from './types.ts';
import { smoothstep } from '../timeline/events.ts';

/** a float render target with a full mip chain (the Droste reads its levels at every scale) */
function mipTarget(g: Gfx, w: number, h: number): Target {
  const gl = g.gl;
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA16F, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex: [tex], depth: null, w, h, spec: { formats: [gl.RGBA16F] } };
}
function mipmap(g: Gfx, t: Target) {
  g.gl.bindTexture(g.gl.TEXTURE_2D, t.tex[0]);
  g.gl.generateMipmap(g.gl.TEXTURE_2D);
}

// the gallery level: square on to the tunnel memory from 4.5 m; the wall spans ±2.4 m vertically
// (so the 1.2 m screen is a quarter of the picture's height: G coordinates y ∈ [-1, 1])
const G_W = 2560, G_H = 1600;
const C_W = 2400, C_H = 1800;
const G_VIEW: View = {
  eye: [HALL.HW - 4.5, HALL.MEM_Y, memZ(MEM_TUNNEL)],
  right: [0, 0, 1],
  up: [0, 1, 0],
  fwd: [1, 0, 0],
  tanH: 2.4 / 4.5,
};

// zoom speed (log-magnification per second) through the cue; logF = ∫ speed
const BAR = 1.92;
const SPEED: [number, number][] = [
  [0, 0], // 0B:00 the gallery, the crash
  [BAR, 1.55], // into the screen
  [2 * BAR, 1.2], // through the tunnel, the city, the gallery again
  [4 * BAR, 0.95], // 0C:00 Escher's spiral
  [6 * BAR, 1.05],
  [6.6 * BAR, 2.3], // 0C:32 the spiral winds down…
  [7 * BAR, 1.2], // 0C:48 …into a pearl; the held note
  [8 * BAR, 0.25],
];
function logZoom(τ: number): number {
  let s = 0;
  for (let i = 0; i + 1 < SPEED.length; i++) {
    const [t0, v0] = SPEED[i], [t1, v1] = SPEED[i + 1];
    if (τ <= t0) break;
    const e = Math.min(τ, t1);
    const ve = v0 + ((v1 - v0) * (e - t0)) / (t1 - t0);
    s += ((v0 + ve) / 2) * (e - t0);
  }
  return s;
}

/** For S07, which opens on this pearl: a copy of S06's HDR output over its last 0.3 s (the last copy
 *  is the last frame) and that frame's song time; S07 dissolves from it into its own pearl. */
let lastFrame: { tex: WebGLTexture; t: number } | null = null;
export const s06Last = () => lastFrame;

const PEARL_T0 = 6 * BAR; // 0C:32
const PEARL_D0 = 1.02; // camera distance when the sphere still looks like the plane
const PEARL_D1 = 3.75; // …and at the end: the sphere is ~0.6 of the half-height, like S07's first pearl
const PEARL_TAN = 0.45; // must match s06-droste.glsl
const ST_SCALE = 2 / (PEARL_TAN * (PEARL_D0 - 1));

export function createEscher(g: Gfx): Scene {
  const gl = g.gl;
  const mem = memories(g);
  const gal = gallery(g);
  const city = program(g, 'scenes/s06-city');
  const droste = program(g, 'scenes/s06-droste');
  let gT: Target | null = null;
  let cT: Target | null = null;
  let cityDone = false;
  let snap: Target | null = null;
  let snapWarm = false;

  return {
    id: 'S06',
    title: 'Escher Gallery',
    post: (f: FrameCtx) => ({
      bloom: 0.11 + 0.08 * smoothstep(PEARL_T0, PEARL_T0 + 2 * BAR, f.local),
      bloomRadius: 1.15,
      vignette: 0.45,
      grain: 0.04,
      exposure: 0.25 * (f.S[15] ?? 0), // the orchestra hits
    }),
    programs: () => [...mem.programs(), ...gal.programs(), city, droste],
    init() {
      mem.init();
      gal.init();
      gT ??= mipTarget(g, G_W, G_H);
      cT ??= mipTarget(g, C_W, C_H);
    },
    render(f: FrameCtx, hdr: Target | null) {
      const τ = f.local;
      const kick = f.S[0] ?? 0;
      mem.update(f.t, f.jumped, kick);

      // the city level is static: render it once (dev: again after a seek — not at a cut — for shader edits)
      if ((!cityDone || (import.meta.env.DEV && f.jumped && f.dt === 0)) && city.use()) {
        bindTarget(g, cT);
        city.set('res', C_W, C_H);
        fullscreen(g);
        mipmap(g, cT!);
        cityDone = true;
      }
      // the gallery level is alive (the memories play): every frame
      const o = { t: f.t, expo: 1, kick, hole: MEM_TUNNEL, hudGL: 1 };
      gal.relight(o);
      gal.draw(G_VIEW, gT!, o);
      mipmap(g, gT!);

      const logF = logZoom(τ);
      const pk = smoothstep(PEARL_T0, 8 * BAR, τ);
      // pull back from the surface until the pearl is the size S07's first sphere has
      const pull = smoothstep(PEARL_T0, 7 * BAR + 0.8, τ);
      bindTarget(g, hdr);
      if (!droste.use()) return;
      droste
        .tex('gTex', gT!.tex[0], 0)
        .tex('cTex', cT!.tex[0], 1)
        .set('res', hdr!.w, hdr!.h)
        .set('logF', logF)
        .set('twist', smoothstep(2 * BAR, 4 * BAR, τ))
        .set('depth', f.t * 0.3)
        .set('vgaK', 1 - smoothstep(Math.log(4), Math.log(16), logF))
        .set('screenGain', 2.4 * (1 + 0.12 * kick))
        .set('pearl', τ < PEARL_T0 ? 0 : 0.001 + 2 * pk)
        .set('camD', PEARL_D0 + (PEARL_D1 - PEARL_D0) * pull ** 2.2 + 0.15 * smoothstep(7 * BAR, 8 * BAR, τ))
        .set('stScale', ST_SCALE)
        .set('imageK', 1 - 0.75 * smoothstep(7 * BAR, 8 * BAR, τ))
        .set('t', f.t);
      fullscreen(g);
      // the hand-off to S07: copy the last frames out (once on the first, loader warm-up frame too, so
      // the blit's pipeline exists before the show)
      if (hdr && (τ >= 8 * BAR - 0.3 || !snapWarm)) {
        snap = ensureTarget(g, snap, hdr.w, hdr.h, { formats: [gl.RGBA16F] });
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hdr.fb);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, snap.fb);
        gl.blitFramebuffer(0, 0, hdr.w, hdr.h, 0, 0, hdr.w, hdr.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        bindTarget(g, hdr);
        lastFrame = { tex: snap.tex[0], t: f.t };
        snapWarm = true;
      }
    },
  };
}

export default createEscher;
