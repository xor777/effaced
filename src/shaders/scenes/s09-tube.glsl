// S09 · fibre shading. The still: Kitaoka's peripheral-drift inks (black → dark → white → light,
// repeated; the eye drifts from black to dark and from white to light) painted along every fibre, flat,
// with a dark contour where the tube turns away. Alive: lit pearl tubes; the inks stay on as a faint
// pattern that now really flows along the fibres. Alpha = 1 / view depth (for the depth of field).
#include "lib/common"
in vec3 vP, vN;
in float vU;
flat in vec2 vI;
out vec4 o;
uniform vec3 eye, fwd;
uniform float flatK;  // 1 = the still's flat inks, 0 = lit
uniform float snakeK; // ink contrast when lit
uniform float flow;   // phase of the inks along the fibres (periods)
uniform vec3 K0, K1, K2, K3;
uniform vec3 TINT[4];
uniform vec3 Ldir;

vec3 seq(float u, float aa) {
  u = fract(u);
  vec3 c = mix(K3, K0, smoothstep(-aa, aa, u));
  c = mix(c, K1, smoothstep(0.18 - aa, 0.18 + aa, u));
  c = mix(c, K2, smoothstep(0.5 - aa, 0.5 + aa, u));
  c = mix(c, K3, smoothstep(0.68 - aa, 0.68 + aa, u));
  return mix(c, K0, smoothstep(1.0 - aa, 1.0 + aa, u));
}

void main() {
  vec3 N = normalize(vN), V = normalize(eye - vP);
  float n = vI.x;
  // signed periods: the sequence runs either way along the fibre, and so does the drift the eye sees
  // (from black to dark, from white to light = towards increasing u). Alive, the inks really move that
  // way: a fixed ink u0 sits at vU = (u0 + flow) / n.
  float u = vU * n - flow;
  float aa = max(fwidth(u), 1e-4) * 0.75;
  vec3 ink = seq(u, aa);
  float ndv = abs(dot(N, V));
  vec3 flatC = mix(K0, ink, smoothstep(0.17, 0.3, ndv));

  vec3 tint = TINT[int(vI.y + 0.5)];
  float l = dot(ink, vec3(0.2126, 0.7152, 0.0722));
  vec3 alb = tint * (1.0 + snakeK * (l * 1.5 - 0.55));
  vec3 L = normalize(Ldir), Hh = normalize(L + V);
  float dif = max(dot(N, L), 0.0);
  float sky = 0.5 + 0.5 * N.z;
  vec3 lit = alb * (0.85 * dif + 0.22 * sky) + vec3(1.0, 0.97, 0.95) * pow(max(dot(N, Hh), 0.0), 70.0) * 1.4
           + tint * pow(1.0 - ndv, 3.0) * 0.5;
  o = vec4(mix(lit, flatC, flatK), 1.0 / max(dot(vP - eye, fwd), 1e-3));
}
