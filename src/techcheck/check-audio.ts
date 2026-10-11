// I. Audio basics (needs a user gesture → button) and workers (automatic).
import type { Ctx } from './main.ts';
import { fmt, r2, r3, sleep, linfit, stdev, median, errMsg, mean } from './util.ts';

// ------------------------------------------------------------------------------------------ workers

function spawn(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'techcheck' });
}
function call<T>(w: Worker, msg: unknown, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const on = (e: MessageEvent) => {
      w.removeEventListener('message', on);
      w.removeEventListener('error', onErr);
      resolve(e.data as T);
    };
    const onErr = (e: ErrorEvent) => {
      w.removeEventListener('message', on);
      w.removeEventListener('error', onErr);
      reject(new Error(e.message || 'worker error'));
    };
    w.addEventListener('message', on);
    w.addEventListener('error', onErr);
    w.postMessage(msg, transfer);
  });
}

export async function checkWorkers(c: Ctx) {
  const hc = navigator.hardwareConcurrency;
  c.add('navigator.hardwareConcurrency', String(hc), hc >= 8 ? 'PASS' : 'WARN', 'track pre-render fan-out');
  const dm = (navigator as any).deviceMemory;
  if (dm !== undefined) c.add('navigator.deviceMemory', `${dm} GB (capped by spec)`, 'INFO');

  // performance.now() resolution (affects every timing in this page)
  {
    let minD = Infinity;
    let last = performance.now();
    const end = last + 30;
    while (true) {
      const t = performance.now();
      if (t !== last) {
        minD = Math.min(minD, t - last);
        last = t;
      }
      if (t > end) break;
    }
    c.add('performance.now() resolution', `${fmt(minD * 1000, 1)} µs`, 'INFO', crossOriginIsolated ? 'cross-origin isolated (5 µs class)' : 'not isolated (100 µs class + jitter)');
  }

  // module worker spawn + echo
  let w: Worker;
  try {
    const t0 = performance.now();
    w = spawn();
    const r = await call<{ t: number; wt: number }>(w, { kind: 'ping', t: t0 });
    c.add('Module worker (type: "module") spawn → first reply', `${fmt(performance.now() - t0, 1)} ms`, 'PASS', 'new Worker(new URL("./worker.ts", import.meta.url), {type:"module"})', r);
  } catch (e) {
    c.add('Module worker', errMsg(e), 'FAIL');
    return;
  }

  // transferable round trip (64 MB ≈ 4:30 mono float at 48 kHz × ~1.2)
  try {
    const bytes = 64 * 1024 * 1024;
    const buf = new ArrayBuffer(bytes);
    const t0 = performance.now();
    const r = await call<{ bytes: number; buf: ArrayBuffer }>(w, { kind: 'transfer', buf }, [buf]);
    const dt = performance.now() - t0;
    const detached = buf.byteLength === 0;
    c.add('Transferable ArrayBuffer 64 MB round trip', `${fmt(dt, 2)} ms`, detached && r.buf.byteLength === bytes ? 'PASS' : 'FAIL', `zero-copy: sender detached = ${detached}`);
  } catch (e) {
    c.add('Transferable round trip', errMsg(e), 'FAIL');
  }

  // OffscreenCanvas WebGL2 in a worker
  try {
    const r = await call<{ res: string }>(w, { kind: 'offscreen' });
    c.add('OffscreenCanvas + WebGL2 inside worker', r.res, r.res.startsWith('webgl2 ok') ? 'PASS' : 'WARN');
  } catch (e) {
    c.add('OffscreenCanvas in worker', errMsg(e), 'WARN');
  }

  // cross-origin isolation / SAB
  const sab = typeof SharedArrayBuffer !== 'undefined';
  c.add(
    'crossOriginIsolated / SharedArrayBuffer',
    `${crossOriginIsolated} / ${sab ? 'available' : 'unavailable'}`,
    crossOriginIsolated ? 'PASS' : 'INFO',
    crossOriginIsolated
      ? ''
      : 'Vite dev server would need server.headers {"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp"} (and the same on the release host). Only needed for SAB/Atomics or 5 µs timers — transferables are enough for a pre-rendered track.',
  );
  if (sab && crossOriginIsolated) {
    try {
      const s = new SharedArrayBuffer(4);
      await call(w, { kind: 'sab', sab: s });
      c.add('SAB + Atomics with worker', String(new Int32Array(s)[0] === 42), 'PASS');
    } catch (e) {
      c.add('SAB + Atomics', errMsg(e), 'FAIL');
    }
  }
  w.terminate();

  // parallel scaling: 16 jobs of additive synthesis (≈ one 4 s channel each)
  c.progress('I · worker scaling (additive synth jobs)');
  const JOBS = 16;
  const job = (j: number) => ({ kind: 'synth', job: j, seconds: 4, sr: 48000, partials: 24 });
  const runPool = async (n: number) => {
    const ws = Array.from({ length: n }, spawn);
    await Promise.all(ws.map((x) => call(x, { kind: 'ping', t: 0 })));
    const t0 = performance.now();
    let next = 0;
    const perJob: number[] = [];
    await Promise.all(
      ws.map(async (x) => {
        while (next < JOBS) {
          const j = next++;
          const r = await call<{ ms: number }>(x, job(j));
          perJob.push(r.ms);
        }
      }),
    );
    const dt = performance.now() - t0;
    ws.forEach((x) => x.terminate());
    return { dt, perJob: mean(perJob) };
  };
  try {
    const one = await runPool(1);
    const nW = Math.min(16, hc);
    const many = await runPool(nW);
    const speed = one.dt / many.dt;
    c.add(
      `Worker scaling: 16 synth jobs, 1 vs ${nW} workers`,
      `${fmt(one.dt, 0)} ms → ${fmt(many.dt, 0)} ms (×${fmt(speed, 1)})`,
      speed > 4 ? 'PASS' : speed > 2 ? 'WARN' : 'FAIL',
      `per job ${fmt(one.perJob, 0)} ms alone vs ${fmt(many.perJob, 0)} ms in parallel (P/E-core mix + thermal)`,
    );
  } catch (e) {
    c.add('Worker scaling', errMsg(e), 'FAIL');
  }
}

// ------------------------------------------------------------------------------------------ audio

/** Must be called synchronously from a click handler (creates the contexts inside the gesture). */
export function startAudio(c: Ctx): Promise<void> {
  let ctx: AudioContext;
  let ctxPlayback: AudioContext | null = null;
  let ctx48: AudioContext | null = null;
  try {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    void ctx.resume();
    try {
      ctxPlayback = new AudioContext({ latencyHint: 'playback' });
    } catch {
      /* ignore */
    }
    try {
      ctx48 = new AudioContext({ sampleRate: 48000 });
    } catch {
      /* ignore */
    }
  } catch (e) {
    c.add('AudioContext', errMsg(e), 'FAIL');
    return Promise.resolve();
  }
  return runAudio(c, ctx, ctxPlayback, ctx48).finally(() => {
    void ctx.close();
    void ctxPlayback?.close();
    void ctx48?.close();
  });
}

async function runAudio(c: Ctx, ctx: AudioContext, ctxPlayback: AudioContext | null, ctx48: AudioContext | null) {
  c.progress('I · audio checks (≈ 8 s, silent)');
  const t0 = performance.now();
  while (ctx.state !== 'running' && performance.now() - t0 < 3000) await sleep(20);
  c.add('AudioContext state after gesture', ctx.state, ctx.state === 'running' ? 'PASS' : 'FAIL', `resumed in ${fmt(performance.now() - t0, 0)} ms`);
  c.add('sampleRate', `${ctx.sampleRate} Hz`, ctx.sampleRate === 48000 ? 'PASS' : 'WARN', 'render the track at ctx.sampleRate to avoid resampling');
  if (ctx48) c.add('AudioContext({sampleRate: 48000})', `${ctx48.sampleRate} Hz`, ctx48.sampleRate === 48000 ? 'PASS' : 'WARN', 'forcing the rate is allowed');
  await sleep(400);
  c.add(
    'baseLatency / outputLatency (interactive)',
    `${fmt(ctx.baseLatency * 1000, 2)} / ${fmt(ctx.outputLatency * 1000, 2)} ms`,
    'INFO',
    `audible ≈ base + output = ${fmt((ctx.baseLatency + ctx.outputLatency) * 1000, 1)} ms`,
  );
  if (ctxPlayback) {
    await ctxPlayback.resume().catch(() => {});
    await sleep(100);
    c.add('baseLatency / outputLatency (playback hint)', `${fmt(ctxPlayback.baseLatency * 1000, 2)} / ${fmt(ctxPlayback.outputLatency * 1000, 2)} ms`, 'INFO', 'larger buffers, more robust; fine for a pre-rendered track');
  }
  c.add('AudioWorklet', 'audioWorklet' in ctx ? 'available' : 'missing', 'audioWorklet' in ctx ? 'PASS' : 'INFO');
  c.add('setSinkId', 'setSinkId' in ctx ? 'available' : 'missing', 'INFO');
  const hasOTS = typeof ctx.getOutputTimestamp === 'function';
  const ots0 = hasOTS ? ctx.getOutputTimestamp() : null;
  c.add(
    'getOutputTimestamp()',
    ots0 ? `contextTime ${fmt(ots0.contextTime ?? NaN, 4)} s · performanceTime ${fmt(ots0.performanceTime ?? NaN, 1)} ms (currentTime ${fmt(ctx.currentTime, 4)})` : 'missing',
    ots0 ? 'PASS' : 'WARN',
  );

  // currentTime update granularity (tight burst)
  {
    const steps: number[] = [];
    let last = ctx.currentTime;
    const end = performance.now() + 120;
    while (performance.now() < end) {
      const v = ctx.currentTime;
      if (v !== last) {
        steps.push((v - last) * 1000);
        last = v;
      }
      await Promise.resolve();
    }
    // currentTime is frozen within a task; sample across tasks
    for (let i = 0; i < 60; i++) {
      await sleep(1);
      const v = ctx.currentTime;
      if (v !== last) {
        steps.push((v - last) * 1000);
        last = v;
      }
    }
    c.add('currentTime update step', steps.length ? `${fmt(Math.min(...steps), 3)} ms min · ${fmt(median(steps), 3)} ms median` : 'no change', 'INFO', `render quantum = ${fmt((128 / ctx.sampleRate) * 1000, 3)} ms`);
  }

  // drift + smoothness over ~5 s
  const perf: number[] = [];
  const ct: number[] = [];
  const est: number[] = [];
  const gap: number[] = [];
  const tEnd = performance.now() + 5000;
  while (performance.now() < tEnd) {
    await sleep(16);
    const now = performance.now();
    perf.push(now);
    ct.push(ctx.currentTime * 1000);
    if (hasOTS) {
      const o = ctx.getOutputTimestamp();
      const e = (o.contextTime ?? 0) * 1000 + (now - (o.performanceTime ?? now));
      est.push(e);
      gap.push(ctx.currentTime * 1000 - e);
    }
  }
  const fA = linfit(perf, ct);
  c.add(
    'Audio clock drift vs performance.now (5 s)',
    `${fmt((fA.b - 1) * 1e6, 0)} ppm`,
    Math.abs(fA.b - 1) < 500e-6 ? 'PASS' : 'WARN',
    'slope of currentTime vs performance.now; drift is irrelevant if visuals are slaved to the audio clock',
  );
  c.add(
    'Raw currentTime as frame clock: jitter',
    `σ ${fmt(stdev(fA.residuals), 3)} ms · max |err| ${fmt(Math.max(...fA.residuals.map(Math.abs)), 2)} ms`,
    'INFO',
    'currentTime advances in render-callback chunks → stair-steps if used directly per frame',
  );
  if (hasOTS) {
    const fB = linfit(perf, est);
    c.add(
      'getOutputTimestamp extrapolated clock: jitter',
      `σ ${fmt(stdev(fB.residuals), 3)} ms · max |err| ${fmt(Math.max(...fB.residuals.map(Math.abs)), 2)} ms`,
      stdev(fB.residuals) < stdev(fA.residuals) ? 'PASS' : 'INFO',
      't = contextTime + (performance.now() − performanceTime)/1000 — what the listener hears now',
    );
    c.add('currentTime − heard-time offset', `${fmt(median(gap), 2)} ms median`, 'INFO', `compare outputLatency+baseLatency ${fmt((ctx.outputLatency + ctx.baseLatency) * 1000, 1)} ms`, {
      gapMs: gap.slice(0, 50).map(r2),
    });
  }

  // 4:30 stereo buffer
  const sr = ctx.sampleRate;
  const len = Math.round(270 * sr);
  let t = performance.now();
  const buf = ctx.createBuffer(2, len, sr);
  const tAlloc = performance.now() - t;
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  for (let i = 0; i < len; i += 64) {
    L[i] = 1e-7;
    R[i] = -1e-7;
  }
  t = performance.now();
  buf.copyToChannel(L, 0);
  buf.copyToChannel(R, 1);
  const tCopy = performance.now() - t;
  c.add(
    'AudioBuffer 4:30 stereo @ ctx rate',
    `${fmt((len * 2 * 4) / 1048576, 0)} MB · createBuffer ${fmt(tAlloc, 1)} ms · copyToChannel ×2 ${fmt(tCopy, 1)} ms`,
    tAlloc + tCopy < 200 ? 'PASS' : 'WARN',
  );

  // start latency (silent: through a zero gain)
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(g).connect(ctx.destination);
  const when = ctx.currentTime + 0.05;
  t = performance.now();
  src.start(when);
  const tStartCall = performance.now() - t;
  const pStart = performance.now();
  let audible = NaN;
  let rendering = NaN;
  while (performance.now() - pStart < 2000) {
    await sleep(1);
    if (Number.isNaN(rendering) && ctx.currentTime >= when) rendering = performance.now() - pStart;
    if (hasOTS && (ctx.getOutputTimestamp().contextTime ?? 0) >= when) {
      audible = performance.now() - pStart;
      break;
    }
    if (!hasOTS && !Number.isNaN(rendering)) break;
  }
  src.stop();
  c.add(
    'start(t0 = currentTime + 50 ms) → rendering / audible',
    `start() ${fmt(tStartCall, 3)} ms · rendering after ${fmt(rendering, 1)} ms · at speaker after ${fmt(audible, 1)} ms`,
    'INFO',
    'schedule the track start ~100 ms ahead and derive t0 from the scheduled time, not from when start() was called',
  );
  c.add(
    'Audio clock recommendation',
    hasOTS
      ? 'Slave visuals to getOutputTimestamp(): t = contextTime + (rAF_time − performanceTime)/1000 − t0, smoothed (e.g. 1-pole on the offset), fall back to currentTime − outputLatency; never accumulate frame dt.'
      : 'Use currentTime − outputLatency with per-frame smoothing.',
    'INFO',
    '',
    { slopePpm: r3((fA.b - 1) * 1e6) },
  );
}
