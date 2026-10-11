// The Machine's memories (S04, S06): six classics of the 90s demoscene rendered into one atlas of
// 320×200 VGA tiles — plasma, rotozoomer, tunnel, glenz vectors, fire, twister. The atlas is
// mip-mapped so the gallery can blur it for glossy reflections and read average colours for light.
// One instance per GL context, shared by the scenes that hang these billboards.

import { type Gfx, type Program, type Target, program, fullscreen, PingPong, bindTarget } from './gl.ts';

export const MEM_W = 320;
export const MEM_H = 200;
/** tile stride in the atlas: 64 px gutters keep mip levels ≤ 5 from bleeding between tiles */
export const MEM_SX = 384;
export const MEM_SY = 264;
export const ATLAS_W = MEM_SX * 3;
export const ATLAS_H = MEM_SY * 2;
export const MEM_NAMES = ['plasma', 'rotozoomer', 'tunnel', 'glenz', 'fire', 'twister'] as const;
export const MEM_TUNNEL = 2;
/** origin (px) of tile i */
export const memOrigin = (i: number): [number, number] => [(i % 3) * MEM_SX + 32, Math.floor(i / 3) * MEM_SY + 32];

const FIRE_RATE = 70; // VGA frames per second
const FIRE_W = MEM_W / 2;
const FIRE_H = MEM_H / 2;

export class Memories {
  g: Gfx;
  prog: Program;
  fireProg: Program;
  tex: WebGLTexture | null = null;
  fb: WebGLFramebuffer | null = null;
  fire = new PingPong({ formats: [] });
  private fireStep = -1;
  private lastT = -1;

  constructor(g: Gfx) {
    this.g = g;
    this.prog = program(g, 'scenes/s04-memories');
    this.fireProg = program(g, 'scenes/s04-fire');
  }

  programs() {
    return [this.prog, this.fireProg];
  }

  init() {
    const gl = this.g.gl;
    if (this.tex) return;
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    const levels = Math.floor(Math.log2(Math.max(ATLAS_W, ATLAS_H))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, ATLAS_W, ATLAS_H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fire.spec = { formats: [gl.R8], filter: gl.NEAREST };
    this.fire.ensure(this.g, FIRE_W, FIRE_H);
  }

  /** advance the fire to time t (fixed 70 Hz steps, so it doesn't depend on the frame rate) */
  private stepFire(t: number, jumped: boolean) {
    const gl = this.g.gl;
    const target = Math.floor(t * FIRE_RATE);
    let from = this.fireStep;
    // the first time: pre-roll 40 steps (flames up); after that a jump or a scene cut just carries on
    // from the live state (a pre-roll at a cut is 40 render passes in one frame)
    if (from < 0) from = target - 40;
    else if (jumped || target < from || target - from > 8) from = target - 1;
    if (target <= from || !this.fireProg.use()) {
      this.fireStep = Math.max(this.fireStep, target);
      return;
    }
    for (let s = from + 1; s <= target; s++) {
      bindTarget(this.g, this.fire.write as Target);
      this.fireProg.tex('prev', this.fire.read.tex[0], 0).set('seed', (s >>> 0) & 0x7fffffff);
      fullscreen(this.g);
      this.fire.swap();
    }
    this.fireStep = target;
  }

  /** render all six tiles for time t (once per distinct t) */
  update(t: number, jumped: boolean, beat = 0) {
    if (!this.tex) this.init();
    if (t === this.lastT && !jumped) return;
    this.lastT = t;
    const gl = this.g.gl;
    gl.disable(gl.BLEND);
    this.stepFire(t, jumped);
    if (!this.prog.use()) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    this.prog.set('t', t).set('beat', beat).tex('fire', this.fire.read.tex[0], 0);
    for (let i = 0; i < 6; i++) {
      const [x, y] = memOrigin(i);
      gl.viewport(x, y, MEM_W, MEM_H);
      this.prog.set('fx', i).set('org', x, y);
      fullscreen(this.g);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

const shared = new WeakMap<Gfx, Memories>();
export function memories(g: Gfx): Memories {
  let m = shared.get(g);
  if (!m) shared.set(g, (m = new Memories(g)));
  return m;
}
