// Contract between the audio engine (src/audio/*) and the demo (visuals, HUD, sync).
// Pure data, no DOM — used in the browser, workers and Node.
//
// The music is an .xm (MUSIC_BRIEF.md): 18 channels — 1–16 music, 17 the ghost, 18 silent
// markers — rendered offline by libopenmpt (src/audio/openmpt.ts) per channel, then mixed
// through the engine FX bus (src/audio/fx.ts, src/audio/mixer.ts).
// Timing is tracker-classic: speed 6 / BPM 125 → 1 tick = 0.02 s, 1 row = 0.12 s,
// 1 pattern = 64 rows = 7.68 s. Channel numbers in this file are 1-based like in the tracker.

export const BPM = 125;
export const SPEED = 6; // ticks per row
export const TICK = 2.5 / BPM; // 0.02 s
export const ROW = TICK * SPEED; // 0.12 s
export const ROWS = 64; // rows per pattern
export const CHANNELS = 18; // 16 music + ghost + markers
export const GHOST_CH = 17;
export const MARKER_CH = 18;
/** envelope frames per second */
export const ENV_RATE = 60;

/** Playback "device" of the setup screen (PLAN §6.3, MUSIC_BRIEF §12). */
export type Device = 'webaudio' | 'gus' | 'sb16';

/** What the engine hands to the demo after the precalc. */
export interface RenderResult {
  /**
   * Sample rate of every buffer below. Equals the requested rate for 'webaudio'; the 'gus'
   * (38.6 kHz, linear interpolation) and 'sb16' (22.05 kHz, no interpolation) devices render at
   * their native rate — create the AudioBuffer with this rate and let Web Audio resample.
   * ('gus' = 38600 Hz: multiples of 50 Hz keep libopenmpt's ticks whole, so events never drift.)
   */
  sampleRate: number;
  /** final stereo mix (FX, compressor, limiter: true peak ≤ −1 dBTP) */
  left: Float32Array;
  right: Float32Array;
  /**
   * The ghost's XY oscilloscope signal (channel 17, "scope" notes): L = x, R = y in [-1, 1],
   * normalized so the loudest scope moment fills ±0.9. Synthesized by the engine from the
   * channel-17 notes; the beam draws exactly what plays (quietly) in the mix.
   */
  ghostL: Float32Array;
  ghostR: Float32Array;
  /**
   * Per-channel RMS envelopes at ENV_RATE Hz, env[ch - 1][frame], ≈ 0..1 (a full-scale sine on
   * its own reads 1). 18 entries; env[17] (markers) is all zeros. Measured on the dry channel
   * stems before the engine's channel processing.
   */
  env: Float32Array[];
  /** every note-on in song order (key-offs excluded; retriggers are not expanded) */
  notes: NoteEvent[];
  /** channel-18 markers (MUSIC_BRIEF §11) */
  markers: Marker[];
  /** pattern data and names for the tracker HUD */
  track: TrackInfo;
}

export interface NoteEvent {
  /** absolute time in seconds (includes EDx note delay) */
  t: number;
  /** order position 0..31 */
  pos: number;
  /** row inside the pattern 0..63 */
  row: number;
  /** global row = pos * 64 + row */
  grow: number;
  /** tracker channel 1..18 */
  ch: number;
  /** XM note 1..96 (C-4 = 49) */
  note: number;
  /** MIDI note (C-4 = 60) */
  midi: number;
  /** note name as the tracker shows it, e.g. "C-4" */
  name: string;
  /** XM instrument 1..128 (0 = none given, the channel's previous one plays) */
  ins: number;
  /** volume column 0..64, or -1 when the note uses the instrument's default volume */
  vol: number;
}

export interface Marker {
  t: number;
  /** global row = pos * 64 + row */
  row: number;
  /** "C-4" look · "D-4" hit · "E-4" mode · "F-4" motif */
  note: string;
}

/** Pattern data for the HUD. Cells are XM-native (see src/music/xm/xm.ts XmCell). */
export interface TrackInfo {
  title: string;
  channels: number;
  /** pattern index per order position */
  order: number[];
  /** per pattern: rows × channels cells, row-major: [row * channels + ch0] */
  patterns: { rows: number; cells: TrackCell[] }[];
  /** instrument names (index 0 = instrument 1) — the diary in slots 01–16 */
  instruments: string[];
  /** seconds per order position start (length order.length + 1, last = song end) */
  posTime: number[];
  /** song length without the tail */
  duration: number;
  /** tail rendered after the song end */
  tail: number;
}

export interface TrackCell {
  note: number; // 0 none, 1..96, 97 key off
  ins: number;
  vol: number; // XM volume-column byte
  fx: number; // XM effect number 0..35
  param: number;
}

export interface RenderOptions {
  device?: Device;
  /** seconds of tail after the last position (default 12, MUSIC_BRIEF §4) */
  tail?: number;
  /** override FX settings (see src/audio/fx.ts FX_DEFAULTS) */
  fx?: Partial<import('./fx.ts').FxSettings>;
  /** sends per instrument slot (default: the bank's sends, src/audio/synth/bank.ts) */
  sends?: Record<number, { reverb?: number; delay?: number; chorus?: number }>;
  /** engine channel pan −1..1 per tracker channel (default CHANNEL_PAN in engine-core.ts: ch10 +0.3, ch11 −0.45) */
  pan?: Record<number, number>;
  /** number of render workers (browser), default hardwareConcurrency − 1 */
  workers?: number;
}

// ---------------------------------------------------------------------------------------------
// LEGACY: the first prototype's own song format (custom replayer). Superseded by XM + libopenmpt;
// kept only so older imports keep type-checking. Do not use for new code.

/** @deprecated */
export const OFF = -1;
/** @deprecated */
export const GHOST = 16;
/** @deprecated use src/music/xm/xm.ts XmCell */
export interface Cell {
  n?: number;
  i?: number;
  v?: number;
  fx?: string;
  p?: number;
}
/** @deprecated */
export type Pattern = (Cell | null)[][];
/** @deprecated */
export interface ChannelDef {
  name: string;
  pan: number;
  gain: number;
  reverb: number;
  delay: number;
}
/** @deprecated */
export interface InstrumentDef {
  name: string;
  kind: string;
  vol: number;
  params: Record<string, number>;
}
/** @deprecated use an .xm file */
export interface Song {
  title: string;
  channels: ChannelDef[];
  instruments: InstrumentDef[];
  patterns: Pattern[];
  order: number[];
  tail: number;
}
