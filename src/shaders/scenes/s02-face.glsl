#include "lib/color"
in vec3 bary;
out vec4 o;
uniform float k;
void main() {
  // the S01 gamut triangle, coloured exactly as S01 fills it: the chromaticity at this barycentric
  // point of the Display P3 triangle, as bright as it can be (A, B, C are its R, G, B corners)
  vec2 xy = bary.x * vec2(0.680, 0.320) + bary.y * vec2(0.265, 0.690) + bary.z * vec2(0.150, 0.060);
  vec3 c = max(xyz2p3(xyY2xyz(xy, 1.0)), 0.0);
  c /= max(max(c.r, c.g), max(c.b, 1e-6));
  o = vec4(c * k, 1.0);
}
