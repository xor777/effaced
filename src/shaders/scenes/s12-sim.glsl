// S12 · Canvas — the creature as a cloud on the Lorenz attractor, one RK4 step per pass.
// Runs in lock-step in BOTH WebGL contexts (the canvas and the "outside"): same source, same inputs,
// same step count from the song time → bit-identical states, so a particle can leave one canvas and
// appear in the other at the same place.
#include "lib/common"
#include "scenes/s12-lib"
in vec2 uv;
out vec4 o;
uniform sampler2D st; // xyz position, w per-particle random
uniform float h;      // step (attractor time units)
uniform int reset;

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(st, ip, 0);
  if (reset == 1) {
    uint k = hashu(uvec2(ip));
    float u1 = hash1(k), u2 = hash1(k + 1u), u3 = hash1(k + 2u);
    // start on a shell around the attractor; the burn-in pulls everything onto it
    float th = TAU * u1, z = u2 * 2.0 - 1.0;
    vec3 sh = vec3(sqrt(1.0 - z * z) * cos(th), sqrt(1.0 - z * z) * sin(th), z);
    // w (the particle's own number: launch order, place on the sigil, colour) = its initial longitude,
    // a dye that the flow then carries and folds
    s = vec4(sh * (4.0 + 14.0 * u3) + vec3(0, 0, 24.0), u1);
  }
  vec3 p = s.xyz;
  vec3 k1 = lorenzF(p), k2 = lorenzF(p + 0.5 * h * k1), k3 = lorenzF(p + 0.5 * h * k2), k4 = lorenzF(p + h * k3);
  p += h / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
  if (!(abs(p.x) < 200.0 && abs(p.y) < 200.0 && abs(p.z) < 200.0)) p = vec3(1.0, 1.0, 20.0);
  o = vec4(p, s.w);
}
