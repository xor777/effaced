// S12 · Canvas — the creature as a cloud on the Aizawa attractor, one RK4 step per pass.
// Runs in lock-step in BOTH WebGL contexts (the canvas and the "outside"): same source, same inputs,
// same step count from the song time → bit-identical states, so a particle can leave one canvas and
// appear in the other at the same place. kind 1: the same particles on a Halvorsen attractor (the
// canvas only), the shape the cloud morphs into on the G/F bars.
#include "lib/common"
#include "scenes/s12-lib"
in vec2 uv;
out vec4 o;
uniform sampler2D st; // xyz position, w per-particle random
uniform float h;      // step (attractor time units)
uniform int reset;
uniform int kind;     // 0 Aizawa, 1 Halvorsen

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
    s = kind == 0 ? vec4(sh * (0.6 + 0.6 * u3) + vec3(0, 0, 0.4), u1) : vec4(sh * (2.0 + 4.0 * u3) - 2.6, u1);
  }
  vec3 p = s.xyz;
  if (kind == 0) {
    vec3 k1 = aizawaF(p), k2 = aizawaF(p + 0.5 * h * k1), k3 = aizawaF(p + 0.5 * h * k2), k4 = aizawaF(p + h * k3);
    p += h / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    if (!(abs(p.x) < 10.0 && abs(p.y) < 10.0 && abs(p.z) < 10.0)) p = vec3(0.1, 0.0, 0.5);
  } else {
    vec3 k1 = halvorsenF(p), k2 = halvorsenF(p + 0.5 * h * k1), k3 = halvorsenF(p + 0.5 * h * k2), k4 = halvorsenF(p + h * k3);
    p += h / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    if (!(abs(p.x) < 40.0 && abs(p.y) < 40.0 && abs(p.z) < 40.0)) p = vec3(-1.0, 0.0, 0.5);
  }
  o = vec4(p, s.w);
}
