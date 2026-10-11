// D. Shader compilation: 16 heavy programs. Serial-sync vs batched-sync vs KHR_parallel_shader_compile,
// then the first-draw stall (Metal pipeline-state creation) and how warm-up draws affect frame pacing.
// A random constant per mode defeats Chrome's / ANGLE's / Metal's shader caches.
import type { Ctx } from './main.ts';
import { FS_TRI_VS, type GL, type GpuTimer, compileShader, linkProgram, programError, makeRT, makeFbo } from './glutil.ts';
import { FAMILIES, QUALITY, raymarchFS, type Family } from './shaders.ts';
import { fmt, nonce, r2, sleep, median, nextFrame, diffs } from './util.ts';

interface Spec {
  name: string;
  family: Family;
  q: number;
  fs: string;
}
interface Item {
  spec: Spec;
  vs: WebGLShader;
  fs: WebGLShader;
  p: WebGLProgram;
  /** serial mode: link duration; batched modes: ms from batch start until ready */
  ready: number;
  firstDraw: number;
  secondDraw: number;
  error: string | null;
}

function specs(n: number): Spec[] {
  return FAMILIES.flatMap((family) => QUALITY.map((_, q) => ({ name: `${family}/q${q}`, family, q, fs: raymarchFS(family, q, n) })));
}

/** concurrent rAF watcher → longest frame gap (loader animation smoothness) */
function rafWatch() {
  const stamps: number[] = [];
  let on = true;
  const f = (t: number) => {
    stamps.push(t);
    if (on) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
  return {
    stop() {
      on = false;
      const d = diffs(stamps);
      return { frames: stamps.length, maxGap: r2(d.length ? Math.max(...d) : 0), medianGap: r2(median(d)) };
    },
  };
}

function issue(gl: GL, list: Spec[]): Item[] {
  return list.map((spec) => {
    const vs = compileShader(gl, gl.VERTEX_SHADER, FS_TRI_VS);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, spec.fs);
    return { spec, vs, fs, p: linkProgram(gl, vs, fs), ready: NaN, firstDraw: NaN, secondDraw: NaN, error: null };
  });
}

function bindDraw(gl: GL, it: Item, fbo: WebGLFramebuffer, size: number) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, size, size);
  gl.useProgram(it.p);
  gl.uniform2f(gl.getUniformLocation(it.p, 'uRes'), size, size);
  gl.uniform1f(gl.getUniformLocation(it.p, 'uTime'), 3);
  gl.uniform1i(gl.getUniformLocation(it.p, 'uScene'), 0);
}

/** first vs second draw of each program, each followed by a real GPU sync */
async function drawStalls(gl: GL, T: GpuTimer, items: Item[], fbo: WebGLFramebuffer, size: number) {
  for (const it of items) {
    if (it.error) continue;
    bindDraw(gl, it, fbo, size);
    it.firstDraw = T.once(() => gl.drawArrays(gl.TRIANGLES, 0, 3));
    it.secondDraw = T.once(() => gl.drawArrays(gl.TRIANGLES, 0, 3));
    await sleep(16); // don't freeze the page in one block
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function cleanup(gl: GL, items: Item[]) {
  for (const it of items) {
    gl.deleteShader(it.vs);
    gl.deleteShader(it.fs);
    gl.deleteProgram(it.p);
  }
}

async function pollReady(gl: GL, ext: any, items: Item[], t0: number) {
  let pending = items.filter((i) => Number.isNaN(i.ready)).length;
  let maxPoll = 0;
  let polls = 0;
  while (pending && performance.now() - t0 < 120000) {
    await sleep(2);
    const ps = performance.now();
    for (const it of items) {
      if (!Number.isNaN(it.ready)) continue;
      if (gl.getProgramParameter(it.p, ext.COMPLETION_STATUS_KHR)) {
        it.ready = performance.now() - t0;
        pending--;
      }
    }
    maxPoll = Math.max(maxPoll, performance.now() - ps);
    polls++;
  }
  return { pending, maxPoll, polls };
}

export async function checkCompile(c: Ctx) {
  const b = c.bench;
  b.ensure();
  const gl = b.gl;
  const T = b.timer;
  const SZ = 64;
  const rt = makeRT(gl, SZ, SZ, gl.RGBA16F);
  const { fbo } = makeFbo(gl, [rt]);
  T.sync();
  const srcLen = specs(0.5).map((s) => s.fs.length);
  c.add('Program set', '16 programs = 4 families × 4 quality levels', 'INFO', `GLSL ${Math.min(...srcLen)}–${Math.max(...srcLen)} chars; fresh random NONCE constant per mode; first draws into a 64×64 RGBA16F target`);

  // ---------------------------------------------------------------- A: serial, sync status per program
  c.progress('D · mode A: serial synchronous compile+link');
  b.setLabel('compiling (serial, sync)…');
  await sleep(50);
  const nA = nonce();
  const A: Item[] = [];
  {
    const w = rafWatch();
    const t0 = performance.now();
    for (const spec of specs(nA)) {
      const ts = performance.now();
      const [it] = issue(gl, [spec]);
      it.error = programError(gl, it.p, it.vs, it.fs, FS_TRI_VS, spec.fs); // blocks until linked
      it.ready = performance.now() - ts;
      A.push(it);
      await sleep(0);
    }
    const total = performance.now() - t0;
    const watch = w.stop();
    await drawStalls(gl, T, A, fbo, SZ);
    c.add(
      'Mode A: compile+link one by one, sync LINK_STATUS each',
      `${fmt(total, 0)} ms total`,
      A.some((i) => i.error) ? 'FAIL' : 'INFO',
      `median ${fmt(median(A.map((i) => i.ready)), 0)} ms/program, max ${fmt(Math.max(...A.map((i) => i.ready)), 0)} · main thread blocked · rAF max gap ${watch.maxGap} ms`,
      { total: r2(total), raf: watch, perProgram: A.map((i) => ({ name: i.spec.name, ms: r2(i.ready) })) },
    );
    for (const e of A.filter((i) => i.error)) c.add(`compile error ${e.spec.name}`, (e.error ?? '').slice(0, 300), 'FAIL', '', e.error);
    const st = A.map((i) => i.firstDraw - i.secondDraw);
    c.add(
      'First-draw stall per program (Metal pipeline creation)',
      `median ${fmt(median(st), 1)} ms · max ${fmt(Math.max(...st), 1)} ms · Σ16 ${fmt(st.reduce((s, x) => s + x, 0), 0)} ms`,
      median(st) > 16 ? 'WARN' : 'PASS',
      'first draw + readPixels sync minus second draw; happens on the GPU-process thread at first use, NOT at link → must be pre-warmed in the loader with the real target formats',
      { perProgram: A.map((i) => ({ name: i.spec.name, first: r2(i.firstDraw), second: r2(i.secondDraw) })) },
    );
    cleanup(gl, A);
    T.sync();
  }

  // ---------------------------------------------------------------- A2: batch issue, then sync query
  c.progress('D · mode A2: batched issue, then sync LINK_STATUS');
  b.setLabel('compiling (batched, sync)…');
  await sleep(50);
  let A2: Item[] = [];
  {
    const w = rafWatch();
    const t0 = performance.now();
    A2 = issue(gl, specs(nonce()));
    const iss = performance.now() - t0;
    for (const it of A2) {
      it.error = programError(gl, it.p, it.vs, it.fs, FS_TRI_VS, it.spec.fs);
      it.ready = performance.now() - t0;
    }
    const total = performance.now() - t0;
    await sleep(0);
    const watch = w.stop();
    c.add(
      'Mode A2: issue all 16, then sync LINK_STATUS',
      `${fmt(total, 0)} ms total`,
      'INFO',
      `issue ${fmt(iss, 1)} ms; Chrome/ANGLE compiles batched programs in parallel even without the extension · rAF max gap ${watch.maxGap} ms`,
      { total: r2(total), issue: r2(iss), raf: watch, perProgram: A2.map((i) => ({ name: i.spec.name, readyAt: r2(i.ready) })) },
    );
  }

  // ---------------------------------------------------------------- B: KHR_parallel_shader_compile polling
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  let B: Item[] = [];
  if (!ext) {
    c.add('Mode B: KHR_parallel_shader_compile', 'extension missing', 'WARN', 'loader must budget for main-thread blocking');
  } else {
    c.progress('D · mode B: KHR_parallel_shader_compile (poll COMPLETION_STATUS_KHR)');
    b.setLabel('compiling (parallel, async poll)…');
    await sleep(50);
    const w = rafWatch();
    const t0 = performance.now();
    B = issue(gl, specs(nonce()));
    const iss = performance.now() - t0;
    const pr = await pollReady(gl, ext, B, t0);
    const total = performance.now() - t0;
    const watch = w.stop();
    for (const it of B) it.error = programError(gl, it.p, it.vs, it.fs, FS_TRI_VS, it.spec.fs);
    c.add(
      'Mode B: KHR_parallel_shader_compile, poll COMPLETION_STATUS_KHR',
      `${fmt(total, 0)} ms until all ready`,
      pr.pending ? 'FAIL' : 'PASS',
      `issue ${fmt(iss, 1)} ms · ${pr.polls} polls, longest ${fmt(pr.maxPoll, 2)} ms · rAF ${watch.frames} frames, max gap ${watch.maxGap} ms (main thread free)`,
      { total: r2(total), issue: r2(iss), ...pr, raf: watch, perProgram: B.map((i) => ({ name: i.spec.name, readyAt: r2(i.ready) })) },
    );
    const dbg = gl.getExtension('WEBGL_debug_shaders');
    if (dbg) {
      const tr = B.filter((i) => i.spec.q === 2).map((i) => `${i.spec.name} ${(dbg.getTranslatedShaderSource(i.fs).length / 1024).toFixed(0)}K`);
      c.add('Translated shader size (WEBGL_debug_shaders, q2)', tr.join(' · '), 'INFO', 'ANGLE → MSL source length');
    }

    // warm-up W2: one first draw per frame (what a loader should do)
    c.progress('D · warm-up: one first draw per frame');
    const stamps: number[] = [];
    for (const it of B) {
      const t = await nextFrame();
      if (t !== null) stamps.push(t);
      if (it.error) continue;
      bindDraw(gl, it, fbo, SZ);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    for (let i = 0; i < 4; i++) {
      const t = await nextFrame();
      if (t !== null) stamps.push(t);
    }
    const g = diffs(stamps);
    if (median(g) > 100) c.add('Warm-up one program per rAF', 'pending — run in Chrome with the tab in front', 'SKIP', 'renderer throttled (frames ~1/s)');
    else c.add(
      'Warm-up one program per rAF',
      `frame gaps median ${fmt(median(g), 1)} ms · max ${fmt(Math.max(...g), 1)} ms`,
      Math.max(...g) < 100 ? 'PASS' : 'WARN',
      'loader keeps animating with one ~stall-sized hitch per program; spread warm-ups (or hide them behind a static loader moment)',
      { gaps: g.map(r2) },
    );
    // second draws are now cheap
    await drawStalls(gl, T, B, fbo, SZ);
    c.add('After warm-up: draw cost', `median ${fmt(median(B.map((i) => i.firstDraw)), 2)} ms (64×64)`, 'INFO', 'no residual stall once pipelines exist');

    // pipeline re-creation when the target format / attachment set changes
    const it = B.find((i) => i.spec.name === 'kifs/q2' && !i.error);
    if (it) {
      const rt8 = makeRT(gl, SZ, SZ, gl.RGBA8);
      const { fbo: fbo8 } = makeFbo(gl, [rt8]);
      const t1 = makeRT(gl, SZ, SZ, gl.R32F, gl.NEAREST);
      const t2 = makeRT(gl, SZ, SZ, gl.RG16F);
      const { fbo: mrt } = makeFbo(gl, [rt, t1, t2]);
      // the raymarcher has one output → disable the other draw buffers (an enabled buffer without a
      // matching fragment output is INVALID_OPERATION in Chrome)
      gl.bindFramebuffer(gl.FRAMEBUFFER, mrt);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE, gl.NONE]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const once = (f: WebGLFramebuffer, blend = false) => {
        bindDraw(gl, it, f, SZ);
        if (blend) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
        }
        const ms = T.once(() => gl.drawArrays(gl.TRIANGLES, 0, 3));
        gl.disable(gl.BLEND);
        return ms;
      };
      const r8 = [once(fbo8), once(fbo8)];
      const m3 = [once(mrt), once(mrt)];
      const bl = [once(fbo, true), once(fbo, true)];
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const re = Math.max(r8[0] - r8[1], m3[0] - m3[1], bl[0] - bl[1]);
      c.add(
        'Re-stall when target format / blend state changes (kifs/q2)',
        `RGBA8 ${fmt(r8[0], 1)}→${fmt(r8[1], 1)} · MRT×3 ${fmt(m3[0], 1)}→${fmt(m3[1], 1)} · +additive blend ${fmt(bl[0], 1)}→${fmt(bl[1], 1)} ms`,
        re > 10 ? 'WARN' : 'PASS',
        'Metal pipelines are keyed by program + attachment formats + blend state → warm up every combination a scene uses',
      );
      gl.deleteFramebuffer(fbo8);
      gl.deleteFramebuffer(mrt);
      [rt8, t1, t2].forEach((t) => gl.deleteTexture(t));
    }
  }

  // ---------------------------------------------------------------- warm-up W1: all 16 first draws in one frame (last: the long freeze can stall a hidden tab)
  c.progress('D · warm-up: all 16 first draws in one frame');
  {
    await nextFrame();
    const w = rafWatch();
    await nextFrame();
    const t0 = performance.now();
    for (const it of A2) {
      bindDraw(gl, it, fbo, SZ);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const issued = performance.now() - t0;
    T.sync();
    const blocked = performance.now() - t0;
    await sleep(300);
    const watch = w.stop();
    c.add(
      'Warm-up all 16 at once',
      `GPU thread busy ${fmt(blocked, 0)} ms (issue ${fmt(issued, 1)} ms)`,
      blocked > 250 ? 'WARN' : 'PASS',
      `rAF max gap ${watch.maxGap} ms → one long freeze of the loader`,
      watch,
    );
    cleanup(gl, A2);
    T.sync();
  }

  // ---------------------------------------------------------------- C: identical sources again (program cache)
  if (ext) {
    c.progress('D · mode C: same sources as mode A again (cache)');
    await sleep(50);
    T.sync();
    const t0 = performance.now();
    const C = issue(gl, specs(nA));
    await pollReady(gl, ext, C, t0);
    const total = performance.now() - t0;
    await drawStalls(gl, T, C, fbo, SZ);
    const st = C.map((i) => i.firstDraw - i.secondDraw);
    c.add(
      'Mode C: recompile identical sources (cache hit)',
      `${fmt(total, 0)} ms until all ready · first-draw stall median ${fmt(median(st), 1)} ms, Σ ${fmt(st.reduce((s, x) => s + x, 0), 0)} ms`,
      'INFO',
      'Chrome caches programs keyed by source (memory + disk) → 2nd visit compiles near-free; shows whether the Metal pipeline cost is cached too',
    );
    cleanup(gl, C);
  }

  // ---------------------------------------------------------------- per-shader table
  for (let i = 0; i < 16; i++) {
    const a = A[i];
    const bb = B[i];
    const stall = a.firstDraw - a.secondDraw;
    c.add(
      `compile ${a.spec.name}`,
      `link ${fmt(a.ready, 0)} ms · 1st draw +${fmt(stall, 1)} ms${bb ? ` · in batch ready@${fmt(bb.ready, 0)} ms` : ''}`,
      a.error || bb?.error ? 'FAIL' : a.ready + stall > 250 ? 'WARN' : 'INFO',
      `${(a.spec.fs.length / 1024).toFixed(1)}K GLSL`,
      { linkMs: r2(a.ready), firstDraw: r2(a.firstDraw), secondDraw: r2(a.secondDraw), batchReadyAt: bb ? r2(bb.ready) : null },
    );
  }
  if (B.length) cleanup(gl, B);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(rt);
  b.setLabel('');
}
