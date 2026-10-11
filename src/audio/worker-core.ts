// The engine's worker roles, independent of the worker API (browser module workers and Node
// worker_threads both provide MessagePort with addEventListener/start/postMessage).
//  'mix'    — loads libopenmpt (compiles the wasm once and shares the compiled module with the
//             other workers), plans the render, hands groups to the render workers, sums their
//             buses in group order, sends the summed FX sends to the fx worker and runs the master
//             bus on dry + wet, returns the RenderResult.
//  'render' — renders its groups chunk by chunk (libopenmpt passes → group buses) and streams them
//             to the mixer with back-pressure.
//  'fx'     — chorus, ping-pong delay and reverb on the summed sends, chunk by chunk (pipelined
//             with the master bus).
// A worker can serve several jobs over its life (the browser keeps a pool); every job talks over
// its own MessagePorts.

import { loadOpenMPT, compiledOpenMPT } from './openmpt.ts';
import { prepare, GroupRenderer, assemble, type Plan } from './engine-core.ts';
import { MasterBus, FxBus, sumGroups, type Buses } from './mixer.ts';
import type { FxSettings } from './fx.ts';
import type { RenderOptions, RenderResult } from './types.ts';

const MAX_AHEAD = 6; // chunks a render worker may run ahead of the mixer

export interface PortLike {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
  start(): void;
  close?(): void;
}
export type Post = (m: unknown, transfer?: Transferable[]) => void;

export type WorkerRequest =
  | { type: 'mix'; bytes: Uint8Array; sampleRate: number; opts: RenderOptions; ports: PortLike[]; fxPort: PortLike; reply: PortLike }
  | { type: 'render'; port: PortLike }
  | { type: 'fx'; port: PortLike }
  | { type: 'warm' };

/** entry point for both worker flavours */
export function handle(m: WorkerRequest, _post?: Post): void {
  if (m.type === 'mix') {
    const reply: Post = (x, t) => m.reply.postMessage(x, t);
    mixRole(m, reply).catch((err) => reply({ type: 'error', message: String(err?.stack ?? err) }));
  } else if (m.type === 'render') renderRole(m.port);
  else if (m.type === 'fx') fxRole(m.port);
  else if (m.type === 'warm') void loadOpenMPT(); // the mixer compiles libopenmpt early; the others reuse its module
}

const BUS_KEYS = ['dryL', 'dryR', 'rev', 'dly', 'cho', 'ghostL', 'ghostR'] as const;

interface PlanMsg {
  type: 'plan';
  plan: Plan;
  tailBytes: Uint8Array;
  groups: number[];
  wasm: WebAssembly.Module | null;
}

// ---------------------------------------------------------------------------------------------

function renderRole(port: PortLike): void {
  let acked = -1;
  let wake: (() => void) | null = null;
  const pool: Float32Array[] = [];
  port.addEventListener('message', (e) => {
    const d = e.data as { type: string; k?: number; bufs?: Float32Array[] };
    if (d.type === 'ack') {
      acked = Math.max(acked, d.k!);
      for (const b of d.bufs!) pool.push(b);
      wake?.();
      wake = null;
    } else if (d.type === 'quit') port.close?.();
    else if (d.type === 'plan') run(d as unknown as PlanMsg).catch((err) => port.postMessage({ type: 'error', message: String((err as Error)?.stack ?? err) }));
  });
  port.start();
  const take = (n: number) => {
    const i = pool.findIndex((b) => b.length === n);
    return i >= 0 ? pool.splice(i, 1)[0] : new Float32Array(n);
  };

  async function run({ plan, tailBytes, groups, wasm }: PlanMsg): Promise<void> {
    const tw0 = performance.now();
    const mpt = await loadOpenMPT(wasm ?? undefined);
    const grs = groups.map((g) => new GroupRenderer(mpt, tailBytes, plan, plan.groups[g]));
    const tOpen = performance.now() - tw0;
    let tWork = 0, tWait = 0;
    try {
      for (let start = 0, k = 0; start < plan.total; start += plan.chunk, k++) {
        const tw = performance.now();
        while (k - acked > MAX_AHEAD) await new Promise<void>((res) => (wake = res));
        const tr = performance.now();
        tWait += tr - tw;
        const n = Math.min(plan.chunk, plan.total - start);
        const outs: { g: number; b: Buses }[] = [];
        const transfer: Transferable[] = [];
        grs.forEach((gr, i) => {
          const b = gr.next(start, n);
          const sent: Buses = { ...b };
          // the group continues with recycled arrays; only sends that carry signal travel
          for (const key of BUS_KEYS) {
            const a = b[key];
            if (!a) continue;
            const used = key === 'rev' ? b.sendMask & 1 : key === 'dly' ? b.sendMask & 2 : key === 'cho' ? b.sendMask & 4 : 1;
            if (!used || !b.active) {
              if (key.startsWith('ghost')) {
                transfer.push(a.buffer);
                b[key] = take(plan.chunk);
              } else (sent as unknown as Record<string, unknown>)[key] = undefined;
              continue;
            }
            transfer.push(a.buffer);
            b[key] = take(plan.chunk);
          }
          outs.push({ g: groups[i], b: sent });
        });
        port.postMessage({ type: 'chunk', k, start, n, outs }, transfer);
        tWork += performance.now() - tr;
      }
      const envs = grs.flatMap((gr) => gr.renderers.map((r, j) => ({ pass: gr.passIdx[j], env: r.env })));
      port.postMessage({ type: 'env', envs, stats: { open: tOpen, work: tWork, wait: tWait } }, envs.map((x) => x.env.buffer));
    } finally {
      for (const g of grs) g.destroy();
    }
  }
}

// ---------------------------------------------------------------------------------------------

function fxRole(port: PortLike): void {
  let bus: FxBus | null = null;
  let tWork = 0;
  port.addEventListener('message', (e) => {
    const d = e.data as { type: string; sr: number; fx: FxSettings; rowSeconds: number; k: number; n: number; rev: Float32Array; dly: Float32Array; cho: Float32Array; mask: number };
    if (d.type === 'init') {
      bus = new FxBus(d.sr, d.fx, d.rowSeconds);
      tWork = 0;
    } else if (d.type === 'chunk' && bus) {
      const t = performance.now();
      const l = new Float32Array(d.rev.length), r = new Float32Array(d.rev.length);
      bus.process(d.rev, d.dly, d.cho, d.mask, l, r, d.n);
      tWork += performance.now() - t;
      port.postMessage({ type: 'wet', k: d.k, l, r, used: [d.rev, d.dly, d.cho], work: tWork }, [l.buffer, r.buffer, d.rev.buffer, d.dly.buffer, d.cho.buffer]);
    } else if (d.type === 'quit') port.close?.();
  });
  port.start();
}

// ---------------------------------------------------------------------------------------------

async function mixRole({ bytes, sampleRate, opts, ports, fxPort }: Extract<WorkerRequest, { type: 'mix' }>, post: Post): Promise<void> {
  const t0 = performance.now();
  const mpt = await loadOpenMPT();
  const tLoaded = performance.now() - t0;
  const prep = prepare(mpt, bytes, sampleRate, opts);
  const tPrepared = performance.now() - t0;
  let tFirst = 0, tMaster = 0, fxWork = 0;
  const { plan, tailBytes } = prep;
  const G = plan.groups.length;
  const W = Math.min(ports.length, G);
  const assign: number[][] = Array.from({ length: W }, () => []);
  for (let g = 0; g < G; g++) assign[g % W].push(g);
  const master = new MasterBus(plan.sr, plan.total, plan.fx, plan.chunk, plan.stems.some((s) => s.scope), plan.master);
  const nChunks = Math.ceil(plan.total / plan.chunk);
  const free: Float32Array[] = [];
  const take = () => free.pop() ?? new Float32Array(plan.chunk);
  const zero = new Float32Array(plan.chunk);
  type Pending = { start: number; n: number; groups: (Buses | null)[]; count: number; from: Map<number, Float32Array[]> };
  const pending = new Map<number, Pending>();
  const dryWait = new Map<number, { start: number; n: number; l: Float32Array; r: Float32Array }>();
  const envs: Float32Array[] = [];
  const workerStats: unknown[] = [];
  let nextSum = 0, nextMaster = 0, envCount = 0, lastProgress = -1;

  fxPort.postMessage({ type: 'init', sr: plan.sr, fx: plan.fx, rowSeconds: plan.rowSeconds });

  const done = new Promise<void>((resolve, reject) => {
    const finishIfDone = () => {
      if (nextMaster === nChunks && envCount === W) resolve();
    };
    // stage 1: group buses → sums → fx worker
    const drain = () => {
      for (;;) {
        const c = pending.get(nextSum);
        if (!c || c.count < G) break;
        if (!tFirst) tFirst = performance.now() - t0;
        const tm = performance.now();
        const sum: Buses = { dryL: take(), dryR: take(), rev: take(), dly: take(), cho: take(), active: false, sendMask: 0 };
        // missing sends are zero
        for (const g of c.groups) if (g) for (const key of ['rev', 'dly', 'cho'] as const) if (!g[key]) g[key] = zero;
        sumGroups(c.groups, c.n, sum, master.ghostL, master.ghostR, c.start);
        tMaster += performance.now() - tm;
        fxPort.postMessage({ type: 'chunk', k: nextSum, n: c.n, rev: sum.rev, dly: sum.dly, cho: sum.cho, mask: sum.sendMask }, [sum.rev.buffer, sum.dly.buffer, sum.cho.buffer]);
        dryWait.set(nextSum, { start: c.start, n: c.n, l: sum.dryL, r: sum.dryR });
        pending.delete(nextSum);
        for (const [w, bufs] of c.from) ports[w].postMessage({ type: 'ack', k: nextSum, bufs }, bufs.map((b) => b.buffer));
        nextSum++;
      }
    };
    // stage 2: wet from the fx worker → master
    fxPort.addEventListener('message', (e) => {
      const d = e.data as { type: string; k: number; l: Float32Array; r: Float32Array; used: Float32Array[]; work: number };
      if (d.type !== 'wet') return;
      const dry = dryWait.get(d.k)!;
      dryWait.delete(d.k);
      const tm = performance.now();
      master.process(dry.start, dry.n, dry.l, dry.r, d.l, d.r);
      tMaster += performance.now() - tm;
      free.push(dry.l, dry.r, ...d.used);
      fxWork = d.work;
      nextMaster++;
      const p = Math.floor((nextMaster / nChunks) * 100);
      if (p !== lastProgress) post({ type: 'progress', p: nextMaster / nChunks });
      lastProgress = p;
      finishIfDone();
    });
    fxPort.start();
    ports.slice(0, W).forEach((port, w) => {
      port.addEventListener('message', (e) => {
        const d = e.data as { type: string; k: number; start: number; n: number; outs: { g: number; b: Buses }[]; envs: { pass: number; env: Float32Array }[]; message: string; stats: unknown };
        if (d.type === 'chunk') {
          let c = pending.get(d.k);
          if (!c) pending.set(d.k, (c = { start: d.start, n: d.n, groups: new Array(G).fill(null), count: 0, from: new Map() }));
          const back = c.from.get(w) ?? [];
          for (const o of d.outs) {
            c.groups[o.g] = o.b;
            c.count++;
            for (const key of BUS_KEYS) {
              const a = o.b[key];
              if (a) back.push(a);
            }
          }
          c.from.set(w, back);
          drain();
        } else if (d.type === 'env') {
          for (const { pass, env } of d.envs) envs[pass] = env;
          workerStats[w] = d.stats;
          envCount++;
          finishIfDone();
        } else if (d.type === 'error') reject(new Error(d.message));
      });
      port.start();
    });
  });
  const wasm = compiledOpenMPT();
  for (let w = 0; w < W; w++) ports[w].postMessage({ type: 'plan', plan, tailBytes, groups: assign[w], wasm } satisfies PlanMsg);
  for (let w = W; w < ports.length; w++) ports[w].postMessage({ type: 'quit' });
  await done;
  fxPort.postMessage({ type: 'quit' });
  master.finish();
  const res: RenderResult = assemble(prep, master, envs);
  const timing = { loaded: tLoaded, prepared: tPrepared, firstChunk: tFirst, master: tMaster, fx: fxWork, total: performance.now() - t0, workers: workerStats };
  const transfer = [res.left, res.right, res.ghostL, res.ghostR, ...res.env].map((a) => a.buffer);
  post({ type: 'done', result: res, ms: performance.now() - t0, groups: G, workers: W, timing }, transfer);
}

