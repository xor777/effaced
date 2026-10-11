// Node version of renderXm: the same worker roles on worker_threads (bit-identical to the
// browser and to renderInline). Used by tools/render-xm.ts. Not for the browser bundle.

import { Worker, MessageChannel, type MessagePort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import type { RenderOptions, RenderResult } from './types.ts';
import { GROUPS, renderInline } from './engine-core.ts';

export interface NodeRenderStats {
  ms: number;
  workers: number;
  groups: number;
  timing?: { loaded: number; prepared: number; firstChunk: number; master: number; fx?: number; total: number; workers?: unknown[] };
}
export let lastNodeStats: NodeRenderStats | null = null;

export async function renderXmNode(xm: Uint8Array, sampleRate: number, opts: RenderOptions = {}, onProgress?: (p: number) => void): Promise<RenderResult> {
  const t0 = performance.now();
  const W = Math.max(1, Math.min(GROUPS, opts.workers ?? availableParallelism() - 2));
  if (W <= 1) {
    const r = await renderInline(xm, sampleRate, opts, onProgress);
    lastNodeStats = { ms: performance.now() - t0, workers: 0, groups: 0 };
    return r;
  }
  const url = new URL('./node.worker.ts', import.meta.url);
  const mixer = new Worker(url);
  mixer.postMessage({ type: 'warm' });
  const fx = new Worker(url);
  const render: Worker[] = [];
  const ports: MessagePort[] = [];
  for (let i = 0; i < W; i++) {
    const w = new Worker(url);
    const ch = new MessageChannel();
    w.postMessage({ type: 'render', port: ch.port1 }, [ch.port1]);
    ports.push(ch.port2);
    render.push(w);
  }
  const fxCh = new MessageChannel();
  fx.postMessage({ type: 'fx', port: fxCh.port1 }, [fxCh.port1]);
  const reply = new MessageChannel();
  const all = [mixer, fx, ...render];
  try {
    return await new Promise<RenderResult>((resolve, reject) => {
      for (const w of all) w.on('error', reject);
      reply.port1.on('message', (d: { type: string; p: number; result: RenderResult; message: string; groups: number; workers: number; timing: NodeRenderStats['timing'] }) => {
        if (d.type === 'progress') onProgress?.(d.p);
        else if (d.type === 'done') {
          lastNodeStats = { ms: performance.now() - t0, workers: d.workers, groups: d.groups, timing: d.timing };
          resolve(d.result);
        } else if (d.type === 'error') reject(new Error(d.message));
      });
      const { fx: fxs, sends, device, tail, pan } = opts;
      mixer.postMessage(
        { type: 'mix', bytes: xm, sampleRate, opts: { fx: fxs, sends, device, tail, pan }, ports, fxPort: fxCh.port2, reply: reply.port2 },
        [...ports, fxCh.port2, reply.port2],
      );
    });
  } finally {
    reply.port1.close();
    await Promise.all(all.map((w) => w.terminate()));
  }
}
