// S04 · the fire memory: the classic cellular fire, one step. Each cell = average of the three
// below and the one two below, minus a random decay; the bottom rows are random embers.
#include "lib/common"
in vec2 uv;
out vec4 o;
uniform sampler2D prev;
uniform uint seed;

float at(ivec2 p) {
  ivec2 s = textureSize(prev, 0);
  return texelFetch(prev, clamp(p, ivec2(0), s - 1), 0).r;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.y < 2) {
    // embers flicker in clumps of 3 cells
    float h = hash1(uint(p.x / 3) * 7919u + seed * 104729u);
    float h2 = hash1(uint(p.x) + seed * 15485863u);
    o = vec4(h > 0.42 ? 0.85 + 0.15 * h2 : 0.15 * h2, 0.0, 0.0, 1.0);
    return;
  }
  int w = int(hash1(uint(p.y) * 31u + seed * 2654435761u) * 3.0) - 1; // a little wind
  float s = at(p + ivec2(-1 + w, -1)) + at(p + ivec2(w, -1)) + at(p + ivec2(1 + w, -1)) + at(p + ivec2(0, -2));
  float decay = 0.008 + 0.013 * hash1(uint(p.x) * 977u + uint(p.y) * 131u + seed * 7u);
  o = vec4(max(s * 0.25 - decay, 0.0), 0.0, 0.0, 1.0);
}
