// Small helpers shared by all techcheck modules. Self-contained (no src/gfx dependency).

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Yield to the event loop without the 4 ms nested-setTimeout clamp. */
const chan = new MessageChannel();
const chanQueue: (() => void)[] = [];
chan.port1.onmessage = () => chanQueue.shift()?.();
export const yieldTask = () =>
  new Promise<void>((r) => {
    chanQueue.push(r);
    chan.port2.postMessage(0);
  });

/** requestAnimationFrame with a timeout (hidden tabs / panes stop rAF). Resolves null on timeout. */
export function nextFrame(timeoutMs = 1000): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const id = requestAnimationFrame((t) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      resolve(t);
    });
    const to = setTimeout(() => {
      if (done) return;
      done = true;
      cancelAnimationFrame(id);
      resolve(null);
    }, timeoutMs);
  });
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`timeout after ${ms} ms: ${what}`)), ms);
    p.then(
      (v) => {
        clearTimeout(to);
        resolve(v);
      },
      (e) => {
        clearTimeout(to);
        reject(e);
      },
    );
  });
}

export function sorted(a: number[]): number[] {
  return [...a].sort((x, y) => x - y);
}
export function median(a: number[]): number {
  if (!a.length) return NaN;
  const s = sorted(a);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function mean(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
}
export function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}
export function percentile(a: number[], p: number): number {
  if (!a.length) return NaN;
  const s = sorted(a);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}
export function diffs(a: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < a.length; i++) out.push(a[i] - a[i - 1]);
  return out;
}
/** Least squares fit y = a + b x. */
export function linfit(xs: number[], ys: number[]): { a: number; b: number; residuals: number[] } {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  const b = sxx ? sxy / sxx : 0;
  const a = my - b * mx;
  return { a, b, residuals: xs.map((x, i) => ys[i] - (a + b * x)) };
}

export function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined) return '—';
  return Number.isFinite(n) ? n.toFixed(d) : String(n);
}
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Random constant injected into shader sources to defeat Chrome's / ANGLE's / Metal's shader caches. */
export function nonce(): number {
  return 0.1 + Math.random() * 0.8;
}

export function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
}

/** Collect rAF timestamps for a duration, calling perFrame each frame. Times out if rAF is throttled. */
export function rafSamples(
  durationMs: number,
  perFrame?: (t: number, i: number) => void,
): Promise<{ stamps: number[]; cpu: number[]; throttled: boolean }> {
  return new Promise((resolve) => {
    const stamps: number[] = [];
    const cpu: number[] = [];
    let last = performance.now();
    let finished = false;
    const finish = (throttled: boolean) => {
      if (finished) return;
      finished = true;
      clearInterval(watchdog);
      resolve({ stamps, cpu, throttled });
    };
    const watchdog = setInterval(() => {
      if (performance.now() - last > 1500) finish(true);
    }, 250);
    const f = (t: number) => {
      if (finished) return;
      last = performance.now();
      stamps.push(t);
      if (perFrame) {
        const c0 = performance.now();
        perFrame(t, stamps.length - 1);
        cpu.push(performance.now() - c0);
      }
      if (t - stamps[0] < durationMs) requestAnimationFrame(f);
      else finish(false);
    };
    requestAnimationFrame(f);
  });
}

export interface CadenceStats {
  frames: number;
  medianMs: number;
  hz: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  jitterMs: number;
  /** fraction of intervals > 1.5 × reference interval */
  dropFrac: number;
  hist: Record<string, number>;
}
export function cadence(stamps: number[], refIntervalMs?: number): CadenceStats {
  const iv = diffs(stamps);
  const med = median(iv);
  const ref = refIntervalMs ?? med;
  const hist: Record<string, number> = {};
  for (const d of iv) {
    const k = d < 10 ? '≤10ms' : d < 19 ? '10–19ms' : d < 27 ? '19–27ms' : d < 36 ? '27–36ms' : '>36ms';
    hist[k] = (hist[k] ?? 0) + 1;
  }
  return {
    frames: iv.length,
    medianMs: r3(med),
    hz: r2(1000 / med),
    meanMs: r3(mean(iv)),
    p95Ms: r3(percentile(iv, 95)),
    maxMs: r3(Math.max(...iv)),
    jitterMs: r3(stdev(iv)),
    dropFrac: r3(iv.filter((d) => d > ref * 1.5).length / Math.max(1, iv.length)),
    hist,
  };
}
