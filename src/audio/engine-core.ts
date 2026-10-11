// Engine core, shared by the inline renderer (Node, tools, main-thread fallback) and the
// browser workers: plan the render (scan, passes, mixer stems), render one libopenmpt pass
// chunk by chunk (one channel solo per pass), and mix.
//
// Determinism: every pass is an independent libopenmpt instance with fixed settings and the
// mixer sums stems in plan order, so workers and the inline path produce identical output.

import { loadOpenMPT, type OpenMPT, type OpenMPTModule, type Interpolation } from './openmpt.ts';
import { scanXm, withTail, SCOPE_SLOT, type Scan } from './scan.ts';
import { type FxSettings, FX_DEFAULTS, mergeFx } from './fx.ts';
import { GroupMixer, FxBus, MasterBus, makeBuses, sumGroups, type StemSpec, type Stereo, type Buses, type MasterOptions } from './mixer.ts';
import { ScopeSynth, SCOPE_DEFAULTS, sigilTables, type ScopeEvent } from './synth/scope.ts';
import { BANK } from './synth/bank.ts';
import { type Device, type RenderOptions, type RenderResult, ENV_RATE, CHANNELS, GHOST_CH, MARKER_CH } from './types.ts';

export const CHUNK = 16384; // frames per chunk (multiple of 64: FX control rates stay aligned)
/** passes are summed in this many fixed groups (one per render worker at most) */
export const GROUPS = 6;

/**
 * The setup screen's devices: render rate + libopenmpt interpolation. Rates must be multiples of
 * 50 Hz: libopenmpt rounds a tick (sr / 50 at BPM 125) to whole samples, and a fractional tick
 * would make the song drift against the event times (the real GUS rate 617400/16 = 38587.5 Hz
 * drifts 0.24 s over the track, so we use 38600).
 */
export const DEVICES: Record<Device, { rate: number | null; interpolation: Interpolation; label: string }> = {
  webaudio: { rate: null, interpolation: 8, label: 'Web Audio — requested rate, 8-tap windowed sinc' },
  gus: { rate: 38600, interpolation: 2, label: 'Gravis Ultrasound — 38.6 kHz (GUS, 16 voices), linear interpolation' },
  sb16: { rate: 22050, interpolation: 1, label: 'Sound Blaster 16 — 22.05 kHz, no interpolation' },
};

/** Engine-side channel processing (MUSIC_BRIEF §7/§8): positions are [from, to). */
export const ENGINE_RULES: { ch: number; from: number; to: number; op: 'missingFundamental' | 'mute' }[] = [
  { ch: 5, from: 0x0d, to: 0x0f, op: 'missingFundamental' }, // bass: cut the fundamental, keep harmonics
  { ch: 6, from: 0x0d, to: 0x0f, op: 'mute' }, // sub: removed entirely
];
/** highpass corner as a multiple of the bass note's fundamental (8th-order Butterworth: f0 −33 dB, 2·f0 −0.1 dB) */
export const MISSING_FUNDAMENTAL_RATIO = 1.6;

/** engine-side channel pan (balance on the stem), so the tracker file can stay centred: lead right, echo left */
export const CHANNEL_PAN: Record<number, number> = { 10: 0.3, 11: -0.45 };

/** S10 "compression": the master crush ramps in over [from, full) and is released at `release` — [pos, row] */
export const CRUSH = { from: [0x14, 32], full: [0x15, 63], release: [0x16, 0] } as const;
/** one beat of true silence (MUSIC_BRIEF §7, 1B:60–63): FX returns gated over [from, to) — [pos, row] */
export const SILENCE = { from: [0x1b, 60], to: [0x1c, 0] } as const;

export interface PassSpec {
  /** tracker channel 1..18 rendered solo */
  ch: number;
  /** 'stem' = the channel's audio; 'scope' = the scope slot on the ghost channel, turned into XY */
  kind: 'stem' | 'scope';
  /** instrument slots muted in this pass */
  muteIns: number[];
  /** estimated cost for worker balancing */
  cost: number;
}

export interface Plan {
  sr: number;
  device: Device;
  interpolation: Interpolation;
  /** frames including the tail */
  total: number;
  chunk: number;
  rowSeconds: number;
  tail: number;
  /** extra empty positions appended for the tail */
  tailPositions: number;
  passes: PassSpec[];
  /** mixer spec per pass (same index) */
  stems: StemSpec[];
  /** pass indices per group, fixed by the plan (independent of the core count) */
  groups: number[][];
  scopeEvents: ScopeEvent[];
  fx: FxSettings;
  master: MasterOptions;
  envFrames: number;
}

export type Prepared = { plan: Plan; scan: Scan; tailBytes: Uint8Array };

function sendsFor(slot: number, over?: RenderOptions['sends']): { rev: number; dly: number; cho: number } {
  const o = over?.[slot];
  const b = BANK.find((x) => x.slot === slot)?.sends ?? { reverb: 0.2, delay: 0, chorus: 0 };
  return { rev: o?.reverb ?? b.reverb, dly: o?.delay ?? b.delay, cho: o?.chorus ?? b.chorus };
}

/** Scan the module and plan passes + mixer. `mpt` is used for timing (position starts). */
export function prepare(mpt: OpenMPT, bytes: Uint8Array, requestedRate: number, opts: RenderOptions = {}): Prepared {
  const device = opts.device ?? 'webaudio';
  const dev = DEVICES[device];
  const sr = dev.rate ?? requestedRate;
  if ((sr * 2.5) / 125 !== Math.round((sr * 2.5) / 125)) console.warn(`[audio] ${sr} Hz: a tick is not a whole number of samples — events will drift`);
  const tail = opts.tail ?? 12;
  // position start times from libopenmpt
  const m = mpt.open(bytes);
  let posTime: number[];
  try {
    const n = m.numOrders;
    posTime = [];
    for (let o = 0; o < n; o++) posTime.push(m.timeAt(o, 0));
    posTime.push(m.duration);
  } finally {
    m.destroy();
  }
  const scan = scanXm(bytes, posTime);
  const duration = posTime[posTime.length - 1];
  const rowSeconds = scan.xm.order.length ? (posTime[1] - posTime[0]) / (scan.xm.patterns[scan.xm.order[0]]?.rows || 64) : 0.12;
  const tailPositions = Math.max(1, Math.ceil(tail / (64 * rowSeconds)) + 1);
  const tailBytes = withTail(bytes, tailPositions);
  const total = Math.round((duration + tail) * sr);
  const S = (t: number) => Math.round(t * sr);
  const posAt = (p: number) => posTime[Math.min(p, posTime.length - 1)];

  const passes: PassSpec[] = [];
  const stems: StemSpec[] = [];
  const notesOn = (ch: number) => scan.notes.filter((n) => n.ch === ch).length;
  for (let ch = 1; ch <= scan.xm.channels && ch <= CHANNELS; ch++) {
    if (ch === MARKER_CH || !scan.used[ch - 1]) continue;
    const isGhost = ch === GHOST_CH;
    if (isGhost && !scan.ghostOther) continue;
    passes.push({ ch, kind: 'stem', muteIns: isGhost ? [SCOPE_SLOT] : [], cost: 1 + notesOn(ch) / 200 });
    const spec: StemSpec = {
      ch,
      sends: scan.insTimeline[ch - 1].map((c) => ({ at: S(c.t), ...sendsFor(c.slot, opts.sends) })),
      pan: opts.pan?.[ch] ?? CHANNEL_PAN[ch] ?? 0,
    };
    for (const r of ENGINE_RULES) {
      if (r.ch !== ch || r.from >= scan.xm.order.length) continue;
      const from = S(posAt(r.from)), to = S(posAt(r.to));
      if (r.op === 'mute') (spec.mute ??= []).push({ from, to });
      else
        spec.hpf = {
          from,
          to,
          ratio: MISSING_FUNDAMENTAL_RATIO,
          notes: scan.notes.filter((n) => n.ch === ch).map((n) => ({ at: S(n.t), f0: 440 * Math.pow(2, (n.midi - 69) / 12) })),
        };
    }
    stems.push(spec);
  }
  if (scan.ghostScope) {
    passes.push({ ch: GHOST_CH, kind: 'scope', muteIns: [], cost: 1.5 });
    const s = sendsFor(SCOPE_SLOT, opts.sends);
    stems.push({ ch: GHOST_CH, scope: true, sends: [{ at: 0, ...s }] });
  }
  const scopeEvents: ScopeEvent[] = scan.scopeEvents.map((e) => ({ at: S(e.t), f: e.f, morph: e.morph }));
  // fixed groups, balanced by estimated cost (longest-processing-time first, deterministic)
  const G = Math.min(GROUPS, passes.length);
  const groups: number[][] = Array.from({ length: G }, () => []);
  const load = new Array(G).fill(0);
  passes
    .map((p, i) => ({ i, c: p.cost }))
    .sort((a, b) => b.c - a.c || a.i - b.i)
    .forEach(({ i, c }) => {
      let g = 0;
      for (let k = 1; k < G; k++) if (load[k] < load[g]) g = k;
      groups[g].push(i);
      load[g] += c;
    });
  for (const g of groups) g.sort((a, b) => a - b);
  scan.track.tail = tail;
  const fx = mergeFx(FX_DEFAULTS, opts.fx);
  const at = ([p, r]: readonly [number, number]) => {
    const pat = scan.xm.patterns[scan.xm.order[p]];
    const rows = pat?.rows ?? 64;
    return S(posAt(p) + ((posAt(p + 1) - posAt(p)) * r) / rows);
  };
  const master: MasterOptions = {
    songEnd: S(duration),
    tailHold: fx.tailHold,
    ...(fx.crush > 0 && scan.xm.order.length > CRUSH.release[0] ? { crush: { from: at(CRUSH.from), full: at(CRUSH.full), release: at(CRUSH.release), amount: fx.crush } } : {}),
    ...(scan.xm.order.length > SILENCE.to[0] ? { gate: { from: at(SILENCE.from), to: at(SILENCE.to), ramp: S(0.005), reopen: S(2) } } : {}),
  };
  const plan: Plan = {
    sr,
    device,
    interpolation: dev.interpolation,
    total,
    chunk: CHUNK,
    rowSeconds,
    tail,
    tailPositions,
    passes,
    stems,
    groups,
    scopeEvents,
    fx,
    master,
    envFrames: Math.ceil((total / sr) * ENV_RATE),
  };
  return { plan, scan, tailBytes };
}

// ---------------------------------------------------------------------------------------------

/**
 * RMS (L,R mean) of the XY figure at amplitude 1 (average of the sigil and the Lissajous, times
 * the output size), to level-match the XY stem to libopenmpt's render of the mono preview sample
 */
let xyUnitRms = 0;
function unitRms(): number {
  if (xyUnitRms) return xyUnitRms;
  const t = sigilTables()[6];
  let s = 0;
  for (let i = 0; i < t.x.length - 1; i++) s += 0.5 * (t.x[i] * t.x[i] + t.y[i] * t.y[i]);
  const sig = Math.sqrt(s / (t.x.length - 1));
  return (xyUnitRms = 0.5 * (sig + Math.SQRT1_2) * SCOPE_DEFAULTS.size);
}

/** One libopenmpt instance rendering one channel solo, chunk by chunk, with its RMS envelope. */
export class PassRenderer {
  readonly pass: PassSpec;
  readonly env: Float32Array;
  private m: OpenMPTModule;
  private plan: Plan;
  private pos = 0;
  private done = false;
  // envelope accumulation
  private ef = 0;
  private eAcc = 0;
  private eN = 0;
  // scope
  private scope: ScopeSynth | null = null;
  private amp = 0;
  private ampK = 0;
  private blk = 0;
  private blkAcc = 0;
  private blkN = 0;
  private tmpL: Float32Array;
  private tmpR: Float32Array;
  private ampBuf: Float32Array;

  constructor(mpt: OpenMPT, tailBytes: Uint8Array, plan: Plan, pass: PassSpec) {
    this.pass = pass;
    this.plan = plan;
    this.env = new Float32Array(plan.envFrames);
    this.m = mpt.open(tailBytes);
    this.m.setRender({ interpolation: plan.interpolation });
    const nch = this.m.numChannels;
    for (let c = 0; c < nch; c++) this.m.setChannelMute(c, c !== pass.ch - 1);
    if (pass.kind === 'scope') {
      const nins = this.m.numInstruments;
      for (let i = 0; i < nins; i++) this.m.setInstrumentMute(i, i !== SCOPE_SLOT - 1);
      this.scope = new ScopeSynth(plan.scopeEvents, plan.sr, SCOPE_DEFAULTS);
      this.ampK = 1 - Math.exp(-1 / (0.003 * plan.sr));
    } else for (const s of pass.muteIns) this.m.setInstrumentMute(s - 1, true);
    this.tmpL = new Float32Array(plan.chunk);
    this.tmpR = new Float32Array(plan.chunk);
    this.ampBuf = new Float32Array(plan.chunk);
  }

  /**
   * Render the next n frames into out (overwrites). Returns false if the chunk is silent (out is
   * zero-filled either way).
   */
  next(out: Stereo, n: number): boolean {
    const { l, r } = out;
    let got = 0;
    if (!this.done) {
      const L = this.scope ? this.tmpL : l, R = this.scope ? this.tmpR : r;
      while (got < n) {
        const k = this.m.read(L, R, this.plan.sr, n - got, got);
        if (!k) {
          this.done = true;
          break;
        }
        got += k;
      }
      if (got < n) (L.fill(0, got, n), R.fill(0, got, n));
    } else {
      (this.scope ? this.tmpL : l).fill(0, 0, n);
      (this.scope ? this.tmpR : r).fill(0, 0, n);
    }
    if (this.scope) {
      // amplitude follower on libopenmpt's mono preview (128-sample RMS blocks, 3 ms smoothing)
      const a = this.tmpL, b = this.tmpR, amp = this.ampBuf;
      const inv = 1 / unitRms();
      for (let i = 0; i < n; i++) {
        this.blkAcc += 0.5 * (a[i] * a[i] + b[i] * b[i]);
        if (++this.blkN === 128) {
          this.blk = Math.sqrt(this.blkAcc / 128) * inv;
          this.blkAcc = 0;
          this.blkN = 0;
        }
        this.amp += (this.blk - this.amp) * this.ampK;
        amp[i] = this.amp < 1e-7 ? 0 : this.amp;
      }
      this.scope.render(this.pos, n, amp, l, r);
    }
    // envelope + silence check
    let any = false;
    const sr = this.plan.sr;
    for (let i = 0; i < n; i++) {
      const v = 0.5 * (l[i] * l[i] + r[i] * r[i]);
      if (v !== 0) any = true;
      this.eAcc += v;
      this.eN++;
      const frameEnd = Math.floor(((this.ef + 1) * sr) / ENV_RATE);
      if (this.pos + i + 1 >= frameEnd) {
        if (this.ef < this.env.length) this.env[this.ef] = Math.sqrt((2 * this.eAcc) / Math.max(1, this.eN));
        this.ef++;
        this.eAcc = 0;
        this.eN = 0;
      }
    }
    this.pos += n;
    return any;
  }

  destroy(): void {
    this.m.destroy();
  }
}

/** Assemble the result once the master bus is finished. envs: pass index → envelope. */
export function assemble(prep: { plan: Plan; scan: Scan }, master: MasterBus, envs: Float32Array[]): RenderResult {
  const { plan, scan } = prep;
  const env: Float32Array[] = [];
  for (let ch = 1; ch <= CHANNELS; ch++) {
    const e = new Float32Array(plan.envFrames);
    plan.passes.forEach((p, i) => {
      if (p.ch !== ch || !envs[i]) return;
      const x = envs[i];
      for (let f = 0; f < e.length; f++) e[f] = Math.hypot(e[f], x[f] ?? 0);
    });
    // the engine's mute rule also silences the envelope (the picture should not pulse to an inaudible sub)
    const pt = scan.track.posTime;
    for (const r of ENGINE_RULES)
      if (r.ch === ch && r.op === 'mute' && r.from < pt.length - 1) {
        const a = Math.floor(pt[r.from] * ENV_RATE), b = Math.floor(pt[Math.min(r.to, pt.length - 1)] * ENV_RATE);
        e.fill(0, Math.max(0, a), Math.min(e.length, b));
      }
    env.push(e);
  }
  return {
    sampleRate: plan.sr,
    left: master.left,
    right: master.right,
    ghostL: master.ghostL.length ? master.ghostL : new Float32Array(plan.total),
    ghostR: master.ghostR.length ? master.ghostR : new Float32Array(plan.total),
    env,
    notes: scan.notes,
    markers: scan.markers,
    track: scan.track,
  };
}

/** Renders one group of passes and sums it into group buses, chunk by chunk (used by workers and inline). */
export class GroupRenderer {
  readonly passIdx: number[];
  readonly renderers: PassRenderer[];
  /** the bus buffers the next chunk is written to (workers swap the arrays after each chunk) */
  readonly buses: Buses;
  private mixer: GroupMixer;
  private bufs: Stereo[];
  private chunks: (Stereo | null)[];
  constructor(mpt: OpenMPT, tailBytes: Uint8Array, plan: Plan, group: number[]) {
    this.passIdx = group;
    this.renderers = group.map((i) => new PassRenderer(mpt, tailBytes, plan, plan.passes[i]));
    this.mixer = new GroupMixer(plan.sr, group.map((i) => plan.stems[i]));
    this.buses = makeBuses(plan.chunk, group.some((i) => plan.stems[i].scope));
    this.bufs = group.map(() => ({ l: new Float32Array(plan.chunk), r: new Float32Array(plan.chunk) }));
    this.chunks = group.map(() => null);
  }
  /** render + sum frames [start, start+n) into this.buses (dry stereo + sends) */
  next(start: number, n: number): Buses {
    for (let k = 0; k < this.renderers.length; k++) this.chunks[k] = this.renderers[k].next(this.bufs[k], n) ? this.bufs[k] : null;
    this.mixer.process(start, n, this.chunks, this.buses);
    return this.buses;
  }
  destroy(): void {
    for (const r of this.renderers) r.destroy();
  }
}

/** Render in the calling thread (Node tools, tests, main-thread fallback). */
export async function renderInline(bytes: Uint8Array, sampleRate: number, opts: RenderOptions = {}, onProgress?: (p: number) => void): Promise<RenderResult> {
  const mpt = await loadOpenMPT();
  const prep = prepare(mpt, bytes, sampleRate, opts);
  const { plan, tailBytes } = prep;
  const groups = plan.groups.map((g) => new GroupRenderer(mpt, tailBytes, plan, g));
  const master = new MasterBus(plan.sr, plan.total, plan.fx, plan.chunk, plan.stems.some((s) => s.scope), plan.master);
  const fx = new FxBus(plan.sr, plan.fx, plan.rowSeconds);
  const sum = makeBuses(plan.chunk, false);
  const wetL = new Float32Array(plan.chunk), wetR = new Float32Array(plan.chunk);
  try {
    for (let start = 0; start < plan.total; start += plan.chunk) {
      const n = Math.min(plan.chunk, plan.total - start);
      sumGroups(groups.map((g) => g.next(start, n)), n, sum, master.ghostL, master.ghostR, start);
      fx.process(sum.rev, sum.dly, sum.cho, sum.sendMask, wetL, wetR, n);
      master.process(start, n, sum.dryL, sum.dryR, wetL, wetR);
      onProgress?.((start + n) / plan.total);
    }
    master.finish();
  } finally {
    for (const g of groups) g.destroy();
  }
  const envs: Float32Array[] = [];
  for (const g of groups) g.renderers.forEach((r, k) => (envs[g.passIdx[k]] = r.env));
  return assemble(prep, master, envs);
}
