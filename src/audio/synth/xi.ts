// FastTracker 2 .xi instrument writer (v1.02) — the Lab's "export XI" for MilkyTracker/OpenMPT.

import type { XmInstrument, XmEnvelope } from '../../music/xm/xm.ts';

export function writeXi(ins: XmInstrument): Uint8Array {
  const ns = ins.samples.length;
  const pcm = ins.samples.map((s) => {
    // 16-bit delta encoding
    const out = new Int16Array(s.data.length);
    let prev = 0;
    for (let i = 0; i < s.data.length; i++) {
      const v = Math.max(-32768, Math.min(32767, Math.round(s.data[i] * 32767)));
      out[i] = (v - prev) << 16 >> 16;
      prev = v;
    }
    return out;
  });
  const size = 298 + ns * 40 + pcm.reduce((a, p) => a + p.length * 2, 0);
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  const str = (o: number, s: string, n: number) => {
    for (let i = 0; i < n; i++) b[o + i] = i < s.length ? s.charCodeAt(i) & 0xff : 0x20;
  };
  str(0, 'Extended Instrument: ', 21);
  str(21, ins.name, 22);
  b[43] = 0x1a;
  str(44, 'EFFACED Lab', 20);
  dv.setUint16(64, 0x0102, true);
  for (let i = 0; i < 96; i++) b[66 + i] = ins.sampleMap?.[i] ?? 0;
  const env = (e: XmEnvelope | undefined, at: number, nAt: number, susAt: number, typeAt: number) => {
    if (!e) return;
    e.points.slice(0, 12).forEach(([x, y], i) => {
      dv.setUint16(at + i * 4, x, true);
      dv.setUint16(at + i * 4 + 2, y, true);
    });
    b[nAt] = Math.min(12, e.points.length);
    b[susAt] = e.sustain ?? 0;
    b[susAt + 1] = e.loop?.[0] ?? 0;
    b[susAt + 2] = e.loop?.[1] ?? 0;
    b[typeAt] = 1 | (e.sustain !== undefined ? 2 : 0) | (e.loop ? 4 : 0);
  };
  env(ins.volEnv, 162, 258, 260, 266);
  env(ins.panEnv, 210, 259, 263, 267);
  if (ins.vibrato) {
    b[268] = ins.vibrato.type;
    b[269] = ins.vibrato.sweep;
    b[270] = ins.vibrato.depth;
    b[271] = ins.vibrato.rate;
  }
  dv.setUint16(272, ins.fadeout, true);
  dv.setUint16(296, ns, true);
  let o = 298;
  ins.samples.forEach((s, i) => {
    dv.setUint32(o, pcm[i].length * 2, true);
    dv.setUint32(o + 4, s.loopStart * 2, true);
    dv.setUint32(o + 8, s.loopLength * 2, true);
    b[o + 12] = s.volume;
    dv.setInt8(o + 13, s.finetune);
    b[o + 14] = (s.loopLength ? s.loopType & 3 : 0) | 0x10;
    b[o + 15] = s.panning;
    dv.setInt8(o + 16, s.relativeNote);
    b[o + 17] = 0;
    str(o + 18, s.name, 22);
    o += 40;
  });
  for (const p of pcm) {
    for (let i = 0; i < p.length; i++) dv.setInt16(o + i * 2, p[i], true);
    o += p.length * 2;
  }
  return b;
}
