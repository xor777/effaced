// S09 · the low-pass half of the hybrid image: the creature's word EFFACED (lib/glyphs, the same strokes
// S14 builds from embers) in a bold, soft pen — nothing sharper than ~0.1 cap — plus a broad radial light
// for the field around it. Quarter resolution, drawn once: r = the word, g = the field.
#include "lib/glyphs"
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform float cap; // H per cap; the A's circle centre (word origin) sits on the fixation point
uniform vec3 pen;  // half-width, softness, glow reach (caps)

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  int i;
  float d = glyphWord(q / cap, i);
  float v = smoothstep(pen.x + pen.y, pen.x - pen.y, d) + 0.22 * smoothstep(pen.z, 0.0, d);
  float field = 1.0 - smoothstep(0.3, 0.95, length(q * vec2(0.72, 1.0)));
  o = vec4(v, field, 0.0, 1.0);
}
