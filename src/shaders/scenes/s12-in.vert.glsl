// S12 · the particles inside the canvas (main context): attractor → window plane, until they leave.
// On the G/F bars the cloud morphs from the Aizawa (the circle) into the Halvorsen (the triangle) and
// back: every particle has a home on both, and flies between them in a vortex, staggered by its number.
// Colour by speed: slow violet → magenta → coral → #FACADE → white-hot (HDR, for the bloom).
#include "lib/common"
#include "scenes/s12-lib"
uniform sampler2D st;    // Aizawa state
uniform sampler2D sh;    // Halvorsen state
uniform int stW;
uniform float aspect;
uniform float tRel;      // s since the hit (negative before)
uniform vec4 morph;      // amount (0 Aizawa … 1 Halvorsen), vortex (rad), heat, unused
uniform vec3 C0, C1, C2, C3, C4; // linear palette: slow → fast
uniform vec2 band;       // NDC y range drawn by this pass
out vec3 col;

vec3 ramp(float x) {
  x = clamp(x, 0.0, 1.0) * 4.0;
  if (x < 1.0) return mix(C0, C1, x);
  if (x < 2.0) return mix(C1, C2, x - 1.0);
  if (x < 3.0) return mix(C2, C3, x - 2.0);
  return mix(C3, C4, x - 3.0);
}

void main() {
  ivec2 ip = ivec2(gl_VertexID % stW, gl_VertexID / stW);
  vec4 s = texelFetch(st, ip, 0);
  vec3 P = s.xyz;
  float sp = length(aizawaF(P)) * 0.42;
  float m = morph.x;
  if (m > 0.0) {
    vec3 hq = texelFetch(sh, ip, 0).xyz;
    // staggered by the particle's number: the change sweeps through the cloud
    float mi = smoothstep(0.0, 1.0, clamp(m * 1.6 - 0.6 * fract(s.w * 7.31), 0.0, 1.0));
    P = mix(P, halvorsenFrame(hq), mi);
    float tr = sin(PI * mi);
    vec2 c = P.xy;
    float a = morph.y * tr * (0.6 + 0.8 * s.w);
    P.xy = mat2(cos(a), sin(a), -sin(a), cos(a)) * c;
    P.z += 0.35 * tr * (fract(s.w * 3.7) - 0.5);
    sp = mix(sp, length(halvorsenF(hq)) * 0.022, mi) + 1.6 * tr;
  }
  vec3 v = innerView(P);
  bool gone = tRel >= launchAt(s.w) || v.y * 2.0 < band.x || v.y * 2.0 >= band.y;
  gl_Position = gone ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(v.x * 2.0 / aspect, v.y * 2.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  // the dye the flow carries and folds: filaments
  float dye = 0.5 + 0.5 * cos(TAU * 2.0 * s.w);
  float x = sp * 0.55 + 0.18 * dye + morph.z;
  col = ramp(x) * (0.55 + 0.6 * dye) * (1.0 + 1.6 * smoothstep(0.75, 1.0, x));
}
