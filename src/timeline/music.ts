// Glue between the demo and the audio engine: fetch the module, render it offline (workers),
// hand back the RenderResult. `?xm=/out/engine-test.xm` plays another module; `?silent` skips audio.
// Offline rendering needs no user gesture, so main.ts starts it at page load, behind the setup screen.
// In dev, renders are cached in IndexedDB by module hash (`?nocache` to bypass).

import type { RenderResult } from '../audio/types.ts';
import type { SoundDevice } from '../boot/setup.ts';

const DEFAULT_XM = '/music/effaced.xm';
const DEV = import.meta.env.DEV;

let bytesP: Promise<Uint8Array | null> | null = null;
function fetchModule(): Promise<Uint8Array | null> {
  const url = new URLSearchParams(location.search).get('xm') ?? DEFAULT_XM;
  return (bytesP ??= fetch(url).then(async (r) => {
    if (!r.ok) {
      console.warn(`[music] ${url}: ${r.status} — running silent`);
      return null;
    }
    return new Uint8Array(await r.arrayBuffer());
  }));
}

export async function renderMusic(
  sampleRate: number,
  device: SoundDevice,
  onProgress: (p: number) => void,
): Promise<RenderResult | null> {
  const q = new URLSearchParams(location.search);
  if (q.has('silent')) return null;
  const t0 = performance.now();
  // spin up the worker pool (libopenmpt compiled once, posted to the workers) while the module downloads
  const engineP = import('../audio/engine.ts').then((m) => {
    m.warmAudioWorkers?.();
    return m;
  });
  const [bytes, { renderXm }] = await Promise.all([fetchModule(), engineP]);
  if (!bytes) return null;
  let key = '';
  if (DEV && !q.has('nocache')) {
    const cache = await import('../dev/render-cache.ts');
    key = await cache.cacheKey(bytes, device, sampleRate);
    const hit = await cache.getCached(key);
    if (hit) {
      console.log(`[music] cached render (${key})`);
      onProgress(1);
      return hit;
    }
  }
  onProgress(0.05);
  const out = await renderXm(bytes, sampleRate, { device }, (p) => onProgress(0.05 + p * 0.95));
  console.log(
    `[music] ${(bytes.length / 1e6).toFixed(1)} MB module, ${device}: ${(out.left.length / out.sampleRate).toFixed(1)} s rendered in ${((performance.now() - t0) / 1000).toFixed(2)} s`,
  );
  if (key) (await import('../dev/render-cache.ts')).putCached(key, out);
  return out;
}
