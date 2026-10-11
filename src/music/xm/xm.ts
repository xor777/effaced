// FastTracker 2 .xm data model, writer and reader (pure TS: runs in Node, workers and the browser).
// Spec: "The XM module format description for XM files version $0104" (Mr.H / Triton), plus the
// usual FT2/MilkyTracker/OpenMPT conventions.
//
// Note numbers follow XM: 0 = none, 1..96 = C-0..B-7, 97 = key off. Tracker "C-4" is note 49,
// which we define as middle C (MIDI 60): midi = note + 11.

export const KEY_OFF = 97;

export interface XmCell {
  note: number; // 0 none, 1..96, 97 key off
  ins: number; // 0 none, 1..128
  vol: number; // volume column byte: 0 none, 0x10..0x50 = volume 0..64, 0x60.. effects
  fx: number; // effect number 0..35 (0-9, A=10 … Z=35)
  param: number; // 0..255
}

export const emptyCell = (): XmCell => ({ note: 0, ins: 0, vol: 0, fx: 0, param: 0 });
export const isEmpty = (c: XmCell) => !c.note && !c.ins && !c.vol && !c.fx && !c.param;

export interface XmPattern {
  rows: number;
  /** row-major: cells[row * channels + ch] */
  cells: XmCell[];
}

export interface XmEnvelope {
  /** up to 12 points: [tick, value 0..64] */
  points: [number, number][];
  sustain?: number;
  loop?: [number, number];
}

export interface XmSample {
  name: string;
  /** mono PCM in -1..1; written as 16-bit */
  data: Float32Array;
  loopStart: number; // in samples
  loopLength: number; // in samples; 0 = no loop
  loopType: 0 | 1 | 2; // none, forward, ping-pong
  volume: number; // 0..64
  finetune: number; // -128..127 (1/128 semitone)
  panning: number; // 0..255
  relativeNote: number; // -96..95
}

export interface XmInstrument {
  name: string; // ≤ 22 chars
  samples: XmSample[];
  /** sample index per note 0..95 (default all 0) */
  sampleMap?: number[];
  volEnv?: XmEnvelope;
  panEnv?: XmEnvelope;
  vibrato?: { type: number; sweep: number; depth: number; rate: number };
  fadeout: number; // 0..0xfff
}

export interface XmModule {
  name: string; // ≤ 20 chars
  tracker?: string;
  channels: number; // even number in FT2; MilkyTracker/OpenMPT accept any up to 32
  speed: number;
  bpm: number;
  linear: boolean;
  restart: number;
  order: number[];
  patterns: XmPattern[];
  instruments: XmInstrument[]; // index 0 = instrument 1
}

// ---------------------------------------------------------------------------------------------
// tuning helpers

/**
 * relativeNote/finetune so that a sample recorded at `sampleRate` whose pitch is MIDI `rootMidi`
 * sounds at that pitch when played with the same tracker note (C-4 = MIDI 60).
 */
export function tuneSample(sampleRate: number, rootMidi: number): { relativeNote: number; finetune: number } {
  const s = 12 * Math.log2(sampleRate / 8363) - (rootMidi - 60);
  let rel = Math.round(s);
  // FT2 and libopenmpt use XM finetune in 1/16-semitone steps (multiples of 8): round to that grid,
  // otherwise the sample plays up to 6 cents flat. Sources that need exact tuning should be
  // rendered at an "XM-exact" sample rate (see src/audio/synth).
  let fine = Math.round(((s - rel) * 128) / 8) * 8;
  if (fine > 127) {
    fine -= 128;
    rel++;
  }
  if (fine < -128) {
    fine += 128;
    rel--;
  }
  return { relativeNote: rel, finetune: fine };
}

const NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
export function noteName(n: number): string {
  if (n === 0) return '...';
  if (n === KEY_OFF) return '==';
  const v = n - 1;
  return NAMES[v % 12] + Math.floor(v / 12);
}
export const noteToMidi = (n: number) => n + 11;
export const midiToNote = (m: number) => m - 11;
/** pitch class 0..11 (C = 0) of an XM note */
export const pitchClass = (n: number) => (n - 1) % 12;
export const isBlackKey = (n: number) => [1, 3, 6, 8, 10].includes(pitchClass(n));

export const FX_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function fxName(c: XmCell): string {
  if (!c.fx && !c.param) return '...';
  return FX_CHARS[c.fx] + c.param.toString(16).toUpperCase().padStart(2, '0');
}

// ---------------------------------------------------------------------------------------------
// writer

class Writer {
  buf = new Uint8Array(1 << 20);
  dv = new DataView(this.buf.buffer);
  pos = 0;
  ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf);
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }
  u8(v: number) {
    this.ensure(1);
    this.buf[this.pos++] = v & 0xff;
  }
  i8(v: number) {
    this.u8(v < 0 ? v + 256 : v);
  }
  u16(v: number) {
    this.ensure(2);
    this.dv.setUint16(this.pos, v, true);
    this.pos += 2;
  }
  u32(v: number) {
    this.ensure(4);
    this.dv.setUint32(this.pos, v, true);
    this.pos += 4;
  }
  str(s: string, n: number, pad = 0) {
    this.ensure(n);
    for (let i = 0; i < n; i++) this.buf[this.pos + i] = i < s.length ? s.charCodeAt(i) & 0xff : pad;
    this.pos += n;
  }
  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  zeros(n: number) {
    this.ensure(n);
    this.buf.fill(0, this.pos, this.pos + n);
    this.pos += n;
  }
  result() {
    return this.buf.slice(0, this.pos);
  }
}

function packPattern(p: XmPattern, channels: number): Uint8Array {
  const w = new Writer();
  for (const c of p.cells) {
    const has = [c.note, c.ins, c.vol, c.fx, c.param].map((v) => v !== 0);
    if (has.every(Boolean)) {
      w.u8(c.note);
      w.u8(c.ins);
      w.u8(c.vol);
      w.u8(c.fx);
      w.u8(c.param);
      continue;
    }
    let flags = 0x80;
    has.forEach((h, i) => (flags |= h ? 1 << i : 0));
    w.u8(flags);
    if (has[0]) w.u8(c.note);
    if (has[1]) w.u8(c.ins);
    if (has[2]) w.u8(c.vol);
    if (has[3]) w.u8(c.fx);
    if (has[4]) w.u8(c.param);
  }
  if (p.cells.length !== p.rows * channels) throw new Error(`pattern has ${p.cells.length} cells, expected ${p.rows * channels}`);
  return w.result();
}

function writeEnvelope(w: Writer, env: XmEnvelope | undefined) {
  const pts = env?.points ?? [];
  for (let i = 0; i < 12; i++) {
    w.u16(pts[i]?.[0] ?? 0);
    w.u16(pts[i]?.[1] ?? 0);
  }
}

export function writeXm(m: XmModule): Uint8Array {
  const w = new Writer();
  w.str('Extended Module: ', 17);
  w.str(m.name, 20, 0x20);
  w.u8(0x1a);
  w.str(m.tracker ?? 'EFFACED xm writer', 20, 0x20);
  w.u16(0x0104);
  w.u32(276);
  w.u16(m.order.length);
  w.u16(m.restart);
  w.u16(m.channels);
  w.u16(m.patterns.length);
  w.u16(m.instruments.length);
  w.u16(m.linear ? 1 : 0);
  w.u16(m.speed);
  w.u16(m.bpm);
  for (let i = 0; i < 256; i++) w.u8(m.order[i] ?? 0);

  for (const p of m.patterns) {
    const data = packPattern(p, m.channels);
    w.u32(9);
    w.u8(0);
    w.u16(p.rows);
    w.u16(data.length);
    w.bytes(data);
  }

  for (const ins of m.instruments) {
    const ns = ins.samples.length;
    w.u32(ns ? 263 : 29);
    w.str(ins.name, 22, 0);
    w.u8(0);
    w.u16(ns);
    if (!ns) continue;
    w.u32(40);
    for (let i = 0; i < 96; i++) w.u8(ins.sampleMap?.[i] ?? 0);
    writeEnvelope(w, ins.volEnv);
    writeEnvelope(w, ins.panEnv);
    w.u8(ins.volEnv?.points.length ?? 0);
    w.u8(ins.panEnv?.points.length ?? 0);
    w.u8(ins.volEnv?.sustain ?? 0);
    w.u8(ins.volEnv?.loop?.[0] ?? 0);
    w.u8(ins.volEnv?.loop?.[1] ?? 0);
    w.u8(ins.panEnv?.sustain ?? 0);
    w.u8(ins.panEnv?.loop?.[0] ?? 0);
    w.u8(ins.panEnv?.loop?.[1] ?? 0);
    const envType = (e?: XmEnvelope) =>
      e && e.points.length ? 1 | (e.sustain !== undefined ? 2 : 0) | (e.loop ? 4 : 0) : 0;
    w.u8(envType(ins.volEnv));
    w.u8(envType(ins.panEnv));
    w.u8(ins.vibrato?.type ?? 0);
    w.u8(ins.vibrato?.sweep ?? 0);
    w.u8(ins.vibrato?.depth ?? 0);
    w.u8(ins.vibrato?.rate ?? 0);
    w.u16(ins.fadeout);
    w.zeros(22);
    // sample headers, then all sample data
    const pcm = ins.samples.map((s) => toDelta16(s.data));
    ins.samples.forEach((s, i) => {
      w.u32(pcm[i].length);
      w.u32(s.loopLength ? s.loopStart * 2 : 0);
      w.u32(s.loopLength * 2);
      w.u8(Math.max(0, Math.min(64, Math.round(s.volume))));
      w.i8(s.finetune);
      w.u8((s.loopLength ? s.loopType : 0) | 0x10);
      w.u8(s.panning);
      w.i8(s.relativeNote);
      w.u8(0);
      w.str(s.name, 22, 0);
    });
    pcm.forEach((d) => w.bytes(d));
  }
  return w.result();
}

function toDelta16(f: Float32Array): Uint8Array {
  const out = new Uint8Array(f.length * 2);
  const dv = new DataView(out.buffer);
  let prev = 0;
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32768)));
    dv.setInt16(i * 2, ((v - prev) << 16) >> 16, true);
    prev = v;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// reader (patterns, order, instruments; sample PCM decoded to float)

export function readXm(bytes: Uint8Array): XmModule {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o: number, n: number) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const c = bytes[o + i];
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s.replace(/\s+$/, '');
  };
  if (str(0, 17) !== 'Extended Module:') throw new Error('not an XM file');
  const name = str(17, 20);
  const tracker = str(38, 20);
  const hdrSize = dv.getUint32(60, true);
  const songLen = dv.getUint16(64, true);
  const restart = dv.getUint16(66, true);
  const channels = dv.getUint16(68, true);
  const npat = dv.getUint16(70, true);
  const nins = dv.getUint16(72, true);
  const flags = dv.getUint16(74, true);
  const speed = dv.getUint16(76, true);
  const bpm = dv.getUint16(78, true);
  const order = Array.from(bytes.subarray(80, 80 + songLen));
  let o = 60 + hdrSize;

  const patterns: XmPattern[] = [];
  for (let p = 0; p < npat; p++) {
    const plen = dv.getUint32(o, true);
    const rows = dv.getUint16(o + 5, true);
    const size = dv.getUint16(o + 7, true);
    o += plen;
    const cells: XmCell[] = [];
    let q = o;
    const end = o + size;
    for (let i = 0; i < rows * channels; i++) {
      const c = emptyCell();
      if (size && q < end) {
        const b = bytes[q++];
        if (b & 0x80) {
          if (b & 1) c.note = bytes[q++];
          if (b & 2) c.ins = bytes[q++];
          if (b & 4) c.vol = bytes[q++];
          if (b & 8) c.fx = bytes[q++];
          if (b & 16) c.param = bytes[q++];
        } else {
          c.note = b;
          c.ins = bytes[q++];
          c.vol = bytes[q++];
          c.fx = bytes[q++];
          c.param = bytes[q++];
        }
      }
      cells.push(c);
    }
    o = end;
    patterns.push({ rows, cells });
  }

  const instruments: XmInstrument[] = [];
  for (let n = 0; n < nins; n++) {
    const isize = dv.getUint32(o, true);
    const iname = str(o + 4, 22);
    const ns = dv.getUint16(o + 27, true);
    const ins: XmInstrument = { name: iname, samples: [], fadeout: 0 };
    if (!ns) {
      o += isize;
      instruments.push(ins);
      continue;
    }
    const shsize = dv.getUint32(o + 29, true);
    ins.sampleMap = Array.from(bytes.subarray(o + 33, o + 33 + 96));
    const env = (base: number, count: number, sus: number, ls: number, le: number, type: number): XmEnvelope | undefined => {
      if (!(type & 1) || !count) return undefined;
      const points: [number, number][] = [];
      for (let i = 0; i < count; i++) points.push([dv.getUint16(base + i * 4, true), dv.getUint16(base + i * 4 + 2, true)]);
      return { points, sustain: type & 2 ? sus : undefined, loop: type & 4 ? [ls, le] : undefined };
    };
    const b = o + 129;
    ins.volEnv = env(b, bytes[o + 225], bytes[o + 227], bytes[o + 228], bytes[o + 229], bytes[o + 233]);
    ins.panEnv = env(b + 48, bytes[o + 226], bytes[o + 230], bytes[o + 231], bytes[o + 232], bytes[o + 234]);
    ins.vibrato = { type: bytes[o + 235], sweep: bytes[o + 236], depth: bytes[o + 237], rate: bytes[o + 238] };
    ins.fadeout = dv.getUint16(o + 239, true);
    o += isize;
    const heads = [];
    for (let s = 0; s < ns; s++) {
      const h = o + s * shsize;
      heads.push({
        len: dv.getUint32(h, true),
        ls: dv.getUint32(h + 4, true),
        ll: dv.getUint32(h + 8, true),
        vol: bytes[h + 12],
        fine: dv.getInt8(h + 13),
        type: bytes[h + 14],
        pan: bytes[h + 15],
        rel: dv.getInt8(h + 16),
        name: str(h + 18, 22),
      });
    }
    o += ns * shsize;
    for (const h of heads) {
      const is16 = (h.type & 0x10) !== 0;
      const count = is16 ? h.len >> 1 : h.len;
      const data = new Float32Array(count);
      let acc = 0;
      for (let i = 0; i < count; i++) {
        if (is16) {
          acc = (acc + dv.getInt16(o + i * 2, true)) << 16 >> 16;
          data[i] = acc / 32768;
        } else {
          acc = (acc + dv.getInt8(o + i)) << 24 >> 24;
          data[i] = acc / 128;
        }
      }
      o += h.len;
      const div = is16 ? 2 : 1;
      ins.samples.push({
        name: h.name,
        data,
        loopStart: h.ls / div,
        loopLength: h.type & 3 ? h.ll / div : 0,
        loopType: (h.type & 3) as 0 | 1 | 2,
        volume: h.vol,
        finetune: h.fine,
        panning: h.pan,
        relativeNote: h.rel,
      });
    }
    instruments.push(ins);
  }
  return { name, tracker, channels, speed, bpm, linear: (flags & 1) !== 0, restart, order, patterns, instruments };
}
