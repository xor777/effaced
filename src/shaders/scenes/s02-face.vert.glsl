// the highlighted 600-cell face: a flat triangle in R⁴ (subdivided), pushed onto S³, rotated and
// projected like the edges. Barycentric colour = the gamut triangle of S01.
#include "lib/quat"
out vec3 bary;
uniform vec4 A;
uniform vec4 B;
uniform vec4 C;
uniform mat4 view;
uniform mat4 proj;
uniform vec4 qL;
uniform vec4 qR;
uniform float curve;
const int N = 32; // subdivisions per side

void main() {
  // triangle index → row/col in a subdivided triangle (two triangles per cell)
  int tri = gl_VertexID / 3, v = gl_VertexID % 3;
  int row = int(floor((sqrt(8.0 * float(tri / 2) + 1.0) - 1.0) * 0.5));
  int col = tri / 2 - row * (row + 1) / 2;
  bool up = (tri & 1) == 0;
  ivec2 ij;
  if (up) ij = v == 0 ? ivec2(row, col) : v == 1 ? ivec2(row + 1, col) : ivec2(row + 1, col + 1);
  else ij = v == 0 ? ivec2(row, col) : v == 1 ? ivec2(row + 1, col + 1) : ivec2(row, col + 1);
  if (!up && col >= row) { gl_Position = vec4(0, 0, -2, 1); bary = vec3(0); return; }
  float s = float(ij.x) / float(N), t = float(ij.y) / float(N);
  bary = vec3(1.0 - s, s - t, t);
  // flat at the cut from S01 (a plane through the pole projects to a plane: straight edges), then
  // pushed onto S³ as the camera pulls back
  vec4 q = A * bary.x + B * bary.y + C * bary.z;
  vec4 p = mix(q, normalize(q), curve);
  p = qmul(qmul(qL, p), qR);
  gl_Position = proj * view * vec4(stereo(p), 1.0);
}
