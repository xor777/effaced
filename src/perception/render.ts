// Params + time → uniforms. One place that turns authored colours into buffer-space linear light.

import {
  hsl, toBuffer, luminance, predictAfterimage, rgb2hex, encode3, convertLinear, inGamut, css, glMat3, RGB_TO_LMS,
  LMS_TO_RGB, xyz2oklab, oklabHue, toXYZ, mul, hex2rgb, decode3, FACE_HEX, type Space, type Vec3,
} from './color.ts';
import { ROW, type Params, type LilacParams, type FaceParams, type HybridParams, type DriftParams } from './params.ts';
import {
  lilacFrame, faceFrame, faceLock, eraseSteps, DAWN_FRONT, ERASE_LEAD, ERASE_PREROLL, SCORE_CUES, type LilacFrame, type FaceFrame,
  type FaceCues,
} from './timeline.ts';
import { Pass, type Ctx } from './gl.ts';
import { Embers } from './embers.ts';
import { FaceCache } from './face-cache.ts';
import { LILAC_SRC } from './shaders/lilac.glsl.ts';
import { FACE_SRC } from './shaders/face.glsl.ts';
import { HYBRID_SRC, DRIFT_SRC } from './shaders/s9.glsl.ts';

const gray = (g: number): Vec3 => [g, g, g];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// ---------------------------------------------------------------------------------------------
export function lilacColors(p: LilacParams, space: Space) {
  const discEnc = hsl(p.hue, p.sat, p.light); // authored in sRGB (#BEADED is an sRGB hex)
  const disc = toBuffer(discEnc, 'srgb', space);
  const bg = toBuffer(gray(p.bgGray), 'srgb', space);
  const cross = toBuffer(gray(p.crossGray), 'srgb', space);
  const Yd = luminance(disc, space), Yb = luminance(bg, space);
  // assist colour: the complement of the disc around the background, in linear light
  const assist = bg.map((b, i) => Math.max(0, b - (disc[i] - b))) as Vec3;
  // hint text colour: Weber contrast on the background luminance (gray, so identical in sRGB/P3)
  const hintY = Math.max(0, Yb * (1 + p.hintContrast));
  const hintEnc = encode3(gray(hintY))[0];
  return { discEnc, disc, bg, cross, Yd, Yb, assist, hintCss: css(gray(hintEnc), 'srgb'), hintEnc };
}

/** background gray (sRGB-encoded) with the same luminance as the disc colour */
export function isoluminantGray(p: LilacParams): number {
  const lin = decode3(hsl(p.hue, p.sat, p.light));
  return encode3(gray(luminance(lin, 'srgb')))[0];
}

// ---------------------------------------------------------------------------------------------
export function faceColors(p: FaceParams, space: Space) {
  const authored: Space = p.gamut === 'p3' ? 'display-p3' : 'srgb';
  const enc = hsl(p.hue, p.sat, p.light);
  const skinRaw = toBuffer(enc, authored, space);
  const clipped = !inGamut(skinRaw);
  const skin = skinRaw.map(clamp01) as Vec3;
  const deep = skin.map((x) => x * p.deep) as Vec3;
  const white14 = toBuffer(gray(p.white14), 'srgb', space);
  const white15 = toBuffer(gray(p.white15), 'srgb', space);
  const Yw = luminance(white14, space);
  const Ys = luminance(skin, space) / Yw;
  const pred = predictAfterimage(skin, white14, space, p.predictP);
  const predDeep = predictAfterimage(deep, white14, space, p.predictP);
  const predScale = 1 / Math.max(1, ...pred, ...predDeep);
  // how the skin and its predicted afterimage look in sRGB (for the readouts)
  const skinSrgbLin = convertLinear(skin, space, 'srgb');
  const predSrgb = convertLinear(pred, space, 'srgb');
  const predY = luminance(pred, space);
  const predHue = oklabHue(xyz2oklab(mul(toXYZ(space), pred)));
  const faceHue = oklabHue(xyz2oklab(mul(toXYZ('srgb'), decode3(hex2rgb(FACE_HEX)))));
  const sRGBhex = inGamut(skinSrgbLin) ? rgb2hex(encode3(skinSrgbLin)) : 'outside sRGB';
  return {
    enc, skin, deep, white14, white15, clipped, Ys, pred, predScale, predY, predHue, faceHue,
    skinCss: css(enc, authored), sRGBhex,
    predHex: rgb2hex(encode3(predSrgb.map((x) => x / Math.max(...predSrgb)) as Vec3)),
  };
}

/** choose the face hue whose predicted afterimage has the OKLab hue of #FACE */
export function matchHue(p: FaceParams, space: Space): number {
  let best = p.hue, bestErr = 1e9;
  const q = { ...p };
  for (let h = 100; h <= 230; h += 0.5) {
    q.hue = h;
    const c = faceColors(q, space);
    const err = Math.abs(((c.predHue - c.faceHue + 540) % 360) - 180);
    if (err < bestErr) (bestErr = err), (best = h);
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
export interface Renderer {
  lilac: Pass;
  face: Pass;
  faceCache: FaceCache;
  embers: Embers;
  hybrid: Pass;
  drift: Pass;
}

export function createRenderer(ctx: Ctx): Renderer {
  return {
    lilac: new Pass(ctx, LILAC_SRC, 'S8 lilac'),
    face: new Pass(ctx, FACE_SRC, 'S14 face'),
    faceCache: new FaceCache(ctx),
    embers: new Embers(ctx),
    hybrid: new Pass(ctx, HYBRID_SRC, 'S9 hybrid'),
    drift: new Pass(ctx, DRIFT_SRC, 'S9 drift'),
  };
}

const visBuf = new Float32Array(12);

export function drawLilac(r: Renderer, P: Params, t: number, res: [number, number], space: Space): LilacFrame {
  const p = P.lilac;
  const f = lilacFrame(t, p, visBuf);
  const c = lilacColors(p, space);
  const crossStyle = p.crossStyle === 'none' ? 0 : p.crossStyle === 'cross' ? 1 : 2;
  r.lilac.draw({
    res, dither: P.g.dither,
    bg: c.bg, disc: c.disc, ringR: p.ringRadius, discR: p.discRadius, sigma: p.blurSigma,
    vis: f.vis, dir: p.clockwise ? 1 : -1,
    crossStyle, crossSz: [p.crossSize, p.crossThickness], crossCol: c.cross, crossA: f.cross,
    assistCol: c.assist, assistA: f.assistA, assistIdx: Math.max(0, f.assistIdx),
  });
  return f;
}

/** what the demo adds on top of the shared sequence (S15: the oscilloscope beam, drawn by the engine) */
export interface FaceExtra {
  /** linear glow of the beam (any size, sampled bilinearly) */
  beam?: WebGLTexture | null;
  beamExposure?: number;
  /** how far from the point the beam (+ its glow and trails) can reach, in frame heights */
  beamRadius?: number;
  /** added to the point's glow */
  halo?: number;
}

export function faceUniforms(P: Params, f: FaceFrame, res: [number, number], space: Space, x: FaceExtra = {}) {
  const p = P.face;
  const c = faceColors(p, space);
  const white = f.endWhite > 0 ? c.white15 : c.white14;
  const dark = toBuffer(gray(p.dotGray), 'srgb', space);
  const light = toBuffer(gray(0.85), 'srgb', space);
  const dotCol = dark.map((d, i) => d + (light[i] - d) * f.dotLight);
  const k = res[1] / 945;
  const lock = faceLock(p);
  const steps = eraseSteps(p);
  const design = faceDesignUniforms(p);
  return {
    res, dither: P.g.dither,
    center: [0, p.offsetY], scale: p.size,
    white, skin: c.skin, deepC: c.deep, faceOn: f.face, endWhite: f.endWhite,
    mode: p.preview === 'stimulus' ? 0 : p.preview === 'afterimage' ? 1 : 2,
    rgb2lms: glMat3(RGB_TO_LMS(space)), lms2rgb: glMat3(LMS_TO_RGB(space)),
    predP: p.predictP, predScale: c.predScale,
    dotCol, dotRA: [p.dotRadiusPx * k, f.dot],
    halo: [f.halo + (x.halo ?? 0), 14 * k],
    asmT: [f.row, 4 * (lock / 64), lock - 6.5, f.assembling ? 1 : f.erasing ? 2 : 0],
    dawnU: [f.field, DAWN_FRONT, Math.hypot((0.5 * res[0]) / res[1], 0.5 + Math.abs(p.offsetY)), 0],
    eraseU: [steps[0] ?? 1e4, p.eraseStepRows, Math.max(1, steps.length), p.eraseEase],
    eraseL: [ERASE_LEAD, ERASE_PREROLL],
    glowC: [0.95, 0.9, 1.0],
    comet: [f.cometPos[0], f.cometPos[1], f.comet, f.sweep],
    ...design,
    eyesOpen: f.eyes,
    vCache: 1,
    eyesLive: f.face > 0 && f.eyes !== design.eyesOpen ? 1 : 0,
    beamTex: 2,
    beamU: [x.beam ? 1 : 0, x.beamExposure ?? 1, x.beamRadius ?? 2],
  };
}

/** the design uniforms of the cache: the portrait with its final eyes */
export function faceCacheUniforms(p: FaceParams) {
  return { ...faceDesignUniforms(p), center: [0, p.offsetY], scale: p.size };
}

export function faceDesignUniforms(p: FaceParams) {
  return {
    featK: p.featureContrast, modelling: p.modelling,
    tones: [p.hairTone, p.haloTone, p.ringTone, p.garmentTone], strands: p.strands,
    edgeS: p.edgeBlur, featS: p.featureSoft, frame: [p.frameRadius, p.ringWidth, p.sides],
    eyesOpen: p.eyesOpen ? 1 : 0,
  };
}

/** the embers' uniforms (they share the clock, the dawn and the erasure with the face) */
export function emberUniforms(
  P: Params, f: FaceFrame, res: [number, number], space: Space, cues: FaceCues, u = faceUniforms(P, f, res, space),
) {
  const p = P.face;
  const kicks = [1e4, 1e4, 1e4, 1e4];
  cues.kick.slice(0, 4).forEach(([r], i) => (kicks[i] = r)); // the real heartbeats, whatever the assembly length
  return {
    res, center: u.center, scale: u.scale, asmT: u.asmT, dawnU: u.dawnU, eraseU: u.eraseU, eraseL: u.eraseL, kicks,
    emb: [0.7 * p.embers, 2.6 * (res[1] / 945), 2.6, 6],
    hotE: [0.85, 0.8, 0.86],
    coolE: encode3(toBuffer(hex2rgb('#ACCEDE'), 'srgb', space).map(clamp01) as Vec3),
    inkE: encode3(u.skin),
  };
}

/**
 * Draw the portrait sequence at `t` (lab time: pre-roll + S14 + S15). `cues` = the music it reacts to
 * (rows since the S14 cue); the lab and the silent demo use the score's. `x`: the demo's additions.
 */
export function drawFace(
  r: Renderer, P: Params, t: number, res: [number, number], space: Space, cues: FaceCues = SCORE_CUES, x: FaceExtra = {},
): FaceFrame {
  const f = faceFrame(t, P.face, cues);
  const embers = f.scene === 'S14' && (f.assembling || f.erasing) && P.face.embers > 0 && P.face.preview === 'stimulus';
  if (embers) r.embers.ensure(faceDesignUniforms(P.face));
  r.faceCache.use(faceCacheUniforms(P.face), res, 1, f.face > 0);
  const gl = r.face.ctx.gl;
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, x.beam ?? null);
  gl.activeTexture(gl.TEXTURE0);
  const u = faceUniforms(P, f, res, space, x);
  r.face.draw(u);
  if (embers) r.embers.draw(emberUniforms(P, f, res, space, cues, u));
  return f;
}

/** build the design cache, the ember table and the ember pipeline now (first draws cost tens of ms on
 *  ANGLE/Metal): nothing visible is drawn (every ember is culled) */
export function warmFace(r: Renderer, P: Params, res: [number, number], space: Space) {
  r.embers.ensure(faceDesignUniforms(P.face));
  r.faceCache.use(faceCacheUniforms(P.face), res, 1);
  const f = faceFrame(P.face.preRoll + (faceLock(P.face) + 4) * ROW, P.face);
  r.embers.draw(emberUniforms(P, { ...f, assembling: false, erasing: false }, res, space, SCORE_CUES));
}

export function drawHybrid(r: Renderer, P: Params, t: number, res: [number, number], space: Space) {
  const h: HybridParams = P.hybrid;
  const dof = h.sweep ? h.sweepMax * 0.5 * (1 - Math.cos((2 * Math.PI * t) / Math.max(0.5, h.sweepPeriod))) : h.dof;
  const sF = Math.sqrt(h.lowSigma ** 2 + (dof / h.size) ** 2);
  const colA = toBuffer(hsl(h.hue, 0.45, 0.06), 'srgb', space);
  const colB = toBuffer(hex2rgb('#DECADE'), 'srgb', space);
  r.hybrid.draw({
    res, dither: P.g.dither, center: [0, 0], scale: h.size,
    ...faceDesignUniforms({ ...P.face, eyesOpen: false }),
    featK: 1, modelling: 1, edgeS: sF, featS: sF, strands: 0,
    dofH: dof, faceAmp: h.faceAmp, patAmp: h.patternAmp, base: h.base,
    lineS: h.lineSigma, surround: h.surround, tori: h.tori, circles: h.circles, colA, colB,
  });
  return dof;
}

export function drawDrift(r: Renderer, P: Params, res: [number, number], space: Space) {
  const d: DriftParams = P.drift;
  const pal: Record<DriftParams['palette'], string[]> = {
    kitaoka: ['#000000', '#1F4BD8', '#FFFFFF', '#E8D200'],
    gray: ['#000000', '#5A5A5A', '#FFFFFF', '#B4B4B4'],
    beaded: ['#000000', '#6E5FA8', '#FFFFFF', '#BEADED'],
  };
  const [c0, c1, c2, c3] = pal[d.palette].map((h) => toBuffer(hex2rgb(h), 'srgb', space));
  r.drift.draw({
    res, dither: P.g.dither, layout_: d.layout === 'hopf' ? 1 : 0,
    rings: d.rings, segments: d.segments, wheels: d.wheels, radius: d.radius, contrast: d.contrast,
    width: d.width, circles: d.circles, c0, c1, c2, c3, bgc: toBuffer(gray(0.5), 'srgb', space),
  });
}
