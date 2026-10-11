// Audio Lab (lab.html): browser preview of the track through the real engine + Instrument Lab.
//  · source: music/*.xm or out/*.xm (polled — re-renders when the file changes), file picker,
//    drag & drop; ?xm=/path/to.xm picks one
//  · render through renderXm (workers) for the chosen device, play, loop a position range, seek on
//    the timeline (scenes from src/timeline/script.ts, markers from channel 18). Playback only ever
//    starts from the play button or Space — never by itself (re-renders stop it and leave it stopped)
//  · pattern view (HUD data), per-channel meters (RenderResult.env), ghost XY scope (ghostL/R),
//    instrument names (the diary)
//  · Instrument Lab: pick a slot, tweak its generator params, play it from the keyboard
//    (tracker layout: Z S X D C V … / Q 2 W 3 E R …), export WAV / XI, apply it to the loaded
//    module and re-render; FX bus settings
//  · benchmark: renders out/stress.xm and reports the time

import { Pane, type FolderApi } from 'tweakpane';
import * as Essentials from '@tweakpane/plugin-essentials';
import { renderXm, lastRenderStats, warmAudioWorkers } from '../audio/engine.ts';
import type { RenderResult, Device } from '../audio/types.ts';
import { FX_DEFAULTS, type FxSettings } from '../audio/fx.ts';
import { BANK, PARAM_RANGES, renderInstrument, zoneForKey, type InstrumentSpec } from '../audio/synth/bank.ts';
import type { Zone } from '../audio/synth/synths.ts';
import { zonesToXmInstrument } from '../audio/synth/xm-zones.ts';
import { writeXi } from '../audio/synth/xi.ts';
import { encodeWav } from '../audio/wav.ts';
import { loudness } from '../audio/analysis.ts';
import { readXm, writeXm, noteName, fxName, type XmCell } from '../music/xm/xm.ts';
import { SCRIPT, cueAt } from '../timeline/script.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const CH_NAMES = ['kick', 'snare', 'hats', 'perc', 'bass', 'sub', 'padA', 'padB', 'arp', 'lead', 'echo', 'counter', 'bell', 'pluck', 'fx', 'stab', 'ghost', 'mark'];
const CANDIDATES = ['/music/effaced.xm', '/music/template.xm', '/out/engine-test.xm', '/out/stress.xm', '/out/smoke.xm'];

// ---------------------------------------------------------------------------------------------
// state

let ctx: AudioContext | null = null;
let xm: Uint8Array | null = null;
let xmLabel = '';
let res: RenderResult | null = null;
let buffer: AudioBuffer | null = null;
let src: AudioBufferSourceNode | null = null;
let startedAt = 0; // ctx time when song time 0 would have played
let pausedAt = 0;
let rendering = false;
let watchTag = '';
const view = { full: true };
const fx: FxSettings = structuredClone(FX_DEFAULTS);

function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'playback' });
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}
const log = (s: string) => ($('log').textContent = s);

// ---------------------------------------------------------------------------------------------
// sources

async function exists(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return null; // SPA fallback, not the file
    return `${r.headers.get('etag') ?? ''}|${r.headers.get('last-modified') ?? ''}|${r.headers.get('content-length') ?? ''}`;
  } catch {
    return null;
  }
}

async function populateSources(): Promise<void> {
  const sel = $<HTMLSelectElement>('source');
  const want = new URLSearchParams(location.search).get('xm');
  const list = want ? [want, ...CANDIDATES.filter((c) => c !== want)] : CANDIDATES;
  sel.innerHTML = '';
  for (const url of list) {
    if (!(await exists(url))) continue;
    const o = document.createElement('option');
    o.value = o.textContent = url;
    sel.appendChild(o);
  }
  if (!sel.options.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '(no .xm found — open or drop one)';
    sel.appendChild(o);
  }
}

async function loadUrl(url: string): Promise<void> {
  if (!url) return;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  watchTag = (await exists(url)) ?? '';
  await loadBytes(new Uint8Array(await r.arrayBuffer()), url);
}

async function loadBytes(bytes: Uint8Array, label: string): Promise<void> {
  xm = bytes;
  xmLabel = label;
  await doRender();
}

// poll the selected URL; re-render when it changes on disk
setInterval(async () => {
  const sel = $<HTMLSelectElement>('source');
  if (!$<HTMLInputElement>('watch').checked || rendering || !sel.value || xmLabel !== sel.value) return;
  const tag = await exists(sel.value);
  if (tag && watchTag && tag !== watchTag) {
    log(`${sel.value} changed — re-rendering (playback stays stopped; press play)`);
    await loadUrl(sel.value);
  }
}, 1500);

// ---------------------------------------------------------------------------------------------
// render + transport

async function doRender(): Promise<void> {
  if (!xm || rendering) return;
  rendering = true;
  // a re-render always stops playback and never restarts it: audio only starts from the play button / space
  stop();
  const device = $<HTMLSelectElement>('device').value as Device;
  const rate = ctx?.sampleRate ?? 48000;
  log(`rendering ${xmLabel} (${device})…`);
  try {
    const t0 = performance.now();
    res = await renderXm(xm, rate, { device, fx }, (p) => log(`rendering ${xmLabel}… ${Math.round(p * 100)}%`));
    const ms = performance.now() - t0;
    buffer = new AudioBuffer({ numberOfChannels: 2, length: res.left.length, sampleRate: res.sampleRate });
    buffer.copyToChannel(res.left as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(res.right as Float32Array<ArrayBuffer>, 1);
    const st = lastRenderStats;
    const secs = res.left.length / res.sampleRate;
    const tm = st?.timing;
    log(`${xmLabel}: ${secs.toFixed(1)} s rendered in ${(ms / 1000).toFixed(2)} s · ${st?.workers ?? 0} workers × ${st?.groups ?? 0} groups${tm ? ` (mix ${(tm.master / 1000).toFixed(2)} s, fx ${((tm.fx ?? 0) / 1000).toFixed(2)} s)` : ''} · ${res.sampleRate} Hz`);
    (window as unknown as { __lab: unknown }).__lab = { res, ms, stats: st, label: xmLabel };
    console.log(`[lab] rendered ${xmLabel} ${secs.toFixed(1)} s in ${ms.toFixed(0)} ms`, st);
    $<HTMLInputElement>('loopB').max = String(res.track.order.length);
    names();
    drawTimeline();
    setTimeout(() => {
      if (!res) return;
      const L = loudness(res.left, res.right, res.sampleRate);
      log(`${$('log').textContent} · ${L.integrated.toFixed(1)} LUFS`);
    }, 50);
  } catch (e) {
    console.error(e);
    log(`render failed: ${(e as Error).message}`);
  } finally {
    rendering = false;
  }
}

function loopRange(): [number, number] | null {
  if (!res || !$<HTMLInputElement>('loop').checked) return null;
  const pt = res.track.posTime;
  const a = Math.max(0, Math.min(pt.length - 2, +$<HTMLInputElement>('loopA').value | 0));
  const b = Math.max(a + 1, Math.min(pt.length - 1, +$<HTMLInputElement>('loopB').value | 0));
  return [pt[a], pt[b]];
}

function play(from = pausedAt): void {
  if (!buffer) return;
  const c = audio();
  stop(false);
  src = c.createBufferSource();
  src.buffer = buffer;
  const lr = loopRange();
  if (lr) {
    src.loop = true;
    src.loopStart = lr[0];
    src.loopEnd = lr[1];
    if (from < lr[0] || from >= lr[1]) from = lr[0];
  }
  src.connect(c.destination);
  src.start(0, Math.max(0, from));
  startedAt = c.currentTime - from;
  src.onended = () => {
    if (src && !src.loop) stop();
  };
  $('play').textContent = '■ stop';
  $('play').classList.add('on');
}

function stop(keepPos = true): void {
  if (src) {
    if (keepPos) pausedAt = now();
    src.onended = null;
    try {
      src.stop();
    } catch {
      /* not started */
    }
    src.disconnect();
    src = null;
  }
  $('play').textContent = '▶ play';
  $('play').classList.remove('on');
}

/** song time now (audio clock, minus output latency) */
function now(): number {
  if (!src || !ctx) return pausedAt;
  let t = ctx.currentTime - startedAt - (ctx.outputLatency || 0);
  const lr = loopRange();
  if (lr && t >= lr[1]) t = lr[0] + ((t - lr[0]) % (lr[1] - lr[0]));
  return Math.max(0, t);
}

function posOf(t: number): { pos: number; row: number } {
  if (!res) return { pos: 0, row: 0 };
  const pt = res.track.posTime;
  let p = 0;
  while (p + 1 < pt.length - 1 && pt[p + 1] <= t) p++;
  const pat = res.track.patterns[res.track.order[p]];
  const rows = pat?.rows ?? 64;
  const row = Math.min(rows - 1, Math.max(0, Math.floor(((t - pt[p]) / (pt[p + 1] - pt[p])) * rows)));
  return { pos: p, row };
}

// ---------------------------------------------------------------------------------------------
// drawing

const tl = $<HTMLCanvasElement>('timeline');
let tlBg: HTMLCanvasElement | null = null; // cached background (scenes, loop, markers, envelope)
function drawTimeline(): void {
  const dpr = devicePixelRatio || 1;
  const w = Math.max(1, tl.clientWidth * dpr), h = Math.max(1, tl.clientHeight * dpr);
  tl.width = w;
  tl.height = h;
  const bg = (tlBg = document.createElement('canvas'));
  bg.width = w;
  bg.height = h;
  const g = bg.getContext('2d')!;
  g.fillStyle = '#0d0c10';
  g.fillRect(0, 0, w, h);
  const total = res ? res.left.length / res.sampleRate : 257.76;
  const X = (t: number) => (t / total) * w;
  g.font = `${10 * dpr}px ui-monospace, monospace`;
  SCRIPT.forEach((c, i) => {
    const a = c.pos * 64 * 0.12, b = i + 1 < SCRIPT.length ? SCRIPT[i + 1].pos * 64 * 0.12 : 32 * 7.68;
    g.fillStyle = i % 2 ? '#1c1922' : '#221e29';
    g.fillRect(X(a), 0, X(b) - X(a) - 1, h);
    g.fillStyle = '#8a8394';
    g.fillText(`${c.scene} ${c.title}`, X(a) + 3 * dpr, 12 * dpr, X(b) - X(a) - 6 * dpr);
  });
  const lr = loopRange();
  if (lr) {
    g.fillStyle = 'rgba(222,202,222,0.15)';
    g.fillRect(X(lr[0]), 0, X(lr[1]) - X(lr[0]), h);
  }
  if (res) {
    g.fillStyle = '#facade';
    for (const m of res.markers) g.fillRect(X(m.t), h - 9 * dpr, 1.5 * dpr, 9 * dpr);
    // activity: sum of the channel envelopes
    g.strokeStyle = 'rgba(222,202,222,0.5)';
    g.beginPath();
    const frames = res.env[0].length;
    for (let x = 0; x < w; x += 2) {
      const f = Math.floor((x / w) * frames);
      let s = 0;
      for (let c = 0; c < 17; c++) s += res.env[c][f] ?? 0;
      const y = h - Math.min(1, s / 3) * (h - 16 * dpr) - 2;
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
  tlPlayhead = -1;
}
let tlPlayhead = -1;
function drawPlayhead(t: number): void {
  if (!tlBg) drawTimeline();
  const total = res ? res.left.length / res.sampleRate : 257.76;
  const x = Math.round((t / total) * tl.width);
  if (x === tlPlayhead) return;
  const g = tl.getContext('2d')!;
  g.drawImage(tlBg!, 0, 0);
  g.fillStyle = '#fff';
  g.fillRect(x, 0, 2, tl.height);
  tlPlayhead = x;
}
tl.addEventListener('click', (e) => {
  if (!res) return;
  const t = (e.offsetX / tl.clientWidth) * (res.left.length / res.sampleRate);
  if (src) play(t);
  else {
    pausedAt = t;
    drawPlayhead(t);
  }
});

const pat = $<HTMLPreElement>('pattern');
let lastPatKey = '';
function cellText(c: XmCell, ch: number): string {
  const n = c.note ? noteName(c.note).padEnd(3, ' ') : '...';
  const i = c.ins ? hex2(c.ins) : '..';
  if (!view.full) return `${n}${ch === 18 ? '' : i}`;
  const v = c.vol ? hex2(c.vol) : '..';
  return `${n} ${i} ${v} ${fxName(c)}`;
}
function drawPattern(pos: number, row: number): void {
  if (!res) return;
  const key = `${pos}:${row}:${view.full}`;
  if (key === lastPatKey) return;
  lastPatKey = key;
  const tr = res.track;
  const p = tr.patterns[tr.order[pos]];
  if (!p) return;
  const C = tr.channels;
  const half = Math.max(8, Math.floor(($('patwrap').clientHeight / 15 - 2) / 2));
  const w = view.full ? 13 : 5;
  let html = `<span class="hdr">   ${Array.from({ length: C }, (_, c) => `${c + 1} ${CH_NAMES[c] ?? ''}`.slice(0, w).padEnd(w)).join(' ')}</span>\n`;
  for (let r = row - half; r <= row + half; r++) {
    if (r < 0 || r >= p.rows) {
      html += '\n';
      continue;
    }
    let line = `${hex2(r)} `;
    for (let c = 0; c < C; c++) {
      const cell = p.cells[r * C + c];
      const t = cellText(cell, c + 1);
      const cls = cell.note || cell.ins || cell.vol || cell.fx || cell.param ? (c === 17 ? 'mk' : 'n') : 'e';
      line += `<span class="${cls}">${t.padEnd(w)}</span> `;
    }
    html += r === row ? `<span class="cur">${line}</span>\n` : line + '\n';
  }
  pat.innerHTML = html;
}

const meters = $<HTMLCanvasElement>('meters');
function drawMeters(t: number): void {
  const g = meters.getContext('2d')!;
  const w = meters.width, h = meters.height;
  g.fillStyle = '#0d0c10';
  g.fillRect(0, 0, w, h);
  const bw = w / 18;
  g.font = '16px ui-monospace, monospace';
  for (let c = 0; c < 18; c++) {
    const e = res?.env[c];
    const v = e ? e[Math.min(e.length - 1, Math.floor(t * 60))] ?? 0 : 0;
    const db = v > 0 ? 20 * Math.log10(v) : -60;
    const k = Math.max(0, Math.min(1, (db + 48) / 48));
    g.fillStyle = c === 16 ? '#facade' : c === 17 ? '#555' : '#decade';
    g.fillRect(c * bw + 3, h - 22 - k * (h - 30), bw - 6, k * (h - 30));
    g.fillStyle = '#8a8394';
    g.fillText(String(c + 1), c * bw + 6, h - 5);
  }
}

const scope = $<HTMLCanvasElement>('scope');
let scopeIdle = 0;
function drawScope(t: number): void {
  if (!src) {
    if (scopeIdle++ > 30) return; // let the phosphor fade, then stop drawing
  } else scopeIdle = 0;
  const g = scope.getContext('2d')!;
  const w = scope.width, h = scope.height;
  g.fillStyle = 'rgba(5,4,7,0.35)';
  g.fillRect(0, 0, w, h);
  if (!res || !res.ghostL.length) return;
  const sr = res.sampleRate;
  const i1 = Math.floor(t * sr), n = Math.floor(sr / 30), i0 = Math.max(0, i1 - n);
  const L = res.ghostL, R = res.ghostR;
  g.strokeStyle = 'rgba(160,255,200,0.75)';
  g.lineWidth = 2;
  g.beginPath();
  const cx = w / 2, cy = h / 2, rr = w * 0.47;
  for (let i = i0; i < i1 && i < L.length; i++) {
    const x = cx + L[i] * rr, y = cy - R[i] * rr;
    i === i0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
}

function names(): void {
  if (!res) return;
  const lines = res.track.instruments.slice(0, 19).map((n, i) => `<b>${hex2(i + 1)}</b> ${n || '·'}`);
  const mk = res.track.instruments[0x7e];
  if (mk !== undefined) lines.push(`<b>7F</b> ${mk}`);
  $('names').innerHTML = `instruments (the diary):\n${lines.join('\n')}`;
}

function frame(): void {
  const t = now();
  const { pos, row } = posOf(t);
  $('pos').textContent = `${hex2(pos)}:${hex2(row)}`;
  $('time').textContent = mmss(t);
  const cue = SCRIPT[cueAt(t)];
  $('scene').textContent = cue ? `${cue.scene} ${cue.title}` : '—';
  drawPattern(pos, row);
  drawMeters(t);
  drawScope(t);
  drawPlayhead(t);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------------------------
// Instrument Lab

const pane = new Pane({ container: $('pane'), title: 'Instrument Lab' });
pane.registerPlugin(Essentials);
const lab = { slot: 1, octave: 4, key: 60 };
let spec: InstrumentSpec = structuredClone(BANK[0]);
let zones: (Zone & { rate: number })[] = [];
let zoneBufs = new Map<Zone, AudioBuffer>();
const voices = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
let paramsFolder: FolderApi | null = null;
let rebuildTimer = 0;

function rebuildZones(): void {
  const t0 = performance.now();
  zones = renderInstrument(spec, 44100);
  zoneBufs = new Map();
  log(`${hex2(spec.slot)} ${spec.name}: ${zones.length} zone(s) in ${(performance.now() - t0).toFixed(0)} ms`);
}
function bufFor(z: Zone & { rate: number }): AudioBuffer {
  let b = zoneBufs.get(z);
  if (!b) {
    b = new AudioBuffer({ numberOfChannels: 1, length: z.data.length, sampleRate: Math.round(z.rate) });
    b.copyToChannel(z.data as Float32Array<ArrayBuffer>, 0);
    zoneBufs.set(z, b);
  }
  return b;
}
function noteOn(code: string, key: number): void {
  if (!zones.length) rebuildZones();
  const c = audio();
  const z = zoneForKey(zones, key) as Zone & { rate: number };
  const s = c.createBufferSource();
  s.buffer = bufFor(z);
  s.playbackRate.value = Math.pow(2, (key - z.rootMidi) / 12);
  if (z.loopLength) {
    s.loop = true;
    s.loopStart = z.loopStart / z.rate;
    s.loopEnd = (z.loopStart + z.loopLength) / z.rate;
  }
  const g = c.createGain();
  const lvl = (spec.volume / 64) * 0.8;
  // XM volume envelope up to the sustain point (attack), release on key up
  const env = spec.volEnv;
  g.gain.setValueAtTime(env ? (env.points[0][1] / 64) * lvl : lvl, c.currentTime);
  if (env) {
    const sus = env.sustain ?? env.points.length - 1;
    for (let i = 1; i <= sus; i++) g.gain.linearRampToValueAtTime((env.points[i][1] / 64) * lvl, c.currentTime + env.points[i][0] * 0.02);
  }
  s.connect(g).connect(c.destination);
  s.start();
  voices.get(code)?.src.stop();
  voices.set(code, { src: s, gain: g });
  lab.key = key;
}
function noteOff(code: string): void {
  const v = voices.get(code);
  if (!v || !ctx) return;
  voices.delete(code);
  const env = spec.volEnv;
  const rel = env && env.sustain !== undefined ? (env.points[env.points.length - 1][0] - env.points[env.sustain][0]) * 0.02 : 0.05;
  v.gain.gain.cancelScheduledValues(ctx.currentTime);
  v.gain.gain.setValueAtTime(v.gain.gain.value, ctx.currentTime);
  v.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + Math.max(0.02, rel));
  v.src.stop(ctx.currentTime + Math.max(0.02, rel) + 0.05);
}

function buildParams(): void {
  paramsFolder?.dispose();
  const f = (paramsFolder = pane.addFolder({ title: `${hex2(spec.slot)} ${spec.name} · ${spec.kind}`, index: 3 }));
  f.addBlade({ view: 'text', label: 'note', parse: (v: string) => v, value: spec.note, disabled: true } as never);
  const ranges = PARAM_RANGES[spec.kind];
  for (const k of Object.keys(spec.params)) {
    const r = ranges[k];
    f.addBinding(spec.params, k, r ? { min: r[0], max: r[1], step: r[2] } : {}).on('change', () => {
      clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(rebuildZones, 120);
    });
  }
  f.addBinding(spec, 'volume', { min: 0, max: 64, step: 1 });
  const sends = f.addFolder({ title: 'engine sends', expanded: false });
  sends.addBinding(spec.sends, 'reverb', { min: 0, max: 1 });
  sends.addBinding(spec.sends, 'delay', { min: 0, max: 1 });
  sends.addBinding(spec.sends, 'chorus', { min: 0, max: 1 });
}

pane
  .addBinding(lab, 'slot', { options: Object.fromEntries(BANK.map((b) => [`${hex2(b.slot)} ${b.name}`, b.slot])) })
  .on('change', (e) => {
    spec = structuredClone(BANK.find((b) => b.slot === e.value)!);
    rebuildZones();
    buildParams();
  });
pane.addBinding(lab, 'octave', { min: 0, max: 8, step: 1 });
pane.addBlade({ view: 'separator' });
buildParams();

const io = pane.addFolder({ title: 'export / apply', expanded: true });
io.addButton({ title: 'export WAV (zone of the last key)' }).on('click', () => {
  if (!zones.length) rebuildZones();
  const z = zoneForKey(zones, lab.key) as Zone & { rate: number };
  download(encodeWav([z.data], z.rate), `${hex2(spec.slot)}-${spec.id}-${z.rootMidi}.wav`);
});
io.addButton({ title: 'export XI (all zones)' }).on('click', () => {
  if (!zones.length) rebuildZones();
  download(writeXi(zonesToXmInstrument(spec, zones)), `${hex2(spec.slot)}-${spec.id}.xi`);
});
io.addButton({ title: 'apply to loaded module + re-render' }).on('click', async () => {
  if (!xm) return log('load a module first');
  if (!zones.length) rebuildZones();
  const mod = readXm(xm);
  while (mod.instruments.length < spec.slot) mod.instruments.push({ name: '', samples: [], fadeout: 0 });
  const keepName = mod.instruments[spec.slot - 1]?.name;
  mod.instruments[spec.slot - 1] = { ...zonesToXmInstrument(spec, zones), name: keepName || spec.name };
  xm = writeXm(mod);
  xmLabel = `${xmLabel.replace(/ \+.*$/, '')} + lab ${hex2(spec.slot)}`;
  await doRender();
});
io.addButton({ title: 'copy params JSON' }).on('click', () => {
  const s = JSON.stringify({ slot: spec.slot, params: spec.params, volume: spec.volume, sends: spec.sends }, null, 1);
  void navigator.clipboard?.writeText(s);
  console.log(s);
  log('params copied (also in the console)');
});

const fxf = pane.addFolder({ title: 'FX bus (re-render to hear)', expanded: false });
fxf.addBinding(fx, 'masterGain', { min: -12, max: 18, step: 0.5 });
fxf.addBinding(fx.reverb, 'rt60', { min: 0.3, max: 8 });
fxf.addBinding(fx.reverb, 'size', { min: 0.4, max: 2 });
fxf.addBinding(fx.reverb, 'damping', { min: 1000, max: 16000, step: 100 });
fxf.addBinding(fx.reverb, 'predelay', { min: 0, max: 80 });
fxf.addBinding(fx.reverb, 'mod', { min: 0, max: 2 });
fxf.addBinding(fx.reverb, 'level', { label: 'reverb dB', min: -24, max: 6 });
fxf.addBinding(fx.delay, 'rows', { min: 1, max: 8, step: 1 });
fxf.addBinding(fx.delay, 'feedback', { min: 0, max: 0.9 });
fxf.addBinding(fx.delay, 'level', { label: 'delay dB', min: -24, max: 6 });
fxf.addBinding(fx.chorus, 'depth', { min: 0, max: 8 });
fxf.addBinding(fx.chorus, 'rate', { min: 0.05, max: 3 });
fxf.addBinding(fx.chorus, 'level', { label: 'chorus dB', min: -24, max: 6 });
fxf.addBinding(fx.comp, 'threshold', { min: -40, max: 0 });
fxf.addBinding(fx.comp, 'ratio', { min: 1, max: 10 });
fxf.addBinding(fx.limiter, 'ceiling', { min: -6, max: 0, step: 0.1 });
fxf.addButton({ title: 're-render' }).on('click', () => void doRender());
const viewf = pane.addFolder({ title: 'view', expanded: false });
viewf.addBinding(view, 'full', { label: 'full cells' }).on('change', () => (lastPatKey = ''));

function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// tracker keyboard: lower row = octave, upper row = octave + 1
const KEYS: Record<string, number> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
};
const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
window.addEventListener('keydown', (e) => {
  if (typing(e) || e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (src) stop();
    else play();
    return;
  }
  if (e.repeat) return;
  const k = KEYS[e.code];
  if (k !== undefined) noteOn(e.code, 12 * (lab.octave + 1) + k);
});
window.addEventListener('keyup', (e) => {
  if (KEYS[e.code] !== undefined) noteOff(e.code);
});

// ---------------------------------------------------------------------------------------------
// wiring

$('render').onclick = () => {
  audio();
  void doRender();
};
$('play').onclick = () => {
  audio();
  if (src) stop();
  else play();
};
$('source').onchange = () => {
  audio();
  void loadUrl($<HTMLSelectElement>('source').value);
};
$('device').onchange = () => void doRender();
for (const id of ['loop', 'loopA', 'loopB']) $(id).onchange = () => (src ? play(now()) : drawTimeline());
$('open').onclick = () => $('file').click();
$('file').onchange = async () => {
  const f = $<HTMLInputElement>('file').files?.[0];
  if (f) await loadBytes(new Uint8Array(await f.arrayBuffer()), f.name);
};
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const f = e.dataTransfer?.files[0];
  if (f) await loadBytes(new Uint8Array(await f.arrayBuffer()), f.name);
});
$('bench').onclick = async () => {
  const url = '/out/stress.xm';
  if (!(await exists(url))) return log('no out/stress.xm — node tools/build-xm.ts music/score/_stress.ts out/stress.xm');
  audio();
  const r = await fetch(url, { cache: 'no-store' });
  const bytes = new Uint8Array(await r.arrayBuffer());
  const t0 = performance.now();
  const b = await renderXm(bytes, ctx?.sampleRate ?? 48000, { device: 'webaudio' });
  const ms = performance.now() - t0;
  const msg = `benchmark: out/stress.xm ${(b.left.length / b.sampleRate).toFixed(1)} s rendered in ${(ms / 1000).toFixed(2)} s (${lastRenderStats?.workers} workers, ${lastRenderStats?.groups} groups, ${navigator.hardwareConcurrency} cores)`;
  console.log('[lab]', msg);
  (window as unknown as { __bench: unknown }).__bench = { ms, stats: lastRenderStats };
  log(msg);
};
window.addEventListener('resize', () => {
  drawTimeline();
  lastPatKey = '';
});

void (async () => {
  warmAudioWorkers();
  await populateSources();
  drawTimeline();
  requestAnimationFrame(frame);
  const first = $<HTMLSelectElement>('source').value;
  if (first) await loadUrl(first);
})();
