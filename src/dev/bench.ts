// Dev performance sweep (?go&silent&bench[=3024x1890][&only=S09,S12]): renders every scene at the target size in
// short windows spread over its cue and times each frame CPU+GPU, serialised by a 1×1 readPixels
// (gl.finish is not a sync point on ANGLE/Metal). Serial timing is an upper bound: in the real loop
// the CPU half overlaps the GPU. DOM/compositor work (S04 HUD, S12's second canvas) is not counted.
// Nothing is played. Result: an on-screen table + window.__bench (JSON for pasting back).

import type { Demo } from '../demo.ts';
import { SCRIPT, cueStart, cueEnd } from '../timeline/script.ts';
import { frameCounter } from '../meta/overlay.ts';

const WINDOWS = 8;
const FRAMES = 24;

interface SceneBench {
  id: string;
  fps: number;
  scale: number;
  median: number;
  p95: number;
  max: number;
  /** cue cut: first frame after a jump (resets, pre-rolls) */
  cut: number;
  worst: { t: number; median: number };
  verdict: string;
}

const pct = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

export async function runBench(demo: Demo, size: string | null) {
  const [w, h] = (size && /^\d+x\d+$/.test(size) ? size : '3024x1890').split('x').map(Number);
  const gl = demo.g.gl;
  const c = demo.g.canvas;
  c.width = w;
  c.height = h;
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const yieldUi = () => new Promise((r) => setTimeout(r, 0));

  const out = document.createElement('pre');
  out.style.cssText =
    'position:fixed;inset:2vh 2vw auto auto;z-index:9;margin:0;padding:1em 1.4em;max-height:96vh;overflow:auto;background:#000d;color:#ddd;font:12px/1.45 ui-monospace,Menlo,monospace;white-space:pre';
  document.body.appendChild(out);
  const lines = [`bench ${w}×${h} · ${WINDOWS} windows × ${FRAMES} frames per scene · readPixels-serialised`, ''];
  const show = (extra = '') => (out.textContent = [...lines, extra].join('\n'));

  // sync overhead alone
  const base: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    sync();
    base.push(performance.now() - t0);
  }
  lines.push(`sync overhead ${r2(pct(base, 0.5))} ms (not subtracted)`, '');
  lines.push('scene   fps scale  median    p95    max    cut   worst@t        verdict');

  const results: SceneBench[] = [];
  // &only=S09,S12 limits the sweep to some scenes
  const only = new URLSearchParams(location.search).get('only')?.toUpperCase().split(',');
  const ids = [...new Set(SCRIPT.map((s) => s.scene))].filter((id) => !only || only.includes(id));
  for (const id of ids) {
    const ci = SCRIPT.findIndex((s) => s.scene === id);
    const cue = SCRIPT[ci];
    const sc = demo.scenes.get(id)!;
    const start = cueStart(cue), end = cueEnd(cue, ci);
    const fps = sc.fps ?? 120;
    const dt = 1 / fps;
    const all: number[] = [];
    let cut = 0;
    let worst = { t: start, median: 0 };
    for (let wi = 0; wi < WINDOWS; wi++) {
      const t0w = start + ((end - start - FRAMES * dt) * wi) / (WINDOWS - 1);
      const win: number[] = [];
      for (let k = 0; k <= FRAMES; k++) {
        const t = t0w + k * dt;
        const a = performance.now();
        demo.renderAt(ci, t, k === 0, k === 0 ? 0 : dt);
        sync();
        const ms = performance.now() - a;
        if (k === 0) cut = Math.max(cut, ms);
        else win.push(ms);
      }
      all.push(...win);
      const m = pct(win, 0.5);
      if (m > worst.median) worst = { t: r2(t0w), median: r2(m) };
      show(`… ${id} window ${wi + 1}/${WINDOWS}`);
      await yieldUi();
    }
    const budget = 1000 / fps;
    const p95 = pct(all, 0.95);
    const verdict = p95 < budget * 0.8 ? `ok @${fps}` : p95 < budget ? `tight @${fps}` : `OVER @${fps} (${r2(budget)} ms)`;
    const r: SceneBench = {
      id,
      fps,
      scale: sc.scale ?? 1,
      median: r2(pct(all, 0.5)),
      p95: r2(p95),
      max: r2(Math.max(...all)),
      cut: r2(cut),
      worst,
      verdict,
    };
    results.push(r);
    const f = (x: number) => x.toFixed(2).padStart(6);
    lines.push(
      `${id.padEnd(6)} ${String(fps).padStart(4)} ${r.scale.toFixed(2).padStart(5)} ${f(r.median)} ${f(r.p95)} ${f(r.max)} ${f(r.cut)}   ${(f(worst.median) + '@' + worst.t.toFixed(1)).padEnd(14)} ${verdict}`,
    );
    show();
  }
  // leave the last scene cleanly
  demo.scenes.get(SCRIPT[demo.cur]?.scene ?? '')?.leave?.();
  frameCounter(false);
  const json = JSON.stringify({ size: [w, h], ua: navigator.userAgent, sync: r2(pct(base, 0.5)), results });
  (window as unknown as { __bench: unknown }).__bench = JSON.parse(json);
  lines.push('', 'JSON (window.__bench):', json);
  show();
  console.log('[bench]', json);
}
