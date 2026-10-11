// S11 · the compass: every Carlyle circle is one instance, drawn as a ribbon along the arc it has swept
// so far (mode 0), or as the two ink dots of its roots on the x-axis (mode 1). Positions in px from the
// screen centre; the fragment shader measures the exact distance to the circle for the coverage.
#include "lib/common"
uniform vec2 res;
uniform float U;           // px per construction unit
uniform float hw;          // half line width, px
uniform int mode;
uniform float spin;         // the page turns (see s11-plane)
uniform vec4 C[136];       // centre (units), radius (units), sweep 0..1
uniform vec4 Cs[136];      // start angle, colour index, alpha, roots alpha
uniform int seg;           // segments per ribbon (the draw issues 2·(seg + 1) vertices)
out vec2 vP;
out vec4 vCirc;            // centre px, radius px, alpha
flat out vec2 vInfo;       // colour index, mode

void main() {
  vec4 ci = C[gl_InstanceID], cs = Cs[gl_InstanceID];
  vec2 p;
  if (mode == 0) {
    int s = gl_VertexID >> 1;
    float side = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
    float th = cs.x + ci.w * TAU * float(s) / float(seg);
    p = (ci.xy + ci.z * vec2(cos(th), sin(th))) * U + side * (hw + 2.0) * vec2(cos(th), sin(th));
    vCirc = vec4(ci.xy * U, ci.z * U, cs.z);
    if (ci.w <= 0.0 || cs.z <= 0.0) p = vec2(1e6);
  } else {
    int k = gl_VertexID / 6, v = gl_VertexID - 6 * (gl_VertexID / 6);
    vec2 corner = vec2(v == 1 || v == 2 || v == 4 ? 1.0 : -1.0, v == 2 || v == 4 || v == 5 ? 1.0 : -1.0);
    float disc = ci.z * ci.z - ci.y * ci.y;
    vec2 root = vec2(ci.x + (k == 0 ? -1.0 : 1.0) * sqrt(max(disc, 0.0)), 0.0) * U;
    p = root + corner * (2.6 * hw + 2.0);
    vCirc = vec4(root, 0.0, cs.w);
    if (cs.w <= 0.0 || disc <= 0.0) p = vec2(1e6);
  }
  vP = p;
  vInfo = vec2(cs.y, float(mode));
  vec2 q = vec2(cos(spin) * p.x + sin(spin) * p.y, -sin(spin) * p.x + cos(spin) * p.y);
  gl_Position = vec4(q / (0.5 * res), 0.0, 1.0);
}
