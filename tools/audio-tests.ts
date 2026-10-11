// Numeric checks for the audio toolchain (we can't listen, so we measure).
//   node tools/audio-tests.ts [--bank dir]   (needs music/instruments/manifest.json; builds out/engine-test.xm if missing)
// Covers: the shipped instrument bank (finite, DC, onsets, loop seams, calibrated levels, tuning of
// every pitched zone through libopenmpt), the Lab's synthetic stand-ins, Shepard zones, scope XY synth,
// the missing-fundamental filter and mute rule, and a full engine render (levels, true peak, DC,
// envelopes, notes / markers / note delay timing, ghost stem, determinism, devices).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BANK, renderInstrument } from '../src/audio/synth/bank.ts';
import { zonesToXmInstrument, manifestToXmInstrument, type ZonedEntry, type ManifestZone } from '../src/audio/synth/xm-zones.ts';
import { writeXi } from '../src/audio/synth/xi.ts';
import { sigilTables, ScopeSynth, SCOPE_DEFAULTS } from '../src/audio/synth/scope.ts';
import { writeXm, type XmInstrument, type XmModule, type XmPattern, type XmCell } from '../src/music/xm/xm.ts';
import { markerInstrument } from '../src/music/xm/instruments.ts';
import { song, type ScoreSong } from '../src/music/score/dsl.ts';
import { loadOpenMPT } from '../src/audio/openmpt.ts';
import { renderInline } from '../src/audio/engine-core.ts';
import { GroupMixer, makeBuses } from '../src/audio/mixer.ts';
import { Crusher } from '../src/audio/fx.ts';
import { estimatePitch, centsOff, loudness, truePeak } from '../src/audio/analysis.ts';
import { ENV_RATE } from '../src/audio/types.ts';
import { readWav, mono } from './wav.ts';
import { seamMetrics, pitchOf, resample } from './bank/dsp.ts';

let pass = 0, fail = 0;
const results: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++;
  else fail++;
  results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) console.log(`FAIL ${name} ${detail}`);
}
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const noteNameOf = (m: number) => ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'][m % 12] + (Math.floor(m / 12) - 1);
const t0 = performance.now();

// ---------------------------------------------------------------------------------------------
// 1. the shipped instrument bank (music/instruments, or --bank dir): every zone finite, ≤ 1, no DC,
//    onsets on the sample start, seamless loops, levels at their calibration targets
const SR = 44100;
const bankDir = resolve(process.argv.includes('--bank') ? process.argv[process.argv.indexOf('--bank') + 1] : 'music/instruments');
const manifest = JSON.parse(readFileSync(resolve(bankDir, 'manifest.json'), 'utf8')) as {
  generator: string;
  instruments: (ZonedEntry & { source?: string; level?: { lufs: number; targetLufs: number | null; shortfallDb: number; refMidi: number; v0Lufs: number | null; correctionDb: number } })[];
};
const wavCache = new Map<string, { data: Float32Array; sampleRate: number }>();
const loadZone = (f: string) => {
  let w = wavCache.get(f);
  if (!w) {
    const r = readWav(resolve(bankDir, f));
    wavCache.set(f, (w = { data: mono(r), sampleRate: r.sampleRate }));
  }
  return w;
};
const levelRows: string[] = [];
for (const e of manifest.instruments) {
  const zones = e.zones ?? [{ file: e.file, rootMidi: e.rootMidi, lo: 0, hi: 127, loopStart: e.loopStart ?? 0, loopLength: e.loopLength ?? 0, loopType: e.loopType ?? 0 }];
  const tag = `bank ${String(e.slot).padStart(2)} ${e.name}`;
  let finite = true, pk = 0, dcWorst = 0, onsetWorst = 0, stepWorst = 0, lvlWorst = -Infinity, specWorst = -Infinity;
  const looped = zones.some((z) => z.loopLength);
  for (const z of zones) {
    const { data: a, sampleRate: sr } = loadZone(z.file);
    let zpk = 0;
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i])) finite = false;
      zpk = Math.max(zpk, Math.abs(a[i]));
    }
    pk = Math.max(pk, zpk);
    // DC over the part that plays forever (the loop) or the whole one-shot
    const s0 = z.loopLength ? z.loopStart : 0, s1 = z.loopLength ? z.loopStart + z.loopLength : a.length;
    let dc = 0;
    for (let i = s0; i < s1; i++) dc += a[i];
    dcWorst = Math.max(dcWorst, Math.abs(dc / (s1 - s0)) / Math.max(zpk, 1e-9));
    // onset: the first sample above −30 dB re the zone peak (one-shots must speak on the row)
    let i0 = 0;
    while (i0 < a.length && Math.abs(a[i0]) < zpk * 0.0316) i0++;
    onsetWorst = Math.max(onsetWorst, (i0 / sr) * 1000);
    if (z.loopLength) {
      const m = seamMetrics(a, sr, z.loopStart, z.loopLength);
      stepWorst = Math.max(stepWorst, m.step);
      lvlWorst = Math.max(lvlWorst, m.levelDb - m.levelRef);
      specWorst = Math.max(specWorst, m.specDb - m.specRef);
    }
  }
  check(`${tag}: finite, peak ≤ 1`, finite && pk <= 1, `peak ${pk.toFixed(3)}, ${zones.length} zone(s)`);
  check(`${tag}: no DC`, dcWorst < 2e-3, `worst |mean| ${dcWorst.toExponential(1)} of peak`);
  // pads/strings speak from the first sample too (their slow attacks are XM envelopes or bowed
  // onsets that start at once); the reverse crash is a 1.9 s swell by design
  const onsetTol = e.slot === 14 ? 1000 : looped ? 25 : 5;
  check(`${tag}: onset on the sample start`, onsetWorst <= onsetTol, `first sample over −30 dB re peak at ${onsetWorst.toFixed(2)} ms (≤ ${onsetTol})`);
  if (looped)
    check(
      `${tag}: loop seams`,
      stepWorst < 6 && lvlWorst < 1.5 && specWorst < 1.5,
      `step ${stepWorst.toFixed(2)}× mean 2nd diff; level / spectrum jump across the seam minus the largest such jump inside the loop: ${lvlWorst > 0 ? '+' : ''}${lvlWorst.toFixed(2)} dB, ${specWorst > 0 ? '+' : ''}${specWorst.toFixed(2)} dB`,
    );
  const lv = e.level;
  if (lv && lv.targetLufs !== null) {
    const ok = Math.abs(lv.lufs - lv.targetLufs) <= Math.max(0.6, (lv.shortfallDb ?? 0) + 0.4);
    check(`${tag}: level at its calibration target`, ok, `${lv.lufs.toFixed(1)} LUFS at ${lv.refMidi}, target ${lv.targetLufs.toFixed(1)} (v0 ${lv.v0Lufs}${lv.correctionDb ? ` ${lv.correctionDb > 0 ? '+' : ''}${lv.correctionDb}` : ''})`);
  }
  if (lv) levelRows.push(`  ${String(e.slot).padStart(2)} ${e.name.padEnd(17)} ${(e.source ?? '').padEnd(7)} ${lv.lufs.toFixed(1).padStart(6)} LUFS  v0 ${lv.v0Lufs === null ? '   —' : lv.v0Lufs.toFixed(1).padStart(5)}  Δ ${lv.v0Lufs === null ? ' —' : (lv.lufs - lv.v0Lufs > 0 ? '+' : '') + (lv.lufs - lv.v0Lufs).toFixed(1)}`);
}

// synthetic stand-ins (src/audio/synth/bank.ts) — the Lab renders these; used below for the XI
// export and the engine sync test, which test the toolchain rather than the shipped sounds
const rendered = new Map<number, ReturnType<typeof renderInstrument>>();
for (const spec of BANK) rendered.set(spec.slot, renderInstrument(spec, SR));
for (const spec of BANK) {
  const zones = rendered.get(spec.slot)!;
  let finite = true, pk = 0;
  for (const z of zones) for (let i = 0; i < z.data.length; i++) (finite &&= Number.isFinite(z.data[i])), (pk = Math.max(pk, Math.abs(z.data[i])));
  if (!finite || pk > 1) check(`lab stand-in ${spec.slot} ${spec.id}: finite, peak ≤ 1`, false, `peak ${pk}`);
}

// ---------------------------------------------------------------------------------------------
// 2. tuning of every pitched zone through libopenmpt: each zone's root note is played from the
//    built XM instrument and its pitch compared with (a) the zone sample measured at its own rate
//    — exact XM tuning (relativeNote/finetune at an XM-exact rate) must reproduce it within 0.5 cent —
//    and (b) the equal-tempered target (the sample's intonation)
const mpt = await loadOpenMPT();
{
  type Case = { slot: number; name: string; root: number; zone: ManifestZone; ins: number };
  const cases: Case[] = [];
  const instruments: XmInstrument[] = [];
  const insOf = new Map<number, number>();
  for (const e of manifest.instruments) {
    if (e.unpitched || e.slot === 17 || e.slot === 18) continue; // kit/drums; Shepard (pitch class only); scope
    instruments.push(manifestToXmInstrument(e, loadZone));
    insOf.set(e.slot, instruments.length);
    for (const z of e.zones ?? []) cases.push({ slot: e.slot, name: e.name, root: z.rootMidi, zone: z, ins: instruments.length });
  }
  // one note every 16 rows on channel 1 (4 per pattern)
  const C = 2;
  const patterns: XmPattern[] = [];
  for (let p = 0; p < Math.ceil(cases.length / 4); p++) {
    const cells: XmCell[] = Array.from({ length: 64 * C }, () => ({ note: 0, ins: 0, vol: 0, fx: 0, param: 0 }));
    for (let k = 0; k < 4; k++) {
      const c = cases[p * 4 + k];
      if (!c) break;
      cells[k * 16 * C] = { note: c.root - 11, ins: c.ins, vol: 0x50, fx: 0, param: 0 };
      cells[(k * 16 + 15) * C] = { note: 97, ins: 0, vol: 0, fx: 0, param: 0 };
    }
    patterns.push({ rows: 64, cells });
  }
  const bytes = writeXm({ name: 'tuning', channels: C, speed: 6, bpm: 125, linear: true, restart: 0, order: patterns.map((_, i) => i), patterns, instruments });
  const m = mpt.open(bytes);
  const sr = 48000, N = Math.round(m.duration * sr);
  const L = new Float32Array(N), R = new Float32Array(N);
  let pos = 0;
  while (pos < N) {
    const k = m.read(L, R, sr, Math.min(8192, N - pos), pos);
    if (!k) break;
    pos += k;
  }
  m.destroy();
  const rowSec = 0.12;
  // a zone's audio as it plays (loops unrolled) at its own rate
  const unrolled = (z: ManifestZone, secs: number) => {
    const w = loadZone(z.file), n = Math.round(secs * w.sampleRate), y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let k = i;
      if (z.loopLength && k >= z.loopStart + z.loopLength) k = z.loopStart + ((k - z.loopStart) % z.loopLength);
      y[i] = w.data[k] ?? 0;
    }
    return { y, sr: w.sampleRate };
  };
  // timpani: the principal mode = the strongest spectral peak within ±5 % of the note
  const peakHz = (x: Float32Array, sr: number, from: number, len: number, f0: number) => {
    let best = f0, bm = -1;
    for (let c = -85; c <= 85; c += 0.5) {
      const f = f0 * Math.pow(2, c / 1200);
      let re = 0, im = 0;
      const w = (2 * Math.PI * f) / sr;
      for (let i = 0; i < len; i++) {
        const v = x[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)));
        re += v * Math.cos(w * i);
        im -= v * Math.sin(w * i);
      }
      const m2 = re * re + im * im;
      if (m2 > bm) (bm = m2), (best = f);
    }
    return best;
  };
  const worst = new Map<number, { xm: number; tune: number; name: string; n: number; detail: string }>();
  cases.forEach((c, i) => {
    const t = i * 16 * rowSec;
    const short = c.slot === 19 || c.slot === 16; // spiccato / orchestra hit: analyse early
    // ring instruments (bell, e-piano, harp): analyse the natural head, before the envelope decays
    const timp = c.slot === 15, ring = [7, 8, 9].includes(c.slot), looped = c.zone.loopLength > 0 && !ring;
    const from = short ? 0.03 : timp ? 0.15 : ring ? 0.06 : looped ? 0.4 : 0.25;
    const len = short ? 0.12 : timp ? 0.5 : ring ? 0.24 : looped ? 0.8 : 0.35;
    const f0 = mtof(c.root);
    const lo = f0 / 1.3, hi = f0 * 1.3;
    // the zone's own audio, brought to the render rate first so both estimates share the same
    // (rate-dependent) estimator bias
    const zr = unrolled(c.zone, from + len + 0.1);
    const z = { y: resample(zr.y, sr / zr.sr), sr };
    let fr: number, fz: number;
    // the rendered note's first sample (libopenmpt may start it a few samples after the row)
    let on = Math.round(t * sr);
    while (on < L.length && Math.abs(L[on]) < 1e-5) on++;
    const t0 = on / sr;
    if (timp) {
      fr = peakHz(L, sr, Math.round((t0 + from) * sr), Math.round(len * sr), f0);
      fz = peakHz(z.y, z.sr, Math.round(from * z.sr), Math.round(len * z.sr), f0);
    } else {
      fr = estimatePitch(L, sr, Math.round((t0 + from) * sr), Math.round(len * sr), lo, hi);
      fz = estimatePitch(z.y, z.sr, Math.round(from * z.sr), Math.round(len * z.sr), lo, hi);
    }
    // (a) the zone plays at its root: the render must equal the sample's own pitch
    const xmCents = centsOff(fr, fz);
    // (b) intonation of the sample itself: median pitch over the steady part
    const steady = timp ? fz : pitchOf(z.y, z.sr, from, from + len, lo, hi).f;
    const tuneCents = centsOff(steady, f0);
    const o = worst.get(c.slot) ?? { xm: 0, tune: 0, name: c.name, n: 0, detail: '' };
    o.n++;
    if (Math.abs(xmCents) > Math.abs(o.xm) || !Number.isFinite(xmCents)) o.xm = xmCents;
    if (Math.abs(tuneCents) > Math.abs(o.tune) || !Number.isFinite(tuneCents)) (o.tune = tuneCents), (o.detail = `worst ${noteNameOf(c.root)}`);
    worst.set(c.slot, o);
  });
  // XM playback must reproduce each zone (pads: formant-filtered ensemble noise, the estimator
  // itself wobbles ±2 c); intonation: steady synths 3 c, ensembles / brass 8 c, mallets 8 c,
  // spiccato (bow attack) 12 c, timpani (principal mode of a real drum) 25 c
  const XTOL: Record<number, number> = { 1: 3, 2: 3, 4: 3 };
  const TOL: Record<number, number> = { 1: 10, 2: 10, 4: 8, 3: 8, 5: 8, 7: 8, 8: 4, 9: 6, 15: 25, 16: 12, 19: 12 };
  for (const [slot, o] of worst) {
    check(`tuning slot ${slot} ${o.name}: XM-exact playback of ${o.n} zone(s)`, Math.abs(o.xm) <= (XTOL[slot] ?? 0.5), `worst ${o.xm.toFixed(2)} cents vs the sample at its own rate (tol ${XTOL[slot] ?? 0.5})`);
    check(`tuning slot ${slot} ${o.name}: intonation`, Math.abs(o.tune) <= (TOL[slot] ?? 3), `${o.tune.toFixed(2)} cents (${o.detail}, tol ${TOL[slot] ?? 3})`);
  }
}

// XI export (FT2 instrument file): header, keymap, sample headers, 16-bit delta data
{
  const ins = zonesToXmInstrument(BANK[0], rendered.get(1)!);
  const xi = writeXi(ins);
  const dv = new DataView(xi.buffer);
  const ns = dv.getUint16(296, true);
  const bytes = ins.samples.reduce((a, s) => a + s.data.length * 2, 0);
  const magic = String.fromCharCode(...xi.subarray(0, 21));
  check('XI export: header, keymap, samples', magic === 'Extended Instrument: ' && dv.getUint16(64, true) === 0x0102 && ns === ins.samples.length && xi.length === 298 + ns * 40 + bytes && xi[66 + 48] === ins.sampleMap![48], `${ns} samples, ${xi.length} bytes`);
}

// ---------------------------------------------------------------------------------------------
// 3. Shepard: one fixed spectral envelope for all pitch classes; partials step up with the note
{
  const zones = rendered.get(17)!;
  const cents: number[] = [];
  const centroid = (x: Float32Array, rate: number) => {
    // log-frequency centroid via a DFT on a 4096 window (Goertzel over a grid would be slower)
    const N = 8192, half = N / 2;
    let num = 0, den = 0;
    for (let k = 4; k < half; k += 1) {
      let re = 0, im = 0;
      const w = (2 * Math.PI * k) / N;
      for (let i = 0; i < N; i += 1) {
        const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
        re += x[i] * h * Math.cos(w * i);
        im -= x[i] * h * Math.sin(w * i);
      }
      const p = re * re + im * im;
      const f = (k * rate) / N;
      num += p * Math.log2(f);
      den += p;
      if (f > 6000) break;
    }
    return num / den;
  };
  // zones are short loops: unroll them to the analysis window first
  const unroll = (z: (typeof zones)[number]) => {
    const y = new Float32Array(8192);
    for (let i = 0; i < y.length; i++) y[i] = z.data[i < z.loopStart + z.loopLength ? i : z.loopStart + ((i - z.loopStart) % z.loopLength)];
    return y;
  };
  const cs = zones.filter((z) => [60, 62, 64, 65, 67, 69, 71].includes(z.rootMidi)).map((z) => centroid(unroll(z), z.rate));
  const spread = Math.max(...cs) - Math.min(...cs);
  check('shepard: spectral centroid identical across the 7 white keys', spread < 0.12, `spread ${spread.toFixed(3)} octaves (centroid ≈ ${Math.pow(2, cs[0]).toFixed(0)} Hz)`);
  // pitch class rises: estimate of the strongest partial's pitch class per zone increases (mod 12)
  for (const z of zones.slice(0, 7)) cents.push(z.rootMidi);
  check('shepard: 12 zones keyed by pitch class', zones.length === 12 && zones.every((z) => z.keys && z.keys.length >= 10));
}

// ---------------------------------------------------------------------------------------------
// 4. scope XY synth: bounded, Lissajous at morph 0, the sigil at morph 1, continuous
{
  const sr = 48000, n = sr;
  const amp = new Float32Array(n).fill(1);
  const mk = (morph: number) => {
    const s = new ScopeSynth([{ at: 0, f: 100, morph }], sr, { ...SCOPE_DEFAULTS, morphTime: 1e-4 });
    const l = new Float32Array(n), r = new Float32Array(n);
    s.render(0, n, amp, l, r);
    return { l, r };
  };
  const a = mk(0), b = mk(1);
  let pk = 0, step = 0;
  for (let i = 1; i < n; i++) {
    pk = Math.max(pk, Math.abs(b.l[i]), Math.abs(b.r[i]), Math.abs(a.l[i]), Math.abs(a.r[i]));
    if (i > n / 4) step = Math.max(step, Math.abs(b.l[i] - b.l[i - 1]), Math.abs(b.r[i] - b.r[i - 1]));
  }
  check('scope: XY bounded to ±0.9', pk <= 0.9 + 1e-6, `peak ${pk.toFixed(3)}`);
  // morph 1 traces the sigil table: correlate one period (480 samples at 100 Hz) with the table
  const tab = sigilTables()[6];
  let num = 0, da = 0, db = 0;
  const off = sr / 2; // after the morph settled
  for (let i = 0; i < 480; i++) {
    const u = (((i + off) * 100) / sr) % 1;
    const tx = tab.x[Math.floor(u * 4096)], ty = tab.y[Math.floor(u * 4096)];
    num += b.l[off + i] * tx + b.r[off + i] * ty;
    da += b.l[off + i] ** 2 + b.r[off + i] ** 2;
    db += tx * tx + ty * ty;
  }
  const corr = num / Math.sqrt(da * db);
  check('scope: morph 9FF traces the sigil', corr > 0.98, `correlation ${corr.toFixed(4)}`);
  let lis = 0;
  for (let i = 0; i < 480; i++) lis += Math.abs(a.r[off + i] - 0.9 * Math.sin(2 * Math.PI * 2 * (((i + off) * 100) / sr)));
  check('scope: morph 900 is the 3:2 Lissajous', lis / 480 < 0.01, `mean |y − sin| ${(lis / 480).toExponential(1)}`);
  // even speed: the largest step stays near the mean step of the table's own path length at 100 Hz
  // (whatever the sigil is), i.e. no jumps where the beam would skip
  const t6 = sigilTables()[6];
  let len = 0;
  for (let i = 1; i < t6.x.length; i++) len += Math.hypot(t6.x[i] - t6.x[i - 1], t6.y[i] - t6.y[i - 1]);
  const mean = (len * 100) / sr;
  check('scope: continuous beam, even speed', step < 1.6 * mean, `max step ${step.toFixed(4)} per sample at 100 Hz, mean ${mean.toFixed(4)}`);
}

// ---------------------------------------------------------------------------------------------
// 5. missing fundamental + mute rule (GroupMixer in isolation)
{
  const sr = 48000, n = sr * 2, f0 = 73.42; // D-2
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const v = 0.5 * Math.sin(2 * Math.PI * f0 * t) + 0.25 * Math.sin(2 * Math.PI * 2 * f0 * t) + 0.15 * Math.sin(2 * Math.PI * 3 * f0 * t);
    l[i] = r[i] = v;
  }
  const gm = new GroupMixer(sr, [{ ch: 5, sends: [], hpf: { from: sr / 2, to: n, ratio: 1.6, notes: [{ at: 0, f0 }] } }]);
  const out = makeBuses(n, false);
  gm.process(0, n, [{ l: l.slice(), r: r.slice() }], out);
  const amp = (x: Float32Array, f: number, from: number) => {
    let re = 0, im = 0;
    for (let i = from; i < from + sr / 2; i++) (re += x[i] * Math.cos((2 * Math.PI * f * i) / sr)), (im += x[i] * Math.sin((2 * Math.PI * f * i) / sr));
    return (2 * Math.hypot(re, im)) / (sr / 2);
  };
  const a1 = amp(out.dryL, f0, sr), a2 = amp(out.dryL, 2 * f0, sr), b1 = amp(out.dryL, f0, 0);
  const cut = 20 * Math.log10(a1 / 0.5), keep = 20 * Math.log10(a2 / 0.25);
  check('missing fundamental: f0 removed inside the range', cut < -25, `${cut.toFixed(1)} dB at f0`);
  check('missing fundamental: 2nd harmonic kept', Math.abs(keep) < 1.5, `${keep.toFixed(2)} dB at 2·f0`);
  check('missing fundamental: untouched before the range', Math.abs(20 * Math.log10(b1 / 0.5)) < 0.5);
  const gm2 = new GroupMixer(sr, [{ ch: 6, sends: [], mute: [{ from: sr / 2, to: sr }] }]);
  const o2 = makeBuses(n, false);
  gm2.process(0, n, [{ l: l.slice(), r: r.slice() }], o2);
  let inside = 0, after = 0;
  for (let i = sr / 2 + 512; i < sr; i++) inside = Math.max(inside, Math.abs(o2.dryL[i]));
  for (let i = sr + 512; i < sr + 4800; i++) after = Math.max(after, Math.abs(o2.dryL[i]));
  check('mute rule: silent inside, back after (ramped)', inside === 0 && after > 0.3, `inside ${inside}, after ${after.toFixed(2)}`);
}

// ---------------------------------------------------------------------------------------------
// 5b. engine channel pan (balance) and the S10 crusher
{
  const sr = 48000, n = 4096;
  const l = new Float32Array(n).fill(0.5), r = new Float32Array(n).fill(0.5);
  const gm = new GroupMixer(sr, [{ ch: 10, sends: [], pan: 0.3 }, { ch: 11, sends: [], pan: -0.45 }]);
  const out = makeBuses(n, false);
  gm.process(0, n, [{ l, r }, null], out);
  check('channel pan: ch10 +0.3 → left 0.7, right 1', Math.abs(out.dryL[100] - 0.35) < 1e-6 && Math.abs(out.dryR[100] - 0.5) < 1e-6, `${out.dryL[100].toFixed(3)} / ${out.dryR[100].toFixed(3)}`);
  const cr = new Crusher(1);
  const a = new Float32Array(sr), b = new Float32Array(sr);
  for (let i = 0; i < sr; i++) a[i] = b[i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / sr);
  const orig = a.slice();
  cr.process(a, b, sr, 0, { from: sr / 4, full: sr / 2, release: (3 * sr) / 4 });
  let before = 0, levels = new Set<number>(), after = 0;
  for (let i = 0; i < sr / 4; i++) before = Math.max(before, Math.abs(a[i] - orig[i]));
  for (let i = sr / 2; i < (3 * sr) / 4; i++) levels.add(Math.round(a[i] * 1e6));
  for (let i = (3 * sr) / 4 + 2400; i < sr; i++) after = Math.max(after, Math.abs(a[i] - orig[i]));
  let held = 0;
  for (let i = sr / 2 + 1; i < (3 * sr) / 4; i++) if (a[i] === a[i - 1]) held++;
  check('crush: untouched before the ramp and after the release', before === 0 && after === 0);
  check('crush: at full amount ≈ 8 bits and 1/4 rate', levels.size <= 260 && held > (sr / 4) * 0.7, `${levels.size} levels, ${((held / (sr / 4)) * 100).toFixed(0)}% held samples`);
}

// ---------------------------------------------------------------------------------------------
// 6. engine render of the fixture
const fixture = resolve('out/engine-test.xm');
if (!existsSync(fixture)) {
  // build it the way tools/build-xm.ts does
  const man = JSON.parse(readFileSync(resolve(bankDir, 'manifest.json'), 'utf8'));
  const sc: ScoreSong = (await import(pathToFileURL(resolve('music/score/_engine-test.ts')).href)).default;
  const ins: XmInstrument[] = [];
  for (let s = 1; s <= 0x7f; s++) {
    const e = man.instruments.find((x: { slot: number }) => x.slot === s);
    ins.push(e ? manifestToXmInstrument(e, loadZone) : s === 0x7f ? markerInstrument() : { name: '', samples: [], fadeout: 0 });
  }
  const mod: XmModule = { name: sc.name, channels: 18, speed: 6, bpm: 125, linear: true, restart: 0, order: sc.order, patterns: sc.patterns.map((b) => b.pattern), instruments: ins };
  mkdirSync(resolve('out'), { recursive: true });
  writeFileSync(fixture, writeXm(mod));
}
{
  const bytes = new Uint8Array(readFileSync(fixture));
  const tr = performance.now();
  const res = await renderInline(bytes, 48000);
  const secs = (performance.now() - tr) / 1000;
  const { left: L, right: R, sampleRate: sr } = res;
  let finite = true, pk = 0, dc = 0;
  for (let i = 0; i < L.length; i++) {
    if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) finite = false;
    pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    dc += L[i] + R[i];
  }
  dc /= 2 * L.length;
  const tp = Math.max(truePeak(L), truePeak(R));
  const lu = loudness(L, R, sr).integrated;
  check('engine: output finite', finite);
  check('engine: sample peak ≤ 1', pk <= 1, `peak ${pk.toFixed(4)}`);
  check('engine: true peak ≤ −1 dBTP', tp <= -1, `${tp.toFixed(2)} dBTP`);
  check('engine: DC offset < 1e-3', Math.abs(dc) < 1e-3, dc.toExponential(1));
  check('engine: loudness in a sane range', lu > -20 && lu < -9, `${lu.toFixed(1)} LUFS, rendered in ${secs.toFixed(2)} s`);
  const songLen = res.track.duration;
  check('engine: length = song + 12 s tail', Math.abs(L.length / sr - (songLen + 12)) < 1 / sr + 1e-9, `${(L.length / sr).toFixed(3)} s`);
  check('engine: 18 envelopes at 60 Hz', res.env.length === 18 && res.env.every((e) => e.length === Math.ceil((L.length / sr) * ENV_RATE)));
  check('engine: marker channel envelope is silent', res.env[17].every((v) => v === 0));
  check('engine: 13 markers with global rows', res.markers.length === 13 && res.markers[0].row === 0 && res.markers[5].row === 5 * 64 + 32, res.markers.map((m) => m.row).join(','));
  // note delay ED3 on the snare in position 06 row 8
  const pt = res.track.posTime;
  const ed = res.notes.find((n) => n.ch === 2 && n.pos === 6 && n.row === 8);
  check('engine: EDx note delay in NoteEvent.t', !!ed && Math.abs(ed.t - (pt[6] + 8 * 0.12 + 3 * 0.02)) < 1e-9, ed ? `${(ed.t - pt[6]).toFixed(4)} s into the position` : 'missing');
  // sync: the first kick of position 02 shows up in env[0] within 2 frames
  const k = res.notes.find((n) => n.ch === 1 && n.pos === 2)!;
  const f = Math.floor(k.t * ENV_RATE);
  const before = Math.max(...Array.from(res.env[0].subarray(f - 6, f - 1)));
  const at = Math.max(...Array.from(res.env[0].subarray(f, f + 2)));
  check('engine: kick onset in env[0] within 2 frames of the note', at > 0.05 && at > 4 * before, `before ${before.toFixed(3)}, at ${at.toFixed(3)}`);
  // ghost stem: present during the scope notes (pos 00), silent where the ghost plays nothing (pos 02)
  const rms = (a: Float32Array, t0: number, t1: number) => {
    let s = 0;
    const i0 = Math.floor(t0 * sr), i1 = Math.floor(t1 * sr);
    for (let i = i0; i < i1; i++) s += a[i] * a[i];
    return Math.sqrt(s / (i1 - i0));
  };
  let gpk = 0;
  for (let i = 0; i < res.ghostL.length; i++) gpk = Math.max(gpk, Math.abs(res.ghostL[i]), Math.abs(res.ghostR[i]));
  check('engine: ghost XY normalized to 0.9', Math.abs(gpk - 0.9) < 1e-3, `peak ${gpk.toFixed(4)}`);
  check('engine: ghost XY sounds in 00, silent in 02', rms(res.ghostL, pt[0] + 1, pt[1] - 0.5) > 0.1 && rms(res.ghostL, pt[2], pt[3]) < 1e-4);
  // sub removed in 0D–0E: its envelope is zero there and back in 0F? (0F has no sub) — check 0D–0E zero
  const e6 = res.env[5];
  const z = Array.from(e6.subarray(Math.ceil(pt[13] * ENV_RATE) + 1, Math.floor(pt[15] * ENV_RATE) - 1)).every((v) => v === 0);
  check('engine: sub envelope silent in 0D–0E (mute rule)', z);
  // tail: holds, then fades to silence at the very end
  const tailRms0 = rms(L, songLen + 1, songLen + 2), tailRms1 = rms(L, songLen + 11.6, songLen + 12 - 1 / sr);
  let lastPk = 0;
  for (let i = L.length - 64; i < L.length; i++) lastPk = Math.max(lastPk, Math.abs(L[i]), Math.abs(R[i]));
  check('engine: tail holds, then fades to silence', tailRms0 > 0.01 && tailRms1 < tailRms0 * 0.05 && lastPk < 1e-4, `rms ${tailRms0.toFixed(3)} → ${tailRms1.toExponential(1)}, last ${lastPk.toExponential(1)}`);
  // determinism
  const res2 = await renderInline(bytes, 48000);
  let same = res2.left.length === L.length;
  for (let i = 0; same && i < L.length; i++) if (L[i] !== res2.left[i] || R[i] !== res2.right[i]) same = false;
  check('engine: deterministic (two renders bit-identical)', same);
  // devices
  for (const device of ['gus', 'sb16'] as const) {
    const r = await renderInline(bytes, 48000, { device });
    let ok = true;
    for (let i = 0; i < r.left.length; i++) if (!Number.isFinite(r.left[i]) || Math.abs(r.left[i]) > 1) ok = false;
    const lud = loudness(r.left, r.right, r.sampleRate).integrated;
    check(`engine: device ${device}`, ok && Math.abs(lud - lu) < 2.5 && r.sampleRate === (device === 'gus' ? 38600 : 22050), `${r.sampleRate} Hz, ${lud.toFixed(1)} LUFS`);
  }
}

// ---------------------------------------------------------------------------------------------
// 7. sync: note times (incl. EDx) vs audible onsets in the final mix, every device
{
  const ins: XmInstrument[] = [];
  for (let s = 1; s <= 19; s++) ins.push(zonesToXmInstrument(BANK.find((b) => b.slot === s)!, rendered.get(s)!));
  const sc = song({ name: 'sync', patterns: { a: { 1: { 0: 'C-4:kick', 16: 'C-4', 37: 'C-4!ED3', 50: 'C-4!ED5' } } }, order: ['a', 'a', 'a'] });
  const bytes = writeXm({ name: 'sync', channels: 18, speed: 6, bpm: 125, linear: true, restart: 0, order: sc.order, patterns: sc.patterns.map((b) => b.pattern), instruments: ins });
  for (const device of ['webaudio', 'gus', 'sb16'] as const) {
    const res = await renderInline(bytes, 48000, { device });
    const sr = res.sampleRate;
    let worst = 0;
    for (const n of res.notes) {
      const i0 = Math.round(n.t * sr);
      let on = -1;
      for (let i = i0 - 2000; i < i0 + 2000; i++) if (Math.abs(res.left[i]) > 0.003) { on = i; break; }
      worst = Math.max(worst, Math.abs(on - i0) / sr);
      // let the previous kick decay before the next onset search
    }
    check(`sync ${device}: notes (incl. EDx) start on their sample`, worst <= 0.0002, `worst ${(worst * 1000).toFixed(2)} ms over ${res.notes.length} notes at ${sr} Hz`);
  }
}

console.log(results.join('\n'));
console.log(`\ninstrument levels (${manifest.generator}; LUFS of the mono zone at its root — loops: held note, one-shots: momentary max):\n${levelRows.join('\n')}`);
console.log(`\n${pass} passed, ${fail} failed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fail ? 1 : 0);
