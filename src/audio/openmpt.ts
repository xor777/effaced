// libopenmpt (WASM build from npm `chiptune3`) for OFFLINE rendering — Node, workers and the
// browser main thread. Thin typed wrapper over the libopenmpt C API (+ the "interactive" ext
// interface for channel / instrument muting).
//
//   const mpt = await loadOpenMPT();
//   const m = mpt.open(xmBytes);           // OpenMPTModule
//   m.setRender({ interpolation: 8 });
//   m.read(L, R, 48000)                    // frames rendered (0 = song end)
//   m.destroy();

import factory from 'chiptune3/libopenmpt.worklet.js';

type Fn = (...a: number[]) => number;
interface Emscripten {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _malloc(n: number): number;
  _free(p: number): void;
  UTF8ToString(p: number): string;
  [k: `_openmpt_${string}`]: Fn;
}

// libopenmpt.h
export const RENDER = { MASTERGAIN_MILLIBEL: 1, STEREOSEPARATION_PERCENT: 2, INTERPOLATIONFILTER_LENGTH: 3, VOLUMERAMPING_STRENGTH: 4 } as const;
const COMMAND = { NOTE: 0, INSTRUMENT: 1, VOLUMEEFFECT: 2, EFFECT: 3, VOLUME: 4, PARAMETER: 5 } as const;

/** Interpolation filter taps: 1 = none (zero-order hold), 2 = linear, 4 = cubic, 8 = windowed sinc (libopenmpt default). */
export type Interpolation = 0 | 1 | 2 | 4 | 8;

export interface RenderSettings {
  interpolation?: Interpolation;
  /** -1 = libopenmpt default, 0 = off, 1..10 */
  volumeRamping?: number;
  stereoSeparation?: number; // percent 0..200 (default 100)
  gainMb?: number; // master gain, millibel
}

let loading: Promise<OpenMPT> | null = null;
let compiled: WebAssembly.Module | null = null;

/** the compiled libopenmpt wasm of this thread (post it to other workers: loadOpenMPT(module)) */
export const compiledOpenMPT = () => compiled;

/**
 * Load (once per thread) the libopenmpt WASM runtime. ~30 ms in Node. Pass a WebAssembly.Module
 * compiled by another thread to skip compiling (structured-cloneable to workers).
 */
export function loadOpenMPT(shared?: WebAssembly.Module): Promise<OpenMPT> {
  return (loading ??= (async () => {
    // The build compiles and instantiates synchronously (new WebAssembly.Module / Instance) and
    // does not export its function table, which we need to call the ext-interface function
    // pointers. Capture module + instance; reuse a shared module if given.
    const W = WebAssembly as unknown as { Instance: unknown; Module: unknown };
    const OrigInstance = WebAssembly.Instance, OrigModule = WebAssembly.Module;
    let inst: WebAssembly.Instance | null = null;
    W.Instance = function (m: WebAssembly.Module, i: WebAssembly.Imports) {
      compiled = m;
      inst = new OrigInstance(m, i);
      return inst;
    };
    if (shared) W.Module = function () {
      return shared;
    };
    let lib: Emscripten;
    try {
      lib = (await factory({ print: () => {}, printErr: () => {} })) as Emscripten;
    } finally {
      W.Instance = OrigInstance;
      W.Module = OrigModule;
    }
    const exp = (inst as WebAssembly.Instance | null)?.exports ?? {};
    const table = Object.values(exp).find((v) => v instanceof WebAssembly.Table) as WebAssembly.Table | undefined;
    if (!table) throw new Error('libopenmpt: function table not found');
    return new OpenMPT(lib, table);
  })());
}

export class OpenMPT {
  readonly lib: Emscripten;
  readonly table: WebAssembly.Table;
  constructor(lib: Emscripten, table: WebAssembly.Table) {
    this.lib = lib;
    this.table = table;
  }
  get version(): string {
    return this.withStr('library_version', (p) => this.takeString(this.lib._openmpt_get_string(p)));
  }
  /** C string on the heap for the duration of fn */
  withStr<T>(s: string, fn: (p: number) => T): T {
    const L = this.lib;
    const p = L._malloc(s.length + 1);
    for (let i = 0; i < s.length; i++) L.HEAPU8[p + i] = s.charCodeAt(i) & 0xff;
    L.HEAPU8[p + s.length] = 0;
    try {
      return fn(p);
    } finally {
      L._free(p);
    }
  }
  /** read and free a libopenmpt-allocated string */
  takeString(p: number): string {
    if (!p) return '';
    const s = this.lib.UTF8ToString(p);
    this.lib._openmpt_free_string(p);
    return s;
  }
  open(bytes: Uint8Array, ctls: Record<string, string> = {}): OpenMPTModule {
    return new OpenMPTModule(this, bytes, ctls);
  }
}

/** Function pointers of openmpt_module_ext_interface_interactive (16 × wasm32 pointers). */
const IFACE_INTERACTIVE = [
  'set_current_speed',
  'set_current_tempo',
  'set_tempo_factor',
  'get_tempo_factor',
  'set_pitch_factor',
  'get_pitch_factor',
  'set_global_volume',
  'get_global_volume',
  'set_channel_volume',
  'get_channel_volume',
  'set_channel_mute_status',
  'get_channel_mute_status',
  'set_instrument_mute_status',
  'get_instrument_mute_status',
  'play_note',
  'stop_note',
] as const;
type Interactive = Record<(typeof IFACE_INTERACTIVE)[number], (...a: number[]) => number>;

export interface PatternCell {
  /** libopenmpt internal note: 0 none, 1..120 (C-0..B-9, XM C-4 = 49), 253 fade, 254 cut, 255 key off */
  note: number;
  ins: number;
  volcmd: number;
  vol: number;
  /** libopenmpt internal effect command (not the XM number — use `text` for display) */
  fx: number;
  param: number;
}

export class OpenMPTModule {
  readonly mpt: OpenMPT;
  readonly ext: number;
  readonly mod: number;
  private ia: Interactive;
  private bufL = 0;
  private bufR = 0;
  private bufN = 0;

  constructor(mpt: OpenMPT, bytes: Uint8Array, ctls: Record<string, string>) {
    this.mpt = mpt;
    const L = mpt.lib;
    const data = L._malloc(bytes.length);
    L.HEAPU8.set(bytes, data);
    // initial ctls: array of {const char* ctl; const char* value;} terminated by {0,0}
    const keys = Object.keys(ctls);
    const strs: number[] = [];
    const cstr = (s: string) => {
      const p = L._malloc(s.length + 1);
      for (let i = 0; i < s.length; i++) L.HEAPU8[p + i] = s.charCodeAt(i) & 0xff;
      L.HEAPU8[p + s.length] = 0;
      strs.push(p);
      return p;
    };
    const ctlArr = L._malloc(8 * (keys.length + 1));
    const u32 = () => new Uint32Array(L.HEAPU8.buffer);
    keys.forEach((k, i) => {
      const a = cstr(k), b = cstr(ctls[k]);
      u32()[(ctlArr >> 2) + 2 * i] = a;
      u32()[(ctlArr >> 2) + 2 * i + 1] = b;
    });
    u32()[(ctlArr >> 2) + 2 * keys.length] = 0;
    u32()[(ctlArr >> 2) + 2 * keys.length + 1] = 0;
    const errPtr = L._malloc(8);
    u32()[errPtr >> 2] = 0;
    u32()[(errPtr >> 2) + 1] = 0;
    this.ext = L._openmpt_module_ext_create_from_memory(data, bytes.length, 0, 0, 0, 0, errPtr, errPtr + 4, ctlArr);
    const errMsg = u32()[(errPtr >> 2) + 1];
    const msg = errMsg ? L.UTF8ToString(errMsg) : '';
    if (errMsg) L._openmpt_free_string(errMsg);
    L._free(errPtr);
    L._free(ctlArr);
    for (const p of strs) L._free(p);
    L._free(data);
    if (!this.ext) throw new Error(`libopenmpt: cannot open module${msg ? ': ' + msg : ''}`);
    this.mod = L._openmpt_module_ext_get_module(this.ext);
    // interactive interface → JS functions via the captured table
    const size = IFACE_INTERACTIVE.length * 4;
    const s = L._malloc(size);
    const ok = mpt.withStr('interactive', (id) => L._openmpt_module_ext_get_interface(this.ext, id, s, size));
    if (!ok) throw new Error('libopenmpt: no interactive interface');
    const view = new Uint32Array(L.HEAPU8.buffer, s, IFACE_INTERACTIVE.length);
    const ia = {} as Interactive;
    IFACE_INTERACTIVE.forEach((name, i) => {
      const f = mpt.table.get(view[i]) as (...a: number[]) => number;
      ia[name] = (...a: number[]) => f(this.ext, ...a);
    });
    L._free(s);
    this.ia = ia;
    L._openmpt_module_set_repeat_count(this.mod, 0);
  }

  destroy(): void {
    const L = this.mpt.lib;
    if (this.bufL) L._free(this.bufL);
    if (this.bufR) L._free(this.bufR);
    this.bufL = this.bufR = this.bufN = 0;
    L._openmpt_module_ext_destroy(this.ext);
  }

  setRender(s: RenderSettings): void {
    const f = this.mpt.lib._openmpt_module_set_render_param;
    if (s.interpolation !== undefined) f(this.mod, RENDER.INTERPOLATIONFILTER_LENGTH, s.interpolation);
    if (s.volumeRamping !== undefined) f(this.mod, RENDER.VOLUMERAMPING_STRENGTH, s.volumeRamping);
    if (s.stereoSeparation !== undefined) f(this.mod, RENDER.STEREOSEPARATION_PERCENT, s.stereoSeparation);
    if (s.gainMb !== undefined) f(this.mod, RENDER.MASTERGAIN_MILLIBEL, s.gainMb);
  }
  ctl(key: string, value: string): void {
    this.mpt.withStr(key, (k) => this.mpt.withStr(value, (v) => this.mpt.lib._openmpt_module_ctl_set_text(this.mod, k, v)));
  }

  /** Render n frames (n ≤ out length) at sampleRate into l/r (offset off). Returns frames rendered; 0 at song end. */
  read(l: Float32Array, r: Float32Array, sampleRate: number, n = l.length, off = 0): number {
    const L = this.mpt.lib;
    if (n > this.bufN) {
      if (this.bufL) L._free(this.bufL), L._free(this.bufR);
      this.bufN = Math.max(n, 4096);
      this.bufL = L._malloc(this.bufN * 4);
      this.bufR = L._malloc(this.bufN * 4);
    }
    const got = L._openmpt_module_read_float_stereo(this.mod, sampleRate, n, this.bufL, this.bufR);
    const H = L.HEAPF32;
    l.set(H.subarray(this.bufL >> 2, (this.bufL >> 2) + got), off);
    r.set(H.subarray(this.bufR >> 2, (this.bufR >> 2) + got), off);
    return got;
  }

  // --- interactive (ext) ---------------------------------------------------------------------
  /** channel 0-based */
  setChannelMute(ch: number, mute: boolean): void {
    this.ia.set_channel_mute_status(ch, mute ? 1 : 0);
  }
  /** instrument 0-based (XM instrument 1 = 0) */
  setInstrumentMute(ins: number, mute: boolean): void {
    this.ia.set_instrument_mute_status(ins, mute ? 1 : 0);
  }
  setChannelVolume(ch: number, v: number): void {
    this.ia.set_channel_volume(ch, v);
  }
  /** Play an instrument note on a free channel (for auditioning). instrument 0-based, note = libopenmpt note (XM C-4 → 49). Returns the channel. */
  playNote(ins: number, note: number, volume = 1, pan = 0): number {
    return this.ia.play_note(ins, note, volume, pan);
  }
  stopNote(ch: number): void {
    this.ia.stop_note(ch);
  }

  // --- info ----------------------------------------------------------------------------------
  get numChannels(): number {
    return this.mpt.lib._openmpt_module_get_num_channels(this.mod);
  }
  get numOrders(): number {
    return this.mpt.lib._openmpt_module_get_num_orders(this.mod);
  }
  get numPatterns(): number {
    return this.mpt.lib._openmpt_module_get_num_patterns(this.mod);
  }
  get numInstruments(): number {
    return this.mpt.lib._openmpt_module_get_num_instruments(this.mod);
  }
  get numSamples(): number {
    return this.mpt.lib._openmpt_module_get_num_samples(this.mod);
  }
  get duration(): number {
    return this.mpt.lib._openmpt_module_get_duration_seconds(this.mod);
  }
  get positionSeconds(): number {
    return this.mpt.lib._openmpt_module_get_position_seconds(this.mod);
  }
  get order(): number {
    return this.mpt.lib._openmpt_module_get_current_order(this.mod);
  }
  get row(): number {
    return this.mpt.lib._openmpt_module_get_current_row(this.mod);
  }
  /** channel VU (0..1, libopenmpt's meter of the last rendered block) */
  vu(ch: number): number {
    return this.mpt.lib._openmpt_module_get_current_channel_vu_mono(this.mod, ch);
  }
  vuLR(ch: number): [number, number] {
    const L = this.mpt.lib;
    return [L._openmpt_module_get_current_channel_vu_left(this.mod, ch), L._openmpt_module_get_current_channel_vu_right(this.mod, ch)];
  }
  orderPattern(o: number): number {
    return this.mpt.lib._openmpt_module_get_order_pattern(this.mod, o);
  }
  patternRows(p: number): number {
    return this.mpt.lib._openmpt_module_get_pattern_num_rows(this.mod, p);
  }
  timeAt(order: number, row: number): number {
    return this.mpt.lib._openmpt_module_get_time_at_position(this.mod, order, row);
  }
  cell(p: number, row: number, ch: number): PatternCell {
    const f = this.mpt.lib._openmpt_module_get_pattern_row_channel_command;
    const m = this.mod;
    return {
      note: f(m, p, row, ch, COMMAND.NOTE),
      ins: f(m, p, row, ch, COMMAND.INSTRUMENT),
      volcmd: f(m, p, row, ch, COMMAND.VOLUMEEFFECT),
      vol: f(m, p, row, ch, COMMAND.VOLUME),
      fx: f(m, p, row, ch, COMMAND.EFFECT),
      param: f(m, p, row, ch, COMMAND.PARAMETER),
    };
  }
  /** OpenMPT's own text for a cell, e.g. "C-5 01 v64 047" (width 0 = natural) */
  cellText(p: number, row: number, ch: number, width = 0, pad = true): string {
    return this.mpt.takeString(this.mpt.lib._openmpt_module_format_pattern_row_channel(this.mod, p, row, ch, width, pad ? 1 : 0));
  }
  /** text of one column: 0 note, 1 instrument, 2 volume effect, 3 effect, 4 volume, 5 parameter */
  columnText(p: number, row: number, ch: number, command: number): string {
    return this.mpt.takeString(this.mpt.lib._openmpt_module_format_pattern_row_channel_command(this.mod, p, row, ch, command));
  }
  instrumentName(i: number): string {
    return this.mpt.takeString(this.mpt.lib._openmpt_module_get_instrument_name(this.mod, i));
  }
  sampleName(i: number): string {
    return this.mpt.takeString(this.mpt.lib._openmpt_module_get_sample_name(this.mod, i));
  }
  channelName(i: number): string {
    return this.mpt.takeString(this.mpt.lib._openmpt_module_get_channel_name(this.mod, i));
  }
  metadata(key: string): string {
    return this.mpt.withStr(key, (k) => this.mpt.takeString(this.mpt.lib._openmpt_module_get_metadata(this.mod, k)));
  }
}
