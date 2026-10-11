// Browser-safe WAV encoder (16-bit PCM or 32-bit float), used by the Lab's exports.
export function encodeWav(channels: Float32Array[], sampleRate: number, float = false): Uint8Array {
  const nch = channels.length, n = channels[0].length, bps = float ? 4 : 2;
  const b = new Uint8Array(44 + n * nch * bps);
  const dv = new DataView(b.buffer);
  const s = (o: number, t: string) => {
    for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i);
  };
  s(0, 'RIFF');
  dv.setUint32(4, 36 + n * nch * bps, true);
  s(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, float ? 3 : 1, true);
  dv.setUint16(22, nch, true);
  dv.setUint32(24, Math.round(sampleRate), true);
  dv.setUint32(28, Math.round(sampleRate) * nch * bps, true);
  dv.setUint16(32, nch * bps, true);
  dv.setUint16(34, bps * 8, true);
  s(36, 'data');
  dv.setUint32(40, n * nch * bps, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < nch; c++) {
      const v = channels[c][i];
      if (float) dv.setFloat32(o, v, true);
      else dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(v * 32767))), true);
      o += bps;
    }
  return b;
}
