// Colour math for the perception lab. Everything the shaders receive is LINEAR light expressed in
// the primaries of the drawing buffer ('srgb' or 'display-p3'); the shader only applies the sRGB
// transfer curve at the very end (Display P3 uses the same curve). So "the colour on screen is the
// colour we computed": no tonemapping, no bloom, only ±1 LSB TPDF dither that preserves the mean.

export type Vec3 = [number, number, number];
export type Space = 'srgb' | 'display-p3';
type Mat3 = number[]; // row-major 3×3

export const srgbDecode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const srgbEncode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);
export const decode3 = (c: Vec3): Vec3 => [srgbDecode(c[0]), srgbDecode(c[1]), srgbDecode(c[2])];
export const encode3 = (c: Vec3): Vec3 => [srgbEncode(c[0]), srgbEncode(c[1]), srgbEncode(c[2])];

export const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
export const matmul = (a: Mat3, b: Mat3): Mat3 => {
  const r: Mat3 = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  return r;
};
export function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(
    (x) => x / det,
  );
}

// linear RGB → XYZ (D65)
export const SRGB_TO_XYZ: Mat3 = [0.4123908, 0.3575843, 0.1804808, 0.212639, 0.7151687, 0.0721923, 0.0193308, 0.1191948, 0.9505322];
export const P3_TO_XYZ: Mat3 = [0.4865709, 0.2656677, 0.1982173, 0.2289746, 0.6917385, 0.0792869, 0.0, 0.0451134, 1.0439444];
export const XYZ_TO_SRGB = inv3(SRGB_TO_XYZ);
export const XYZ_TO_P3 = inv3(P3_TO_XYZ);
// Hunt–Pointer–Estévez cone space, normalised so that D65 white → (1,1,1)
export const XYZ_TO_LMS: Mat3 = [0.40024, 0.7076, -0.08081, -0.2263, 1.16532, 0.0457, 0.0, 0.0, 0.91822];
export const LMS_TO_XYZ = inv3(XYZ_TO_LMS);

export const toXYZ = (space: Space): Mat3 => (space === 'srgb' ? SRGB_TO_XYZ : P3_TO_XYZ);
export const fromXYZ = (space: Space): Mat3 => (space === 'srgb' ? XYZ_TO_SRGB : XYZ_TO_P3);

/** linear RGB in space `a` → linear RGB in space `b` */
export function convertLinear(c: Vec3, a: Space, b: Space): Vec3 {
  return a === b ? [...c] : mul(fromXYZ(b), mul(toXYZ(a), c));
}

/** encoded colour authored in `authored` space → linear light in the drawing buffer's primaries */
export function toBuffer(encoded: Vec3, authored: Space, buffer: Space): Vec3 {
  return convertLinear(decode3(encoded), authored, buffer);
}

export const luminance = (lin: Vec3, space: Space) => {
  const m = toXYZ(space);
  return m[3] * lin[0] + m[4] * lin[1] + m[5] * lin[2];
};

// --- HSL (in whatever RGB space the caller says) --------------------------------------------
export function hsl(h: number, s: number, l: number): Vec3 {
  h = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
export function rgb2hsl([r, g, b]: Vec3): Vec3 {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

export const hex2rgb = (hex: string): Vec3 => {
  let h = hex.replace('#', '');
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Vec3;
};
export const rgb2hex = (c: Vec3) =>
  '#' + c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

export const inGamut = (lin: Vec3, eps = 1e-4) => lin.every((x) => x >= -eps && x <= 1 + eps);

/** CSS colour string for an encoded colour in `space` */
export function css(encoded: Vec3, space: Space): string {
  if (space === 'srgb') return `rgb(${encoded.map((x) => (Math.min(1, Math.max(0, x)) * 255).toFixed(2)).join(' ')})`;
  return `color(display-p3 ${encoded.map((x) => Math.min(1, Math.max(0, x)).toFixed(5)).join(' ')})`;
}

// --- OKLab (for hue matching) ----------------------------------------------------------------
const OK_M1: Mat3 = [0.8189330101, 0.3618667424, -0.1288597137, 0.0329845436, 0.9293118715, 0.0361456387, 0.0482003018, 0.2643662691, 0.633851707];
const OK_M2: Mat3 = [0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371, 0.7827717662, -0.808675766];
export function xyz2oklab(xyz: Vec3): Vec3 {
  const lms = mul(OK_M1, xyz).map((x) => Math.cbrt(x)) as Vec3;
  return mul(OK_M2, lms);
}
export const oklabHue = (lab: Vec3) => (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
export const oklabChroma = (lab: Vec3) => Math.hypot(lab[1], lab[2]);

// --- Negative afterimage predictor ---------------------------------------------------------------
// A deliberately crude partial von Kries model: after adapting to stimulus S (cone excitations, white
// surround W), the white test field is seen with gains (W/S)^p per cone class. p≈0.3–0.5 for 20–30 s
// of steady fixation is a guess, not a measurement — the model is only used to choose the HUE of the
// face so its afterimage lands near #FACE, and to visualise which features survive. Output: linear RGB
// in `space`, normalised so the white field is (1,1,1)-ish; values > 1 = "brighter than white".
export function predictAfterimage(stimLin: Vec3, whiteLin: Vec3, space: Space, p: number): Vec3 {
  const toLms = matmul(XYZ_TO_LMS, toXYZ(space));
  const S = mul(toLms, stimLin), W = mul(toLms, whiteLin);
  const A = W.map((w, i) => w * (w / Math.max(S[i], 0.02 * w)) ** p) as Vec3;
  const scale = 1 / Math.max(1e-6, luminance(whiteLin, space));
  return mul(matmul(fromXYZ(space), LMS_TO_XYZ), A).map((x) => x * scale) as Vec3;
}

export const RGB_TO_LMS = (space: Space) => matmul(XYZ_TO_LMS, toXYZ(space));
export const LMS_TO_RGB = (space: Space) => matmul(fromXYZ(space), LMS_TO_XYZ);

/** column-major Float32Array for gl.uniformMatrix3fv */
export const glMat3 = (m: Mat3) => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);

// the target afterimage colour of the story: #FACE = rgba(255,170,204,.93) — never drawn on screen
export const FACE_HEX = '#FFAACC';
export const BEADED_HEX = '#BEADED';
