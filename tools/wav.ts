// minimal WAV I/O for the tools (PCM 16/24/32-bit int and 32-bit float; mixed down to mono on read)
import { readFileSync, writeFileSync } from 'node:fs';

export interface Wav {
  sampleRate: number;
  channels: Float32Array[];
}

export function readWav(path: string): Wav {
  const b = readFileSync(path);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV`);
  let o = 12, fmt = 1, nch = 1, sr = 44100, bits = 16;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      fmt = dv.getUint16(body, true);
      nch = dv.getUint16(body + 2, true);
      sr = dv.getUint32(body + 4, true);
      bits = dv.getUint16(body + 14, true);
      if (fmt === 0xfffe) fmt = dv.getUint16(body + 24, true);
    } else if (id === 'data') {
      const bps = bits / 8;
      const frames = Math.floor(size / (bps * nch));
      const chans = Array.from({ length: nch }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++)
        for (let c = 0; c < nch; c++) {
          const p = body + (i * nch + c) * bps;
          let v: number;
          if (fmt === 3) v = bits === 64 ? dv.getFloat64(p, true) : dv.getFloat32(p, true);
          else if (bits === 16) v = dv.getInt16(p, true) / 32768;
          else if (bits === 24) v = ((dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16)) / 8388608);
          else if (bits === 32) v = dv.getInt32(p, true) / 2147483648;
          else v = (dv.getUint8(p) - 128) / 128;
          chans[c][i] = v;
        }
      return { sampleRate: sr, channels: chans };
    }
    o = body + size + (size & 1);
  }
  throw new Error(`${path}: no data chunk`);
}

export function mono(w: Wav): Float32Array {
  if (w.channels.length === 1) return w.channels[0];
  const n = w.channels[0].length, out = new Float32Array(n);
  for (const c of w.channels) for (let i = 0; i < n; i++) out[i] += c[i] / w.channels.length;
  return out;
}

/** write 16-bit PCM (or 32-bit float with float=true) */
export function writeWav(path: string, sampleRate: number, channels: Float32Array[], float = false) {
  const nch = channels.length, n = channels[0].length, bps = float ? 4 : 2;
  const b = Buffer.alloc(44 + n * nch * bps);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + n * nch * bps, 4);
  b.write('WAVEfmt ', 8, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(float ? 3 : 1, 20);
  b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * nch * bps, 28);
  b.writeUInt16LE(nch * bps, 32);
  b.writeUInt16LE(bps * 8, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(n * nch * bps, 40);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < nch; c++) {
      const v = channels[c][i];
      if (float) b.writeFloatLE(v, o);
      else b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), o);
      o += bps;
    }
  writeFileSync(path, b);
}
