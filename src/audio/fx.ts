// Engine FX bus — pure TS, streaming (process any block size, state carries over), identical
// results in Node, workers and the browser. "90s demo hall": an 8×8 FDN reverb with a Hadamard
// feedback matrix, a ping-pong delay (3 rows = 3/16 at speed 6 / BPM 125), a stereo chorus, a
// gentle bus compressor and a look-ahead true-peak-ish limiter.

const TAU = Math.PI * 2;
const dbToGain = (db: number) => Math.pow(10, db / 20);

export interface FxSettings {
  /** gain applied to the summed mix before the compressor (dB) */
  masterGain: number;
  /** S10 crush wet amount at full ramp (0 = off) */
  crush: number;
  /** seconds the tail holds at full level before fading to silence at the end of the render */
  tailHold: number;
  reverb: {
    /** RT60 at low/mid frequencies (s) */
    rt60: number;
    /** scales all FDN delay lengths (room size) */
    size: number;
    /** high-frequency damping corner in the feedback loop (Hz) */
    damping: number;
    predelay: number; // ms
    lowcut: number; // Hz, on the reverb input
    /** chorus-like modulation depth of the delay lines (ms) — the lush 90s tail */
    mod: number;
    /** wet return level (dB) */
    level: number;
  };
  delay: {
    /** delay time in rows (3 rows = 3/16 note at speed 6) */
    rows: number;
    feedback: number;
    lowpass: number; // Hz in the loop
    highpass: number; // Hz in the loop
    level: number; // dB
    /** part of the delay output that is also sent to the reverb */
    toReverb: number;
  };
  chorus: {
    delay: number; // ms
    depth: number; // ms
    rate: number; // Hz
    level: number; // dB
  };
  comp: {
    threshold: number; // dB
    ratio: number;
    knee: number; // dB
    attack: number; // ms
    release: number; // ms
    makeup: number; // dB
  };
  limiter: {
    ceiling: number; // dBFS (sample + midpoint peak), ≈ dBTP
    lookahead: number; // ms
    release: number; // ms
  };
}

export const FX_DEFAULTS: FxSettings = {
  masterGain: 9,
  crush: 0.55,
  tailHold: 6,
  reverb: { rt60: 3.2, size: 1, damping: 5500, predelay: 22, lowcut: 180, mod: 0.35, level: -4 },
  delay: { rows: 3, feedback: 0.42, lowpass: 4200, highpass: 220, level: -5, toReverb: 0.25 },
  chorus: { delay: 14, depth: 3.2, rate: 0.42, level: -3 },
  comp: { threshold: -14, ratio: 2, knee: 8, attack: 12, release: 180, makeup: 2 },
  limiter: { ceiling: -1.5, lookahead: 3, release: 120 },
};

export function mergeFx(base: FxSettings, o?: Partial<FxSettings>): FxSettings {
  if (!o) return base;
  return {
    masterGain: o.masterGain ?? base.masterGain,
    crush: o.crush ?? base.crush,
    tailHold: o.tailHold ?? base.tailHold,
    reverb: { ...base.reverb, ...o.reverb },
    delay: { ...base.delay, ...o.delay },
    chorus: { ...base.chorus, ...o.chorus },
    comp: { ...base.comp, ...o.comp },
    limiter: { ...base.limiter, ...o.limiter },
  };
}

// ---------------------------------------------------------------------------------------------

class OnePoleLP {
  private z = 0;
  private a: number;
  constructor(sr: number, fc: number) {
    this.a = Math.exp((-TAU * fc) / sr);
  }
  tick(x: number): number {
    return (this.z = x + (this.z - x) * this.a);
  }
}
class OnePoleHP {
  private lp: OnePoleLP;
  constructor(sr: number, fc: number) {
    this.lp = new OnePoleLP(sr, fc);
  }
  tick(x: number): number {
    return x - this.lp.tick(x);
  }
}

/**
 * 8×8 feedback delay network, mono in → stereo out ("90s demo hall"). Input: predelay, lowcut,
 * two 4-stage allpass diffusers (one per side) feeding the even / odd lines. Lines 0–3 are
 * slowly modulated (fractional reads) for a lush, chorused tail; one-pole damping per line;
 * feedback through a normalized 8×8 Hadamard matrix (fast Walsh–Hadamard, 24 adds).
 */
export class FdnReverb {
  private buf: Float64Array; // all 8 lines, each a power-of-two ring at offs[k]
  private offs = new Int32Array(8);
  private masks = new Int32Array(8);
  private lens = new Float64Array(8);
  private w = 0;
  private g = new Float64Array(8);
  private dampA: number;
  private z = new Float64Array(8);
  private modDepth: number;
  private modPh = new Float64Array(4);
  private modInc = new Float64Array(4);
  private modCur = new Float64Array(4);
  private pre: Float64Array;
  private preLen: number;
  private preIdx = 0;
  // allpass diffusers: 8 rings in one buffer (4 per side)
  private ap: Float64Array;
  private apOff = new Int32Array(8);
  private apLen = new Int32Array(8);
  private apIdx = new Int32Array(8);
  private apG = new Float64Array(8);
  private hpZ = 0;
  private hpA: number;
  private level: number;

  constructor(sampleRate: number, s: FxSettings['reverb']) {
    // the network runs at half the sample rate (input averaged in pairs, output interpolated):
    // half the cost, and the tail above ~sr/4 is damped away anyway
    const sr = sampleRate / 2;
    const ms = [43.7, 49.3, 55.9, 61.1, 68.3, 74.9, 83.3, 91.1];
    const extra = Math.ceil((s.mod * 2 * sr) / 1000) + 8;
    let total = 0;
    const sizes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const len = Math.max(32, Math.round((ms[i] * s.size * sr) / 1000)) | 1;
      this.lens[i] = len;
      const size = 1 << Math.ceil(Math.log2(len + extra));
      sizes.push(size);
      this.offs[i] = total;
      this.masks[i] = size - 1;
      total += size;
      this.g[i] = Math.pow(10, (-3 * len) / (s.rt60 * sr));
    }
    this.buf = new Float64Array(total);
    for (let i = 0; i < 4; i++) {
      this.modPh[i] = i / 4;
      this.modInc[i] = (0.13 + 0.091 * i) / sr;
    }
    this.dampA = Math.exp((-TAU * s.damping) / sr);
    this.modDepth = (s.mod * sr) / 1000;
    this.preLen = Math.max(1, Math.round((s.predelay * sr) / 1000)) + 1;
    this.pre = new Float64Array(this.preLen);
    const apMs = [4.77, 3.59, 12.73, 9.31, 4.91, 3.71, 13.11, 8.87];
    const apG = [0.7, 0.7, 0.6, 0.6, 0.7, 0.7, 0.6, 0.6];
    let at = 0;
    for (let i = 0; i < 8; i++) {
      const len = Math.max(1, Math.round((apMs[i] * sr) / 1000));
      this.apOff[i] = at;
      this.apLen[i] = len;
      this.apG[i] = apG[i];
      at += len;
    }
    this.ap = new Float64Array(at);
    this.hpA = Math.exp((-TAU * s.lowcut) / sr);
    this.level = dbToGain(s.level);
  }

  private pl = 0;
  private pr = 0;
  /** add the wet signal of the mono input into (outL, outR); n must be even */
  process(input: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const buf = this.buf, offs = this.offs, masks = this.masks, lens = this.lens, g = this.g, z = this.z;
    const ap = this.ap, apOff = this.apOff, apLen = this.apLen, apIdx = this.apIdx, apG = this.apG;
    const a = this.dampA, lvl = this.level * 0.35, pre = this.pre, preLen = this.preLen;
    const o0 = offs[0], o1 = offs[1], o2 = offs[2], o3 = offs[3], o4 = offs[4], o5 = offs[5], o6 = offs[6], o7 = offs[7];
    const k0 = masks[0], k1 = masks[1], k2 = masks[2], k3 = masks[3], k4 = masks[4], k5 = masks[5], k6 = masks[6], k7 = masks[7];
    const d4 = lens[4], d5 = lens[5], d6 = lens[6], d7 = lens[7];
    const g0 = g[0], g1 = g[1], g2 = g[2], g3 = g[3], g4 = g[4], g5 = g[5], g6 = g[6], g7 = g[7];
    let m0 = 0, m1 = 0, m2 = 0, m3 = 0;
    let w = this.w, hpZ = this.hpZ, pi = this.preIdx, pl = this.pl, pr = this.pr;
    let z0 = z[0], z1 = z[1], z2 = z[2], z3 = z[3], z4 = z[4], z5 = z[5], z6 = z[6], z7 = z[7];
    for (let i = 0; i < n; i += 2) {
      if ((i & 31) === 0) {
        for (let k = 0; k < 4; k++) {
          let p = this.modPh[k] + this.modInc[k] * 16;
          if (p >= 1) p -= 1;
          this.modPh[k] = p;
          this.modCur[k] = lens[k] + this.modDepth * (1 + Math.sin(TAU * p));
        }
        m0 = this.modCur[0]; m1 = this.modCur[1]; m2 = this.modCur[2]; m3 = this.modCur[3];
      }
      // predelay + lowcut
      const x0 = pre[pi];
      pre[pi] = 0.5 * (input[i] + input[i + 1]) + 1e-18;
      if (++pi >= preLen) pi = 0;
      hpZ = x0 + (hpZ - x0) * this.hpA;
      let xl = x0 - hpZ, xr = xl;
      // diffusers
      for (let k = 0; k < 4; k++) {
        const j = apOff[k] + apIdx[k], d = ap[j], v = xl + apG[k] * d;
        ap[j] = v;
        if (++apIdx[k] >= apLen[k]) apIdx[k] = 0;
        xl = d - apG[k] * v;
        const k2_ = k + 4, j2 = apOff[k2_] + apIdx[k2_], d2 = ap[j2], v2 = xr + apG[k2_] * d2;
        ap[j2] = v2;
        if (++apIdx[k2_] >= apLen[k2_]) apIdx[k2_] = 0;
        xr = d2 - apG[k2_] * v2;
      }
      // modulated reads (lines 0–3)
      let di = m0 | 0, fr = m0 - di;
      let y = buf[o0 + ((w - di) & k0)];
      const r0 = y + (buf[o0 + ((w - di - 1) & k0)] - y) * fr;
      di = m1 | 0; fr = m1 - di;
      y = buf[o1 + ((w - di) & k1)];
      const r1 = y + (buf[o1 + ((w - di - 1) & k1)] - y) * fr;
      di = m2 | 0; fr = m2 - di;
      y = buf[o2 + ((w - di) & k2)];
      const r2 = y + (buf[o2 + ((w - di - 1) & k2)] - y) * fr;
      di = m3 | 0; fr = m3 - di;
      y = buf[o3 + ((w - di) & k3)];
      const r3 = y + (buf[o3 + ((w - di - 1) & k3)] - y) * fr;
      const r4 = buf[o4 + ((w - d4) & k4)], r5 = buf[o5 + ((w - d5) & k5)], r6 = buf[o6 + ((w - d6) & k6)], r7 = buf[o7 + ((w - d7) & k7)];
      // damping
      z0 = r0 + (z0 - r0) * a; z1 = r1 + (z1 - r1) * a; z2 = r2 + (z2 - r2) * a; z3 = r3 + (z3 - r3) * a;
      z4 = r4 + (z4 - r4) * a; z5 = r5 + (z5 - r5) * a; z6 = r6 + (z6 - r6) * a; z7 = r7 + (z7 - r7) * a;
      const ol = (z0 + z1 - z2 - z3 + z4 + z5 - z6 - z7) * lvl;
      const or = (z0 - z1 + z2 - z3 + z4 - z5 + z6 - z7) * lvl;
      outL[i] += 0.5 * (pl + ol);
      outR[i] += 0.5 * (pr + or);
      outL[i + 1] += ol;
      outR[i + 1] += or;
      pl = ol;
      pr = or;
      // Hadamard 8 / sqrt(8)
      const a0 = z0 + z1, a1 = z0 - z1, a2 = z2 + z3, a3 = z2 - z3, a4 = z4 + z5, a5 = z4 - z5, a6 = z6 + z7, a7 = z6 - z7;
      const b0 = a0 + a2, b1 = a1 + a3, b2 = a0 - a2, b3 = a1 - a3, b4 = a4 + a6, b5 = a5 + a7, b6 = a4 - a6, b7 = a5 - a7;
      const s = 0.35355339059327373;
      buf[o0 + (w & k0)] = xl + g0 * (b0 + b4) * s;
      buf[o1 + (w & k1)] = xr + g1 * (b1 + b5) * s;
      buf[o2 + (w & k2)] = -xl + g2 * (b2 + b6) * s;
      buf[o3 + (w & k3)] = -xr + g3 * (b3 + b7) * s;
      buf[o4 + (w & k4)] = xl + g4 * (b0 - b4) * s;
      buf[o5 + (w & k5)] = xr + g5 * (b1 - b5) * s;
      buf[o6 + (w & k6)] = -xl + g6 * (b2 - b6) * s;
      buf[o7 + (w & k7)] = -xr + g7 * (b3 - b7) * s;
      w = (w + 1) | 0;
    }
    this.w = w;
    this.hpZ = hpZ;
    this.preIdx = pi;
    this.pl = pl;
    this.pr = pr;
    z[0] = z0; z[1] = z1; z[2] = z2; z[3] = z3; z[4] = z4; z[5] = z5; z[6] = z6; z[7] = z7;
  }
}

/** Ping-pong delay: mono in → left tap → right tap → left … with a filtered feedback loop. */
export class PingPong {
  private bufL: Float64Array;
  private bufR: Float64Array;
  private len: number;
  private i = 0;
  private fb: number;
  private lp: OnePoleLP;
  private hp: OnePoleHP;
  private level: number;
  constructor(sr: number, s: FxSettings['delay'], rowSeconds: number) {
    this.len = Math.max(1, Math.round(s.rows * rowSeconds * sr));
    this.bufL = new Float64Array(this.len);
    this.bufR = new Float64Array(this.len);
    this.fb = s.feedback;
    this.lp = new OnePoleLP(sr, s.lowpass);
    this.hp = new OnePoleHP(sr, s.highpass);
    this.level = dbToGain(s.level);
  }
  /** adds the wet output into outL/outR, and toRev·wet (mono) into rev */
  process(input: Float32Array, outL: Float32Array, outR: Float32Array, rev: Float32Array, toRev: number, n: number): void {
    const { bufL, bufR, len } = this;
    const lvl = this.level;
    for (let k = 0; k < n; k++) {
      const yl = bufL[this.i], yr = bufR[this.i];
      const fbIn = this.hp.tick(this.lp.tick(yr * this.fb));
      bufL[this.i] = input[k] + fbIn + 1e-18;
      bufR[this.i] = yl;
      if (++this.i >= len) this.i = 0;
      const wl = yl * lvl, wr = yr * lvl;
      outL[k] += wl;
      outR[k] += wr;
      rev[k] += (wl + wr) * 0.5 * toRev;
    }
  }
}

/** Chorus, mono in → stereo out: two modulated taps per side (opposite LFO phases), wet only. */
export class Chorus {
  private buf: Float64Array;
  private mask: number;
  private w = 0;
  private base: number;
  private depth: number;
  private ph = new Float64Array(4);
  private inc = new Float64Array(4);
  private off = new Float64Array(4);
  private level: number;
  constructor(sr: number, s: FxSettings['chorus']) {
    const max = Math.ceil(((s.delay + s.depth * 2 + 2) * sr) / 1000);
    const size = 1 << Math.ceil(Math.log2(max + 4));
    this.buf = new Float64Array(size);
    this.mask = size - 1;
    this.base = (s.delay * sr) / 1000;
    this.depth = (s.depth * sr) / 1000;
    const ph = [0, 0.33, 0.5, 0.83];
    for (let k = 0; k < 4; k++) {
      this.ph[k] = ph[k];
      this.inc[k] = (s.rate * (1 + 0.31 * (k & 1))) / sr;
    }
    this.level = dbToGain(s.level);
  }
  process(input: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const buf = this.buf, mask = this.mask, ph = this.ph, inc = this.inc, off = this.off;
    const lvl = this.level * 0.5;
    let w = this.w;
    for (let i = 0; i < n; i++) {
      if ((i & 15) === 0) {
        for (let k = 0; k < 4; k++) {
          let p = ph[k] + inc[k] * 16;
          if (p >= 1) p -= 1;
          ph[k] = p;
          off[k] = this.base + this.depth * Math.sin(TAU * p) * (k & 1 ? 0.8 : 1);
        }
      }
      buf[w & mask] = input[i];
      let d = off[0], di = d | 0, f = d - di, a = buf[(w - di) & mask];
      let sl = a + (buf[(w - di - 1) & mask] - a) * f;
      d = off[1]; di = d | 0; f = d - di; a = buf[(w - di) & mask];
      sl += a + (buf[(w - di - 1) & mask] - a) * f;
      d = off[2]; di = d | 0; f = d - di; a = buf[(w - di) & mask];
      let sr = a + (buf[(w - di - 1) & mask] - a) * f;
      d = off[3]; di = d | 0; f = d - di; a = buf[(w - di) & mask];
      sr += a + (buf[(w - di - 1) & mask] - a) * f;
      w = (w + 1) | 0;
      outL[i] += sl * lvl;
      outR[i] += sr * lvl;
    }
    this.w = w;
  }
}

/** Stereo-linked feed-forward compressor, peak detector in dB, soft knee, control rate 16. */
export class Compressor {
  private env = -120;
  private gPrev = 1;
  private s: FxSettings['comp'];
  private aAtt: number;
  private aRel: number;
  private makeup: number;
  constructor(sr: number, s: FxSettings['comp']) {
    this.s = s;
    this.aAtt = Math.exp(-16 / ((s.attack / 1000) * sr));
    this.aRel = Math.exp(-16 / ((s.release / 1000) * sr));
    this.makeup = dbToGain(s.makeup);
  }
  private gainDb(x: number): number {
    const { threshold: T, ratio: R, knee: W } = this.s;
    const d = x - T;
    if (2 * d < -W) return 0;
    if (2 * Math.abs(d) <= W) return ((1 / R - 1) * (d + W / 2) * (d + W / 2)) / (2 * W);
    return (1 / R - 1) * d;
  }
  process(l: Float32Array, r: Float32Array, n: number): void {
    for (let i0 = 0; i0 < n; i0 += 16) {
      const e = Math.min(n, i0 + 16);
      let pk = 0;
      for (let i = i0; i < e; i++) pk = Math.max(pk, Math.abs(l[i]), Math.abs(r[i]));
      const lvl = 20 * Math.log10(pk + 1e-9);
      this.env = lvl > this.env ? lvl + (this.env - lvl) * this.aAtt : lvl + (this.env - lvl) * this.aRel;
      const g = dbToGain(this.gainDb(this.env)) * this.makeup;
      const g0 = this.gPrev, dg = (g - g0) / (e - i0);
      for (let i = i0, k = 0; i < e; i++, k++) {
        const gg = g0 + dg * k;
        l[i] *= gg;
        r[i] *= gg;
      }
      this.gPrev = g;
    }
  }
}

/**
 * Look-ahead brickwall limiter: the required gain (from sample peaks and cubic mid-sample
 * estimates, ≈ 2× oversampled true peak) is min-filtered over the look-ahead window, released
 * exponentially, then box-smoothed over the window — the gain is already down when the peak
 * arrives. Adds `latency` samples of delay (the caller compensates).
 */
export class Limiter {
  readonly latency: number;
  private ceil: number;
  private relA: number;
  // delay line for the audio
  private dl: Float64Array;
  private dr: Float64Array;
  private di = 0;
  // sliding-window minimum (monotonic deque over a ring)
  private qv: Float64Array;
  private qi: Float64Array;
  private qh = 0;
  private qt = 0;
  private qmask: number;
  private n = 0;
  private hold = 1;
  // box smoothing
  private box: Float64Array;
  private bi = 0;
  private bsum: number;
  // previous samples for the mid-point estimate
  private x1l = 0;
  private x2l = 0;
  private x3l = 0;
  private x1r = 0;
  private x2r = 0;
  private x3r = 0;
  constructor(sr: number, s: FxSettings['limiter']) {
    this.latency = Math.max(2, Math.round((s.lookahead / 1000) * sr));
    this.ceil = dbToGain(s.ceiling);
    this.relA = Math.exp(-1 / ((s.release / 1000) * sr));
    const L = this.latency + 1;
    this.dl = new Float64Array(L);
    this.dr = new Float64Array(L);
    const qs = 1 << Math.ceil(Math.log2(L + 2));
    this.qv = new Float64Array(qs);
    this.qi = new Float64Array(qs);
    this.qmask = qs - 1;
    this.box = new Float64Array(L).fill(1);
    this.bsum = L;
  }
  /** in place; output is delayed by `latency` samples */
  process(l: Float32Array, r: Float32Array, n: number): void {
    const L = this.latency + 1;
    for (let i = 0; i < n; i++) {
      const xl = l[i], xr = r[i];
      // 4× oversampled peak between x2 and x1 (4-point Lagrange at 1/4, 1/2, 3/4; needs x3, x2, x1, x0)
      const pl = interPeak(this.x3l, this.x2l, this.x1l, xl);
      const pr = interPeak(this.x3r, this.x2r, this.x1r, xr);
      this.x3l = this.x2l; this.x2l = this.x1l; this.x1l = xl;
      this.x3r = this.x2r; this.x2r = this.x1r; this.x1r = xr;
      const pk = Math.max(Math.abs(xl), Math.abs(xr), pl, pr);
      const req = pk > this.ceil ? this.ceil / pk : 1;
      // push into the min-deque
      const idx = this.n++;
      while (this.qt > this.qh && this.qv[(this.qt - 1) & this.qmask] >= req) this.qt--;
      this.qv[this.qt & this.qmask] = req;
      this.qi[this.qt & this.qmask] = idx;
      this.qt++;
      while (this.qi[this.qh & this.qmask] <= idx - L) this.qh++;
      const mn = this.qv[this.qh & this.qmask];
      // release: rise slowly toward 1, never above the window minimum
      this.hold = Math.min(mn, 1 - (1 - this.hold) * this.relA);
      // box smoothing over L
      this.bsum += this.hold - this.box[this.bi];
      this.box[this.bi] = this.hold;
      this.bi = this.bi + 1 >= L ? 0 : this.bi + 1;
      const g = this.bsum / L;
      // delayed audio
      const ol = this.dl[this.di], or = this.dr[this.di];
      this.dl[this.di] = xl;
      this.dr[this.di] = xr;
      this.di = this.di + 1 >= L - 1 ? 0 : this.di + 1;
      l[i] = ol * g;
      r[i] = or * g;
    }
  }
}

/** max |x| at t = 1/4, 1/2, 3/4 between p1 and p2 (4-point Lagrange through p0..p3) */
function interPeak(p0: number, p1: number, p2: number, p3: number): number {
  const a = -0.0546875 * p0 + 0.8203125 * p1 + 0.2734375 * p2 - 0.0390625 * p3;
  const b = -0.0390625 * p0 + 0.2734375 * p1 + 0.8203125 * p2 - 0.0546875 * p3;
  const m = 0.5625 * (p1 + p2) - 0.0625 * (p0 + p3);
  return Math.max(Math.abs(a), Math.abs(b), Math.abs(m));
}

/**
 * S10 "compression" crush: sample-rate reduction (sample & hold) + bit-depth reduction, mixed in
 * with an amount that ramps from `from` to `full` and is released (50 ms) at `release`.
 * At full amount: ≈ 7 bits, 1/4 rate, wet `amount` of the mix — musical, not a gimmick.
 */
export class Crusher {
  private hl = 0;
  private hr = 0;
  private acc = 1;
  private amount: number;
  constructor(amount: number) {
    this.amount = amount;
  }
  process(l: Float32Array, r: Float32Array, n: number, start: number, c: { from: number; full: number; release: number }): void {
    const rel = 2400;
    for (let i = 0; i < n; i++) {
      const t = start + i;
      let a: number;
      if (t < c.from) a = 0;
      else if (t < c.full) {
        const u = (t - c.from) / (c.full - c.from);
        a = u * u * (3 - 2 * u);
      } else if (t < c.release) a = 1;
      else a = Math.max(0, 1 - (t - c.release) / rel);
      if (a <= 0) continue;
      // sample & hold at rate / (1 + 3a)
      this.acc += 1 / (1 + 3 * a);
      if (this.acc >= 1) {
        this.acc -= 1;
        const q = Math.pow(2, 15 - 8 * a); // 16 → 8 bits
        this.hl = Math.round(l[i] * q) / q;
        this.hr = Math.round(r[i] * q) / q;
      }
      const w = a * this.amount;
      l[i] += (this.hl - l[i]) * w;
      r[i] += (this.hr - r[i]) * w;
    }
  }
}

/** DC blocker (1st-order highpass ~5 Hz) */
export class DcBlock {
  private x1 = 0;
  private y1 = 0;
  private R: number;
  constructor(sr: number) {
    this.R = 1 - (TAU * 5) / sr;
  }
  process(a: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const x = a[i];
      const y = x - this.x1 + this.R * this.y1;
      this.x1 = x;
      this.y1 = y;
      a[i] = y;
    }
  }
}
