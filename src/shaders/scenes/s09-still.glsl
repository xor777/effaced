// S09 · the still, exact colours (no post): the supersampled fibres, S08's fixation cross on top,
// display encoding with a mean-preserving dither. Drawn once — then the render stops.
#include "lib/common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform sampler2D src;
uniform vec2 res;
uniform vec2 crossSz; // half arm, thickness (H) — exactly S08's
uniform vec3 crossCol;

void main() {
  vec3 col = texture(src, uv).rgb;
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y, aq = abs(q);
  vec2 d1 = aq - vec2(crossSz.x, 0.5 * crossSz.y), d2 = aq - vec2(0.5 * crossSz.y, crossSz.x);
  float d = min(length(max(d1, 0.0)) + min(max(d1.x, d1.y), 0.0), length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0));
  col = mix(col, crossCol, clamp(0.5 - d * res.y, 0.0, 1.0));
  vec3 e = lin2srgb(clamp(col, 0.0, 1.0));
  float n = hash1(uint(gl_FragCoord.x) + uint(gl_FragCoord.y) * 4099u) + hash1(uint(gl_FragCoord.y) * 7919u + uint(gl_FragCoord.x) * 31u) - 1.0;
  o = vec4(e + n * clamp(min(e, 1.0 - e) * 255.0, 0.0, 1.0) / 255.0, 1.0);
}
