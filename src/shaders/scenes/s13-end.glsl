// S13 → S14 handover, exact colours (no post): black and the light point, drawn exactly like the
// pre-roll of S14 (perception/shaders/face.glsl.ts: same radius, same 1-px edge, same encoding),
// plus a fading glow left over from the collapse.
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform vec3 dotCol; // linear
uniform vec2 dotRA;  // radius (device px), opacity
uniform vec2 halo;   // linear amplitude, sigma (device px)

void main() {
  float r = length(gl_FragCoord.xy - 0.5 * res);
  vec3 col = dotCol * dotRA.y * clamp(0.5 - (r - dotRA.x), 0.0, 1.0);
  col += halo.x * exp(-0.5 * r * r / (halo.y * halo.y)) * vec3(0.95, 0.9, 1.0);
  o = vec4(lin2srgb(clamp(col, 0.0, 1.0)), 1.0);
}
