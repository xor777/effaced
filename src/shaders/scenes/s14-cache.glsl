// S14: everything about the word that doesn't move, once per resolution (MRT) — the frame pass only reads it.
//   0  RGBA16F  x: distance to the strokes' skeleton, y: to the nearest marked point, z: letter 0..6, w: sideT
//   1  RGBA8    construction hairlines (faded away from their letter) of letters 0..3
//   2  RGBA8    … of letters 4..6
#include "scenes/s14-common"
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
uniform vec2 res;
uniform float cap; // frame heights per cap unit

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  vec2 p = q / cap;
  float px = 1.0 / (res.y * cap);
  int k;
  float d = glyphWord(p, k);
  float dn = glyphNodes(GLY_WL[k], p - vec2(GLY_WX[k], -0.5));
  o0 = vec4(min(d, 8.0), min(dn, 8.0), float(k), sideT(p, k));
  float c[7];
  for (int i = 0; i < 7; i++) {
    vec2 lp = p - vec2(GLY_WX[i], -0.5);
    vec2 r = lp - vec2(0.0, 0.5);
    float near = exp(-0.5 * dot(r, r) / (1.15 * 1.15));
    c[i] = near < 0.004 ? 0.0 : near * clamp(1.3 - glyphConstruction(GLY_WL[i], lp) / px, 0.0, 1.0);
  }
  o1 = vec4(c[0], c[1], c[2], c[3]);
  o2 = vec4(c[4], c[5], c[6], 0.0);
}
