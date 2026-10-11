// S12 · the outside (second context): particles that left the canvas, in the CSS 3D space of the stage
// (H units, y up, z towards the viewer; the canvas plane is mapped by W). Until its launch time a
// particle rides on the canvas plane exactly where the canvas shows it; then it is flung out (excess
// velocity D, decaying) and pulled onto its home on the Thomas attractor wrapped around the canvas.
#include "lib/common"
#include "scenes/s12-lib"
in vec2 uv;
layout(location = 0) out vec4 oP; // xyz, w = launched
layout(location = 1) out vec4 oD; // excess velocity xyz, w = per-particle number
uniform sampler2D st;             // inner (Lorenz) state, this step
uniform sampler2D sq;             // Thomas home, this step (attractor units)
uniform sampler2D op, od;         // previous outer state
uniform mat4 W;                   // canvas plane (H units) → stage space (H units)
uniform float tRel;               // s since the hit, this step
uniform float dt;
uniform vec4 th;                  // Thomas: centre xyz, scale (H per attractor unit)
uniform mat3 thR;                 // and its slow turn
uniform int reset;
uniform float kick;               // the launch's violence
uniform float drag;               // time constant of the excess velocity (s)

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(st, ip, 0);
  vec4 P = texelFetch(op, ip, 0), D = texelFetch(od, ip, 0);
  if (reset == 1) P = vec4(0.0);
  if (P.w < 0.5) {
    // still in the picture: ride on the canvas plane
    vec3 v = innerView(baseFrame(flapQ(s.xyz)));
    P = vec4((W * vec4(v.xy, 0.0, 1.0)).xyz, 0.0);
    D = vec4(0.0, 0.0, 0.0, s.w);
    if (tRel >= launchAt(s.w)) {
      // launch: out of the plane towards the viewer, flung outwards from the centre, with a swirl
      uint k = hashu(uvec2(ip) + 911u);
      vec3 n = normalize((W * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
      vec3 rad = (W * vec4(v.xy, 0.0, 0.0)).xyz;
      vec3 jit = vec3(hash1(k), hash1(k + 1u), hash1(k + 2u)) - 0.5;
      // nearly the same for all: the creature's shape survives the blast, magnified, rushing at us
      D.xyz = (n * (1.2 + 0.3 * hash1(k + 3u)) + rad * (4.2 + 0.4 * hash1(k + 4u)) + cross(n, rad) * 1.6 + jit * 0.1) * kick;
      P.w = 1.0;
    }
  } else {
    P.xyz += D.xyz * dt;
    D.xyz *= exp(-dt / drag);
    // the pull towards its home on the attractor grows as the burst spends itself
    vec3 home = th.xyz + thR * texelFetch(sq, ip, 0).xyz * th.w;
    float pull = smoothstep(0.2, 1.8, tRel);
    P.xyz = mix(P.xyz, home, 1.0 - exp(-dt * 7.0 * pull * pull));
  }
  oP = P;
  oD = D;
}
