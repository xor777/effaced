// S10 · Compression: a real JPEG-style codec on the frame. The city is sampled down to 320×200
// (mode 13h — the Machine's resolution, 40×25 blocks of 8×8), transformed with the 8×8 DCT-II,
// quantised with the JPEG Annex K tables scaled by a growing step and cut in zigzag order, then
// reconstructed with the inverse DCT evaluated continuously inside each block (the cosines become
// visible as the coefficients die). One file, four passes (PASS_DOWN, PASS_DCT, PASS_IDCT, PASS_COMP).
#include "lib/common"
#include "lib/color"
in vec2 uv;

const vec2 GRID = vec2(320.0, 200.0);

// JPEG Annex K quantisation tables, row-major [v * 8 + u]
const float QL[64] = float[64](16., 11., 10., 16., 24., 40., 51., 61., 12., 12., 14., 19., 26., 58., 60., 55.,
  14., 13., 16., 24., 40., 57., 69., 56., 14., 17., 22., 29., 51., 87., 80., 62., 18., 22., 37., 56., 68., 109., 103., 77.,
  24., 35., 55., 64., 81., 104., 113., 92., 49., 64., 78., 87., 103., 121., 120., 101., 72., 92., 95., 98., 112., 100., 103., 99.);
const float QC[64] = float[64](17., 18., 24., 47., 99., 99., 99., 99., 18., 21., 26., 66., 99., 99., 99., 99.,
  24., 26., 56., 99., 99., 99., 99., 99., 47., 66., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99.,
  99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99., 99.);
// zigzag scan position of coefficient [v * 8 + u]
const int ZZ[64] = int[64](0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42, 3, 8, 12, 17, 25, 30, 41, 43,
  9, 11, 18, 24, 31, 40, 44, 53, 10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38, 46, 51, 55, 60,
  21, 34, 37, 47, 50, 56, 59, 61, 35, 36, 48, 49, 57, 58, 62, 63);

float Cn(int k) { return k == 0 ? 0.70710678 : 1.0; }

// linear HDR ↔ the codec's 8-bit-like domain: a soft tonemap + gamma, YCbCr (JFIF), level shift −128
vec3 encode(vec3 c) {
  vec3 e = pow(max(c, 0.0) / (1.0 + max(c, 0.0)), vec3(1.0 / 2.2)) * 255.0;
  return vec3(dot(e, vec3(0.299, 0.587, 0.114)) - 128.0, dot(e, vec3(-0.168736, -0.331264, 0.5)), dot(e, vec3(0.5, -0.418688, -0.081312)));
}
vec3 decode(vec3 y) {
  y.x += 128.0;
  vec3 e = vec3(y.x + 1.402 * y.z, y.x - 0.344136 * y.y - 0.714136 * y.z, y.x + 1.772 * y.y) / 255.0;
  e = clamp(e, 0.0, 0.985);
  vec3 g = pow(e, vec3(2.2));
  return g / (1.0 - g);
}

#ifdef PASS_DOWN
// full-res city → 320×200 codec samples (box filter, 4×4 taps), encoded
out vec4 o;
uniform sampler2D src;
uniform vec2 srcRes;
void main() {
  vec2 p = gl_FragCoord.xy - 0.5;        // codec pixel
  vec2 cell = srcRes / GRID;             // source px per codec px
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 4; j++)
    for (int i = 0; i < 4; i++) {
      vec2 q = (p + (vec2(i, j) + 0.5) / 4.0) * cell;
      acc += texture(src, q / srcRes).rgb;
    }
  o = vec4(encode(acc / 16.0), 1.0);
}
#endif

#ifdef PASS_DCT
// forward 8×8 DCT-II + quantisation. out0 = dequantised coefficients, out1 = quantisation error
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
uniform sampler2D src;   // encoded 320×200
uniform float qs;        // quantiser step multiplier (0 = lossless)
uniform float kmax;      // last zigzag index kept
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 b = p / 8, uv8 = p % 8;
  vec3 F = vec3(0.0);
  for (int y = 0; y < 8; y++) {
    float cy = cos(float((2 * y + 1) * uv8.y) * PI / 16.0);
    for (int x = 0; x < 8; x++) {
      float cx = cos(float((2 * x + 1) * uv8.x) * PI / 16.0);
      F += texelFetch(src, b * 8 + ivec2(x, y), 0).rgb * (cx * cy);
    }
  }
  F *= 0.25 * Cn(uv8.x) * Cn(uv8.y);
  int k = uv8.y * 8 + uv8.x;
  vec3 Fq = F;
  if (qs > 0.0) {
    vec3 Q = max(vec3(QL[k], QC[k], QC[k]) * qs, vec3(1.0));
    Fq = floor(F / Q + 0.5) * Q;
  }
  if (float(ZZ[k]) > kmax) Fq = vec3(0.0);
  o0 = vec4(Fq, 1.0);
  o1 = vec4(Fq - F, 1.0);
}
#endif

#ifdef PASS_IDCT
// inverse DCT evaluated at continuous positions (an oversampled grid): out0 = reconstruction,
// out1 = reconstructed quantisation error
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
uniform sampler2D coef;
uniform sampler2D err;
uniform vec2 res;        // this target's size
void main() {
  vec2 P = gl_FragCoord.xy / res * GRID;   // codec px, continuous
  vec2 bf = floor(P / 8.0);
  ivec2 b = ivec2(bf);
  vec2 x = P - bf * 8.0 - 0.5;             // −0.5 … 7.5 inside the block
  float cxs[8], cys[8];
  for (int u = 0; u < 8; u++) {
    cxs[u] = Cn(u) * cos((2.0 * x.x + 1.0) * float(u) * PI / 16.0);
    cys[u] = Cn(u) * cos((2.0 * x.y + 1.0) * float(u) * PI / 16.0);
  }
  vec3 r = vec3(0.0), e = vec3(0.0);
  for (int v = 0; v < 8; v++)
    for (int u = 0; u < 8; u++) {
      float w = cxs[u] * cys[v];
      ivec2 q = b * 8 + ivec2(u, v);
      r += texelFetch(coef, q, 0).rgb * w;
      e += texelFetch(err, q, 0).rgb * w;
    }
  o0 = vec4(r * 0.25, 1.0);
  o1 = vec4(e * 0.25, 1.0);
}
#endif

#ifdef PASS_COMP
// the picture: pristine city + coding error → the coded image → one block's 64 basis functions →
// the DC mosaic. Writes linear HDR into the scene target.
out vec4 o;
uniform sampler2D city;   // full-res pristine (linear)
uniform sampler2D rec;    // reconstruction (encoded domain), oversampled
uniform sampler2D rerr;   // reconstructed error (encoded domain)
uniform sampler2D coef;   // dequantised coefficients 320×200
uniform vec2 res;         // output size
uniform vec4 zoom;        // xy centre (codec px), z scale (1 = whole frame), w aspect correction
uniform vec2 zoom2;       // the block of the chart
uniform vec4 mode;        // x pristine→coded, y chart (explode), z chart gap, w #DECADE tint
uniform float kmax;
uniform float dcOnly;     // 1 = only the DC terms are left: flat blocks straight from the coefficients
uniform float beat;
uniform float tm;

vec3 decodeAt(vec2 P) { return decode(texture(rec, P / GRID).rgb); }

void main() {
  vec2 sp = gl_FragCoord.xy / res;           // 0..1 screen
  vec2 P = zoom.xy + (sp - 0.5) * GRID / zoom.z;
  vec3 col;
  if (any(lessThan(P, vec2(0.0))) || any(greaterThanEqual(P, GRID))) {
    col = vec3(0.0);
  } else {
    vec2 uvP = P / GRID;
    if (dcOnly > 0.5) {
      col = decode(texelFetch(coef, ivec2(floor(P / 8.0)) * 8, 0).rgb / 8.0);
    } else {
      vec3 pristine = texture(city, uvP).rgb;
      vec3 err = texture(rerr, uvP).rgb;
      vec3 a = decode(encode(pristine) + err);  // the full-res frame with the coding error added
      vec3 b = decodeAt(P);                      // the coded frame as the decoder sees it
      col = mix(a, b, mode.x);
    }

    if (mode.y > 0.0) {
      // the 8×8 chart of one block: cell (u,v) shows its basis function times the coefficient
      vec2 bf = floor(P / 8.0);
      vec2 s = P / 8.0 - bf;                      // 0..1 in the block
      s.y = 1.0 - s.y;                            // the classic chart: DC top-left, v grows downwards
      vec2 cellf = floor(s * 8.0);
      ivec2 cu = ivec2(cellf);
      vec2 c = fract(s * 8.0);                    // 0..1 in the cell
      int k = cu.y * 8 + cu.x;
      // coefficients were taken bottom-up: flipping the block flips the sign of odd v
      vec3 F = texelFetch(coef, ivec2(bf) * 8 + cu, 0).rgb * ((cu.y & 1) == 1 ? -1.0 : 1.0);
      // the pattern of frequency (u, v) over the whole cell: cos((2x+1)uπ/16) for x = 8c − ½
      float bas = cos(c.x * float(cu.x) * PI) * cos(c.y * float(cu.y) * PI);
      vec3 cell;
      bool alive = float(ZZ[k]) <= kmax;
      if (k == 0) {
        cell = decode(vec3(F.x / 8.0, F.yz / 8.0)); // DC = 8 × the block mean
      } else {
        // the basis at full contrast; brightness from the strength of the luma coefficient (in
        // quantiser steps), its sign flips the pattern, the chroma coefficients tint it
        float amp = clamp(abs(F.x) / (1.5 * QL[k]), 0.0, 1.0);
        float lv = 0.5 + 0.5 * bas * (F.x < 0.0 ? -1.0 : 1.0);
        vec3 tint = normalize(decode(vec3(0.0, F.yz * 0.5)) + 1e-3) * 1.732;
        cell = vec3(lv * lv) * mix(vec3(1.0), tint, 0.6) * (0.3 + 0.9 * amp) * (1.0 + 0.5 * beat);
        if (!alive) cell = vec3(0.0);
      }
      // gaps between the cells open as the chart explodes
      vec2 g = min(c, 1.0 - c);
      float gap = smoothstep(0.0, 0.02 + 0.05 * mode.z, min(g.x, g.y) - 0.03 * mode.z);
      cell *= mix(1.0, gap, mode.z);
      // the chosen block stands alone
      float other = any(notEqual(bf, zoom2)) ? 0.07 : 1.0;
      col = mix(col, cell * other, mode.y);
    }
    // the averages take the colour of the air: #DECADE
    float lum = dot(col, vec3(0.2627, 0.678, 0.0593));
    col = mix(col, hex2p3(C_DECADE) * lum * 1.35, mode.w);
  }
  o = vec4(col, 1.0);
}
#endif
