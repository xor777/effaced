// Mix bus, streaming and chunked, in three stages that can run on different threads:
//  GroupMixer — a fixed group of channel stems (libopenmpt passes) → group buses: dry stereo +
//               mono reverb / delay / chorus sends (per-instrument send levels, ramped at note-ons),
//               engine channel panning, and the engine's channel processing (MUSIC_BRIEF: bass
//               fundamental cut and sub removal in 0D–0E). Runs in the render workers.
//  FxBus      — chorus → ping-pong delay → reverb on the summed sends → wet stereo. Runs in its
//               own worker, pipelined with the master.
//  MasterBus  — dry + wet → master gain, DC blocker, S10 crush, compressor, limiter, tail fade.
// sumGroups() adds the group buses in group order. Grouping is fixed by the plan (not by the core
// count), so every path sums in the same order: workers (browser or Node) and the inline renderer
// give bit-identical output.

import { type FxSettings, FdnReverb, PingPong, Chorus, Compressor, Limiter, DcBlock, Crusher } from './fx.ts';
import { Biquad } from './synth/util.ts';

export interface StemSpec {
  /** tracker channel 1..18 */
  ch: number;
  /** ghost scope XY stem (also copied to ghostL/ghostR) */
  scope?: boolean;
  /** send levels from sample `at` on (instrument changes at note-ons), sorted */
  sends: { at: number; rev: number; dly: number; cho: number }[];
  /** silence the stem in these sample ranges */
  mute?: { from: number; to: number }[];
  /**
   * "missing fundamental": inside [from, to) the stem goes through an 8th-order Butterworth
   * highpass at ratio × the current note's fundamental (retuned at `notes[].at`)
   */
  hpf?: { from: number; to: number; ratio: number; notes: { at: number; f0: number }[] };
  /** engine channel pan −1..1 (balance on the stereo stem; the tracker file can stay centred) */
  pan?: number;
}

export interface Stereo {
  l: Float32Array;
  r: Float32Array;
}

/** group buses for one chunk */
export interface Buses {
  dryL: Float32Array;
  dryR: Float32Array;
  rev: Float32Array;
  dly: Float32Array;
  cho: Float32Array;
  /** raw scope XY (only for the group holding the scope stem) */
  ghostL?: Float32Array;
  ghostR?: Float32Array;
  /** false = everything is silent this chunk */
  active: boolean;
  /** which sends received signal this chunk (bit 1 reverb, 2 delay, 4 chorus) */
  sendMask: number;
}

export function makeBuses(chunk: number, ghost: boolean): Buses {
  const f = () => new Float32Array(chunk);
  return { dryL: f(), dryR: f(), rev: f(), dly: f(), cho: f(), ...(ghost ? { ghostL: f(), ghostR: f() } : {}), active: false, sendMask: 0 };
}

const BLOCK = 64; // automation granularity (samples)
const RAMP = 256; // send / mute ramp length (samples)
const BUTTER8_Q = [0.5097955791, 0.6013448869, 0.8999762231, 2.5629154477];

/** linear ramp toward a target that changes at events */
class Ramp {
  from = 0;
  to = 0;
  t0 = -1e12;
  set(at: number, v: number, cur: number): void {
    this.from = cur;
    this.to = v;
    this.t0 = at;
  }
  at(t: number): number {
    const u = (t - this.t0) / RAMP;
    return u >= 1 ? this.to : u <= 0 ? this.from : this.from + (this.to - this.from) * u;
  }
}

class StemState {
  spec: StemSpec;
  si = 0;
  rev = new Ramp();
  dly = new Ramp();
  cho = new Ramp();
  mute = new Ramp();
  muteState = 1;
  hpL: Biquad[] = [];
  hpR: Biquad[] = [];
  hpNote = -1;
  wet = 0;
  constructor(spec: StemSpec) {
    this.spec = spec;
    this.mute.to = this.mute.from = 1;
    if (spec.hpf) for (let q = 0; q < 4; q++) (this.hpL.push(new Biquad()), this.hpR.push(new Biquad()));
  }
}

export class GroupMixer {
  private sr: number;
  private stems: StemState[];
  constructor(sr: number, stems: StemSpec[]) {
    this.sr = sr;
    this.stems = stems.map((s) => new StemState(s));
  }

  /** chunks[i] belongs to stems[i] (null = silent) */
  process(start: number, n: number, chunks: (Stereo | null)[], out: Buses): void {
    out.dryL.fill(0, 0, n);
    out.dryR.fill(0, 0, n);
    out.rev.fill(0, 0, n);
    out.dly.fill(0, 0, n);
    out.cho.fill(0, 0, n);
    out.ghostL?.fill(0, 0, n);
    out.ghostR?.fill(0, 0, n);
    out.active = false;
    out.sendMask = 0;
    for (let s = 0; s < this.stems.length; s++) {
      const st = this.stems[s];
      const spec = st.spec;
      const c = chunks[s];
      if (spec.scope && c && out.ghostL && out.ghostR) {
        out.ghostL.set(c.l.subarray(0, n));
        out.ghostR.set(c.r.subarray(0, n));
      }
      for (let b0 = 0; b0 < n; b0 += BLOCK) {
        const b1 = Math.min(n, b0 + BLOCK);
        const t0 = start + b0, t1 = start + b1;
        // automation events up to this block's start
        while (st.si < spec.sends.length && spec.sends[st.si].at <= t0) {
          const e = spec.sends[st.si++];
          st.rev.set(e.at, e.rev, st.rev.at(e.at));
          st.dly.set(e.at, e.dly, st.dly.at(e.at));
          st.cho.set(e.at, e.cho, st.cho.at(e.at));
        }
        if (spec.mute) {
          let target = 1;
          for (const m of spec.mute) if (t0 >= m.from && t0 < m.to) target = 0;
          if (target !== st.muteState) {
            st.mute.set(t0, target, st.mute.at(t0));
            st.muteState = target;
          }
        }
        if (!c) continue;
        const gm0 = st.mute.at(t0), gm1 = st.mute.at(t1);
        if (gm0 === 0 && gm1 === 0) continue;
        const { l, r } = c;
        const hpf = spec.hpf;
        if (hpf && t1 > hpf.from - this.sr * 0.25 && t0 < hpf.to + this.sr * 0.25) this.hpfBlock(st, hpf, l, r, b0, b1, start);
        const k = 1 / (b1 - b0);
        let gm = gm0;
        const dgm = (gm1 - gm0) * k;
        let gr = st.rev.at(t0), gd = st.dly.at(t0), gc = st.cho.at(t0);
        const dgr = (st.rev.at(t1) - gr) * k, dgd = (st.dly.at(t1) - gd) * k, dgc = (st.cho.at(t1) - gc) * k;
        const { dryL, dryR, rev, dly, cho } = out;
        const pan = spec.pan ?? 0;
        const pl = pan > 0 ? 1 - pan : 1, pr = pan < 0 ? 1 + pan : 1;
        const sends = gr !== 0 || dgr !== 0 || gd !== 0 || dgd !== 0 || gc !== 0 || dgc !== 0;
        if (sends) {
          out.sendMask |= (gr !== 0 || dgr !== 0 ? 1 : 0) | (gd !== 0 || dgd !== 0 ? 2 : 0) | (gc !== 0 || dgc !== 0 ? 4 : 0);
          for (let i = b0; i < b1; i++) {
            const xl = l[i] * gm * pl, xr = r[i] * gm * pr;
            dryL[i] += xl;
            dryR[i] += xr;
            const m = (xl + xr) * 0.5;
            rev[i] += m * gr;
            dly[i] += m * gd;
            cho[i] += m * gc;
            gm += dgm;
            gr += dgr;
            gd += dgd;
            gc += dgc;
          }
        } else {
          for (let i = b0; i < b1; i++) {
            dryL[i] += l[i] * gm * pl;
            dryR[i] += r[i] * gm * pr;
            gm += dgm;
          }
        }
        out.active = true;
      }
    }
  }

  /** in-place 8th-order highpass tracking the note, crossfaded in/out at the range edges */
  private hpfBlock(st: StemState, hpf: NonNullable<StemSpec['hpf']>, l: Float32Array, r: Float32Array, b0: number, b1: number, start: number): void {
    const k = 1 / (0.05 * this.sr);
    for (let i = b0; i < b1; i++) {
      const at = start + i;
      let ni = st.hpNote;
      while (ni + 1 < hpf.notes.length && hpf.notes[ni + 1].at <= at) ni++;
      if (ni !== st.hpNote && ni >= 0) {
        st.hpNote = ni;
        const fc = hpf.notes[ni].f0 * hpf.ratio;
        for (let q = 0; q < 4; q++) {
          st.hpL[q].design('hp', this.sr, fc, BUTTER8_Q[q]);
          st.hpR[q].design('hp', this.sr, fc, BUTTER8_Q[q]);
        }
      }
      const xl = l[i], xr = r[i];
      let yl = xl, yr = xr;
      if (st.hpNote >= 0) for (let q = 0; q < 4; q++) (yl = st.hpL[q].tick(yl)), (yr = st.hpR[q].tick(yr));
      const target = at >= hpf.from && at < hpf.to ? 1 : 0;
      st.wet += (target - st.wet) * k;
      l[i] = xl + (yl - xl) * st.wet;
      r[i] = xr + (yr - xr) * st.wet;
    }
  }
}

/** Sum group buses (group order) into `out`; copies the ghost XY of the scope group into ghost arrays. */
export function sumGroups(groups: (Buses | null)[], n: number, out: Buses, ghostL?: Float32Array, ghostR?: Float32Array, start = 0): void {
  out.dryL.fill(0, 0, n);
  out.dryR.fill(0, 0, n);
  out.rev.fill(0, 0, n);
  out.dly.fill(0, 0, n);
  out.cho.fill(0, 0, n);
  out.active = false;
  out.sendMask = 0;
  for (const g of groups) {
    if (!g) continue;
    if (g.ghostL && g.ghostR && ghostL && ghostR && ghostL.length) {
      const m = Math.min(n, ghostL.length - start);
      if (m > 0) {
        ghostL.set(g.ghostL.subarray(0, m), start);
        ghostR.set(g.ghostR.subarray(0, m), start);
      }
    }
    if (!g.active) continue;
    out.active = true;
    out.sendMask |= g.sendMask;
    add(out.dryL, g.dryL, n);
    add(out.dryR, g.dryR, n);
    if (g.sendMask & 1) add(out.rev, g.rev, n);
    if (g.sendMask & 2) add(out.dly, g.dly, n);
    if (g.sendMask & 4) add(out.cho, g.cho, n);
  }
}

/** chorus → ping-pong delay → reverb on the summed sends; writes the wet stereo (overwrites) */
export class FxBus {
  private rev: FdnReverb;
  private dly: PingPong;
  private cho: Chorus;
  private toRev: number;
  /** FX that have received signal (they keep running afterwards for their tails) */
  private live = 0;
  constructor(sr: number, fx: FxSettings, rowSeconds: number) {
    this.rev = new FdnReverb(sr, fx.reverb);
    this.dly = new PingPong(sr, fx.delay, rowSeconds);
    this.cho = new Chorus(sr, fx.chorus);
    this.toRev = fx.delay.toReverb;
  }
  /** rev is modified (the delay feeds it) */
  process(rev: Float32Array, dly: Float32Array, cho: Float32Array, sendMask: number, wetL: Float32Array, wetR: Float32Array, n: number): void {
    wetL.fill(0, 0, n);
    wetR.fill(0, 0, n);
    this.live |= sendMask;
    if (this.live & 2 && this.toRev) this.live |= 1;
    if (this.live & 4) this.cho.process(cho, wetL, wetR, n);
    if (this.live & 2) this.dly.process(dly, wetL, wetR, rev, this.toRev, n);
    if (this.live & 1) this.rev.process(rev, wetL, wetR, n);
  }
}

export interface MasterOptions {
  /** S10 crush: sample ranges [rampStart, full, releaseAt) */
  crush?: { from: number; full: number; release: number; amount: number };
  /**
   * Silence gate on the FX returns (1B:60–63 must be truly silent, but reverb/delay tails ring on):
   * wet ramps to 0 over `ramp` samples before `from`, stays 0 until `to`, then fades back in over `reopen`.
   */
  gate?: { from: number; to: number; ramp: number; reopen: number };
  /** the song end (samples); the tail holds `tailHold` s, then fades to silence at `total` */
  songEnd: number;
  tailHold: number;
}

export class MasterBus {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly ghostL: Float32Array;
  readonly ghostR: Float32Array;
  private sr: number;
  private total: number;
  private comp: Compressor;
  private lim: Limiter;
  private dcL: DcBlock;
  private dcR: DcBlock;
  private crush: Crusher | null;
  private master: number;
  private o: MasterOptions;
  private sumL: Float32Array;
  private sumR: Float32Array;
  private written = 0;

  constructor(sr: number, total: number, fx: FxSettings, chunk: number, ghost: boolean, o: MasterOptions) {
    this.sr = sr;
    this.total = total;
    this.o = o;
    this.left = new Float32Array(total);
    this.right = new Float32Array(total);
    this.ghostL = new Float32Array(ghost ? total : 0);
    this.ghostR = new Float32Array(ghost ? total : 0);
    this.comp = new Compressor(sr, fx.comp);
    this.lim = new Limiter(sr, fx.limiter);
    this.dcL = new DcBlock(sr);
    this.dcR = new DcBlock(sr);
    this.crush = o.crush ? new Crusher(o.crush.amount) : null;
    this.master = Math.pow(10, fx.masterGain / 20);
    this.sumL = new Float32Array(chunk);
    this.sumR = new Float32Array(chunk);
  }

  /** Samples [start, start+n): dry + wet stereo → master chain → output. */
  process(start: number, n: number, dryL: Float32Array, dryR: Float32Array, wetL: Float32Array, wetR: Float32Array): void {
    const L = this.sumL, R = this.sumR, g = this.master;
    const gt = this.o.gate;
    if (gt && start + n > gt.from - gt.ramp && start < gt.to + gt.reopen) {
      for (let i = 0; i < n; i++) {
        const t = start + i;
        let w = 1;
        if (t >= gt.from - gt.ramp && t < gt.from) w = (gt.from - t) / gt.ramp;
        else if (t >= gt.from && t < gt.to) w = 0;
        else if (t >= gt.to && t < gt.to + gt.reopen) w = 0.5 - 0.5 * Math.cos((Math.PI * (t - gt.to)) / gt.reopen);
        L[i] = (dryL[i] + wetL[i] * w) * g;
        R[i] = (dryR[i] + wetR[i] * w) * g;
      }
    } else {
      for (let i = 0; i < n; i++) {
        L[i] = (dryL[i] + wetL[i]) * g;
        R[i] = (dryR[i] + wetR[i]) * g;
      }
    }
    this.out(start, n);
  }

  private out(start: number, n: number): void {
    const L = this.sumL, R = this.sumR;
    this.dcL.process(L, n);
    this.dcR.process(R, n);
    const c = this.o.crush;
    if (this.crush && c && start + n > c.from && start < c.release + this.sr) this.crush.process(L, R, n, start, c);
    this.comp.process(L, R, n);
    this.lim.process(L, R, n);
    // limiter latency: output sample i belongs to time start + i − latency
    const lat = this.lim.latency;
    const fadeFrom = this.o.songEnd + Math.round(this.o.tailHold * this.sr), fadeLen = Math.max(1, this.total - fadeFrom);
    for (let i = 0; i < n; i++) {
      const o = start + i - lat;
      if (o < 0 || o >= this.total) continue;
      let a = L[i], b = R[i];
      if (!(a === a)) a = 0; // NaN guard
      if (!(b === b)) b = 0;
      if (o >= fadeFrom) {
        const u = (o - fadeFrom) / fadeLen;
        const f = 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, u)); // raised-cosine fade to −∞ dB at the end
        a *= f;
        b *= f;
      }
      this.left[o] = a > 1 ? 1 : a < -1 ? -1 : a;
      this.right[o] = b > 1 ? 1 : b < -1 ? -1 : b;
    }
    this.written = Math.max(this.written, start + n - lat);
  }

  /** flush the limiter look-ahead; normalize the ghost XY stem to ±0.9 */
  finish(): void {
    const lat = this.lim.latency;
    this.sumL.fill(0);
    this.sumR.fill(0);
    this.out(this.written + lat, Math.min(this.sumL.length, lat + 1));
    let pk = 0;
    for (let i = 0; i < this.ghostL.length; i++) pk = Math.max(pk, Math.abs(this.ghostL[i]), Math.abs(this.ghostR[i]));
    if (pk > 0) {
      const g = 0.9 / pk;
      for (let i = 0; i < this.ghostL.length; i++) (this.ghostL[i] *= g), (this.ghostR[i] *= g);
    }
  }
}

function add(dst: Float32Array, src: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) dst[i] += src[i];
}
