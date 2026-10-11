// S12 · the outside's own attractor: every particle has a home on Thomas' cyclically symmetric
// attractor (dx = sin y − b x, …), integrated with RK4 all along, so the structure is already there
// when the particles burst out of the canvas and are pulled onto it.
#include "lib/common"
in vec2 uv;
out vec4 o;
uniform sampler2D st;
uniform float h; // attractor time per step
uniform float b;
uniform int reset;

vec3 F(vec3 q) { return vec3(sin(q.y) - b * q.x, sin(q.z) - b * q.y, sin(q.x) - b * q.z); }

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(st, ip, 0);
  if (reset == 1) {
    uint k = hashu(uvec2(ip) + 4242u);
    s = vec4(hash1(k) * 6.0 - 3.0, hash1(k + 1u) * 6.0 - 3.0, hash1(k + 2u) * 6.0 - 3.0, 0.0);
  }
  vec3 q = s.xyz;
  vec3 k1 = F(q), k2 = F(q + 0.5 * h * k1), k3 = F(q + 0.5 * h * k2), k4 = F(q + h * k3);
  o = vec4(q + h / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4), s.w);
}
