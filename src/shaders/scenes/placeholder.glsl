// stand-in for scenes that don't exist yet: a quiet field that pulses with the kick
#include "lib/common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform float t;
uniform float k;      // cue progress 0..1
uniform float beat;   // kick envelope
uniform float hue;

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y;
  float r = length(p);
  vec3 base = srgb2lin(pal(hue, vec3(0.5), vec3(0.35), vec3(1.0), vec3(0.0, 0.33, 0.67)));
  float rings = 0.5 + 0.5 * cos(r * 40.0 - t * 2.0);
  vec3 c = base * (0.02 + 0.05 * rings * exp(-r * 2.0));
  // progress bar along the bottom
  c += vec3(0.4) * step(uv.y, 0.004) * step(uv.x, k);
  c += base * beat * 0.4 * exp(-r * 4.0);
  o = vec4(c, 1.0);
}
