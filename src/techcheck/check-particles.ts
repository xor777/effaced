// F. Particles: Thomas attractor RK4 via transform feedback (update / splat / fused) and a
// vertex-pulling variant (state in RGBA32F textures, fragment-shader update, gl_VertexID splat).
import { mat4 } from 'gl-matrix';
import type { Ctx } from './main.ts';
import { FS_TRI_VS, makeProgram, makeRT, makeFbo, drainErrors, type TimingResult } from './glutil.ts';
import {
  PART_INIT_VS,
  PART_UPDATE_VS,
  PART_FUSED_VS,
  PART_SPLAT_VS,
  PART_PULL_VS,
  PART_SPLAT_FS,
  PART_TEX_INIT_FS,
  PART_TEX_UPDATE_FS,
  NULL_FS,
  THOMAS_B,
} from './shaders.ts';
import { fmt, r2, sleep } from './util.ts';
import { TARGET_W, TARGET_H } from './check-gpu.ts';

const COUNTS = [1, 2, 4, 8].map((m) => m * 1024 * 1024);
const DT = 0.08;

/** synced wall time (timer queries are erratic on ANGLE-Metal) */
const best = (t: TimingResult) => t.wall;

export async function checkParticles(c: Ctx) {
  const b = c.bench;
  b.ensure();
  const gl = b.gl;
  const T = b.timer;
  const W = TARGET_W;
  const H = TARGET_H;

  drainErrors(gl); // don't blame stale errors on the allocations below
  const pInit = makeProgram(gl, PART_INIT_VS, NULL_FS, ['vPos']);
  const pUpdate = makeProgram(gl, PART_UPDATE_VS, NULL_FS, ['vPos']);
  const pFused = makeProgram(gl, PART_FUSED_VS, PART_SPLAT_FS, ['vPos']);
  const pSplat = makeProgram(gl, PART_SPLAT_VS, PART_SPLAT_FS);
  const pPull = makeProgram(gl, PART_PULL_VS, PART_SPLAT_FS);
  const pTexInit = makeProgram(gl, FS_TRI_VS, PART_TEX_INIT_FS);
  const pTexUpdate = makeProgram(gl, FS_TRI_VS, PART_TEX_UPDATE_FS);

  const proj = mat4.perspective(mat4.create(), (40 * Math.PI) / 180, W / H, 0.1, 100);
  const view = mat4.lookAt(mat4.create(), [9, 6, 13], [0, 0, 0], [0, 1, 0]);
  const mvp = mat4.multiply(mat4.create(), proj, view);
  for (const p of [pFused, pSplat, pPull]) {
    gl.useProgram(p);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uMVP'), false, mvp);
  }
  for (const p of [pUpdate, pFused, pTexUpdate]) {
    gl.useProgram(p);
    gl.uniform1f(gl.getUniformLocation(p, 'uDt'), DT);
    gl.uniform1f(gl.getUniformLocation(p, 'uB'), THOMAS_B);
  }

  // two splat targets, alternated per iteration (a clear + draws into the same target across iterations could be merged)
  const splatTexs = [makeRT(gl, W, H, gl.RGBA16F), makeRT(gl, W, H, gl.RGBA16F)];
  const splatFbos = splatTexs.map((t) => makeFbo(gl, [t]).fbo);
  const splatTex = splatTexs[0];
  const emptyVao = gl.createVertexArray();
  const summary: Record<string, Record<string, number>> = {};

  const beginSplat = (i: number) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, splatFbos[i & 1]);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
  };
  const endSplat = () => {
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  for (const N of COUNTS) {
    const label = `${N / 1048576}M`;
    c.progress(`F · transform feedback ${label} particles`);
    b.setLabel(`Thomas attractor ${label} particles (TF)`);
    // ---------------------------------------------------------------- transform feedback ping-pong
    drainErrors(gl);
    const bufs = [gl.createBuffer(), gl.createBuffer()];
    const vaos = [gl.createVertexArray(), gl.createVertexArray()];
    const tfs = [gl.createTransformFeedback(), gl.createTransformFeedback()];
    for (let i = 0; i < 2; i++) {
      gl.bindBuffer(gl.ARRAY_BUFFER, bufs[i]);
      gl.bufferData(gl.ARRAY_BUFFER, N * 16, gl.DYNAMIC_COPY);
      gl.bindVertexArray(vaos[i]);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      gl.bindVertexArray(null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tfs[i]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, bufs[i]);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null); // generic binding only; indexed binding stays in the TF object
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const oom = drainErrors(gl);
    if (oom.length) {
      c.add(`TF ${label}: allocate 2×${(N * 16) / 1048576} MB`, oom.join(','), 'FAIL');
      continue;
    }
    let cur = 0;
    const tfPass = (prog: WebGLProgram, discard: boolean) => {
      const dst = 1 - cur;
      gl.useProgram(prog);
      gl.bindVertexArray(vaos[cur]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tfs[dst]);
      if (discard) gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, N);
      gl.endTransformFeedback();
      if (discard) gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.bindVertexArray(null);
      cur = dst;
    };
    // init: no input attributes, hash(gl_VertexID) → buffer 0
    gl.useProgram(pInit);
    gl.bindVertexArray(emptyVao);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tfs[0]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);
    cur = 0;
    for (let i = 0; i < 40; i++) tfPass(pUpdate, true); // settle onto the attractor
    T.sync();

    const tUpd = await T.measure(() => tfPass(pUpdate, true), 8, 2);
    const tSplat = await T.measure((i) => {
      beginSplat(i);
      gl.useProgram(pSplat);
      gl.bindVertexArray(vaos[cur]);
      gl.drawArrays(gl.POINTS, 0, N);
      gl.bindVertexArray(null);
      endSplat();
    }, 8, 2);
    const tFused = await T.measure((i) => {
      beginSplat(i);
      tfPass(pFused, false);
      endSplat();
    }, 8, 2);
    const errs = drainErrors(gl);
    b.presenter.draw(splatTex, 1, 1.5);
    summary[label] = { tfUpdate: r2(best(tUpd)), splat: r2(best(tSplat)), fused: r2(best(tFused)) };
    for (let i = 0; i < 2; i++) {
      gl.deleteBuffer(bufs[i]);
      gl.deleteVertexArray(vaos[i]);
      gl.deleteTransformFeedback(tfs[i]);
    }
    await sleep(100);

    // ---------------------------------------------------------------- vertex pulling (texture state)
    c.progress(`F · vertex pulling ${label} particles`);
    b.setLabel(`Thomas attractor ${label} particles (texture state + gl_VertexID)`);
    const SW = 4096;
    const SH = N / SW;
    const st = [makeRT(gl, SW, SH, gl.RGBA32F, gl.NEAREST), makeRT(gl, SW, SH, gl.RGBA32F, gl.NEAREST)];
    const sf = [makeFbo(gl, [st[0]]).fbo, makeFbo(gl, [st[1]]).fbo];
    let sc = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sf[0]);
    gl.viewport(0, 0, SW, SH);
    gl.useProgram(pTexInit);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const texStep = () => {
      const d = 1 - sc;
      gl.bindFramebuffer(gl.FRAMEBUFFER, sf[d]);
      gl.viewport(0, 0, SW, SH);
      gl.useProgram(pTexUpdate);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, st[sc]);
      gl.uniform1i(gl.getUniformLocation(pTexUpdate, 'uState'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      sc = d;
    };
    const pullSplat = (i: number) => {
      beginSplat(i);
      gl.useProgram(pPull);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, st[sc]);
      gl.uniform1i(gl.getUniformLocation(pPull, 'uState'), 0);
      gl.uniform1i(gl.getUniformLocation(pPull, 'uW'), SW);
      gl.bindVertexArray(emptyVao);
      gl.drawArrays(gl.POINTS, 0, N);
      gl.bindVertexArray(null);
      endSplat();
    };
    for (let i = 0; i < 40; i++) texStep();
    T.sync();
    const tTexUpd = await T.measure(texStep, 8, 2);
    const tPull = await T.measure(pullSplat, 8, 2);
    const errs2 = drainErrors(gl);
    b.presenter.draw(splatTex, 1, 1.5);
    summary[label].texUpdate = r2(best(tTexUpd));
    summary[label].pullSplat = r2(best(tPull));

    // splat-target variants at 2M: flame histogram precision (RGBA32F), density only (R32F), half-res
    if (N === 2 * 1048576) {
      const variants: [string, number, number, GLenum][] = [
        ['RGBA16F full', W, H, gl.RGBA16F],
        ['RGBA32F full', W, H, gl.RGBA32F],
        ['R32F full', W, H, gl.R32F],
        ['RGBA16F ½', W >> 1, H >> 1, gl.RGBA16F],
      ];
      const parts: string[] = [];
      const vData: Record<string, number> = {};
      for (const [nm, w, h, fmtE] of variants) {
        const ts = [makeRT(gl, w, h, fmtE), makeRT(gl, w, h, fmtE)];
        const fs = ts.map((t) => makeFbo(gl, [t]).fbo);
        const tv = await T.measure((i) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fs[i & 1]);
          gl.viewport(0, 0, w, h);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(pPull);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, st[sc]);
          gl.uniform1i(gl.getUniformLocation(pPull, 'uState'), 0);
          gl.uniform1i(gl.getUniformLocation(pPull, 'uW'), SW);
          gl.bindVertexArray(emptyVao);
          gl.drawArrays(gl.POINTS, 0, N);
          gl.bindVertexArray(null);
          gl.disable(gl.BLEND);
        }, 8, 2);
        parts.push(`${nm} ${fmt(best(tv), 2)}`);
        vData[nm] = r2(best(tv));
        fs.forEach((f) => gl.deleteFramebuffer(f));
        ts.forEach((t) => gl.deleteTexture(t));
      }
      const e3 = drainErrors(gl);
      c.add(
        '2M points: splat target variants (ms)',
        parts.join(' · '),
        e3.length ? 'FAIL' : 'INFO',
        `same points, additive; cost is blend/ROP-bound on overlapping points${e3.length ? ' · GL ' + e3.join(',') : ''}`,
        vData,
      );
    }
    st.forEach((t) => gl.deleteTexture(t));
    sf.forEach((f) => gl.deleteFramebuffer(f));

    const fused = best(tFused);
    const pull = best(tTexUpd) + best(tPull);
    const bestPath = Math.min(fused, pull);
    c.add(
      `${label} particles → RGBA16F ${W}×${H}`,
      `TF upd ${fmt(best(tUpd), 2)} · splat ${fmt(best(tSplat), 2)} · fused ${fmt(fused, 2)} · pull: upd ${fmt(best(tTexUpd), 2)} + splat ${fmt(best(tPull), 2)} ms`,
      errs.length || errs2.length ? 'FAIL' : bestPath < 4 ? 'PASS' : bestPath < 8 ? 'WARN' : 'FAIL',
      `best path ${fmt(bestPath, 2)} ms/frame (${fused <= pull ? 'TF fused' : 'vertex pulling'}); readPixels-synced wall${errs.length || errs2.length ? ' · GL ' + [...errs, ...errs2].join(',') : ''}`,
      { tfUpdate: tUpd, splat: tSplat, fused: tFused, texUpdate: tTexUpd, pullSplat: tPull },
    );
    await sleep(150);
  }
  c.add('Particle summary (ms/frame)', JSON.stringify(summary), 'INFO', 'fused = RK4 update + splat in one TF draw', summary);

  [pInit, pUpdate, pFused, pSplat, pPull, pTexInit, pTexUpdate].forEach((p) => gl.deleteProgram(p));
  gl.deleteVertexArray(emptyVao);
  splatFbos.forEach((f) => gl.deleteFramebuffer(f));
  splatTexs.forEach((t) => gl.deleteTexture(t));
  b.setLabel('');
}
