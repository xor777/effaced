// Timeline events from the music: markers of channel 18 and note-ons, with fallbacks so scenes
// work before the real track exists.

import type { RenderResult } from '../audio/types.ts';
import { ROW } from './script.ts';

interface Marker {
  t: number;
  row: number;
  note: string;
}

/**
 * Times (s) of markers `note` (e.g. 'F-4') between global rows [from, to). If the track has none,
 * `fallbackRows` (global rows) are used instead.
 */
export function markerTimes(audio: RenderResult | null, note: string, from: number, to: number, fallbackRows: number[]): number[] {
  const list = (audio as unknown as { markers?: Marker[] })?.markers;
  const hits = list?.filter((m) => m.note === note && m.row >= from && m.row < to).map((m) => m.t) ?? [];
  return hits.length ? hits : fallbackRows.map((r) => r * ROW);
}

/** 0 before `t0`, then an attack/decay envelope: rises over `a` s, decays with time constant `d` (∞ = stays) */
export function hit(t: number, t0: number, a = 0.05, d = Infinity): number {
  if (t < t0) return 0;
  const x = t - t0;
  const up = Math.min(1, x / a);
  return d === Infinity ? up : up * Math.exp(-Math.max(0, x - a) / d);
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
