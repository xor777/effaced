// Dev-only cache of rendered tracks in IndexedDB, keyed by SHA-256 of the module + device + rate.
// A reload with an unchanged effaced.xm skips the offline render entirely.

import type { RenderResult } from '../audio/types.ts';

const DB = 'effaced-dev';
const STORE = 'renders';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function cacheKey(bytes: Uint8Array, device: string, sampleRate: number): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return `${[...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}:${device}:${sampleRate}`;
}

export async function getCached(key: string): Promise<RenderResult | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve((r.result as RenderResult) ?? null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCached(key: string, res: RenderResult) {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    st.clear(); // keep only the latest render (they are ~200 MB)
    st.put(res, key);
  } catch (e) {
    console.warn('[music] render cache write failed', e);
  }
}
