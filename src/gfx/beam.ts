// Oscilloscope beam (woscope technique): consecutive points become line segments with a gaussian
// profile integrated analytically along the segment (erf); energy per segment is constant, so a
// slow beam is bright and a fast one dim. Segments are added into a phosphor buffer that decays
// exponentially (time-based, identical at 60 and 120 Hz).

import { type Gfx, type Target, program, PingPong, bindTarget, fullscreen, clearTarget } from './gl.ts';

const MAX_SEG = 32768;

export interface BeamStyle {
  /** beam radius in output pixels at 1080p */
  sigmaPx: number;
  /** phosphor decay time constant, seconds */
  tau: number;
  /** brightness of a dot parked for 1/60 s */
  intensity: number;
  /** linear P3 tint of the glow */
  tint: [number, number, number];
}

export class Beam {
  g: Gfx;
  splat = (null as unknown) as ReturnType<typeof program>;
  disp = (null as unknown) as ReturnType<typeof program>;
  phos: PingPong;
  pts = new Float32Array((MAX_SEG + 1) * 2);
  n = 0;
  vao: WebGLVertexArrayObject | null = null;
  vbo: WebGLBuffer | null = null;
  style: BeamStyle = { sigmaPx: 1.6, tau: 0.12, intensity: 200, tint: [0.55, 0.42, 0.62] };

  constructor(g: Gfx) {
    this.g = g;
    this.splat = program(g, 'scenes/s00-beam-splat', 'scenes/s00-beam-splat.vert');
    this.disp = program(g, 'scenes/s00-beam');
    // RGBA32F: additive blending into RGBA16F drifts/stalls for small increments (techcheck)
    this.phos = new PingPong({ formats: [g.gl.RGBA32F] });
  }

  programs() {
    return [this.splat, this.disp];
  }

  init() {
    const gl = this.g.gl;
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.pts.byteLength, gl.DYNAMIC_DRAW);
    // p0 = point i, p1 = point i+1: one buffer read twice, offset by one point, advanced per instance
    const l0 = gl.getAttribLocation(this.splat.prog!, 'p0');
    const l1 = gl.getAttribLocation(this.splat.prog!, 'p1');
    gl.enableVertexAttribArray(l0);
    gl.vertexAttribPointer(l0, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(l0, 1);
    gl.enableVertexAttribArray(l1);
    gl.vertexAttribPointer(l1, 2, gl.FLOAT, false, 8, 8);
    gl.vertexAttribDivisor(l1, 1);
    gl.bindVertexArray(null);
  }

  /** start collecting a new polyline for this frame */
  begin() {
    this.n = 0;
  }

  /** append a point (signal units: ±1 spans 82 % of the half-height) */
  push(x: number, y: number) {
    if (this.n > MAX_SEG) return;
    this.pts[this.n * 2] = x;
    this.pts[this.n * 2 + 1] = y;
    this.n++;
  }

  /** decay the phosphor by dt, splat the collected polyline, then draw the glow into `out` */
  render(dt: number, out: Target, aspect: number, reset: boolean, scale = 0.82, energy = 1) {
    const g = this.g, gl = g.gl;
    const s = this.style;
    const pw = out.w, ph = out.h;
    if (this.phos.ensure(g, pw, ph) || reset) {
      clearTarget(g, this.phos.read);
      clearTarget(g, this.phos.write);
    }
    bindTarget(g, this.phos.write);
    if (this.disp.use()) {
      this.disp.tex('phosphor', this.phos.read.tex[0], 0).set('mode', 0).set('decay', Math.exp(-Math.max(0, dt) / s.tau));
      fullscreen(g);
    }
    const segs = this.n - 1;
    if (segs > 0 && this.splat.use() && this.vao) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pts, 0, this.n * 2);
      const sigma = (s.sigmaPx * (ph / 1080)) / (scale * ph * 0.5);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.splat
        .set('scale', scale / aspect, scale)
        .set('sigma', sigma)
        // a dot parked for 1/60 s (800 segments at 48 kHz) peaks at ~intensity
        .set('gain', s.intensity * 2 * Math.PI * sigma * sigma * (1 / 800) * energy);
      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segs);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }
    this.phos.swap();

    bindTarget(g, out);
    if (this.disp.use()) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.disp.tex('phosphor', this.phos.read.tex[0], 0).set('mode', 1).set('tint', s.tint).set('bright', 1);
      fullscreen(g);
      gl.disable(gl.BLEND);
    }
  }
}
