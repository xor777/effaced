// S11 · the city's block heights, from S10's mosaic (one texel per block): r = a block's tallness (its
// luma, with a little variation so equal neighbours don't fuse), g = the tallest of it and its eight
// neighbours. The world mirrors the mosaic beyond its frame, so a block's neighbours are the reflected
// ones (clamping ±1 is that reflection). The march uses g as an exact bound: no neighbour is taller.
#include "lib/common"
out vec4 o;
uniform sampler2D mosT;
uniform float s10on;
float tallAt(ivec2 m) {
  float h = hash2(vec2(m) + vec2(31.0, 7.0));
  float t = h * h * h;
  if (s10on > 0.5) {
    float y = texelFetch(mosT, m, 0).a;
    t = mix(t, y * y * y, 0.7);
  }
  return t;
}
void main() {
  ivec2 m = ivec2(gl_FragCoord.xy);
  float mx = 0.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) mx = max(mx, tallAt(clamp(m + ivec2(i, j), ivec2(0), ivec2(39, 24))));
  o = vec4(tallAt(m), mx, 0.0, 1.0);
}
