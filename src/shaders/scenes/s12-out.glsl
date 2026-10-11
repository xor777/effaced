// S12 · the outside (second context): particles that left the canvas, in the CSS 3D space of the stage
// (H units, y up, z towards the viewer; the canvas plane is mapped by W). Each outside particle belongs
// to a place on the thread (`per` of them along every segment); until its segment's launch time it
// rides on the canvas plane exactly where the canvas shows that place; then it is flung out (excess
// velocity D, decaying) and pulled onto its home on the Thomas attractor wrapped around the canvas.
// Particle 0 is the +1: first out, and thrown hardest.
#include "lib/common"
#include "scenes/s12-lib"
in vec2 uv;
layout(location = 0) out vec4 oP; // xyz, w = launched
layout(location = 1) out vec4 oD; // excess velocity xyz, w = per-particle number
uniform sampler2D st;             // the thread's offsets, this step
uniform int tW;                   // the thread's state width (and height)
uniform int oW;                   // this state's width
uniform int per;                  // outside particles per thread segment
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
  int j = ip.y * oW + ip.x, nT = tW * tW;
  int i = min(j / per, nT - 2);
  float fr = float(j - i * per) / float(per);
  vec3 a = texelFetch(st, ivec2(i % tW, i / tW), 0).xyz, b = texelFetch(st, ivec2((i + 1) % tW, (i + 1) / tW), 0).xyz;
  // its place on the thread (a segment pulled into a long chord: its first end)
  vec3 rel = iRef + (length(b - a) * iView.x > 0.08 ? a : mix(a, b, fr));
  float wl = launchW(i);
  if (j == 0) {
    rel = iPlus;
    wl = 0.0;
  }
  vec4 P = texelFetch(op, ip, 0), D = texelFetch(od, ip, 0);
  if (reset == 1) P = vec4(0.0);
  if (P.w < 0.5) {
    // still in the picture: ride on the canvas plane
    vec3 v = innerView(rel);
    P = vec4((W * vec4(v.xy, 0.0, 1.0)).xyz, 0.0);
    D = vec4(0.0, 0.0, 0.0, j == 0 ? 0.0 : hash1(uint(j) + 911u));
    if (tRel >= launchAt(wl)) {
      // launch: out of the plane towards the viewer, flung outwards from the centre, with a swirl
      uint k = hashu(uvec2(ip) + 911u);
      vec3 n = normalize((W * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
      vec3 rad = (W * vec4(v.xy, 0.0, 0.0)).xyz;
      vec3 jit = vec3(hash1(k), hash1(k + 1u), hash1(k + 2u)) - 0.5;
      // nearly the same for all: the creature's shape survives the blast, magnified, rushing at us
      D.xyz = (n * (1.2 + 0.3 * hash1(k + 3u)) + rad * (4.2 + 0.4 * hash1(k + 4u)) + cross(n, rad) * 1.6 + jit * 0.1) * kick;
      if (j == 0) D.xyz = (n * 2.2 + normalize(rad + vec3(1e-4, 0.0, 0.0)) * 3.0) * kick; // the +1 leads the escape
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
