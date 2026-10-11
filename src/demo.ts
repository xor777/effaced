// The demo runtime: owns the GL context, post chain, scenes and the frame loop.
// Everything is driven by the audio clock (timeline/clock.ts).

import { type Gfx, type Target, createGfx, compileAll, createTarget, destroyTarget, bindTarget } from './gfx/gl.ts';
import { Post, defaultPost, type PostParams } from './gfx/post.ts';
import type { Scene, FrameCtx } from './scenes/types.ts';
import { createScenes } from './scenes/index.ts';
import { SCRIPT, cueAt, cueStart, cueEnd, ROW, ROWS } from './timeline/script.ts';
import type { Clock } from './timeline/clock.ts';
import type { RenderResult } from './audio/types.ts';
import { frameCounter } from './meta/overlay.ts';

export interface DemoOptions {
  /** output height in device pixels, 0 = native */
  height: number;
  /** render-scale multiplier for heavy scenes */
  quality: number;
}

const CHANNELS = 18;
const ENV_RATE = 60;

export class Demo {
  g: Gfx;
  post: Post;
  scenes: Map<string, Scene>;
  clock: Clock;
  audio: RenderResult | null = null;
  opts: DemoOptions;
  hdr: Target | null = null;
  cur = -1;
  frame = 0;
  lastT = 0;
  S = new Float32Array(CHANNELS);
  /** dev: force one scene regardless of time */
  solo: string | null = null;
  onFrame: ((f: FrameCtx, ms: number) => void) | null = null;
  private raf = 0;
  private lastFrame = 0;

  constructor(canvas: HTMLCanvasElement, clock: Clock, opts: DemoOptions) {
    this.g = createGfx(canvas);
    this.post = new Post(this.g);
    this.scenes = createScenes(this.g);
    this.clock = clock;
    this.opts = opts;
  }

  async compile(onProgress?: (done: number, total: number) => void) {
    const progs = [...this.post.programs(), ...[...this.scenes.values()].flatMap((s) => s.programs())];
    const uniq = [...new Set(progs)];
    const t0 = performance.now();
    await compileAll(this.g, uniq, onProgress);
    const failed = uniq.filter((p) => p.error);
    console.log(`[gfx] ${uniq.length} programs in ${(performance.now() - t0).toFixed(0)} ms${failed.length ? `, ${failed.length} FAILED` : ''}`);
    for (const s of this.scenes.values()) s.init?.();
  }

  /**
   * Draw every scene once (with its post chain) so ANGLE/Metal builds the real pipeline states now,
   * not at the scene cut: the first draw of a program costs 20–70 ms on the M4 (techcheck), more
   * for new target formats/blend states. One scene per tick keeps the loader animating.
   */
  async warmup(onProgress?: (done: number, total: number) => void) {
    const gl = this.g.gl;
    this.resize();
    const ids = [...new Set(SCRIPT.map((c) => c.scene))];
    const px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < ids.length; i++) {
      const ci = SCRIPT.findIndex((c) => c.scene === ids[i]);
      const cue = SCRIPT[ci];
      const start = cueStart(cue), end = cueEnd(cue, ci);
      this.renderAt(ci, (start + end) / 2, true, 0, true);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // a real sync point (gl.finish isn't)
      onProgress?.(i + 1, ids.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    console.log(`[gfx] pipeline warm-up ${ids.length} scenes in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  resize() {
    const c = this.g.canvas;
    const dpr = devicePixelRatio || 1;
    const cssW = c.clientWidth, cssH = c.clientHeight;
    let w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (this.opts.height && this.opts.height < h) {
      w = Math.round((w * this.opts.height) / h);
      h = this.opts.height;
    }
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }

  private envAt(t: number) {
    const a = this.audio;
    if (!a) return this.S.fill(0);
    const i = Math.max(0, Math.floor(t * ENV_RATE));
    for (let ch = 0; ch < CHANNELS; ch++) {
      const e = a.env[ch];
      this.S[ch] = e ? (e[Math.min(i, e.length - 1)] ?? 0) : 0;
    }
    return this.S;
  }

  private markers(t0: number, t1: number): FrameCtx['M'] {
    const list = (this.audio as unknown as { markers?: FrameCtx['M'] })?.markers;
    if (!list || t1 <= t0) return [];
    return list.filter((m) => m.t > t0 && m.t <= t1);
  }

  /** render one frame at the clock's current time */
  tick() {
    const t0p = performance.now();
    const gl = this.g.gl;
    this.resize();
    const t = Math.max(0, this.clock.time());
    const jumped = this.clock.jumped;
    this.clock.jumped = false;
    const dt = jumped ? 0 : t - this.lastT;

    let ci = cueAt(t);
    if (this.solo) {
      const si = SCRIPT.findIndex((c) => c.scene === this.solo);
      if (si >= 0) ci = si;
    }
    const f = this.renderAt(ci, t, jumped, dt);
    this.lastT = t;
    this.onFrame?.(f, performance.now() - t0p);
  }

  /** build the frame context for cue `ci` at time `t` and draw it (scene + post) */
  /** `warm`: pipeline warm-up draw — no enter/leave hooks, no cue switch */
  renderAt(ci: number, t: number, jumped: boolean, dt = 0, warm = false): FrameCtx {
    const gl = this.g.gl;
    const cue = SCRIPT[ci];
    const scene = this.scenes.get(cue.scene)!;
    const start = cueStart(cue), end = cueEnd(cue, ci);
    const row = t / ROW;
    const f: FrameCtx = {
      t,
      dt,
      row,
      pos: Math.floor(row / ROWS),
      prow: row % ROWS,
      local: t - start,
      localRow: (t - start) / ROW,
      len: end - start,
      k: Math.min(1, Math.max(0, (t - start) / (end - start))),
      S: this.envAt(t),
      M: jumped ? [] : this.markers(this.lastT, t),
      audio: this.audio,
      w: gl.drawingBufferWidth,
      h: gl.drawingBufferHeight,
      aspect: gl.drawingBufferWidth / gl.drawingBufferHeight,
      frame: this.frame++,
      jumped: jumped || ci !== this.cur,
    };
    if (ci !== this.cur && !warm) {
      if (this.cur >= 0) this.scenes.get(SCRIPT[this.cur].scene)?.leave?.();
      // the F:0x counter lives in S07–S09 only (a seek out of that range must not leave it on screen)
      if (!/^S0[789]$/.test(SCRIPT[ci].scene)) frameCounter(false);
      scene.enter?.(f);
      this.cur = ci;
    }

    if (!warm && scene.freeze?.(f)) return f; // nothing drawn → the browser keeps the last frame
    const postCfg = typeof scene.post === 'function' ? scene.post(f) : scene.post;
    if (postCfg === false) {
      bindTarget(this.g, null);
      scene.render(f, null);
    } else {
      const scale = (scene.scale ?? 1) * (scene.scale !== undefined && scene.scale < 1 ? this.opts.quality : 1);
      this.hdr = this.hdrFor(f.w * scale, f.h * scale);
      bindTarget(this.g, this.hdr);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      scene.render(f, this.hdr);
      const p: PostParams = { ...defaultPost(), ...(postCfg ?? {}) };
      this.post.run(this.hdr, p, t);
    }
    return f;
  }

  /** HDR targets per size: a cut between scenes with different render scales must not reallocate
   *  (+ the bloom chain) on the cut frame; the loader's warm-up creates every size the show needs */
  private hdrs = new Map<string, Target>();
  private hdrFor(w: number, h: number): Target {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const key = `${w}x${h}`;
    let t = this.hdrs.get(key);
    if (!t) {
      t = createTarget(this.g, w, h, { formats: [this.g.gl.RGBA16F] });
      this.hdrs.set(key, t);
      for (const [k, old] of this.hdrs) {
        if (this.hdrs.size <= 4) break;
        destroyTarget(this.g, old);
        this.hdrs.delete(k);
      }
    }
    return t;
  }

  start() {
    let n = 0;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      // heavy scenes lock to 60 Hz instead of oscillating between 120 and 60 (techcheck §G)
      const cue = this.cur >= 0 ? SCRIPT[this.cur] : null;
      const sc = cue ? this.scenes.get(cue.scene) : null;
      const interval = 1000 / 120.5;
      if (sc?.fps === 60 && this.lastFrame && now - this.lastFrame < interval * 1.5) return;
      this.lastFrame = now;
      n++;
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }
}
