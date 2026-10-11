// S02 · Cage: one instance per 600-cell edge; the edge is a great-circle arc on S³, rotated
// isoclinically in 4D (p → qL·p·qR), stereographically projected to R³, then drawn as a
// screen-space ribbon of SEG segments.
#include "lib/quat"
in vec4 a;     // edge endpoints on S³ (per instance)
in vec4 b;
in float hot;  // 1 for the highlighted face's edges
out float side;
out float bright;
out vec3 col;
uniform mat4 view;
uniform mat4 proj;
uniform vec4 qL;
uniform vec4 qR;
uniform vec2 res;
uniform float width;   // px
uniform float hotK;
uniform float baseK;
uniform float curve;   // 0 = straight chords (S01's flat triangle at the cut) → 1 = great-circle arcs
const int SEG = 24;

// a point of the edge: on the chord (stereographic projection is a central projection from the
// pole, so a chord stays a straight line) blended into the arc on S³
vec4 edgeAt(float u) { return mix(mix(a, b, u), slerp4(a, b, u), curve); }

vec4 clipOf(float u, out float w4) {
  vec4 p = qmul(qmul(qL, edgeAt(u)), qR);
  w4 = p.w;
  return proj * view * vec4(stereo(p), 1.0);
}
float radius(float u) { return length(stereo(qmul(qmul(qL, edgeAt(u)), qR))); }

void main() {
  int j = gl_VertexID >> 1;
  side = float(gl_VertexID & 1) * 2.0 - 1.0;
  float u = float(j) / float(SEG);
  float du = 1.0 / float(SEG);
  float w0, w1;
  vec4 c0 = clipOf(u, w0);
  vec4 c1 = clipOf(j < SEG ? u + du : u - du, w1);
  if (c0.w < 0.05 || c1.w < 0.05) { gl_Position = vec4(0, 0, -2, 1); bright = 0.0; side = 0.0; col = vec3(0); return; }
  vec2 s0 = c0.xy / c0.w, s1 = c1.xy / c1.w;
  vec2 dir = (s1 - s0) * res * (j < SEG ? 1.0 : -1.0);
  vec2 n = normalize(vec2(-dir.y, dir.x) + 1e-9) / res * 2.0;
  float wpx = width * mix(1.0, 1.8, hot * hotK);
  gl_Position = c0 + vec4(n * side * wpx * c0.w, 0.0, 0.0);
  // far from the projection pole lines are short and dense; near it they explode — fade both ends
  float depth = c0.w;
  // edges far out in R³ (near the projection pole) fade away so the cage reads as an object
  float r = radius(u);
  // edges passing close to the lens sweep across the whole screen within a frame or two (long
  // flashing lines while the 4D rotation speeds up): fade them instead of brightening them
  float nearK = mix(1.0, smoothstep(0.8, 2.6, depth), 1.0 - hot * hotK);
  bright = (baseK + hot * hotK * 3.0) * nearK * smoothstep(0.02, 0.25, 1.0 - w0) / (1.0 + 0.04 * r * r * r) / (0.6 + 0.02 * depth * depth);
  col = mix(vec3(0.674, 0.807, 0.870), vec3(1.0, 0.92, 0.85), hot * hotK);
}
