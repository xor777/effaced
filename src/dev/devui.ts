// Dev overlay (PLAN §11.5): seek bar with the running order, loop region, transport keys,
// pos:row readout, frame timing. URL: ?scene=S08 (solo) · ?pos=0F&row=0 · ?t=12.5 · ?go (skip setup)
//
// keys: Space play/pause · ←/→ ±1 bar (shift: ±1 pattern) · Home start · L loop current cue
//       S solo current scene · M mute · H hide · [ / ] playback rate · R reset to cue start

import type { Demo } from '../demo.ts';
import type { FrameCtx } from '../scenes/types.ts';
import { SCRIPT, DURATION, cueStart, cueEnd, cueAt, ROW, ROWS } from '../timeline/script.ts';

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

export function devUI(demo: Demo) {
  const clock = demo.clock;
  const root = document.createElement('div');
  root.id = 'dev';
  root.innerHTML = `<div class="bar"></div><div class="info"></div>`;
  document.body.appendChild(root);
  const bar = root.querySelector('.bar') as HTMLElement;
  const info = root.querySelector('.info') as HTMLElement;

  SCRIPT.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = `cue p${c.prio}`;
    const a = cueStart(c) / DURATION, b = cueEnd(c, i) / DURATION;
    el.style.left = `${a * 100}%`;
    el.style.width = `${(b - a) * 100}%`;
    el.textContent = `${c.scene} ${c.title}`;
    el.title = `${c.scene} · ${c.title} · act ${c.act} · ${hex2(c.pos)}:00`;
    bar.appendChild(el);
  });
  const loopEl = document.createElement('div');
  loopEl.className = 'loop';
  bar.appendChild(loopEl);
  const head = document.createElement('div');
  head.className = 'head';
  bar.appendChild(head);

  const seekFromEvent = (e: MouseEvent) => {
    const r = bar.getBoundingClientRect();
    let t = ((e.clientX - r.left) / r.width) * DURATION;
    if (!e.altKey) t = Math.round(t / (ROW * 16)) * ROW * 16; // snap to bars; alt = free
    clock.seek(t);
  };
  let dragging = false;
  bar.addEventListener('mousedown', (e) => {
    dragging = true;
    seekFromEvent(e);
  });
  window.addEventListener('mousemove', (e) => dragging && seekFromEvent(e));
  window.addEventListener('mouseup', () => (dragging = false));

  let frameMs = 0, fps = 0, lastPerf = performance.now();
  demo.onFrame = (f: FrameCtx, ms: number) => {
    const now = performance.now();
    const dtp = now - lastPerf;
    lastPerf = now;
    fps = fps * 0.95 + (1000 / Math.max(1, dtp)) * 0.05;
    frameMs = frameMs * 0.9 + ms * 0.1;
    head.style.left = `${(f.t / DURATION) * 100}%`;
    if (clock.loop) {
      loopEl.style.display = 'block';
      loopEl.style.left = `${(clock.loop[0] / DURATION) * 100}%`;
      loopEl.style.width = `${((clock.loop[1] - clock.loop[0]) / DURATION) * 100}%`;
    } else loopEl.style.display = 'none';
    if (f.frame % 4 === 0) {
      const cue = SCRIPT[cueAt(f.t)];
      info.innerHTML =
        `<span>${clock.playing ? '▶' : '❚❚'} ${mmss(f.t)}</span>` +
        `<span>${hex2(f.pos)}:${String(Math.floor(f.prow)).padStart(2, '0')}</span>` +
        `<span>${demo.solo ? `SOLO ${demo.solo}` : `${cue.scene} ${cue.title}`} · k ${f.k.toFixed(2)}</span>` +
        `<span>${f.w}×${f.h}</span>` +
        `<span>${fps.toFixed(0)} fps · cpu ${frameMs.toFixed(1)} ms</span>` +
        `<span>${demo.audio ? 'audio ✓' : 'silent'}${clock.rate !== 1 ? ` · ×${clock.rate}` : ''}</span>`;
      try {
        sessionStorage.setItem('effaced.t', String(f.t));
      } catch {}
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const t = clock.time();
    const bar16 = ROW * 16, pat = ROW * ROWS;
    const ci = cueAt(t);
    switch (e.key) {
      case ' ':
        clock.toggle();
        break;
      case 'ArrowRight':
        clock.seek(Math.floor(t / (e.shiftKey ? pat : bar16) + 1e-6) * (e.shiftKey ? pat : bar16) + (e.shiftKey ? pat : bar16));
        break;
      case 'ArrowLeft':
        clock.seek(Math.ceil(t / (e.shiftKey ? pat : bar16) - 1e-6) * (e.shiftKey ? pat : bar16) - (e.shiftKey ? pat : bar16));
        break;
      case 'Home':
        clock.seek(0);
        break;
      case 'r':
      case 'R':
        clock.seek(cueStart(SCRIPT[ci]));
        break;
      case 'l':
      case 'L':
        clock.loop = clock.loop ? null : [cueStart(SCRIPT[ci]), cueEnd(SCRIPT[ci], ci)];
        break;
      case 's':
      case 'S':
        demo.solo = demo.solo ? null : SCRIPT[ci].scene;
        break;
      case 'm':
      case 'M':
        clock.setVolume(clock.gain && clock.gain.gain.value > 0 ? 0 : 1);
        break;
      case 'h':
      case 'H':
        root.classList.toggle('hidden');
        break;
      case '[':
        clock.rate = Math.max(0.25, clock.rate / 2);
        clock.seek(t);
        break;
      case ']':
        clock.rate = Math.min(4, clock.rate * 2);
        clock.seek(t);
        break;
      default:
        return;
    }
    e.preventDefault();
  });
}

/** start time from the URL (?scene=S08 · ?pos=0F&row=8 · ?t=12.5) or the last dev session */
export function startTimeFromUrl(): { t: number; solo: string | null } {
  const q = new URLSearchParams(location.search);
  const scene = q.get('scene');
  if (scene) {
    const id = /^S\d$/.test(scene) ? `S0${scene.slice(1)}` : scene.toUpperCase();
    const c = SCRIPT.find((x) => x.scene === id);
    if (c) return { t: cueStart(c), solo: q.has('solo') ? id : null };
  }
  if (q.has('pos')) return { t: (parseInt(q.get('pos')!, 16) * ROWS + +(q.get('row') ?? 0)) * ROW, solo: null };
  if (q.has('t')) return { t: +q.get('t')!, solo: null };
  try {
    const s = sessionStorage.getItem('effaced.t');
    if (s) return { t: +s, solo: null };
  } catch {}
  return { t: 0, solo: null };
}
