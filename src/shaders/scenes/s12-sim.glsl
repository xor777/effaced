// S12 · Canvas — 65536 particles on a line 1/65536 of the attractor long, carried by the Lorenz flow:
// each one an offset from a reference trajectory the CPU integrates in double precision (the offsets
// obey the exact difference flow, s12-lib), RK4 substeps along this step's slice of the reference.
// Runs in lock-step in BOTH WebGL contexts (the canvas and the "outside"): same source, same inputs,
// same steps → bit-identical states, so a particle can leave one canvas and appear in the other at the
// same place.
#include "lib/common"
#include "scenes/s12-lib"
in vec2 uv;
out vec4 o;
uniform sampler2D st;    // offset xyz, w = place along the line 0..1
uniform vec3 refs[49];   // the reference at every half substep of this step
uniform int nsub;        // substeps (≤ 24)
uniform float h;         // substep (attractor time)
uniform int reset;
uniform vec4 init;       // the line's direction xyz (the way it will stretch), its half-length
uniform int tW;          // the state's width (and height)

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(st, ip, 0);
  if (reset == 1) {
    float u = (float(ip.y * tW + ip.x) + 0.5) / float(tW * tW);
    s = vec4(init.xyz * (init.w * (2.0 * u - 1.0)), u);
  }
  vec3 d = s.xyz;
  for (int k = 0; k < 24; k++) {
    if (k >= nsub) break;
    vec3 r0 = refs[2 * k], r1 = refs[2 * k + 1], r2 = refs[2 * k + 2];
    vec3 k1 = lorenzD(r0, d), k2 = lorenzD(r1, d + 0.5 * h * k1), k3 = lorenzD(r1, d + 0.5 * h * k2), k4 = lorenzD(r2, d + h * k3);
    d += h / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
  }
  if (!(abs(d.x) < 300.0 && abs(d.y) < 300.0 && abs(d.z) < 300.0)) d = vec3(0.0);
  o = vec4(d, s.w);
}
