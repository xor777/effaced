// Manifest entry (with the optional multi-sample `zones` extension written by
// tools/build-instruments.ts) → XmInstrument with several samples and a keymap.
// Falls back to the single-sample toXmInstrument() when an entry has no zones.

import { type XmInstrument, type XmSample, tuneSample } from '../../music/xm/xm.ts';
import { type ManifestEntry, toXmInstrument } from '../../music/xm/instruments.ts';

export interface ManifestZone {
  file: string;
  rootMidi: number;
  lo: number;
  hi: number;
  /** explicit MIDI keys (overrides lo..hi), e.g. every C for a pitch-class zone */
  keys?: number[];
  loopStart: number;
  loopLength: number;
  loopType: 0 | 1 | 2;
}
export type ZonedEntry = ManifestEntry & { zones?: ManifestZone[] };

/** XM note index 0..95 (C-0 … B-7) ↔ MIDI: C-4 = MIDI 60 = XM note 49 = index 48 */
const midiOfIndex = (i: number) => i + 12;

/**
 * Build an XM instrument from a manifest entry. `load(file)` returns the mono PCM and its rate.
 * XM allows 16 samples per instrument; zones beyond that are rejected.
 */
export function manifestToXmInstrument(e: ZonedEntry, load: (file: string) => { data: Float32Array; sampleRate: number }): XmInstrument {
  if (!e.zones || e.zones.length <= 1) {
    const w = load(e.file);
    return toXmInstrument(e, w.data, w.sampleRate);
  }
  if (e.zones.length > 16) throw new Error(`${e.name}: ${e.zones.length} zones, XM allows 16`);
  const samples: XmSample[] = e.zones.map((z) => {
    const w = load(z.file);
    const { relativeNote, finetune } = tuneSample(w.sampleRate, z.rootMidi);
    return {
      name: z.file.replace(/^.*\//, '').replace(/\.wav$/, '').slice(0, 22),
      data: w.data,
      loopStart: z.loopStart,
      loopLength: z.loopLength,
      loopType: z.loopLength ? z.loopType : 0,
      volume: e.volume ?? 64,
      finetune,
      panning: e.panning ?? 128,
      relativeNote,
    };
  });
  const sampleMap: number[] = [];
  for (let i = 0; i < 96; i++) {
    const m = midiOfIndex(i);
    let zi = e.zones.findIndex((z) => (z.keys ? z.keys.includes(m) : m >= z.lo && m <= z.hi));
    if (zi < 0) {
      // nearest root
      let best = 0;
      e.zones.forEach((z, k) => {
        if (Math.abs(z.rootMidi - m) < Math.abs(e.zones![best].rootMidi - m)) best = k;
      });
      zi = best;
    }
    sampleMap.push(zi);
  }
  return { name: e.name.slice(0, 22), fadeout: e.fadeout ?? 0, volEnv: e.volEnv, samples, sampleMap };
}

/**
 * In-memory version for the Lab: a bank spec + its rendered zones (each with its own sample rate)
 * → XmInstrument, using the same mapping as the manifest path.
 */
export function zonesToXmInstrument(
  spec: { name: string; volume: number; fadeout: number; volEnv?: ManifestEntry['volEnv']; slot: number; id: string },
  zones: { data: Float32Array; rate: number; rootMidi: number; lo: number; hi: number; keys?: number[]; loopStart: number; loopLength: number; loopType: 0 | 1 | 2 }[],
): XmInstrument {
  const files = new Map<string, { data: Float32Array; sampleRate: number }>();
  const mz: ManifestZone[] = zones.map((z, i) => {
    const file = `${spec.id}-${i}`;
    files.set(file, { data: z.data, sampleRate: Math.round(z.rate) });
    return { file, rootMidi: z.rootMidi, lo: z.lo, hi: z.hi, keys: z.keys, loopStart: z.loopStart, loopLength: z.loopLength, loopType: z.loopType };
  });
  const def = mz.reduce((a, b) => (Math.abs(b.rootMidi - 60) < Math.abs(a.rootMidi - 60) ? b : a));
  const entry: ZonedEntry = {
    slot: spec.slot,
    name: spec.name,
    file: def.file,
    rootMidi: def.rootMidi,
    loopStart: def.loopStart,
    loopLength: def.loopLength,
    loopType: def.loopType,
    volume: spec.volume,
    fadeout: spec.fadeout,
    volEnv: spec.volEnv,
    zones: mz,
  };
  return manifestToXmInstrument(entry, (f) => files.get(f)!);
}
