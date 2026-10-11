// S12 · the particles inside the canvas (main context), until they leave through its frame:
//   mode 0  the 65536 as points (at 18:00 they are all one point),
//   mode 1  the line through them in their order — the thread, drawn segment by segment (GL_LINES,
//           vertex 2k/2k+1 = particles k/k+1); a segment the flow has pulled too long is left out,
//   mode 2  the +1's trail (a ring of its past positions from the CPU, newest last), mode 3 the +1 itself.
// The thread's colour runs along it by the particle's place on the starting line — #ACCEDE → #DECADE →
// #FACADE: as the line stretches the gradient stretches with it, as it folds the colours interleave.
#include "lib/common"
#include "scenes/s12-lib"
uniform sampler2D st;    // offsets (xyz), place along the line (w)
uniform int tW;
uniform float aspect;
uniform float tRel;      // s since the hit (negative before)
uniform int mode;
uniform vec3 C0, C1, C2; // the thread's gradient
uniform vec3 CP;         // the +1's light
uniform vec3 iRefAbs;    // the reference itself (for the speed)
uniform float depthK;    // brightness by depth
uniform vec4 look;       // thread gain, segment cut (H), heat, +1 gain
uniform sampler2D trail; // mode 2: where the eye saw the +1 (innerView, from the CPU), w = its light 1 (the head) … 0 (not drawn)
uniform vec2 poff;       // modes 2, 3: drawn a few times a texel apart (a thicker stroke)
uniform int stride;      // mode 0: every stride-th particle, worth stride (a line a few pixels long would
                         // pile all 65536 onto the same few bins: blending them is serial)
out vec3 col;
out float wt;

vec3 ramp(float u) {
  return u < 0.5 ? mix(C0, C1, u * 2.0) : mix(C1, C2, u * 2.0 - 1.0);
}
vec4 clip(vec3 v) { return vec4(v.x * 2.0 / aspect, v.y * 2.0, 0.0, 1.0); }
const vec4 AWAY = vec4(2.0, 2.0, 2.0, 1.0);

void main() {
  gl_PointSize = 1.0;
  wt = 1.0;
  if (mode == 3) {
    // the +1 itself: a warm white-hot point, worth dozens of the others
    vec3 v = innerView(iPlus);
    gl_Position = tRel >= 0.0 || iView.z - v.z < 0.6 ? AWAY : clip(v) + vec4(poff, 0.0, 0.0);
    gl_PointSize = 2.0;
    col = mix(CP, vec3(1.0), 0.45) * 2.0;
    wt = 80.0 * look.w;
    return;
  }
  if (mode == 2) {
    // segment by segment (GL_LINES): vertex 2k/2k+1 = trail points k/k+1
    int q = (gl_VertexID >> 1) + (gl_VertexID & 1), q2 = (gl_VertexID & 1) == 0 ? q + 1 : q - 1;
    vec4 tp = texelFetch(trail, ivec2(q, 0), 0), tp2 = texelFetch(trail, ivec2(q2, 0), 0);
    bool gone = tRel >= 0.0 || min(tp.w, tp2.w) <= 0.0;
    gl_Position = gone ? AWAY : clip(tp.xyz) + vec4(poff, 0.0, 0.0);
    float a = tp.w;
    // a comet: white-hot at the head, its warm light cooling down the tail (weight: it outshines the
    // threads it crosses)
    col = mix(CP, vec3(1.6, 1.4, 1.2), a * a * a * a) * 1.5;
    wt = (0.6 + 24.0 * a * a) * look.w;
    return;
  }
  int i = mode == 1 ? (gl_VertexID >> 1) + (gl_VertexID & 1) : gl_VertexID * stride;
  if (mode == 0) wt = float(stride);
  int n = tW * tW;
  i = min(i, n - 1);
  vec4 s = texelFetch(st, ivec2(i % tW, i / tW), 0);
  vec3 v = innerView(iRef + s.xyz);
  bool gone = tRel >= launchAt(launchW(i)) || iView.z - v.z < 0.6;
  if (mode == 1) {
    // the other end of this segment: a segment that has become a chord across the picture is not drawn
    int j = (gl_VertexID & 1) == 0 ? min(i + 1, n - 1) : i - 1;
    vec4 s2 = texelFetch(st, ivec2(j % tW, j / tW), 0);
    vec3 v2 = innerView(iRef + s2.xyz);
    gone = gone || tRel >= launchAt(launchW(j)) || length(v.xy - v2.xy) > look.y || (gl_VertexID >> 1) >= n - 1;
  }
  gl_Position = gone ? AWAY : clip(v);
  vec3 F = lorenzF(iRefAbs + s.xyz);
  float fast = smoothstep(80.0, 220.0, length(F));
  vec3 c = ramp(s.w);
  // speed burns white; the near side outshines the far one
  c = mix(c, vec3(1.0, 0.97, 0.94) * 1.4, 0.3 * fast + look.z);
  col = c * look.x * (mode == 1 ? 1.0 : 0.35) * exp(depthK * clamp(v.z, -2.0, 2.0));
}
