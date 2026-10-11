// EFFACED techcheck — orchestrates the checks, renders the table, exports JSON.
// URL params: ?only=A,C,E (run a subset) · ?skip=F
import { Reporter, type SectionId, type Status } from './report.ts';
import { Bench, drainErrors } from './glutil.ts';
import { $, errMsg, sleep, withTimeout } from './util.ts';
import { checkBasics, checkExtensions, checkFloatRT } from './check-gl.ts';
import { checkCompile } from './check-compile.ts';
import { checkGpuTiming, checkCadence } from './check-gpu.ts';
import { checkParticles } from './check-particles.ts';
import { checkColor } from './check-color.ts';
import { checkWorkers, startAudio } from './check-audio.ts';
import { checkDom, setPaused } from './check-dom.ts';
import { checkMisc, testFullscreen } from './check-misc.ts';

export interface Ctx {
  section: SectionId;
  add(name: string, value: string, status: Status, note?: string, data?: unknown): void;
  progress(msg: string): void;
  bench: Bench;
}

interface Check {
  section: SectionId;
  title: string;
  run: (c: Ctx) => Promise<void>;
  heavy?: boolean;
  timeoutMs?: number;
}

const CHECKS: Check[] = [
  { section: 'A', title: 'WebGL2 basics', run: checkBasics },
  { section: 'B', title: 'Extensions', run: checkExtensions },
  { section: 'C', title: 'Float render targets', run: checkFloatRT },
  { section: 'D', title: 'Shader compilation', run: checkCompile, heavy: true, timeoutMs: 240000 },
  { section: 'E', title: 'GPU timing', run: checkGpuTiming, heavy: true, timeoutMs: 180000 },
  { section: 'F', title: 'Particles', run: checkParticles, heavy: true, timeoutMs: 180000 },
  { section: 'G', title: 'Frame cadence', run: checkCadence, heavy: true, timeoutMs: 60000 },
  { section: 'H', title: 'Color', run: checkColor },
  { section: 'K', title: 'Misc', run: checkMisc },
  { section: 'I', title: 'Workers', run: checkWorkers, timeoutMs: 60000 },
  { section: 'J', title: 'DOM / CSS', run: checkDom, timeoutMs: 90000 },
];

const progressEl = $('#progress');

// renderer liveness: rAF stops in hidden/occluded tabs and Chrome then deprioritises the renderer,
// which silently skews every timing. Track it and flag checks that ran while throttled.
let lastRaf = 0;
const heartbeat = () =>
  requestAnimationFrame(() => {
    lastRaf = performance.now();
    heartbeat();
  });
heartbeat();
async function rendererAlive(waitMs: number): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < waitMs) {
    if (performance.now() - lastRaf < 100) return true;
    await sleep(20);
  }
  return false;
}
const reporter = new Reporter($('#results') as HTMLTableElement, $('#summary'));
const bench = new Bench($('#bench') as HTMLCanvasElement, $('#bench-label'));
(window as any).__techcheck = reporter.report;

function ctxFor(section: SectionId): Ctx {
  return {
    section,
    add: (name, value, status, note = '', data) => reporter.add(section, name, value, status, note, data),
    progress: (msg) => (progressEl.textContent = msg),
    bench,
  };
}

async function meta() {
  const m = reporter.report.meta;
  m.userAgent = navigator.userAgent;
  m.url = location.href;
  m.dpr = window.devicePixelRatio;
  m.screen = `${screen.width}×${screen.height}`;
  m.inner = `${innerWidth}×${innerHeight}`;
  m.hardwareConcurrency = navigator.hardwareConcurrency;
  const uad = (navigator as any).userAgentData;
  if (uad?.getHighEntropyValues) {
    try {
      const v = await uad.getHighEntropyValues(['fullVersionList', 'platformVersion', 'architecture', 'model']);
      m.uaData = v;
      const chrome = (v.fullVersionList as { brand: string; version: string }[] | undefined)?.find((b) => /Chrom/.test(b.brand) && !/Not/.test(b.brand));
      if (chrome) m.chrome = `${chrome.brand} ${chrome.version}`;
      m.platformVersion = v.platformVersion;
    } catch {
      /* ignore */
    }
  }
  $('#meta').textContent = `${m.chrome ?? navigator.userAgent} · macOS ${m.platformVersion ?? '?'} · dpr ${m.dpr} · screen ${m.screen} · window ${m.inner}`;
}

async function runAll() {
  const params = new URLSearchParams(location.search);
  const only = params.get('only')?.toUpperCase().split(',');
  const skip = params.get('skip')?.toUpperCase().split(',') ?? [];
  const t0 = performance.now();
  await meta();
  const list = CHECKS.filter((ch) => (!only || only.includes(ch.section)) && !skip.includes(ch.section));
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    const c = ctxFor(ch.section);
    progressEl.textContent = `${ch.section} · ${ch.title} (${i + 1}/${list.length})`;
    const lostBefore = bench.lostCount;
    drainErrors(bench.gl);
    if (!(await rendererAlive(ch.heavy ? 3000 : 300)))
      c.add('Renderer throttled', 'rAF not running before this check', ch.heavy ? 'WARN' : 'INFO', 'tab hidden/occluded → Chrome deprioritises the renderer; timings in this section are not representative. Keep the tab in front.');
    try {
      await withTimeout(ch.run(c), ch.timeoutMs ?? 30000, ch.title);
    } catch (e) {
      c.add(`${ch.title}: check crashed`, errMsg(e).slice(0, 400), 'FAIL', '', errMsg(e));
      console.error(e);
    }
    if (bench.lostCount > lostBefore) c.add('WebGL context lost during this check', String(bench.lostCount - lostBefore), 'FAIL', 'GPU watchdog / OOM?');
    else if (ch.heavy) {
      const errs = drainErrors(bench.gl);
      if (errs.length) c.add('GL errors left on the bench context', errs.join(', '), 'WARN', 'harmless for other checks (drained) but indicates an invalid call in this section');
    }
    if (ch.heavy) await sleep(400);
    else await sleep(30);
  }
  reporter.report.done = true;
  reporter.report.durationMs = Math.round(performance.now() - t0);
  progressEl.textContent = `done in ${(reporter.report.durationMs / 1000).toFixed(1)} s — audio & fullscreen checks need a click`;
  document.body.classList.add('done');
}

// ------------------------------------------------------------------------------------------ buttons

function collectEyeball() {
  const out: Record<string, { verdict: string; note: string }> = {};
  document.querySelectorAll<HTMLSelectElement>('select[data-eyeball]').forEach((sel) => {
    const key = sel.dataset.eyeball!;
    const note = document.querySelector<HTMLInputElement>(`input[data-eyeball-note="${key}"]`)?.value ?? '';
    out[key] = { verdict: sel.value || 'not answered', note };
  });
  (reporter.report as any).eyeball = out;
}

$('#copy').addEventListener('click', async () => {
  collectEyeball();
  const txt = reporter.json();
  const btn = $('#copy');
  try {
    await navigator.clipboard.writeText(txt);
    btn.textContent = 'Copied ✓';
  } catch {
    const ta = document.createElement('textarea');
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
  }
  setTimeout(() => (btn.textContent = 'Copy JSON'), 1500);
});

let audioRunning = false;
$('#audio').addEventListener('click', () => {
  if (audioRunning) return;
  audioRunning = true;
  const btn = $('#audio') as HTMLButtonElement;
  btn.disabled = true;
  const c = ctxFor('I');
  startAudio(c) // synchronous AudioContext creation inside the gesture
    .catch((e) => c.add('Audio checks crashed', errMsg(e), 'FAIL'))
    .finally(() => {
      audioRunning = false;
      btn.disabled = false;
      btn.textContent = 'Re-run audio checks';
      progressEl.textContent = 'audio checks done';
    });
});

$('#fs').addEventListener('click', () => {
  const c = ctxFor('K');
  testFullscreen(c).catch((e) => c.add('Fullscreen test crashed', errMsg(e), 'FAIL'));
});

$('#pause').addEventListener('click', () => {
  const btn = $('#pause');
  const p = btn.dataset.paused !== '1';
  btn.dataset.paused = p ? '1' : '0';
  btn.textContent = p ? 'Resume animations' : 'Pause animations';
  setPaused(p);
});

void runAll();
