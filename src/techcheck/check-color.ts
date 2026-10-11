// H. Color: Display-P3 in SDR end to end (WebGL drawingBufferColorSpace, CSS color(display-p3), canvas
// colour management). HDR/EDR is deliberately not used by the demo → only cheap API probes here.
import type { Ctx } from './main.ts';
import { $, errMsg } from './util.ts';

// --- colour math (linear sRGB <-> linear Display P3, both D65)
const P3_TO_SRGB = [
  [1.2249401, -0.2249404, 0],
  [-0.0420569, 1.0420571, 0],
  [-0.0196376, -0.0786361, 1.0982735],
];
const dec = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const enc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
/** encoded P3 → encoded sRGB, hard-clipped (what a non-colour-managed / sRGB pipeline would show) */
export function p3ToSrgbClamped(p3: number[]): number[] {
  const l = p3.map(dec);
  return P3_TO_SRGB.map((row) => enc(Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2]))));
}

/** Test colours (encoded Display-P3). Green/red are the P3 primaries; teal ≈ S14's saturated turquoise face. */
export const SWATCHES: { name: string; p3: number[] }[] = [
  { name: 'P3 green', p3: [0, 1, 0] },
  { name: 'P3 red', p3: [1, 0, 0] },
  { name: 'S14 teal', p3: [0, 0.85, 0.62] },
];

function glSwatchCanvas(el: HTMLCanvasElement, space: PredefinedColorSpace, colors: number[][]): WebGL2RenderingContext | null {
  const dpr = window.devicePixelRatio || 1;
  const r = el.getBoundingClientRect();
  el.width = Math.round(r.width * dpr);
  el.height = Math.round(r.height * dpr);
  const gl = el.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  if ('drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = space;
  gl.enable(gl.SCISSOR_TEST);
  const h = gl.drawingBufferHeight;
  const band = Math.ceil(h / colors.length);
  colors.forEach((c, i) => {
    // row 0 at top
    gl.scissor(0, h - (i + 1) * band, gl.drawingBufferWidth, band);
    gl.clearColor(c[0], c[1], c[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  });
  gl.disable(gl.SCISSOR_TEST);
  return gl;
}

const rgb255 = (a: ArrayLike<number>) => `(${a[0]}, ${a[1]}, ${a[2]})`;
const near = (a: ArrayLike<number>, b: number[], tol = 3) => b.every((x, i) => Math.abs(a[i] - x) <= tol);

export async function checkColor(c: Ctx) {
  // ---------------------------------------------------------------- environment
  const s = window.screen;
  c.add('devicePixelRatio', String(window.devicePixelRatio), window.devicePixelRatio === 2 ? 'PASS' : 'WARN', 'expected 2 on the built-in XDR panel');
  c.add(
    'screen / avail / inner (CSS px)',
    `${s.width}×${s.height} / ${s.availWidth}×${s.availHeight} / ${innerWidth}×${innerHeight}`,
    'INFO',
    `device px ${Math.round(s.width * devicePixelRatio)}×${Math.round(s.height * devicePixelRatio)} · colorDepth ${s.colorDepth} · fullscreen size → K (button)`,
  );
  const mq = (q: string) => matchMedia(q).matches;
  const gamut = mq('(color-gamut: rec2020)') ? 'rec2020' : mq('(color-gamut: p3)') ? 'p3' : mq('(color-gamut: srgb)') ? 'srgb' : '?';
  c.add('@media (color-gamut)', gamut, gamut === 'p3' || gamut === 'rec2020' ? 'PASS' : 'FAIL', 'P3 panel required for S1 out-of-sRGB colours');
  c.add(
    '@media dynamic-range / video-dynamic-range',
    `${mq('(dynamic-range: high)') ? 'high' : 'standard'} / ${mq('(video-dynamic-range: high)') ? 'high' : 'standard'}`,
    'INFO',
    'HDR deliberately unused (SDR P3 only)',
  );
  c.add('@media prefers-reduced-motion', mq('(prefers-reduced-motion: reduce)') ? 'reduce' : 'no-preference', 'INFO');
  c.add('CSS.supports color(display-p3 …)', String(CSS.supports('color', 'color(display-p3 0 1 0)')), CSS.supports('color', 'color(display-p3 0 1 0)') ? 'PASS' : 'FAIL');
  c.add('CSS.supports oklch / color-mix', `${CSS.supports('color', 'oklch(70% 0.2 150)')} / ${CSS.supports('color', 'color-mix(in oklch, red, blue)')}`, 'INFO');

  // ---------------------------------------------------------------- visual swatches
  const srgbCols = SWATCHES.map((w) => p3ToSrgbClamped(w.p3));
  const cssS = $('#sw-css-srgb');
  const cssP = $('#sw-css-p3');
  cssS.innerHTML = '';
  cssP.innerHTML = '';
  SWATCHES.forEach((w, i) => {
    const a = document.createElement('div');
    const sc = srgbCols[i].map((v) => Math.round(v * 255));
    a.style.background = `rgb(${sc[0]} ${sc[1]} ${sc[2]})`;
    cssS.appendChild(a);
    const b = document.createElement('div');
    b.style.background = `color(display-p3 ${w.p3.join(' ')})`;
    cssP.appendChild(b);
  });
  const glS = glSwatchCanvas($('#sw-gl-srgb') as HTMLCanvasElement, 'srgb', srgbCols);
  const glP = glSwatchCanvas($('#sw-gl-p3') as HTMLCanvasElement, 'display-p3', SWATCHES.map((w) => w.p3));
  if (!glP) {
    c.add('WebGL P3 swatch canvas', 'no context', 'FAIL');
    return;
  }
  c.add(
    'WebGL drawingBufferColorSpace = "display-p3"',
    String(glP.drawingBufferColorSpace),
    glP.drawingBufferColorSpace === 'display-p3' ? 'PASS' : 'FAIL',
    'property sticks after assignment',
  );
  {
    const px = new Uint8Array(4);
    glP.readPixels(1, glP.drawingBufferHeight - 2, 1, 1, glP.RGBA, glP.UNSIGNED_BYTE, px);
    c.add('P3 canvas stores P3-encoded values', rgb255(px), near(px, [0, 255, 0], 1) ? 'PASS' : 'FAIL', 'cleared to (0,1,0) → readPixels (0,255,0)');
  }

  // ---------------------------------------------------------------- colour management through the compositor inputs:
  // draw each canvas into a display-p3 2D canvas and read the pixels back in P3.
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 8;
    const x = cv.getContext('2d', { colorSpace: 'display-p3', willReadFrequently: true });
    if (!x) throw new Error('2D display-p3 context unavailable');
    const read = () => x.getImageData(2, 2, 1, 1, { colorSpace: 'display-p3' }).data;
    const expSrgbGreenInP3 = p3FromSrgb([0, 1, 0]).map((v) => Math.round(v * 255));

    x.fillStyle = 'rgb(0 255 0)';
    x.fillRect(0, 0, 8, 8);
    const a = read();
    c.add('2D P3 canvas ← CSS rgb(0 255 0)', rgb255(a), near(a, expSrgbGreenInP3) ? 'PASS' : 'FAIL', `sRGB green converted into P3: expect ≈${rgb255(expSrgbGreenInP3)}`);

    x.fillStyle = 'color(display-p3 0 1 0)';
    x.fillRect(0, 0, 8, 8);
    const b = read();
    c.add('2D P3 canvas ← CSS color(display-p3 0 1 0)', rgb255(b), near(b, [0, 255, 0]) ? 'PASS' : 'FAIL', 'expect (0, 255, 0)');

    x.clearRect(0, 0, 8, 8);
    x.drawImage(glP.canvas as HTMLCanvasElement, 0, 0, 8, 8);
    const g = read();
    c.add(
      '2D P3 canvas ← drawImage(WebGL display-p3 canvas, green)',
      rgb255(g),
      near(g, [0, 255, 0]) ? 'PASS' : 'FAIL',
      'expect (0,255,0): proves the WebGL buffer is tagged display-p3 when composited (else ≈(117,251,76) or clipped)',
    );
    if (glS) {
      // our sRGB GL canvas row 0 holds the clamped version of P3 green = pure sRGB green
      x.clearRect(0, 0, 8, 8);
      x.drawImage(glS.canvas as HTMLCanvasElement, 0, 0, 8, 8);
      const h = read();
      c.add('2D P3 canvas ← drawImage(WebGL srgb canvas, green)', rgb255(h), near(h, expSrgbGreenInP3) ? 'PASS' : 'FAIL', `expect ≈${rgb255(expSrgbGreenInP3)} (sRGB-tagged buffer gets converted)`);
    }
    // sRGB 2D canvas fed a P3 colour → gamut mapping behaviour
    const cs = document.createElement('canvas');
    cs.width = cs.height = 4;
    const y = cs.getContext('2d', { willReadFrequently: true })!;
    y.fillStyle = 'color(display-p3 0 1 0)';
    y.fillRect(0, 0, 4, 4);
    const k = y.getImageData(1, 1, 1, 1).data;
    c.add('2D sRGB canvas ← color(display-p3 0 1 0)', rgb255(k), 'INFO', 'how out-of-gamut colours are mapped into an sRGB surface (clip vs compress)');
  } catch (e) {
    c.add('Canvas colour-management round trip', errMsg(e), 'FAIL');
  }

  // ---------------------------------------------------------------- precision options for SDR P3 (banding in soft gradients / white field)
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 4;
    const gl = cv.getContext('webgl2')!;
    const anyGl = gl as any;
    if (typeof anyGl.drawingBufferStorage !== 'function') {
      c.add('gl.drawingBufferStorage()', 'not available', 'INFO', 'only RGBA8 default drawing buffer → dither (IGN) before output');
    } else {
      gl.getExtension('EXT_color_buffer_float');
      const res: string[] = [];
      for (const [nm, fmtEnum] of [
        ['RGBA16F', gl.RGBA16F],
        ['SRGB8_ALPHA8', gl.SRGB8_ALPHA8],
        ['RGBA8', gl.RGBA8],
      ] as const) {
        while (gl.getError()) {
          /* drain */
        }
        anyGl.drawingBufferStorage(fmtEnum, 4, 4);
        const err = gl.getError();
        const got = anyGl.drawingBufferFormat;
        res.push(`${nm}:${err ? 'err 0x' + err.toString(16) : 'ok'}${got !== undefined ? ' fmt 0x' + Number(got).toString(16) : ''}`);
      }
      gl.drawingBufferColorSpace = 'display-p3';
      anyGl.drawingBufferStorage(gl.RGBA16F, 4, 4);
      gl.clearColor(0.5004, 2.0, -0.25, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const f = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, f);
      c.add(
        'gl.drawingBufferStorage()',
        res.join(' · '),
        'PASS',
        `RGBA16F+P3 canvas readback ${Array.from(f).map((v) => +v.toFixed(4)).join(', ')} — a float backbuffer avoids 8-bit banding in the S14/S15 gradients (values > 1 are clipped in SDR)`,
      );
    }
    anyGl.getExtension?.('WEBGL_lose_context')?.loseContext();
  } catch (e) {
    c.add('gl.drawingBufferStorage()', errMsg(e), 'WARN');
  }
  {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl2') as any;
    c.add('gl.unpackColorSpace', gl && 'unpackColorSpace' in gl ? `supported (default ${gl.unpackColorSpace})` : 'no', 'INFO', 'image/texture uploads converted into the working space');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }

  // ---------------------------------------------------------------- HDR probes (informational only; not used)
  const probes: string[] = [];
  try {
    const cv = document.createElement('canvas');
    const x = cv.getContext('2d', { colorSpace: 'display-p3', colorType: 'float16' } as any) as any;
    probes.push(`2D colorType float16: ${x?.getContextAttributes?.().colorType ?? 'n/a'}`);
  } catch {
    probes.push('2D float16: throws');
  }
  {
    const gl = document.createElement('canvas').getContext('webgl2') as any;
    probes.push(`WebGL drawingBufferToneMapping: ${gl && typeof gl.drawingBufferToneMapping === 'function' ? 'yes' : 'no'}`);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  probes.push(`HTMLCanvasElement.configureHighDynamicRange: ${'configureHighDynamicRange' in HTMLCanvasElement.prototype ? 'yes' : 'no'}`);
  probes.push(`CSS dynamic-range-limit: ${CSS.supports('dynamic-range-limit', 'standard')}`);
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        const device = await adapter.requestDevice();
        const cv = document.createElement('canvas');
        const ctx = cv.getContext('webgpu') as GPUCanvasContext | null;
        ctx?.configure({ device, format: 'rgba16float', colorSpace: 'display-p3', toneMapping: { mode: 'extended' }, alphaMode: 'opaque' });
        const cfg = ctx?.getConfiguration?.();
        probes.push(`WebGPU toneMapping: ${cfg?.toneMapping?.mode ?? 'not reported'}`);
        c.add('WebGPU adapter', `${adapter.info?.vendor ?? '?'} ${adapter.info?.architecture ?? ''}`.trim(), 'INFO', 'available as an alternative backend; demo stays WebGL2');
        device.destroy();
      }
    } catch (e) {
      probes.push(`WebGPU: ${errMsg(e)}`);
    }
  } else probes.push('WebGPU: no navigator.gpu');
  c.add('HDR / extended-range APIs (probe only)', probes.join(' · '), 'INFO', 'demo is SDR P3 by decision; listed for completeness');
}

function p3FromSrgb(srgb: number[]): number[] {
  // linear sRGB → linear P3
  const M = [
    [0.8224621, 0.177538, 0],
    [0.0331941, 0.9668058, 0],
    [0.0170827, 0.0723974, 0.9105199],
  ];
  const l = srgb.map(dec);
  return M.map((r) => enc(r[0] * l[0] + r[1] * l[1] + r[2] * l[2]));
}
