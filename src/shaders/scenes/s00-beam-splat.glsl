// S0 · Beam: one oscilloscope line segment per instance, gaussian beam profile integrated
// analytically along the segment (erf), as in woscope. Additive into the phosphor buffer.
#include "lib/common"
in vec2 lp;      // position in segment space: x along, y across (beam units)
in float len;    // segment length
in float energy;
out vec4 o;
uniform float sigma;

float erf_(float x) { // Abramowitz–Stegun 7.1.27
  float s = sign(x), a = abs(x);
  float t = 1.0 + (0.278393 + (0.230389 + 0.078108 * a * a) * a) * a;
  t *= t;
  return s - s / (t * t);
}

void main() {
  float sq2s = 1.41421356 * sigma;
  float across = exp(-0.5 * lp.y * lp.y / (sigma * sigma)) / (2.5066283 * sigma);
  float along;
  if (len < 1e-4 * sigma) along = exp(-0.5 * lp.x * lp.x / (sigma * sigma)) / (2.5066283 * sigma) * len;
  else along = 0.5 * (erf_(lp.x / sq2s) - erf_((lp.x - len) / sq2s));
  // energy per segment is constant (one sample period); spreading it over the length makes a
  // fast beam dim and a slow beam bright, like a real CRT
  float i = across * along / max(len, 1e-4 * sigma) * energy;
  o = vec4(vec3(i), 1.0);
}
