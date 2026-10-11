// Post chain: HDR scene target → bloom mip chain → composite (lens, AgX, grain) → screen.
// TAA / DOF / motion blur get added per scene need; this is the always-on part.

import { type Gfx, type Program, type Target, program, createTarget, destroyTarget, bindTarget, fullscreen } from './gl.ts';

export interface PostParams {
  exposure: number; // EV
  bloom: number; // 0..1 mix
  bloomRadius: number;
  vignette: number;
  grain: number;
  ca: number; // px
  /** AgX look: power, saturation, lift (towards white), fade to black */
  look: [number, number, number, number];
  /** 'agx' (default) or 'clip': exact colours, values just clamped — for colour-science scenes */
  tonemap: 'agx' | 'clip';
  /** with tonemap 'agx': blend towards the exact 'clip' output (0..1), for hand-overs between scenes */
  exact?: number;
}

export const defaultPost = (): PostParams => ({
  exposure: 0,
  bloom: 0.06,
  bloomRadius: 1,
  vignette: 0.35,
  grain: 0.035,
  ca: 0,
  look: [1.15, 1.15, 0, 0],
  tonemap: 'agx',
});

const MIPS = 7;

export class Post {
  g: Gfx;
  down: Program;
  up: Program;
  comp: Program;
  mips: Target[] = [];
  /** bloom chains per HDR size: scenes with different render scales don't reallocate at the cut */
  private chains = new Map<string, Target[]>();

  constructor(g: Gfx) {
    this.g = g;
    this.down = program(g, 'post/bloom-down');
    this.up = program(g, 'post/bloom-up');
    this.comp = program(g, 'post/composite');
  }

  programs() {
    return [this.down, this.up, this.comp];
  }

  /** Run bloom on `hdr` and composite to the screen (or to `out`). */
  run(hdr: Target, p: PostParams, time: number, out: Target | null = null) {
    const g = this.g;
    const gl = g.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // bloom chain
    const key = `${hdr.w}x${hdr.h}`;
    let chain = this.chains.get(key);
    if (!chain) {
      chain = [];
      let w = hdr.w, h = hdr.h;
      for (let i = 0; i < MIPS; i++) {
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
        chain.push(createTarget(g, w, h, { formats: [gl.R11F_G11F_B10F] }));
      }
      this.chains.set(key, chain);
      // a window resize leaves old sizes behind: keep the few most recent
      for (const [k, c] of this.chains) {
        if (this.chains.size <= 4) break;
        c.forEach((t) => destroyTarget(g, t));
        this.chains.delete(k);
      }
    }
    this.mips = chain;
    if (p.bloom > 0 && this.down.use()) {
      let src = hdr;
      for (let i = 0; i < MIPS; i++) {
        const dst = this.mips[i]!;
        bindTarget(g, dst);
        this.down.tex('src', src.tex[0], 0).set('texel', 1 / src.w, 1 / src.h).set('first', i === 0 ? 1 : 0);
        fullscreen(g);
        src = dst;
      }
      if (this.up.use()) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        for (let i = MIPS - 1; i > 0; i--) {
          const src = this.mips[i]!, dst = this.mips[i - 1]!;
          bindTarget(g, dst);
          this.up.tex('src', src.tex[0], 0).set('texel', 1 / src.w, 1 / src.h).set('radius', p.bloomRadius);
          fullscreen(g);
        }
        gl.disable(gl.BLEND);
      }
    }

    // composite
    bindTarget(g, out);
    if (!this.comp.use()) return;
    const ow = out ? out.w : gl.drawingBufferWidth, oh = out ? out.h : gl.drawingBufferHeight;
    this.comp
      .tex('hdr', hdr.tex[0], 0)
      .tex('bloom', this.mips[0]!.tex[0], 1)
      .set('res', ow, oh)
      .set('exposure', p.exposure)
      .set('bloomAmt', p.bloom > 0 ? p.bloom : 0)
      // the up-chain sums MIPS levels; normalise so `bloom` reads as a mix amount
      .set('bloomNorm', 1 / MIPS)
      .set('vignette', p.vignette)
      .set('grain', p.grain)
      .set('ca', p.ca)
      .set('time', time)
      .set('look', p.look)
      .set('exact', p.tonemap === 'clip' ? 1 : Math.min(1, Math.max(0, p.exact ?? 0)));
    fullscreen(g);
  }
}
