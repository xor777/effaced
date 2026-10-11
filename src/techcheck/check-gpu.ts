// E. GPU timing (heavy raymarch at internal resolutions, bloom mip chain + AgX) · G. Frame cadence
import type { Ctx } from './main.ts';
import { FS_TRI_VS, type GL, compileShader, linkProgram, programError, makeProgram, makeRT, makeFbo, type TimingResult } from './glutil.ts';
import { raymarchFS, FAMILY_TIME, type Family, HDR_PATTERN_FS, BLOOM_DOWN_FS, BLOOM_UP_FS, AGX_FS } from './shaders.ts';
import { fmt, nonce, r2, sleep, rafSamples, cadence, median, type CadenceStats } from './util.ts';

export const TARGET_W = 3024;
export const TARGET_H = 1890;

export const RESOLUTIONS = [
  { label: '½ 1512×945', w: 1512, h: 945 },
  { label: '⅔ 2016×1260', w: 2016, h: 1260 },
  { label: '¾ 2268×1418', w: 2268, h: 1418 },
  { label: 'full 3024×1890', w: TARGET_W, h: TARGET_H },
  { label: 'ref 1920×1080', w: 1920, h: 1080 },
];

/** Compile with KHR_parallel_shader_compile (if present) and wait. */
export async function compileAsync(gl: GL, fsSrcs: string[], vsSrc = FS_TRI_VS): Promise<WebGLProgram[]> {
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  const items = fsSrcs.map((fsSrc) => {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    return { vs, fs, fsSrc, p: linkProgram(gl, vs, fs) };
  });
  if (ext) {
    const t0 = performance.now();
    while (performance.now() - t0 < 60000) {
      if (items.every((i) => gl.getProgramParameter(i.p, ext.COMPLETION_STATUS_KHR))) break;
      await sleep(5);
    }
  }
  return items.map((i) => {
    const err = programError(gl, i.p, i.vs, i.fs, vsSrc, i.fsSrc);
    gl.deleteShader(i.vs);
    gl.deleteShader(i.fs);
    if (err) throw new Error(err);
    return i.p;
  });
}

function budgetStatus(ms: number) {
  // 120 Hz frame = 8.33 ms; leave ~2 ms for post + compositor
  return ms < 6 ? 'PASS' : ms < 14 ? 'WARN' : 'FAIL';
}
/** Synced wall time is the primary metric; ANGLE-Metal timer queries are erratic (samples sometimes span several draws). */
const best = (t: TimingResult) => t.wall;
const timerAgrees = (t: TimingResult) => t.gpu !== null && Math.abs(t.gpu - t.wall) <= 0.25 * t.wall;
const timingStr = (t: TimingResult) =>
  `${fmt(t.wall, 2)} ms` + (t.gpu !== null ? ` (GPU timer ${fmt(t.gpu, 2)}${timerAgrees(t) ? '' : ' ✗ unreliable'})` : '');

export async function checkGpuTiming(c: Ctx) {
  const b = c.bench;
  b.ensure();
  const gl = b.gl;
  const T = b.timer;
  c.add(
    'Timer source',
    T.available ? 'EXT_disjoint_timer_query_webgl2 + readPixels-synced wall time' : 'readPixels-synced wall time',
    T.available ? 'PASS' : 'WARN',
    'primary = wall: N draws alternating 2 targets + one synced 1×1 readPixels, ÷N. Timer queries on ANGLE-Metal are cumulative per command buffer (per-draw = differences) and still erratic → cross-check only',
  );

  c.progress('E · compiling raymarchers (q2 + q0)');
  const fams: Family[] = ['kifs', 'tpms', 'indra'];
  const progs = await compileAsync(
    gl,
    fams.map((f) => raymarchFS(f, 2, nonce())),
  );
  const progs0 = await compileAsync(
    gl,
    fams.map((f) => raymarchFS(f, 0, nonce())),
  );
  const results: Record<string, Record<string, unknown>> = {};

  // ---- methodology: why gl.finish() and same-target batches lie on Chrome/ANGLE-Metal/Apple TBDR
  {
    const w = 1512;
    const h = 945;
    const rts = [makeRT(gl, w, h, gl.RGBA16F), makeRT(gl, w, h, gl.RGBA16F)];
    const fbs = rts.map((t) => makeFbo(gl, [t]).fbo);
    const p = progs[0];
    gl.useProgram(p);
    gl.uniform2f(gl.getUniformLocation(p, 'uRes'), w, h);
    gl.uniform1f(gl.getUniformLocation(p, 'uTime'), FAMILY_TIME.kifs);
    const draw = (i: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbs[i & 1]);
      gl.viewport(0, 0, w, h);
      gl.useProgram(p);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    draw(0);
    draw(1);
    T.sync();
    let t = performance.now();
    draw(0);
    gl.finish();
    const fin = performance.now() - t;
    T.sync();
    const rp = T.once(() => draw(0));
    t = performance.now();
    for (let i = 0; i < 8; i++) draw(0);
    T.sync();
    const same = (performance.now() - t) / 8;
    t = performance.now();
    for (let i = 0; i < 8; i++) draw(i);
    T.sync();
    const pp = (performance.now() - t) / 8;
    c.add(
      'Sync methodology (KIFS ½ res)',
      `draw+finish ${fmt(fin, 2)} ms · draw+readPixels ${fmt(rp, 2)} ms · 8× same target ${fmt(same, 2)} ms/draw · 8× ping-pong ${fmt(pp, 2)} ms/draw`,
      fin < rp * 0.5 ? 'WARN' : 'INFO',
      'gl.finish() does not wait here → use a 1×1 readPixels (or timer queries) for the loader benchmark; repeated opaque draws into one target get merged by TBDR hidden-surface removal',
    );
    fbs.forEach((f) => gl.deleteFramebuffer(f));
    rts.forEach((x) => gl.deleteTexture(x));
  }

  const runs: { q: number; list: typeof RESOLUTIONS }[] = [
    { q: 2, list: RESOLUTIONS },
    { q: 0, list: RESOLUTIONS.slice(0, 2) },
  ];
  for (const run of runs) {
    for (const res of run.list) {
      const rts = [makeRT(gl, res.w, res.h, gl.RGBA16F), makeRT(gl, res.w, res.h, gl.RGBA16F)];
      const fbos = rts.map((t) => makeFbo(gl, [t]).fbo);
      for (let fi = 0; fi < fams.length; fi++) {
        const fam = fams[fi];
        const p = run.q === 2 ? progs[fi] : progs0[fi];
        const tag = `${fam}/q${run.q}`;
        c.progress(`E · ${tag} @ ${res.label}`);
        b.setLabel(`${tag} raymarch @ ${res.label}`);
        gl.useProgram(p);
        gl.uniform2f(gl.getUniformLocation(p, 'uRes'), res.w, res.h);
        gl.uniform1f(gl.getUniformLocation(p, 'uTime'), FAMILY_TIME[fam]);
        gl.uniform1i(gl.getUniformLocation(p, 'uScene'), 0);
        const draw = (i: number) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[i & 1]);
          gl.viewport(0, 0, res.w, res.h);
          gl.useProgram(p);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        const t = await T.measure(draw, 8, 2);
        b.presenter.draw(rts[1], 0, 1);
        const ms = best(t);
        const mpx = (res.w * res.h) / 1e6;
        c.add(
          `${tag} raymarch @ ${res.label}`,
          timingStr(t),
          budgetStatus(ms),
          `${fmt(ms / mpx, 1)} ms/MP · budget: 120 Hz ≈ 6 ms, 60 Hz ≈ 14 ms${run.q === 0 ? ' · q0 = 100 steps, 24 shadow, KIFS×4' : ' · q2 = 180 steps, 48 shadow, 5 AO, KIFS×6'}`,
          t,
        );
        (results[tag] ??= {})[res.label] = r2(ms);
        await sleep(120);
      }
      fbos.forEach((f) => gl.deleteFramebuffer(f));
      rts.forEach((t) => gl.deleteTexture(t));
    }
  }
  progs0.forEach((p) => gl.deleteProgram(p));
  progs.forEach((p) => gl.deleteProgram(p));
  c.add('Raymarch summary (ms per frame, synced wall)', JSON.stringify(results), 'INFO', '', results);

  // ------------------------------------------------------------ bloom + AgX
  const down = makeProgram(gl, FS_TRI_VS, BLOOM_DOWN_FS);
  const up = makeProgram(gl, FS_TRI_VS, BLOOM_UP_FS);
  const agx = makeProgram(gl, FS_TRI_VS, AGX_FS);
  const pat = makeProgram(gl, FS_TRI_VS, HDR_PATTERN_FS);
  for (const res of [RESOLUTIONS[3], RESOLUTIONS[1]]) {
    c.progress(`E · bloom + AgX @ ${res.label}`);
    b.setLabel(`bloom mip chain + AgX @ ${res.label}`);
    const src = makeRT(gl, res.w, res.h, gl.RGBA16F);
    const { fbo: srcFbo } = makeFbo(gl, [src]);
    const outs = [makeRT(gl, res.w, res.h, gl.RGBA8), makeRT(gl, res.w, res.h, gl.RGBA8)];
    const outFbos = outs.map((t) => makeFbo(gl, [t]).fbo);
    const out = outs[0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, srcFbo);
    gl.viewport(0, 0, res.w, res.h);
    gl.useProgram(pat);
    gl.uniform2f(gl.getUniformLocation(pat, 'uRes'), res.w, res.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const levels: { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }[] = [];
    let lw = res.w >> 1;
    let lh = res.h >> 1;
    while (levels.length < 8 && Math.min(lw, lh) >= 8) {
      const tex = makeRT(gl, lw, lh, gl.RGBA16F);
      levels.push({ tex, fbo: makeFbo(gl, [tex]).fbo, w: lw, h: lh });
      lw >>= 1;
      lh >>= 1;
    }
    const U = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);
    const bind = (unit: number, tex: WebGLTexture) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    };
    const runBloom = () => {
      gl.disable(gl.BLEND);
      gl.useProgram(down);
      gl.uniform1i(U(down, 'uSrc'), 0);
      let pw = res.w;
      let ph = res.h;
      let prev = src;
      levels.forEach((L, i) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
        gl.viewport(0, 0, L.w, L.h);
        bind(0, prev);
        gl.uniform2f(U(down, 'uTexel'), 1 / pw, 1 / ph);
        gl.uniform2f(U(down, 'uDst'), L.w, L.h);
        gl.uniform1i(U(down, 'uKaris'), i === 0 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        prev = L.tex;
        pw = L.w;
        ph = L.h;
      });
      gl.useProgram(up);
      gl.uniform1i(U(up, 'uSrc'), 0);
      gl.uniform1f(U(up, 'uRadius'), 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = levels.length - 1; i > 0; i--) {
        const s = levels[i];
        const d = levels[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo);
        gl.viewport(0, 0, d.w, d.h);
        bind(0, s.tex);
        gl.uniform2f(U(up, 'uTexel'), 1 / s.w, 1 / s.h);
        gl.uniform2f(U(up, 'uDst'), d.w, d.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    };
    const runAgx = (i: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, outFbos[i & 1]);
      gl.viewport(0, 0, res.w, res.h);
      gl.useProgram(agx);
      bind(0, src);
      bind(1, levels[0].tex);
      gl.uniform1i(U(agx, 'uScene'), 0);
      gl.uniform1i(U(agx, 'uBloom'), 1);
      gl.uniform2f(U(agx, 'uDst'), res.w, res.h);
      gl.uniform1f(U(agx, 'uBloomAmt'), 0.05);
      gl.uniform1f(U(agx, 'uExposure'), 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const tAll = await T.measure((i) => {
      runBloom();
      runAgx(i);
    }, 8, 2);
    const tAgx = await T.measure(runAgx, 8, 2);
    b.presenter.draw(out, 2, 1);
    c.add(
      `Bloom (${levels.length} mips, 13-tap down + tent up) + AgX @ ${res.label}`,
      timingStr(tAll),
      best(tAll) < 1.5 ? 'PASS' : best(tAll) < 3 ? 'WARN' : 'FAIL',
      `AgX+dither composite alone: ${timingStr(tAgx)}`,
      { all: tAll, agx: tAgx, levels: levels.map((l) => `${l.w}×${l.h}`) },
    );
    levels.forEach((l) => {
      gl.deleteFramebuffer(l.fbo);
      gl.deleteTexture(l.tex);
    });
    gl.deleteFramebuffer(srcFbo);
    outFbos.forEach((f) => gl.deleteFramebuffer(f));
    gl.deleteTexture(src);
    outs.forEach((t) => gl.deleteTexture(t));
    await sleep(120);
  }
  [down, up, agx, pat].forEach((p) => gl.deleteProgram(p));
  b.setLabel('');
}

// ------------------------------------------------------------------------------------------ G

export async function checkCadence(c: Ctx) {
  const b = c.bench;
  b.ensure();
  const gl = b.gl;
  if (document.visibilityState !== 'visible') c.add('Page visibility', document.visibilityState, 'WARN', 'tab reports hidden → rAF may be throttled; rows marked SKIP/pending need a re-run with the tab in front');

  c.progress('G · idle rAF cadence');
  b.setLabel('rAF cadence: idle');
  const offsets: number[] = [];
  const idle = await rafSamples(2000, (t) => offsets.push(performance.now() - t));
  if (idle.throttled || idle.stamps.length < 10) {
    c.add('rAF cadence (all scenarios)', 'pending — run ?only=G in Chrome with the tab in front', 'SKIP', `renderer throttled: only ${idle.stamps.length} frames in 2 s (hidden/occluded tab)`);
    return;
  }
  const ci = cadence(idle.stamps);
  const is120 = ci.hz > 100;
  c.add(
    'rAF rate (idle)',
    `${fmt(ci.hz, 1)} Hz · median ${fmt(ci.medianMs, 2)} ms · jitter σ ${fmt(ci.jitterMs, 2)} ms · p95 ${fmt(ci.p95Ms, 2)} ms`,
    is120 ? 'PASS' : 'WARN',
    is120 ? 'ProMotion 120 Hz active' : 'not 120 Hz (ProMotion off, low-power mode, external display, or embedded browser)',
    ci,
  );
  c.add('rAF timestamp → callback offset', `${fmt(median(offsets), 2)} ms median`, 'INFO', 'rAF time is the frame start (vsync-aligned), not "now"; use it for animation');
  const ref = ci.medianMs;

  // load scenarios bracketing the 120 Hz budget (costs from section E) + present to the visible canvas each frame
  const [kifs, tpms0] = await compileAsync(gl, [raymarchFS('kifs', 2, nonce()), raymarchFS('tpms', 0, nonce())]);
  const scenarios: { label: string; prog: WebGLProgram | null; t0: number; w: number; h: number; every: number }[] = [
    { label: 'present only', prog: null, t0: 0, w: 0, h: 0, every: 1 },
    { label: 'TPMS q0 ½ (~4–5 ms)', prog: tpms0, t0: FAMILY_TIME.tpms, w: 1512, h: 945, every: 1 },
    { label: 'TPMS q0 ⅔ (~8 ms)', prog: tpms0, t0: FAMILY_TIME.tpms, w: 2016, h: 1260, every: 1 },
    { label: 'KIFS q2 ½ (~13 ms), free-running', prog: kifs, t0: FAMILY_TIME.kifs, w: 1512, h: 945, every: 1 },
    { label: 'KIFS q2 ½ (~13 ms), every 2nd rAF', prog: kifs, t0: FAMILY_TIME.kifs, w: 1512, h: 945, every: 2 },
    { label: 'KIFS q2 full (~40 ms)', prog: kifs, t0: FAMILY_TIME.kifs, w: 3024, h: 1890, every: 1 },
  ];
  const out: Record<string, CadenceStats> = { idle: ci };
  const light = makeRT(gl, 4, 4, gl.RGBA16F);
  for (const s of scenarios) {
    c.progress(`G · cadence: ${s.label}`);
    b.setLabel(`rAF cadence: ${s.label}`);
    const rts = s.w ? [makeRT(gl, s.w, s.h, gl.RGBA16F), makeRT(gl, s.w, s.h, gl.RGBA16F)] : [light, light];
    const fbos = s.w ? rts.map((t) => makeFbo(gl, [t]).fbo) : [];
    const rendered: number[] = [];
    let k = 0;
    const r = await rafSamples(2500, (t, i) => {
      if (i % s.every) return;
      rendered.push(t);
      k++;
      if (s.prog && fbos.length) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[k & 1]);
        gl.viewport(0, 0, s.w, s.h);
        gl.useProgram(s.prog);
        gl.uniform2f(gl.getUniformLocation(s.prog, 'uRes'), s.w, s.h);
        gl.uniform1f(gl.getUniformLocation(s.prog, 'uTime'), s.t0 + t / 4000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      b.presenter.draw(rts[k & 1], 0, 1);
    });
    if (r.throttled || cadence(r.stamps).medianMs > 100) {
      c.add(`rAF under load: ${s.label}`, 'pending — run in Chrome with the tab in front', 'SKIP', `renderer throttled: frames ~1/s (hidden/occluded tab stops producing frames once a frame misses vsync)`);
      fbos.forEach((f) => gl.deleteFramebuffer(f));
      if (s.w) rts.forEach((t) => gl.deleteTexture(t));
      continue;
    }
    const cs = cadence(s.every > 1 ? rendered : r.stamps, ref * s.every);
    out[s.label] = cs;
    const okRate = cs.dropFrac < 0.05;
    c.add(
      `rAF under load: ${s.label}`,
      `${fmt(cs.hz, 1)} Hz · median ${fmt(cs.medianMs, 2)} ms · σ ${fmt(cs.jitterMs, 2)} · drops ${(cs.dropFrac * 100).toFixed(1)}%`,
      okRate ? 'PASS' : cs.dropFrac < 0.25 ? 'WARN' : 'FAIL',
      `intervals ${JSON.stringify(cs.hist)}${s.every > 1 ? ' (rendered frames only)' : ''}`,
      cs,
    );
    fbos.forEach((f) => gl.deleteFramebuffer(f));
    if (s.w) rts.forEach((t) => gl.deleteTexture(t));
    await sleep(150);
  }
  gl.deleteTexture(light);
  gl.deleteProgram(kifs);
  gl.deleteProgram(tpms0);

  const free = out['KIFS q2 ½ (~13 ms), free-running'];
  const locked = out['KIFS q2 ½ (~13 ms), every 2nd rAF'];
  const rec = !free || !locked
    ? 'pending — heavy-load cadence not measured (renderer throttled); run ?only=G in Chrome with the tab in front'
    : is120
    ? `Display runs at ${fmt(ci.hz, 0)} Hz. Animate from the audio clock (time-based, never frame-counted) and render every vsync while the frame fits ~7 ms GPU (dynamic resolution between ½ and ⅔ of 3024×1890). ` +
      `For scenes that can't, lock to 60 Hz by rendering on every 2nd rAF (locked: ${fmt(locked?.hz ?? NaN, 1)} Hz σ ${fmt(locked?.jitterMs ?? NaN, 2)} ms vs free-running: ${fmt(free?.hz ?? NaN, 1)} Hz σ ${fmt(free?.jitterMs ?? NaN, 2)} ms).`
    : `Display at ${fmt(ci.hz, 0)} Hz. Time-based animation from the audio clock; render every rAF.`;
  c.add('Frame pacing recommendation', rec, 'INFO', '', out);
  b.setLabel('');
}
