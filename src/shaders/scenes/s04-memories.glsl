// S04 · the Machine's memories: six classics of the 90s demoscene, one 320×200 tile each of the
// billboard atlas, through an 18-bit VGA DAC. 0 plasma · 1 rotozoomer · 2 tunnel · 3 glenz vectors
// · 4 fire · 5 twister with copper bars.
#include "lib/common"
#include "lib/color"
#include "scenes/s04-common"
in vec2 uv;
out vec4 o;
uniform int fx;
uniform float t;
uniform vec2 org;          // tile origin in the atlas, px
uniform sampler2D fire;    // 160×100 fire state (R)
uniform float beat;        // kick envelope

// mode 13h on a 4:3 tube: pixels are 1.2× taller than wide. q: centred, x ∈ [-2, 2], y ∈ [-1.5, 1.5]
vec2 tubeQ(vec2 p) { return (p - vec2(160.0, 100.0)) * vec2(0.0125, 0.015); }

vec3 plasma(vec2 p) {
  vec2 q = tubeQ(p);
  float tt = t * 0.8;
  float v = sin(q.x * 3.1 + tt)
          + sin(3.3 * (q.x * sin(tt * 0.5) + q.y * cos(tt * 0.33)) + tt * 1.3)
          + sin(length(q - vec2(1.1 * sin(tt * 0.4), 0.8 * cos(tt * 0.31))) * 4.2 - tt)
          + sin(length(q + vec2(0.9 * cos(tt * 0.23), 0.6 * sin(tt * 0.5))) * 3.1 + tt * 0.7);
  float idx = floor(fract(v * 0.125 + t * 0.06) * 256.0) / 256.0; // palette cycling
  return palPlasma(idx);
}

vec3 roto(vec2 p) {
  vec2 q = tubeQ(p);
  float a = t * 0.45 + 0.8 * sin(t * 0.21);
  float z = 34.0 + 26.0 * sin(t * 0.37);
  vec2 w = rot(a) * q * z + vec2(t * 23.0, t * 11.0);
  float x = xorTex(w);
  // the classic rotozoomer pairs the XOR texture with a soft magenta/cyan ramp
  vec3 c = pal(x * 0.5 + 0.55, vec3(0.5), vec3(0.45), vec3(1.0), vec3(0.15, 0.4, 0.65));
  return vga(c * (0.35 + 0.65 * x));
}

vec3 tunnel(vec2 p) {
  vec2 q = tubeQ(p);
  vec2 c = vec2(0.35 * sin(t * 0.61), 0.25 * sin(t * 0.83));
  return vga(tunnelAt((q - c) / 1.5, t * 0.55 + 0.02 * beat));
}

// glenz vectors: a translucent tetrakis hexahedron (24 faces, checkered), ray-traced as a convex
// polyhedron so the back faces show through the front ones
vec3 glenz(vec2 p) {
  vec2 q = tubeQ(p);
  vec3 col = vec3(0.0);
  // background: a perspective checker floor sliding towards us
  if (q.y < -0.15) {
    float z = 1.6 / (-q.y);
    vec2 f = vec2(q.x * z, z + t * 3.0);
    float ch = mod(floor(f.x) + floor(f.y), 2.0);
    col = mix(vec3(0.05, 0.03, 0.18), vec3(0.22, 0.14, 0.5), ch) * sat(1.0 - z / 14.0);
  }
  float bounce = abs(sin(t * 1.9));
  vec3 ro = vec3(0.0, 0.0, -6.5), rd = normalize(vec3(q, 2.6));
  ro.y -= 0.6 * bounce - 0.3;
  float a = t * 0.9, b = t * 0.67;
  mat3 R = mat3(cos(a), 0.0, sin(a), 0.0, 1.0, 0.0, -sin(a), 0.0, cos(a));
  mat3 R2 = mat3(1.0, 0.0, 0.0, 0.0, cos(b), sin(b), 0.0, -sin(b), cos(b));
  R = R * R2;
  vec3 o3 = ro * R, d3 = rd * R; // into object space (R orthonormal: v*R = Rᵀv)
  float tn = -1e9, tf = 1e9;
  int fn = -1, ff = -1;
  bool miss = false;
  for (int i = 0; i < 24; i++) {
    int ax = i / 8, s = (i / 4) & 1, bx = (i / 2) & 1, s2 = i & 1;
    vec3 n = vec3(0.0);
    n[ax] = s == 0 ? 1.0 : -1.0;
    int b2 = (ax + 1 + bx) % 3;
    n[b2] = s2 == 0 ? 0.5 : -0.5;
    float inv = inversesqrt(1.25);
    n *= inv;
    float d = 1.5 * inv;
    float den = dot(n, d3), dist = d - dot(n, o3);
    if (abs(den) < 1e-6) { if (dist < 0.0) miss = true; continue; }
    float tt = dist / den;
    if (den < 0.0) { if (tt > tn) { tn = tt; fn = i; } }
    else { if (tt < tf) { tf = tt; ff = i; } }
  }
  if (!miss && tn < tf && fn >= 0) {
    vec3 L = normalize(vec3(-0.5, 0.7, -0.6)) * R;
    // back face first (seen through), then the front face
    for (int k = 0; k < 2; k++) {
      int i = k == 0 ? ff : fn;
      int ax = i / 8, s = (i / 4) & 1, bx = (i / 2) & 1, s2 = i & 1;
      vec3 n = vec3(0.0);
      n[ax] = s == 0 ? 1.0 : -1.0;
      n[(ax + 1 + bx) % 3] = s2 == 0 ? 0.5 : -0.5;
      n = normalize(n);
      bool white = ((ax + s + bx + s2) & 1) == 0;
      float sh = 0.35 + 0.65 * abs(dot(n, L));
      vec3 fc = white ? vec3(0.95, 0.95, 1.0) : vec3(0.15, 0.35, 1.0);
      // glenz: the faces are glass — the far side and the floor show through
      if (k == 0) col = mix(col, fc * sh * 0.6, 0.4);
      else col = mix(col, fc * sh, white ? 0.36 : 0.5);
    }
  }
  return vga(col);
}

vec3 fireFx(vec2 p) {
  float v = texelFetch(fire, ivec2(p * 0.5) + ivec2(0, 3), 0).r; // the ember rows stay below the tube
  return palFire(v);
}

vec3 twister(vec2 p) {
  float ys = 199.0 - p.y; // VGA scanline, 0 = top
  vec3 col = vec3(0.0);
  // copper bars behind
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float yc = 100.0 + 78.0 * sin(t * 1.1 + fi * 0.55);
    float d = abs(ys - yc) / 9.0;
    if (d < 1.0) col = max(col, palCopper(fi * 0.21 + 0.1) * (1.0 - d * d));
  }
  // the twister: a square column whose angle twists down the screen
  float a = t * 1.3 + 2.4 * sin(ys * 0.011 + t * 0.8) + ys * 0.006;
  float cx = 160.0 + 34.0 * sin(ys * 0.013 + t * 0.6);
  float R = 44.0;
  for (int k = 0; k < 4; k++) {
    float x0 = cx + R * sin(a + float(k) * 1.5707963);
    float x1 = cx + R * sin(a + float(k + 1) * 1.5707963);
    if (x1 > x0 && p.x >= x0 && p.x < x1) {
      float lit = (x1 - x0) / (R * 1.4142);
      vec3 fc = k == 0 ? vec3(0.98, 0.79, 0.87) : k == 1 ? vec3(0.87, 0.79, 0.87) : k == 2 ? vec3(0.67, 0.81, 0.87) : vec3(0.75, 0.68, 0.93);
      col = fc * (0.25 + 0.75 * lit * lit);
    }
  }
  return vga(col);
}

void main() {
  vec2 p = floor(gl_FragCoord.xy - org) + 0.5;
  vec3 c;
  if (fx == 0) c = plasma(p);
  else if (fx == 1) c = roto(p);
  else if (fx == 2) c = tunnel(p);
  else if (fx == 3) c = glenz(p);
  else if (fx == 4) c = fireFx(p);
  else c = twister(p);
  o = vec4(c, 1.0);
}
