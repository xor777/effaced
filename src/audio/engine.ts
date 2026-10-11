// Audio engine — the API the demo calls.
//
//   import { renderXm, warmAudioWorkers } from './audio/engine.ts';
//   warmAudioWorkers();                                   // optional, as early as possible
//   const xm = new Uint8Array(await (await fetch('/music/effaced.xm')).arrayBuffer());
//   const res = await renderXm(xm, ctx.sampleRate, { device: 'webaudio' }, (p) => loader.set(p));
//   const buf = new AudioBuffer({ numberOfChannels: 2, length: res.left.length, sampleRate: res.sampleRate });
//   buf.copyToChannel(res.left, 0); buf.copyToChannel(res.right, 1);
//
// The .xm is rendered offline by libopenmpt, one channel per pass, then mixed through the engine
// bus (engine-core.ts, mixer.ts, fx.ts). In the browser: a persistent pool of module workers —
// one mixer (compiles libopenmpt once and shares the compiled module), one FX worker (pipelined
// with the master), and up to GROUPS render workers. Without Worker it runs inline; Node has
// engine-node.ts. All paths give bit-identical output.

import type { RenderOptions, RenderResult } from './types.ts';
import { renderInline, GROUPS, DEVICES } from './engine-core.ts';

export type { RenderOptions, RenderResult };
export { renderInline, DEVICES };

export interface RenderStats {
  ms: number;
  groups: number;
  workers: number;
  mode: 'workers' | 'inline';
  /** mix worker timeline (ms since it started): libopenmpt loaded, plan ready, first chunk summed, time in sum + master, fx worker busy time */
  timing?: { loaded: number; prepared: number; firstChunk: number; master: number; fx?: number; total: number; workers?: unknown[] };
}
/** timing of the last renderXm call (for loaders / benchmarks) */
export let lastRenderStats: RenderStats | null = null;

interface Pool {
  mixer: Worker;
  fx: Worker;
  render: Worker[];
}
let pool: Pool | null = null;

function spawn(): Worker {
  return new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
}

const defaultWorkers = () => Math.max(1, Math.min(GROUPS, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 2));

/** Spawn the worker pool now (module loading and the libopenmpt compile overlap with whatever the page does next). */
export function warmAudioWorkers(workers = defaultWorkers()): void {
  if (typeof Worker === 'undefined') return;
  if (!pool) {
    pool = { mixer: spawn(), fx: spawn(), render: [] };
    pool.mixer.postMessage({ type: 'warm' });
  }
  while (pool.render.length < workers) pool.render.push(spawn());
}

/** Terminate the pool (e.g. after the precalc, to free memory). */
export function disposeAudioWorkers(): void {
  if (!pool) return;
  for (const w of [pool.mixer, pool.fx, ...pool.render]) w.terminate();
  pool = null;
}

/**
 * Render an .xm to a RenderResult (stereo mix, ghost XY stem, envelopes, notes, markers, HUD data).
 * `sampleRate` is used for the 'webaudio' device (pass audioCtx.sampleRate); 'gus' and 'sb16'
 * render at their native rates — always build the AudioBuffer with `result.sampleRate`.
 */
export async function renderXm(xm: Uint8Array, sampleRate: number, opts: RenderOptions = {}, onProgress?: (p: number) => void): Promise<RenderResult> {
  const t0 = performance.now();
  if (typeof Worker === 'undefined') {
    const res = await renderInline(xm, sampleRate, opts, onProgress);
    lastRenderStats = { ms: performance.now() - t0, groups: 0, workers: 0, mode: 'inline' };
    return res;
  }
  const W = Math.max(1, Math.min(GROUPS, opts.workers ?? defaultWorkers()));
  warmAudioWorkers(W);
  const p = pool!;
  const reply = new MessageChannel();
  const fxCh = new MessageChannel();
  const ports: MessagePort[] = [];
  for (let i = 0; i < W; i++) {
    const ch = new MessageChannel();
    p.render[i].postMessage({ type: 'render', port: ch.port1 }, [ch.port1]);
    ports.push(ch.port2);
  }
  p.fx.postMessage({ type: 'fx', port: fxCh.port1 }, [fxCh.port1]);
  try {
    return await new Promise<RenderResult>((resolve, reject) => {
      const onErr = (e: ErrorEvent) => {
        disposeAudioWorkers();
        reject(new Error(`audio worker: ${e.message || 'failed to load'}`));
      };
      for (const w of [p.mixer, p.fx, ...p.render]) w.onerror = onErr;
      reply.port1.onmessage = (e: MessageEvent) => {
        const d = e.data;
        if (d.type === 'progress') onProgress?.(d.p);
        else if (d.type === 'done') {
          lastRenderStats = { ms: performance.now() - t0, groups: d.groups, workers: d.workers, mode: 'workers', timing: d.timing };
          resolve(d.result as RenderResult);
        } else if (d.type === 'error') reject(new Error(d.message));
      };
      const { fx, sends, device, tail, pan } = opts;
      p.mixer.postMessage(
        { type: 'mix', bytes: xm, sampleRate, opts: { fx, sends, device, tail, pan }, ports, fxPort: fxCh.port2, reply: reply.port2 },
        [...ports, fxCh.port2, reply.port2],
      );
    });
  } finally {
    reply.port1.close();
  }
}
