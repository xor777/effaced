// Instrument manifest: how generated samples (music/instruments/*.wav, built by
// tools/build-instruments.ts) become XM instruments. Shared by tools/build-xm.ts and the preview.

import { type XmInstrument, type XmEnvelope, tuneSample } from './xm.ts';
import { INS } from '../roster.ts';

export interface ManifestEntry {
  slot: number; // 1-based instrument slot (MUSIC_BRIEF §9)
  name: string; // working name (the release script writes the diary into slots 01–16)
  file: string; // wav path relative to the manifest
  rootMidi: number; // pitch of the sample at its natural rate (MIDI, C-4 = 60)
  loopStart?: number; // samples
  loopLength?: number; // samples; 0/absent = one-shot
  loopType?: 0 | 1 | 2;
  volume?: number; // 0..64, default 64
  panning?: number; // 0..255, default 128
  fadeout?: number; // XM fadeout 0..0xfff
  volEnv?: XmEnvelope;
  /** semitone offsets of the tones in a chord sample, e.g. [0, 4, 7] — for the white-key check */
  chordTones?: number[];
  /** unpitched percussion: exempt from the white-key rule */
  unpitched?: boolean;
  /** engine-side FX sends 0..1 (the tracker plays dry) */
  sends?: { reverb?: number; delay?: number; chorus?: number };
}

export interface Manifest {
  sampleRate?: number;
  instruments: ManifestEntry[];
}

export function toXmInstrument(e: ManifestEntry, data: Float32Array, sampleRate: number): XmInstrument {
  const { relativeNote, finetune } = tuneSample(sampleRate, e.rootMidi);
  return {
    name: e.name.slice(0, 22),
    fadeout: e.fadeout ?? 0,
    volEnv: e.volEnv,
    samples: [
      {
        name: e.file.replace(/^.*\//, '').slice(0, 22),
        data,
        loopStart: e.loopStart ?? 0,
        loopLength: e.loopLength ?? 0,
        loopType: e.loopLength ? (e.loopType ?? 1) : 0,
        volume: e.volume ?? 64,
        finetune,
        panning: e.panning ?? 128,
        relativeNote,
      },
    ],
  };
}

/** the silent marker instrument (slot 7F): a name and no samples */
export const markerInstrument = (): XmInstrument => ({ name: '~marker', samples: [], fadeout: 0 });

/**
 * Crude stand-ins so the score → XM → render loop works before the real instrument set exists.
 * Every slot gets a recognisable waveform at 44.1 kHz, root C-4.
 */
export function placeholderInstruments(): Manifest & { data: Map<number, Float32Array> } {
  const sr = 44100;
  const data = new Map<number, Float32Array>();
  const instruments: ManifestEntry[] = [];
  const f0 = sr / 169; // ≈ C-4, an integer period so loops are seamless
  const tone = (len: number, fn: (t: number, i: number) => number) => {
    const a = new Float32Array(Math.round(len * sr));
    for (let i = 0; i < a.length; i++) a[i] = fn(i / sr, i);
    return a;
  };
  let seed = 0xeffaced;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const saw = (t: number, f: number) => 2 * ((t * f) % 1) - 1;
  // periods of f0 that fit a loop cleanly
  const loopLen = Math.round(sr / f0) * 100;
  const add = (slot: number, name: string, a: Float32Array, extra: Partial<ManifestEntry> = {}) => {
    data.set(slot, a);
    instruments.push({ slot, name, file: `placeholder-${slot}`, rootMidi: 60, volume: 48, ...extra });
  };
  const sustained = (fn: (t: number) => number) => tone(loopLen / sr, fn);
  const loop = { loopStart: 0, loopLength: loopLen, loopType: 1 as const, fadeout: 0x200 };
  add(INS.aah, 'aah (placeholder)', sustained((t) => 0.4 * (Math.sin(2 * Math.PI * f0 * t) + 0.3 * Math.sin(4 * Math.PI * f0 * t))), loop);
  add(INS.ooh, 'ooh (placeholder)', sustained((t) => 0.5 * Math.sin(2 * Math.PI * f0 * t)), loop);
  add(INS.strings, 'strings (placeholder)', sustained((t) => 0.3 * saw(t, f0)), loop);
  add(INS.pad, 'pad (placeholder)', sustained((t) => 0.3 * (saw(t, f0) + saw(t, f0 * 1.0)) * 0.5), loop);
  add(INS.brass, 'brass (placeholder)', sustained((t) => 0.35 * saw(t, f0)), loop);
  add(INS.lead, 'lead (placeholder)', sustained((t) => 0.3 * Math.sign(Math.sin(2 * Math.PI * f0 * t))), loop);
  add(INS.bell, 'bell (placeholder)', tone(2.5, (t) => 0.6 * Math.exp(-t * 1.6) * Math.sin(2 * Math.PI * f0 * t + 2 * Math.exp(-t * 3) * Math.sin(2 * Math.PI * f0 * 3.5 * t))));
  add(INS.epiano, 'epiano (placeholder)', tone(1.8, (t) => 0.6 * Math.exp(-t * 2.5) * Math.sin(2 * Math.PI * f0 * t + Math.exp(-t * 8) * Math.sin(2 * Math.PI * f0 * 14 * t))));
  add(INS.harp, 'harp (placeholder)', tone(1.5, (t) => 0.6 * Math.exp(-t * 3) * saw(t, f0) * 0.6));
  add(INS.bass, 'bass (placeholder)', sustained((t) => 0.5 * saw(t, f0)), { ...loop, fadeout: 0x800 });
  add(INS.sub, 'sub (placeholder)', sustained((t) => 0.7 * Math.sin(2 * Math.PI * f0 * t)), { ...loop, fadeout: 0x800 });
  add(INS.kick, 'kick (placeholder)', tone(0.4, (t) => 0.9 * Math.exp(-t * 9) * Math.sin(2 * Math.PI * (45 * t + (105 / 25) * (1 - Math.exp(-t * 25))))), { unpitched: true });
  add(INS.snare, 'snare (placeholder)', tone(0.3, (t) => Math.exp(-t * 14) * (0.5 * rnd() + 0.4 * Math.sin(2 * Math.PI * 180 * t))), { unpitched: true });
  add(INS.hats, 'hats (placeholder)', tone(0.15, (t) => 0.4 * Math.exp(-t * 40) * rnd()), { unpitched: true });
  add(INS.timpani, 'timpani (placeholder)', tone(2, (t) => 0.7 * Math.exp(-t * 2) * Math.sin(2 * Math.PI * f0 * t)));
  add(INS.orchhit, 'orchhit (placeholder)', tone(0.8, (t) => 0.5 * Math.exp(-t * 5) * (saw(t, f0) + saw(t, f0 * 1.5) + saw(t, f0 * 2)) / 3));
  add(INS.shepard, 'shepard (placeholder)', sustained((t) => 0.3 * [1, 2, 4, 8].reduce((s, k) => s + Math.sin(2 * Math.PI * f0 * k * t) / k, 0)), loop);
  add(INS.scope, 'scope (placeholder)', sustained((t) => 0.6 * Math.sin(2 * Math.PI * f0 * t)), loop);
  return { sampleRate: sr, instruments, data };
}
