// Render an .xm through the real engine (libopenmpt per-channel stems + FX bus) and print a
// compact mix report for the composers.
//   node tools/render-xm.ts music/effaced.xm out/effaced.wav [--rate 48000] [--device webaudio|gus|sb16] [--float] [--inline] [--json out.json]
//        [--channels [05-0C]]   per-position × per-channel mean levels (dB of the dry-stem RMS envelope)
// Renders on worker_threads (same code and bit-identical output as the browser); --inline = one thread.
// Report: timing, integrated loudness (BS.1770, ≈LUFS), true peak, per-channel levels (dry stems),
// per-position loudness, markers.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { renderInline } from '../src/audio/engine-core.ts';
import { renderXmNode, lastNodeStats } from '../src/audio/engine-node.ts';
import { loudness, truePeak, rangeLoudness } from '../src/audio/analysis.ts';
import type { Device } from '../src/audio/types.ts';
import { writeWav } from './wav.ts';

const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(k);
const opt = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const BOOL = ['--float', '--inline', '--channels'];
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) pos.push(argv[i]);
  else if (!BOOL.includes(argv[i])) i++;
}
const inPath = resolve(pos[0] ?? 'music/effaced.xm');
const outPath = resolve(pos[1] ?? 'out/' + inPath.replace(/^.*\//, '').replace(/\.xm$/i, '.wav'));
const rate = +(opt('--rate') ?? 48000);
const device = (opt('--device') ?? 'webaudio') as Device;

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : ' -inf');
const CH_NAMES = ['kick', 'snare', 'hats', 'perc', 'bass', 'sub', 'padA', 'padB', 'arp', 'lead', 'echo', 'counter', 'bell', 'pluck', 'fx', 'stab', 'ghost', 'marker'];

const bytes = new Uint8Array(readFileSync(inPath));
const t0 = performance.now();
let lastPct = -1;
const render = flag('--inline') ? renderInline : renderXmNode;
const res = await render(bytes, rate, { device }, (p) => {
  const pct = Math.floor(p * 10);
  if (pct !== lastPct && process.stdout.isTTY) process.stdout.write(`\rrendering… ${pct * 10}%`);
  lastPct = pct;
});
const tRender = (performance.now() - t0) / 1000;
if (process.stdout.isTTY) process.stdout.write('\r');
const sr = res.sampleRate;
const secs = res.left.length / sr;

mkdirSync(dirname(outPath), { recursive: true });
writeWav(outPath, sr, [res.left, res.right], flag('--float'));

// --- analysis
const t1 = performance.now();
const L = res.left, R = res.right;
let peak = 0, dcL = 0, dcR = 0, nan = 0;
for (let i = 0; i < L.length; i++) {
  const a = L[i], b = R[i];
  if (!Number.isFinite(a) || !Number.isFinite(b)) nan++;
  peak = Math.max(peak, Math.abs(a), Math.abs(b));
  dcL += a;
  dcR += b;
}
const loud = loudness(L, R, sr);
const tp = Math.max(truePeak(L), truePeak(R));
const track = res.track;
const nPos = track.order.length;

console.log(`${inPath.replace(/^.*\//, '')} → ${outPath.replace(process.cwd() + '/', '')}`);
const how = flag('--inline') ? 'inline' : `${lastNodeStats?.workers ?? 0} workers`;
console.log(`${device} ${sr} Hz · ${secs.toFixed(2)} s (song ${track.duration.toFixed(2)} + tail ${track.tail}) · ${nPos} positions · rendered in ${tRender.toFixed(2)} s (${(secs / tRender).toFixed(0)}× realtime, ${how})`);
console.log(
  `loudness ${f1(loud.integrated)} LUFS (target ≈ −14) · short-term max ${f1(loud.shortTermMax)} · true peak ${f1(tp)} dBTP (≤ −1) · sample peak ${f1(db(peak))} dBFS · DC ${(dcL / L.length).toExponential(1)}/${(dcR / R.length).toExponential(1)}${nan ? ` · ${nan} NaN!` : ''}`,
);

// per channel (dry stems, envelope = RMS at 60 Hz; a full-scale sine reads 0 dB)
console.log('\nch name     notes  peak dB  mean dB  active');
for (let c = 0; c < 18; c++) {
  const e = res.env[c];
  const notes = res.notes.filter((n) => n.ch === c + 1).length;
  if (!notes && c !== 17) continue;
  if (c === 17) {
    console.log(`18 marker  ${String(res.markers.length).padStart(5)}  (silent)`);
    continue;
  }
  let mx = 0, sum = 0, act = 0;
  for (let i = 0; i < e.length; i++) {
    mx = Math.max(mx, e[i]);
    if (e[i] > 0.001) (sum += e[i] * e[i]), act++;
  }
  console.log(
    `${String(c + 1).padStart(2)} ${CH_NAMES[c].padEnd(8)} ${String(notes).padStart(5)}  ${f1(db(mx)).padStart(7)}  ${f1(db(Math.sqrt(sum / Math.max(1, act)))).padStart(7)}  ${((act / e.length) * 100).toFixed(0).padStart(5)}%`,
  );
}

// per-position loudness (LUFS, ungated over the position)
const posL: string[] = [];
for (let p = 0; p < nPos; p++) {
  const a = track.posTime[p] * sr, b = track.posTime[p + 1] * sr;
  posL.push(`${p.toString(16).toUpperCase().padStart(2, '0')}:${f1(rangeLoudness(L, R, sr, a, b)).padStart(5)}`);
}
posL.push(`tail:${f1(rangeLoudness(L, R, sr, track.duration * sr, L.length)).padStart(5)}`);
console.log('\nloudness per position (LUFS):');
for (let i = 0; i < posL.length; i += 8) console.log('  ' + posL.slice(i, i + 8).join('  '));

if (flag('--channels')) {
  // optional range right after the flag, e.g. --channels 05-0C
  const ci = argv.indexOf('--channels');
  const rng = argv[ci + 1] && /^[0-9a-f]{2}(-[0-9a-f]{2})?$/i.test(argv[ci + 1]) ? argv[ci + 1] : '';
  const [lo, hi] = rng ? rng.split('-').map((x) => parseInt(x, 16)) : [0, nPos - 1];
  const hiP = hi ?? lo;
  const ENV = 60;
  console.log(`\nchannel levels per position (mean dB of active frames · '.' = silent):`);
  console.log('pos ' + CH_NAMES.slice(0, 17).map((n) => n.slice(0, 5).padStart(6)).join(''));
  for (let p = lo; p <= hiP && p < nPos; p++) {
    const a = Math.floor(track.posTime[p] * ENV), b = Math.floor(track.posTime[p + 1] * ENV);
    const cells = res.env.slice(0, 17).map((e) => {
      let sum = 0, n = 0;
      for (let i = a; i < b && i < e.length; i++) if (e[i] > 1e-4) { sum += e[i] * e[i]; n++; }
      return n ? f1(10 * Math.log10(sum / n)).padStart(6) : '     .';
    });
    console.log(`${p.toString(16).toUpperCase().padStart(2, '0')}  ${cells.join('')}`);
  }
}

if (res.markers.length) {
  const ms = res.markers.map((m) => `${Math.floor(m.row / 64).toString(16).toUpperCase().padStart(2, '0')}:${String(m.row % 64).padStart(2, '0')} ${m.note}`);
  console.log(`\nmarkers (${ms.length}): ${ms.join(' · ')}`);
}
console.log(`\nanalysis ${((performance.now() - t1) / 1000).toFixed(2)} s`);

const jsonPath = opt('--json');
if (jsonPath) {
  writeFileSync(
    resolve(jsonPath),
    JSON.stringify(
      {
        file: inPath,
        device,
        sampleRate: sr,
        seconds: secs,
        renderSeconds: tRender,
        lufs: loud.integrated,
        truePeak: tp,
        samplePeak: db(peak),
        positions: Array.from({ length: nPos }, (_, p) => rangeLoudness(L, R, sr, track.posTime[p] * sr, track.posTime[p + 1] * sr)),
        channels: res.env.map((e, c) => ({ ch: c + 1, notes: res.notes.filter((n) => n.ch === c + 1).length, peakDb: db(Math.max(0, ...e)) })),
        markers: res.markers,
      },
      null,
      1,
    ),
  );
}
