// Module worker used by the techcheck (section I). Echo, transfer round-trip, synth workload, OffscreenCanvas probe.
/// <reference lib="webworker" />

type Msg =
  | { kind: 'ping'; t: number }
  | { kind: 'transfer'; buf: ArrayBuffer }
  | { kind: 'synth'; job: number; seconds: number; sr: number; partials: number }
  | { kind: 'offscreen' }
  | { kind: 'sab'; sab: SharedArrayBuffer };

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  switch (m.kind) {
    case 'ping':
      post({ kind: 'pong', t: m.t, wt: performance.now() });
      break;
    case 'transfer':
      post({ kind: 'transfer', bytes: m.buf.byteLength, buf: m.buf }, [m.buf]);
      break;
    case 'synth': {
      // PADsynth-ish additive voice: partials with slight detune + exponential amplitude rolloff
      const t0 = performance.now();
      const n = Math.round(m.seconds * m.sr);
      const out = new Float32Array(n);
      const f0 = 55 * Math.pow(2, (m.job % 24) / 12);
      for (let k = 1; k <= m.partials; k++) {
        const f = f0 * k * (1 + 0.0007 * Math.sin(k * 12.9898 + m.job));
        if (f > m.sr / 2) break;
        const w = (2 * Math.PI * f) / m.sr;
        const a = 0.25 / k;
        const ph = k * 1.618;
        for (let i = 0; i < n; i++) out[i] += a * Math.sin(w * i + ph);
      }
      post({ kind: 'synth', job: m.job, ms: performance.now() - t0, buf: out.buffer }, [out.buffer]);
      break;
    }
    case 'offscreen': {
      let res = 'OffscreenCanvas missing';
      try {
        if (typeof OffscreenCanvas !== 'undefined') {
          const gl = new OffscreenCanvas(4, 4).getContext('webgl2');
          if (!gl) res = 'webgl2 context null';
          else {
            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
            res = `webgl2 ok: ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`;
          }
        }
      } catch (err) {
        res = String(err);
      }
      post({ kind: 'offscreen', res });
      break;
    }
    case 'sab': {
      const a = new Int32Array(m.sab);
      Atomics.store(a, 0, 42);
      Atomics.notify(a, 0);
      post({ kind: 'sab', ok: true });
      break;
    }
  }
};
