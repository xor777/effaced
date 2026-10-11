// Parameters of the perception lab. Lengths are in "H" = fraction of the frame height (the frame is
// 16:10, 3024×1890 device px in fullscreen on the target MacBook), unless the name says Px (CSS px).
// Times are in seconds; ROW = one tracker row at 125 BPM / speed 6.

export const ROW = 0.12;

export type Mode = 'lilac' | 'face' | 'hybrid' | 'drift';

export interface GlobalParams {
  mode: Mode;
  colorSpace: 'display-p3' | 'srgb';
  dither: boolean;
  frame1610: boolean; // render into the largest 16:10 rect of the window (fullscreen is exactly 16:10)
  safeZone: boolean;
  debug: boolean;
  playing: boolean;
  loop: boolean;
  time: number; // preview time within the sequence
  viewDistanceCm: number; // for the degree readouts only
}

export interface LilacParams {
  // disc colour, HSL in sRGB (#BEADED = hsl(255.9°, 64%, 80.4%)); converted to P3 for the canvas
  hue: number;
  sat: number;
  light: number;
  bgGray: number; // sRGB-encoded gray of the background
  discRadius: number; // H
  blurSigma: number; // H, gaussian sigma of the disc⊗gaussian (exact Marcum-Q profile)
  ringRadius: number; // H
  stepTime: number; // s, one disc per step (default = 1 row)
  offTime: number; // s, how long each disc is gone
  clockwise: boolean;
  fadeIn: number; // s
  endAtRows: number; // rows: the ending starts here (quantised to a step)
  durationRows: number; // rows: the scene (192 = 16 revolutions)
  tail: number; // s of empty gray after the scene, still with the cross (in the demo: S9 starts)
  endMode: 'erase' | 'cut' | 'fade';
  endFade: number; // s, for endMode 'fade'
  crossStyle: 'cross' | 'dot' | 'none';
  crossSize: number; // H, half arm length (or dot radius)
  crossThickness: number; // H
  crossGray: number; // sRGB-encoded
  hint: boolean;
  hintText: string;
  hintContrast: number; // Weber luminance contrast (negative = darker than background)
  hintStartRows: number;
  hintRows: number; // visible length incl. fades
  hintFadeRows: number;
  hintSizePx: number;
  hintOffset: number; // H below the centre
  assist: number; // 0 = off. Contrast of a near-threshold green disc that keeps "running" after the end
  assistSteps: number;
}

export interface FaceParams {
  gamut: 'p3' | 'srgb'; // which RGB space the face HSL is authored in (P3 = more saturated stimulus)
  hue: number;
  sat: number;
  light: number;
  deep: number; // ink > 1 goes towards face colour × deep (linear), e.g. sclera
  featureContrast: number; // 1 = designed; 0 = flat silhouette; negative = stimulus-positive polarity
  modelling: number; // soft volume shading (cheeks, sockets, nose)
  hairTone: number;
  haloTone: number;
  ringTone: number;
  garmentTone: number;
  strands: number;
  edgeBlur: number; // face units, gaussian sigma of the outer contours (Troxler)
  featureSoft: number; // face units, gaussian sigma of the inner features
  size: number; // H per face unit (face unit = hairline→chin)
  offsetY: number; // H, vertical offset of the glabella from the frame centre
  frameRadius: number; // face units, apothem of the 65537-gon
  ringWidth: number; // face units
  sides: number; // 65537
  white14: number; // sRGB-encoded white level of the S14 field
  white15: number; // ... and of the S15 field (ending 'afterimage')
  preRoll: number; // s of black + point (the end of S13) before S14
  s14Rows: number; // S14 length (192 rows = 1C–1E = 23.04 s; fixed by the music in the demo)
  // S14: the face assembles from the embers of S13's flame (0 … assembleRows), opens its eyes, holds,
  // then is effaced back into the embers, which stream into the light point (the +1)
  assembleRows: number; // the face is complete from here (64 = 1D:00, the bell's second FADE)
  dawnFrom: number; // rows (of a 64-row assembly; scaled with assembleRows): the white blooms out of the point…
  dawnTo: number; // …and has filled the frame here
  eyesRow: number; // the eyes open (48 = 1C:48, the bell's E)
  eyesRows: number; // … over this many rows
  embers: number; // ember brightness (0 = no embers: the face just develops / dissolves)
  life: number; // the point's reactions: flare on the heartbeat, gathering the embers (0 = none)
  ending: 'erase' | 'afterimage'; // erased into the point (as the show's word) · the old afterimage (cut to white)
  eraseRow: number; // first erasure step (84 = 1D:20, when the echo leaves)
  eraseSteps: number; // one step per channel leaving (8: echo, lead, sub, bass, harp, strings, warm pad, choir)
  eraseStepRows: number; // the drop-out period (12)
  eraseEase: number; // rows each step takes to crumble (the rest of the period is still)
  s15: number; // s of S15 (1F + the 12 s tail = 19.68)
  pointOut: number; // s: the point goes out over the end of S15, with the music's tail fade (erase)
  textAt: number; // s into S15
  textOut: number; // s into S15: fades out again (erase; 0 = stays)
  text: string;
  textSizePx: number;
  textGray: number; // sRGB-encoded
  textFade: number;
  textOffset: number; // H below centre
  dotRadiusPx: number;
  dotGray: number; // the dark dot of the afterimage ending's white field
  s15Dot: 'on' | 'off' | 'fade';
  s15DotFade: number; // s
  eyesOpen: boolean;
  preview: 'stimulus' | 'afterimage' | 'design';
  predictP: number;
}

export interface HybridParams {
  lowSigma: number; // face units: cutoff of the low-pass face
  faceAmp: number;
  lineSigma: number; // H: width of the Hopf lines (centre gaussian of the DoG)
  surround: number; // DoG surround/centre ratio
  patternAmp: number;
  dof: number; // H: extra gaussian blur = DOF preview
  sweep: boolean; // animate dof 0 → max → 0
  sweepMax: number;
  sweepPeriod: number;
  tori: number;
  circles: number;
  hue: number; // tint
  base: number;
  size: number;
}

export interface DriftParams {
  layout: 'concentric' | 'hopf';
  palette: 'kitaoka' | 'gray' | 'beaded';
  rings: number;
  segments: number;
  wheels: number;
  radius: number; // H
  contrast: number;
  width: number; // band width for hopf layout (H)
  circles: number;
}

export interface Params {
  g: GlobalParams;
  lilac: LilacParams;
  face: FaceParams;
  hybrid: HybridParams;
  drift: DriftParams;
}

export function defaults(): Params {
  return {
    g: {
      mode: 'lilac',
      colorSpace: 'display-p3',
      dither: true,
      frame1610: true,
      safeZone: false,
      debug: true,
      playing: true,
      loop: true,
      time: 0,
      viewDistanceCm: 55,
    },
    lilac: {
      hue: 255.9,
      sat: 0.64,
      light: 0.804,
      bgGray: 0.73, // ≈ isoluminant with #BEADED (Y 0.47) — maximises Troxler fading
      discRadius: 0.05,
      blurSigma: 0.022,
      ringRadius: 0.32,
      stepTime: ROW,
      offTime: ROW, // exactly one disc missing at any time (Hinton: ~0.1 s off, ~0.125 s step)
      clockwise: true,
      fadeIn: 8 * ROW,
      endAtRows: 180, // the 16th revolution is the "erase" lap
      durationRows: 192,
      tail: 12 * ROW,
      endMode: 'erase',
      endFade: 4 * ROW,
      crossStyle: 'cross',
      crossSize: 0.011,
      crossThickness: 0.0021,
      crossGray: 0.0,
      hint: true,
      hintText: 'look at the center',
      hintContrast: -0.05,
      hintStartRows: 24,
      hintRows: 32,
      hintFadeRows: 8,
      hintSizePx: 13,
      hintOffset: 0.045,
      assist: 0,
      assistSteps: 6,
    },
    face: {
      gamut: 'p3',
      hue: 168,
      sat: 1.0,
      light: 0.3,
      deep: 0.4,
      featureContrast: 1.0,
      modelling: 1.0,
      hairTone: 0.32,
      haloTone: 0.16,
      ringTone: 1.0,
      garmentTone: 0.55,
      strands: 1.0,
      edgeBlur: 0.03,
      featureSoft: 0.006,
      size: 0.44,
      offsetY: 0.0,
      frameRadius: 1.04,
      ringWidth: 0.012,
      sides: 65537,
      white14: 1.0,
      white15: 1.0,
      preRoll: 1.0,
      s14Rows: 192,
      assembleRows: 64,
      dawnFrom: 20,
      dawnTo: 52,
      eyesRow: 48,
      eyesRows: 6,
      embers: 1,
      life: 1,
      ending: 'afterimage',
      eraseRow: 84,
      eraseSteps: 8,
      eraseStepRows: 12,
      eraseEase: 9,
      s15: 19.68,
      pointOut: 6,
      textAt: 9.5,
      textOut: 15,
      text: '65536 + 1',
      textSizePx: 12,
      textGray: 0.42,
      textFade: 2,
      textOffset: 0.075,
      dotRadiusPx: 2.5,
      dotGray: 0.12,
      s15Dot: 'on',
      s15DotFade: 3,
      eyesOpen: true,
      preview: 'stimulus',
      predictP: 0.35,
    },
    hybrid: {
      lowSigma: 0.05,
      faceAmp: 0.55,
      lineSigma: 0.0016,
      surround: 4,
      patternAmp: 0.5,
      dof: 0,
      sweep: true,
      sweepMax: 0.02,
      sweepPeriod: 8,
      tori: 3,
      circles: 20,
      hue: 285,
      base: 0.22,
      size: 0.5,
    },
    drift: {
      layout: 'concentric',
      palette: 'kitaoka',
      rings: 7,
      segments: 36,
      wheels: 1,
      radius: 0.46,
      contrast: 1,
      width: 0.035,
      circles: 18,
    },
  };
}

/** deep merge of a stored snapshot into fresh defaults (ignores unknown keys, keeps types) */
export function mergeParams(base: Params, src: unknown): Params {
  const walk = (dst: any, s: any) => {
    if (!s || typeof s !== 'object') return;
    for (const k of Object.keys(dst)) {
      if (!(k in s)) continue;
      if (dst[k] && typeof dst[k] === 'object') walk(dst[k], s[k]);
      else if (typeof s[k] === typeof dst[k]) dst[k] = s[k];
    }
  };
  walk(base, src);
  return base;
}

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
