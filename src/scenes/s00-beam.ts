// S00 · Beam (PLAN §4): an XY oscilloscope. The picture is the stereo signal of the ghost channel
// (L = x, R = y): you hear what you see. Every audio sample between two frames is one beam segment.

import type { Gfx } from '../gfx/gl.ts';
import { Beam } from '../gfx/beam.ts';
import type { Scene, FrameCtx } from './types.ts';

const TAU = Math.PI * 2;

export function createBeam(g: Gfx): Scene {
  const beam = new Beam(g);
  let hasGhost: boolean | null = null;
  let lastT = 0;

  // stand-in signal until the ghost voice exists: a Lissajous figure slowly finding its ratio
  const fallback = (t: number) => {
    const f = 55;
    const ratio = 1 + Math.min(1, t / 6) * 0.5;
    const amp = Math.min(1, t / 1.5) * 0.8;
    return [amp * Math.sin(TAU * f * t), amp * Math.sin(TAU * f * ratio * t + t * 0.3)];
  };

  return {
    id: 'S00',
    title: 'Beam',
    post: { bloom: 0.18, bloomRadius: 1.2, vignette: 0.5, grain: 0.03 },
    programs: () => beam.programs(),
    init: () => beam.init(),
    render(f: FrameCtx, hdr) {
      const a = f.audio;
      if (hasGhost === null && a) {
        let m = 0;
        for (let i = 0; i < a.ghostL.length; i += 97) m = Math.max(m, Math.abs(a.ghostL[i]), Math.abs(a.ghostR[i]));
        hasGhost = m > 1e-3;
      }
      const reset = f.jumped || f.t < lastT;
      const sr = a?.sampleRate ?? 48000;
      const t0 = reset ? Math.max(0, f.t - 1 / 60) : lastT;
      let i0 = Math.floor(t0 * sr);
      const i1 = Math.floor(f.t * sr);
      if (i1 - i0 > 32000) i0 = i1 - 32000;
      beam.begin();
      for (let i = i0; i <= i1; i++) {
        if (a && hasGhost) beam.push(a.ghostL[i] ?? 0, a.ghostR[i] ?? 0);
        else {
          const [x, y] = fallback(i / sr);
          beam.push(x, y);
        }
      }
      lastT = f.t;
      beam.render(f.dt, hdr!, f.aspect, reset);
    },
  };
}

export default createBeam;
