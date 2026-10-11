import type { Gfx, Program, Target } from '../gfx/gl.ts';
import type { PostParams } from '../gfx/post.ts';
import type { RenderResult } from '../audio/types.ts';


/** Everything a scene needs to know about "now". All times come from the audio clock. */
export interface FrameCtx {
  /** song time, seconds */
  t: number;
  /** seconds since the previous frame (0 when paused; may be negative after a seek) */
  dt: number;
  /** fractional global row = t / ROW */
  row: number;
  /** order position (integer) and fractional row within its pattern */
  pos: number;
  prow: number;
  /** time / rows since the scene's cue started, and the cue length in seconds */
  local: number;
  localRow: number;
  len: number;
  /** 0..1 progress through the cue */
  k: number;
  /** per-channel envelopes at `t`, S[ch - 1] for tracker channel ch (1..18), roughly 0..1 */
  S: Float32Array;
  /** markers of channel 18 that fired since the previous frame (note: 'C-4' look, 'D-4' hit, 'E-4' mode, 'F-4' motif) */
  M: { t: number; row: number; note: string }[];
  audio: RenderResult | null;
  /** output size in device pixels and its aspect */
  w: number;
  h: number;
  aspect: number;
  frame: number;
  /** true when the clock jumped (seek) — feedback buffers should reset */
  jumped: boolean;
}

export interface Scene {
  id: string;
  title: string;
  /** programs compiled during loading */
  programs(): Program[];
  /** allocate GPU resources once programs exist (may be called again after a context resize) */
  init?(): void;
  /**
   * Draw the frame. With post enabled, `hdr` is a linear HDR RGBA16F target sized w*scale × h*scale
   * (already bound, viewport set). With post disabled, `hdr` is null and the scene draws
   * display-encoded colours straight to the screen — used where colours must be exact (illusions).
   */
  render(f: FrameCtx, hdr: Target | null): void;
  /** post settings for this scene; `false` = no post at all (exact colours) */
  post?: Partial<PostParams> | false | ((f: FrameCtx) => Partial<PostParams> | false);
  /** internal render scale for the HDR target (heavy raymarch scenes < 1) */
  scale?: number;
  /** 60 = draw every second vsync on the 120 Hz panel (scenes that can't fit ~7 ms) */
  fps?: 60 | 120;
  /**
   * S09: "the render really stops". Return true to skip ALL GPU work this frame — the canvas keeps
   * showing the last presented frame while the music (and DOM) go on.
   */
  freeze?(f: FrameCtx): boolean;
  /** DOM hooks */
  enter?(f: FrameCtx): void;
  leave?(): void;
}

export type SceneFactory = (g: Gfx) => Scene;
