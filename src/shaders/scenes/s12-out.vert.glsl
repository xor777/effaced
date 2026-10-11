// S12 · the particles outside the canvas (second context), seen through the stage's CSS perspective;
// in the last bar they settle on the creature's sigil, drawn in the order of its contour — S13's seed.
#include "lib/common"
#include "scenes/s12-lib"
uniform sampler2D op, od, sq; // outer state, Thomas home
uniform sampler2D sig;  // sigil contour RG32F N×1
uniform int sigN;
uniform float sigR;     // sigil radius (H)
uniform int stW;
uniform float aspect;
uniform float dH;       // CSS perspective distance (H units)
uniform float conv;     // 0..1: landing on the sigil
uniform vec3 OC[4];     // a cycle of four colours round the Thomas attractor's lobes
uniform vec3 CS, CH;    // the sigil's light, the heat of the burst
uniform float heatK;    // how long the burst stays white-hot
uniform vec2 band;      // NDC y range drawn by this pass
out vec3 col;

vec2 sigil(float u) {
  float x = u * float(sigN);
  int i = int(x);
  vec2 a = texelFetch(sig, ivec2(i % sigN, 0), 0).xy, b = texelFetch(sig, ivec2((i + 1) % sigN, 0), 0).xy;
  return mix(a, b, x - float(i));
}

void main() {
  ivec2 ip = ivec2(gl_VertexID % stW, gl_VertexID / stW);
  vec4 P = texelFetch(op, ip, 0), D = texelFetch(od, ip, 0);
  col = vec3(0.0);
  gl_PointSize = 1.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (P.w < 0.5) return;
  float w = D.w;
  float e = clamp(conv * 1.7 - w * 0.7, 0.0, 1.0);
  e = e * e * (3.0 - 2.0 * e);
  vec3 T = vec3(sigil(w) * sigR, 0.0);
  vec3 off = P.xyz - T;
  float a = 2.2 * e;
  off.xy = mat2(cos(a), sin(a), -sin(a), cos(a)) * off.xy;
  vec3 X = T + off * (1.0 - e) * (1.0 - e);
  float den = dH - X.z;
  if (den < 0.12 * dH) return;
  float k = dH / den;
  if (X.y * k * 2.0 < band.x || X.y * k * 2.0 >= band.y) return;
  gl_Position = vec4(X.x * k * 2.0 / aspect, X.y * k * 2.0, 0.0, 1.0);
  float sz = clamp(k * k * 0.5, 1.0, 2.2);
  gl_PointSize = sz;
  float sp = length(D.xyz);
  // colour by the place on the Thomas attractor: its cyclic lobes each get their own colour
  vec3 q = texelFetch(sq, ip, 0).xyz;
  float h = fract(atan(sin(q.x) - sin(q.y), sin(q.z) - 0.5 * (sin(q.x) + sin(q.y))) / TAU + 0.12 * w) * 4.0;
  int i = int(h);
  float f = smoothstep(0.0, 1.0, h - float(i));
  vec3 c = mix(OC[i], OC[(i + 1) % 4], f) * (0.75 + 0.5 * w);
  // sparks: white-hot while they fly, cooling into the palette
  c = mix(c, CH, clamp((sp - 0.3) / max(0.05, 2.2 * heatK), 0.0, 1.0));
  col = mix(c, CS, e);
  col /= max(1.0, 0.45 * sz * sz);
}
