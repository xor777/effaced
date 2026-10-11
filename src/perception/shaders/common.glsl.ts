// Shared GLSL for the perception scenes. Conventions match the demo engine (src/gfx, src/shaders):
// fullscreen triangle from gl_VertexID, `in vec2 uv; out vec4 o; uniform vec2 res;`, no #version in
// scene sources (the engine's resolveShader adds the prelude). All colour uniforms are LINEAR light in
// the drawing buffer's primaries (Display P3 on the target); the shader ends with the sRGB transfer
// curve (shared by sRGB and Display P3) + mean-preserving dither. No tonemapping, no bloom.

export const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
`;

export const FULLSCREEN_VS = `#version 300 es
out vec2 uv;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** helpers every perception shader includes (port as src/shaders/lib/perception.glsl) */
export const COMMON = /* glsl */ `
#define PI 3.14159265359
#define TAU 6.28318530718
uniform vec2 res;        // frame size in device px
uniform float dither;    // 1 = ±1 LSB TPDF dither (mean-preserving, off at 0 and 1 so white stays 255)

float dot2(vec2 v) { return dot(v, v); }

// Abramowitz–Stegun 7.1.26, |error| < 1.5e-7
float erf_(float x) {
  float s = sign(x); x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
}
// coverage of a gaussian-blurred edge: d = signed distance (< 0 inside), s = gaussian sigma
float cov(float d, float s) { return 0.5 - 0.5 * erf_(d / (s * 1.41421356)); }

vec3 lin2srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

uint pcgP(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
// display encode: linear (buffer primaries) → sRGB curve → TPDF dither scaled down near 0 and 1
vec3 encodeOut(vec3 lin) {
  vec3 e = lin2srgb(clamp(lin, 0.0, 1.0));
  uvec2 ip = uvec2(gl_FragCoord.xy);
  uint h = pcgP(ip.x ^ pcgP(ip.y ^ 0xEFFACEDu));
  vec3 n = vec3(float(h & 1023u), float((h >> 10) & 1023u), float((h >> 20) & 1023u)) / 1023.0;
  uint h2 = pcgP(h);
  vec3 n2 = vec3(float(h2 & 1023u), float((h2 >> 10) & 1023u), float((h2 >> 20) & 1023u)) / 1023.0;
  vec3 tpdf = n + n2 - 1.0;                       // triangular, [-1, 1] LSB
  vec3 amp = clamp(min(e, 1.0 - e) * 255.0, 0.0, 1.0); // never dither across 0 or 1
  return e + dither * tpdf * amp / 255.0;
}

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// approximate ellipse distance (Quilez), good near the contour — enough for blurred edges
float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
float sdSegment(vec2 p, vec2 a, vec2 b, out float h) {
  vec2 pa = p - a, ba = b - a;
  h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// exact distance to a quadratic Bézier (Quilez)
float sdBezier(vec2 pos, vec2 A, vec2 B, vec2 C) {
  vec2 a = B - A, b = A - 2.0 * B + C, c = a * 2.0, d = A - pos;
  float kk = 1.0 / dot(b, b);
  float kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float res_ = 0.0;
  float p = ky - kx * kx, p3 = p * p * p;
  float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p3;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv_ = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv_.x + uv_.y - kx, 0.0, 1.0);
    res_ = dot2(d + (c + b * t) * t);
  } else {
    float z = sqrt(-p);
    float v = acos(q / (p * z * 2.0)) / 3.0;
    float m = cos(v), n = sin(v) * 1.732050808;
    vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
    res_ = min(dot2(d + (c + b * t.x) * t.x), dot2(d + (c + b * t.y) * t.y));
  }
  return sqrt(res_);
}
// regular n-gon, r = apothem (Quilez). For n = 65537 every edge is ~4.8e-5·r long and the polygon
// deviates from its circumcircle by r·π²/(2n²) ≈ 1.1e-9·r — below perception and below float32.
float sdNgon(vec2 p, float r, float n) {
  float an = TAU / n;
  float he = r * tan(0.5 * an);
  p = -p.yx;
  float bn = an * floor((atan(p.y, p.x) + 0.5 * an) / an);
  vec2 cs = vec2(cos(bn), sin(bn));
  p = mat2(cs.x, -cs.y, cs.y, cs.x) * p;
  return length(p - vec2(r, clamp(p.y, -he, he))) * sign(p.x - r);
}
`;
