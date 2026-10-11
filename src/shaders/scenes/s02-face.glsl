#include "lib/color"
in vec3 bary;
out vec4 o;
uniform float k;
uniform vec2 res;        // target size
uniform vec2 sA, sB, sC; // NDC of the R, G, B corners this frame
uniform float curve;     // 0 at the cut from S01 → 1 once the face lies on S³
void main() {
  // the S01 gamut triangle, coloured exactly as S01 fills it: the chromaticity at this barycentric
  // point of the Display P3 triangle, as bright as it can be (A, B, C are its R, G, B corners).
  // S01 spreads the colours linearly over the screen, the face's own barycentrics are bent by the
  // perspective — so at the cut the colours follow the screen (the white point stays put), and
  // they slide into the face's coordinates as it bends onto S³
  vec2 q = gl_FragCoord.xy / res * 2.0 - 1.0;
  vec2 v0 = sB - sA, v1 = sC - sA, v2 = q - sA;
  float d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1);
  float den = d00 * d11 - d01 * d01;
  vec3 bs = vec3(0.0, (d11 * d20 - d01 * d21) / den, (d00 * d21 - d01 * d20) / den);
  bs.x = 1.0 - bs.y - bs.z;
  bs = max(bs, 0.0);
  bs /= max(bs.x + bs.y + bs.z, 1e-6);
  vec3 b = mix(bs, bary, curve);
  vec2 xy = b.x * vec2(0.680, 0.320) + b.y * vec2(0.265, 0.690) + b.z * vec2(0.150, 0.060);
  vec3 c = max(xyz2p3(xyY2xyz(xy, 1.0)), 0.0);
  c /= max(max(c.r, c.g), max(c.b, 1e-6));
  o = vec4(c * k, 1.0);
}
