// S13 · Erasure — one chaos-game step per walker (fractal flame, Draves & Reckase).
// Transform 0 is the condensation map: it drops the walker anywhere on the creature's sigil, so the
// attractor is "the sigil ∪ all its images" — the flame grows out of the sigil (IFS with condensation).
// Transforms 1..6: affine + a blend of 16 flam3 variations. After every step an n-fold rotation (and a
// mirror) with probabilities sym.y / sym.z: flam3's symmetry transforms, n = 3 → 5 → 17 → 257.
#include "lib/common"
in vec2 uv;
out vec4 o;
uniform sampler2D st;   // walker: xy position, z colour coordinate, w steps since (re)seed
uniform sampler2D sig;  // sigil contour, RG32F, N×1, arc-length parametrised
uniform int sigN;
// per transform, 6 vec4: [a b c d] [e f colour speed]
//   [linear sinusoidal spherical swirl] [horseshoe julia bubble disc]
//   [spiral hyperbolic heart polar] [handkerchief ex eyefish cylinder]
uniform vec4 X[42];
uniform float CP[7];    // cumulative probabilities
uniform vec4 shrink;    // x: condensation scale (the sigil itself), y: translation scale (collapse)
uniform vec4 sym;       // n, P(rotate), P(mirror), sigil phase (turns)
uniform uint seed;
uniform int reset;

float rnd(inout uint h) {
  h = pcg(h);
  return float(h) * (1.0 / 4294967296.0);
}

vec2 sigil(float u) {
  float x = fract(u) * float(sigN);
  int i = int(x);
  vec2 a = texelFetch(sig, ivec2(i % sigN, 0), 0).xy, b = texelFetch(sig, ivec2((i + 1) % sigN, 0), 0).xy;
  return mix(a, b, x - float(i));
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  uint h = pcg(uint(ip.x) * 7919u ^ pcg(uint(ip.y) ^ seed));
  vec4 s = texelFetch(st, ip, 0);
  if (reset == 1 || !(abs(s.x) < 1e3 && abs(s.y) < 1e3)) s = vec4(rnd(h) * 2.0 - 1.0, rnd(h) * 2.0 - 1.0, rnd(h), 0.0);
  float r = rnd(h);
  int k = 0;
  for (int i = 0; i < 6; i++) if (r >= CP[i]) k = i + 1;
  int b = k * 6;
  vec4 A = X[b], B = X[b + 1], V0 = X[b + 2], V1 = X[b + 3], V2 = X[b + 4], V3 = X[b + 5];
  vec2 p;
  if (k == 0) {
    p = sigil(rnd(h) + sym.w) * shrink.x;
  } else {
    vec2 q = vec2(A.x * s.x + A.y * s.y, A.z * s.x + A.w * s.y) + B.xy * shrink.y;
    float r2 = dot(q, q) + 1e-9, rr = sqrt(r2);
    float th = atan(q.x, q.y); // flam3's theta
    p = V0.x * q;
    if (V0.y != 0.0) p += V0.y * sin(q);
    if (V0.z != 0.0) p += V0.z * q / r2;
    if (V0.w != 0.0) { float s2 = sin(r2), c2 = cos(r2); p += V0.w * vec2(q.x * s2 - q.y * c2, q.x * c2 + q.y * s2); }
    if (V1.x != 0.0) p += V1.x * vec2((q.x - q.y) * (q.x + q.y), 2.0 * q.x * q.y) / rr;
    if (V1.y != 0.0) { float om = rnd(h) < 0.5 ? 0.0 : PI; p += V1.y * sqrt(rr) * vec2(cos(th * 0.5 + om), sin(th * 0.5 + om)); }
    if (V1.z != 0.0) p += V1.z * q * (4.0 / (r2 + 4.0));
    if (V1.w != 0.0) p += V1.w * (th / PI) * vec2(sin(PI * rr), cos(PI * rr));
    if (V2.x != 0.0) p += V2.x / rr * vec2(cos(th) + sin(rr), sin(th) - cos(rr));
    if (V2.y != 0.0) p += V2.y * vec2(sin(th) / rr, rr * cos(th));
    if (V2.z != 0.0) p += V2.z * rr * vec2(sin(th * rr), -cos(th * rr));
    if (V2.w != 0.0) p += V2.w * vec2(th / PI, rr - 1.0);
    if (V3.x != 0.0) p += V3.x * rr * vec2(sin(th + rr), cos(th - rr));
    if (V3.y != 0.0) {
      float n0 = sin(th + rr), n1 = cos(th - rr), m0 = n0 * n0 * n0, m1 = n1 * n1 * n1;
      p += V3.y * rr * vec2(m0 + m1, m0 - m1);
    }
    if (V3.z != 0.0) p += V3.z * (2.0 / (rr + 1.0)) * q;
    if (V3.w != 0.0) p += V3.w * vec2(sin(q.x), q.y);
  }
  // symmetry: an n-fold rotation, a mirror
  if (rnd(h) < sym.y) {
    float a = TAU * floor(rnd(h) * sym.x) / sym.x;
    p = mat2(cos(a), sin(a), -sin(a), cos(a)) * p;
  }
  if (rnd(h) < sym.z) p.x = -p.x;
  o = vec4(p, mix(s.z, B.z, B.w), s.w + 1.0);
}
