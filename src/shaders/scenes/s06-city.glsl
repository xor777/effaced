// S06 · the city level of the Droste: a street of ornamental facades in the evening sun under the
// #FACADE sky, seen square on (a relief: height field, normals, cast shadows). The middle house is
// the gallery; its one great window is the hole (alpha 0) through which the next turn of the
// spiral shows. Rendered once into a texture.
// Coordinates: x ∈ [-4/3, 4/3], y ∈ [-1, 1]; 1 unit ≈ 12 m. The window must stay inside
// |x| < 0.2, |y| < 0.125 (the frame of the next gallery level) — WIN in s06-droste.glsl.
#include "lib/common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform vec2 res;

const vec2 WIN = vec2(0.17, 0.106);
const float FL = 0.26;      // storey height
const float GROUND = -0.86; // street level

float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
// arched window: a box with a half-disc on top
float sdArch(vec2 p, vec2 b) { return min(sdBox(p, b), max(length(p - vec2(0.0, b.y)) - b.x, -(p.y - b.y))); }

struct House { float x0, x1, roof; vec3 col; float id; };
House houseAt(float x) {
  House h;
  float a = abs(x), s = x < 0.0 ? -1.0 : 1.0;
  if (a < 0.56) { h.x0 = -0.56; h.x1 = 0.56; h.roof = 0.62; h.col = vec3(1.0, 0.86, 0.72); h.id = 0.0; return h; }
  if (a < 0.98) { h.x0 = 0.56; h.x1 = 0.98; h.roof = s > 0.0 ? 0.44 : 0.76; h.col = s > 0.0 ? hex2p3(C_FACADE) : hex2p3(C_DECADE); h.id = 1.5 + 0.5 * s; }
  else { h.x0 = 0.98; h.x1 = 1.6; h.roof = s > 0.0 ? 0.84 : 0.52; h.col = s > 0.0 ? vec3(0.98, 0.9, 0.74) : hex2p3(C_FACADE); h.id = 3.5 + 0.5 * s; }
  if (s < 0.0) { float t0 = -h.x1; h.x1 = -h.x0; h.x0 = t0; }
  return h;
}

// relief (units of 12 m; walls at 0, ornament +, openings -). mat: 0 wall, 1 glass, 2 hole, 3 sky
float relief(vec2 p, out int mat) {
  mat = 0;
  if (p.y < GROUND) return 0.0;
  House H = houseAt(p.x);
  float ex = min(p.x - H.x0, H.x1 - p.x);
  // roofline: a cornice that projects, then sky
  float top = H.roof + (H.id == 0.0 ? 0.11 * max(0.0, 1.0 - abs(p.x) / 0.5) : 0.0); // the gallery's pediment
  if (p.y > top + 0.03) { mat = 3; return -1.0; }
  float h = 0.0;
  h += 0.016 * smoothstep(0.03, 0.02, abs(p.y - H.roof - 0.012));            // main cornice
  h += 0.006 * step(H.roof + 0.024, p.y);                                     // attic / pediment face
  float fy = (p.y - GROUND) / FL, fi = floor(fy), ff = fract(fy) * FL;
  h += 0.007 * smoothstep(0.008, 0.0, abs(ff - 0.004));                      // string course at each floor
  h += 0.004 * step(p.y, GROUND + FL) * step(0.5, fract((p.y - GROUND) / 0.035)); // rusticated ground floor
  h += 0.009 * smoothstep(0.026, 0.022, ex);                                  // corner pilasters
  if (H.id == 0.0) {
    // the gallery: the great window, a moulded frame, a keystone; two columns of arched windows
    float d = sdBox(p, WIN);
    if (d < 0.0) { mat = 2; return -0.05; }
    h += 0.013 * smoothstep(0.0, 0.003, d) * smoothstep(0.042, 0.03, d);
    h += 0.006 * smoothstep(0.01, 0.0, abs(d - 0.052));
    h += 0.016 * step(sdBox(p - vec2(0.0, WIN.y + 0.052), vec2(0.022 - 0.3 * (p.y - WIN.y - 0.05), 0.03)), 0.0);
    // balcony under it
    h += 0.014 * step(sdBox(p - vec2(0.0, -WIN.y - 0.06), vec2(WIN.x + 0.05, 0.012)), 0.0);
    vec2 q = vec2(abs(p.x) - 0.39, ff - FL * 0.45);
    if (abs(abs(p.x) - 0.39) < 0.09 && p.y > GROUND + FL * 0.9) {
      float w = sdArch(q, vec2(0.04, 0.07));
      if (w < 0.0) { mat = 1; return -0.02; }
      h += 0.007 * smoothstep(0.012, 0.0, abs(w - 0.008));
      h += 0.01 * step(sdBox(q + vec2(0.0, 0.085), vec2(0.055, 0.008)), 0.0); // sills
    }
  } else {
    float n = max(2.0, floor((H.x1 - H.x0 - 0.06) / 0.115));
    float wx = (H.x1 - H.x0 - 0.06) / n;
    vec2 c = vec2(mod(p.x - H.x0 - 0.03, wx) - wx * 0.5, ff - FL * 0.45);
    if (ex > 0.035 && fi >= 1.0 && p.y < H.roof - 0.06) {
      float w = sdArch(c, vec2(wx * 0.22, 0.065));
      if (w < 0.0) { mat = 1; return -0.02; }
      h += 0.006 * smoothstep(0.01, 0.0, abs(w - 0.007));
      h += 0.009 * step(sdBox(c + vec2(0.0, 0.078), vec2(wx * 0.32, 0.007)), 0.0);
    }
    if (fi < 1.0 && ex > 0.035) { // shop fronts
      float w = sdBox(vec2(c.x, ff - FL * 0.42), vec2(wx * 0.36, 0.085));
      if (w < 0.0) { mat = 1; return -0.03; }
    }
  }
  return h;
}

void main() {
  vec2 p = (uv - 0.5) * vec2(8.0 / 3.0, 2.0);
  float e = 1.0 / res.y;
  int mat;
  float h = relief(p, mat);
  vec3 sunDir = normalize(vec3(-0.62, 0.55, 0.56));
  vec3 sun = vec3(1.0, 0.8, 0.62) * 3.6;
  vec3 col;
  if (mat == 3) {
    col = mix(hex2p3(C_FACADE) * 1.35, hex2p3(C_DECADE) * 0.75, smoothstep(0.35, 1.0, p.y));
    col += vec3(1.0, 0.86, 0.74) * 0.9 * exp(-length(p - vec2(-1.05, 0.62)) * 2.6);
  } else if (mat == 2) {
    col = vec3(0.0);
  } else {
    int m2;
    float hx = relief(p + vec2(e, 0.0), m2) - relief(p - vec2(e, 0.0), m2);
    float hy = relief(p + vec2(0.0, e), m2) - relief(p - vec2(0.0, e), m2);
    vec3 n = normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1.0) * vec3(0.6, 0.6, 1.0));
    // cast shadows: march the height field towards the sun
    float sh = 1.0;
    vec2 sd = normalize(-sunDir.xy) * -1.0;
    float rise = sunDir.z / length(sunDir.xy);
    for (int i = 1; i <= 24; i++) {
      float s = float(i) * 0.004;
      int m3;
      float hh = relief(p + sd * s, m3);
      if (m3 == 3) break;
      sh = min(sh, sat(1.0 - (hh - h - s * rise * 0.12) * 120.0));
    }
    float dif = max(dot(n, sunDir), 0.0) * sh;
    float sky = 0.55 + 0.45 * n.y;
    House H = houseAt(p.x);
    vec3 base = H.col;
    if (p.y < GROUND + FL) base *= 0.88;
    if (mat == 1) {
      // glass: the sky in reflection, a few rooms lit
      float w = hash2(floor(vec2((p.x + 2.0) * 8.7, (p.y - GROUND) / FL)));
      base = mix(hex2p3(C_DECADE) * 0.25, vec3(1.0, 0.78, 0.55) * 1.1, step(0.78, w));
      col = base * (0.6 + 0.4 * sky) + sun * 0.04 * dif;
    } else {
      float ao = 0.6 + 0.4 * smoothstep(-0.02, 0.006, h);
      col = base * (sun * 0.42 * dif + mix(hex2p3(C_DECADE), hex2p3(C_ACCEDE), 0.4) * 0.3 * sky * ao + vec3(0.03, 0.025, 0.04));
    }
  }
  if (p.y < GROUND) {
    // the street: warm stone, the houses' shadow
    col = mix(vec3(0.62, 0.5, 0.52), vec3(0.3, 0.24, 0.28), smoothstep(GROUND, -1.0, p.y)) * 0.8;
  }
  o = vec4(col, mat == 2 ? 0.0 : 1.0);
}
