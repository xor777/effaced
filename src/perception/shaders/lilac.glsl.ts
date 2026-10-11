// S8 · Lilac chaser (Hinton). 12 gaussian-blurred discs on a gray field around a fixation cross.
// Which discs are visible is decided on the CPU (timeline.ts → `vis[12]`), so the tracker clock owns
// the timing; the shader only draws. Each disc is the EXACT convolution of a hard disc with a 2D
// gaussian (the Rice / Marcum-Q integral), integrated numerically only inside the blur annulus.
// Port: src/shaders/scenes/s08-lilac.glsl = COMMON + LILAC_FS.

import { COMMON } from './common.glsl.ts';

export const LILAC_FS = /* glsl */ `
in vec2 uv;
out vec4 o;
uniform vec3 bg;          // linear, buffer primaries
uniform vec3 disc;        // linear
uniform float ringR;      // H (fraction of frame height)
uniform float discR;      // H
uniform float sigma;      // H, gaussian blur
uniform float vis[12];    // per-disc visibility; disc j at angle 90° − dir·j·30°
uniform float dir;        // +1 clockwise, −1 counter-clockwise
uniform float crossStyle; // 0 none, 1 cross, 2 dot
uniform vec2 crossSz;     // half arm length, thickness (H)
uniform vec3 crossCol;    // linear
uniform float crossA;
uniform vec3 assistCol;   // linear; near-threshold continuation disc (0 = off)
uniform float assistA;
uniform float assistIdx;

// exp(-|x|)·I0(x), Abramowitz–Stegun 9.8.1 / 9.8.2
float i0e(float x) {
  float ax = abs(x);
  if (ax < 3.75) {
    float t = x / 3.75; t *= t;
    return exp(-ax) * (1.0 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492 + t * (0.2659732 + t * (0.0360768 + t * 0.0045813))))));
  }
  float t = 3.75 / ax;
  return (0.39894228 + t * (0.01328592 + t * (0.00225319 + t * (-0.00157565 + t * (0.00916281 + t * (-0.02057706
         + t * (0.02635537 + t * (-0.01647633 + t * 0.00392377)))))))) / sqrt(ax);
}

// P(r) = ∫_0^R ρ/s² · exp(-(ρ-r)²/2s²) · i0e(rρ/s²) dρ  = disc(R) ⊗ gaussian(s), evaluated at radius r
float blurredDisc(float r, float R, float s, float px) {
  if (s < 0.5 * px) return clamp(0.5 - (r - R) / px, 0.0, 1.0);
  if (r > R + 6.0 * s) return 0.0;
  if (r < R - 6.0 * s) return 1.0;
  float lo = max(0.0, r - 6.0 * s), hi = min(R, r + 6.0 * s);
  const int N = 24;
  float h = (hi - lo) / float(N);
  float inv = 1.0 / (s * s);
  float sum = 0.0;
  for (int i = 0; i < N; i++) {
    float rho = lo + (float(i) + 0.5) * h;
    float d = rho - r;
    sum += rho * exp(-0.5 * d * d * inv) * i0e(r * rho * inv);
  }
  return clamp(sum * h * inv, 0.0, 1.0);
}

vec2 discPos(float j) {
  float th = 0.5 * PI - dir * j * TAU / 12.0;
  return ringR * vec2(cos(th), sin(th));
}

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  float px = 1.0 / res.y;
  float a = 0.0;
  for (int j = 0; j < 12; j++) {
    if (vis[j] <= 0.0) continue;
    a += vis[j] * blurredDisc(length(q - discPos(float(j))), discR, sigma, px);
  }
  // blur of the sharp disc image, in linear light (= optical defocus)
  vec3 col = mix(bg, disc, clamp(a, 0.0, 1.0));
  if (assistA > 0.0) col = mix(col, assistCol, assistA * blurredDisc(length(q - discPos(assistIdx)), discR, sigma, px));

  if (crossStyle > 0.5) {
    float d;
    if (crossStyle < 1.5) {
      vec2 aq = abs(q);
      vec2 d1 = aq - vec2(crossSz.x, 0.5 * crossSz.y), d2 = aq - vec2(0.5 * crossSz.y, crossSz.x);
      d = min(length(max(d1, 0.0)) + min(max(d1.x, d1.y), 0.0), length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0));
    } else d = length(q) - crossSz.x;
    col = mix(col, crossCol, crossA * clamp(0.5 - d / px, 0.0, 1.0));
  }
  o = vec4(encodeOut(col), 1.0);
}
`;

export const LILAC_SRC = COMMON + LILAC_FS;
