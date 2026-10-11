// S09 · fibres of the Hopf fibration as tubes. Every fibre is a great circle of S³; after the
// stereographic projection it is an exact circle in R³ (centre c, radius R, plane e1/e2 — per instance,
// from JS). The tube radius follows the conformal factor of the projection, (1 + |x|²) / 2, so the
// tubes have one constant thickness on S³ (thin near the core, thicker outside).
layout(location = 0) in vec4 iA; // centre xyz, radius (0 = skip)
layout(location = 1) in vec4 iB; // e1 xyz, ink periods along the fibre (signed: direction of the drift)
layout(location = 2) in vec4 iC; // e2 xyz, torus index
uniform mat4 VP;
uniform float r0;
uniform int SEG, SIDES;
out vec3 vP, vN;
out float vU;
flat out vec2 vI; // periods, torus

void main() {
  int q = gl_VertexID / 6, k = gl_VertexID % 6;
  int i = q / SIDES, j = q - i * SIDES;
  // two triangles per quad: (0,0) (1,0) (0,1) · (0,1) (1,0) (1,1)
  int di = (k == 1 || k == 4 || k == 5) ? 1 : 0;
  int dj = (k == 2 || k == 3 || k == 5) ? 1 : 0;
  float u = float(i + di) / float(SEG);
  float th = 6.28318530718 * u, ph = 6.28318530718 * float(j + dj) / float(SIDES);
  vec3 e1 = iB.xyz, e2 = iC.xyz, n = cross(e1, e2);
  vec3 rad = cos(th) * e1 + sin(th) * e2;
  vec3 P = iA.xyz + iA.w * rad;
  float r = r0 * min(0.5 * (1.0 + dot(P, P)), 3.2);
  vN = cos(ph) * rad + sin(ph) * n;
  vP = P + r * vN;
  vU = u;
  vI = vec2(iB.w, iC.w);
  gl_Position = iA.w > 0.0 ? VP * vec4(vP, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
