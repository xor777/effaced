// S11 · Inversion — the plane. A {p,3} tiling in one conformal chart while p flows 3 → 5 → 17 → 257
// (sphere → plane → Poincaré disc; non-integer p tears the tiling: the glitch), under ruler-and-compass
// constructions in the colours of Byrne's Euclid. The constructions are Gauss's: the regular n-gon
// (n = 17, 257) through the tree of Gauss periods, every quadratic step solved by its Carlyle circle
// (the circle on the diameter (0,1)–(s,p) cuts the x-axis in the roots of x² − s·x + p); the last roots
// are 2·cos(2πk/n), and perpendiculars lift them onto the circle of radius 2 = the n-gon's vertices.
// Construction units: the n-gon circle (radius 2) is R px. The central tile is inscribed in it.
#include "lib/common"
#include "lib/color"
#include "lib/hyper"
#include "lib/mosaic"
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform float R;           // px, radius of the n-gon circle = circumradius of the central tile
uniform vec4 T;            // tiling (see lib/hyper)
uniform float p;
uniform float bound;       // hyperbolic boundary radius in chart units (0: none)
uniform float tileK;       // tiling strength
uniform float flowK;       // 0 while p rests … 1 while it flows (the sector colours crossfade)
uniform vec3 wash;         // paint strength of the tiles by generation 1, 2, ≥3
uniform sampler2D world;   // the inverted 3D world (S11 part 1), linear
uniform float worldMix;
uniform vec4 poly;         // n, edges drawn (0..n), perpendiculars drawn (0..(n−1)/2), vertex alpha
uniform vec4 poly17;       // the 17-gon while it fades out
uniform float perp17;
uniform vec4 base;         // x-axis drawn (0..1), n-gon circle swept (0..1), the point (0,1), pen glow
uniform float perpA;       // perpendiculars' opacity
uniform float ring;        // the bell: the n-gon circle glows
uniform vec2 pen;          // current pen tip (units)
uniform float spin;        // the page turns (= the camera's roll in the 3D part)
uniform sampler2D s10coef; // S10's last coefficients: the opening frame is its DC mosaic, at full resolution
uniform float s10on;
uniform float mosK;        // how much of that exact mosaic is shown (1 at 16:00)
uniform float raw;         // 1: S10's HDR values (S10's own post is running), 0: display-referred

vec3 paper() { return hex2p3(C_EFFACE); }
vec3 byrne(float i) {
  return i < 0.5 ? hex2p3(C_BYRNE_R) : i < 1.5 ? hex2p3(C_BYRNE_Y) : i < 2.5 ? hex2p3(C_BYRNE_B) : vec3(0.012);
}
const vec3 INK = vec3(0.010, 0.010, 0.012);
// a wash of pigment on the paper: geometric (subtractive) mix, clean at any strength
vec3 paint(vec3 pig, float a) { vec3 pp = paper(); return pp * pow(max(pig, 1e-4) / pp, vec3(a)); }

// coverage of a line of half-width w (px) at distance d (px)
float ink(float d, float w) { return clamp(w + 0.5 - d, 0.0, 1.0); }

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

vec3 tiling(vec2 q) {
  // screen → chart: vertex radius 1 at R px, a vertex of the central tile at angle 0
  float upx = 1.0 / R;
  vec2 u = q * upx;
  float a = PI / p;
  u = vec2(cos(a) * u.x - sin(a) * u.y, sin(a) * u.x + cos(a) * u.y);
  if (bound > 0.0 && dot(u, u) >= bound * bound) return paper();
  Tile tl = tileFold(u, T);
  float ePx = tl.edge / tl.sc / upx;                        // px to the tile edge
  float tilePx = 1.0 / tl.sc / upx;                         // ≈ size of this tile on screen, px
  vec3 c = paper();
  if (tl.gen > 0.5) {
    // a tile's colour: its sector around the centre (and its generation). While p flows the sectors
    // turn and new ones open at every integer p, so a tile would change colour in one frame — whole
    // thirds of the screen at once; instead the colours crossfade across the sector boundaries
    // (symmetrically, so continuously in space and time), and only while p moves.
    float xm = mod(atan(tl.ctr.y, tl.ctr.x) / T.x + 0.3, p);
    float k = floor(xm);
    float up = min(k + 1.0, p);                     // the last sector is partial
    float kn = up >= p ? 0.0 : k + 1.0, kp = k > 0.5 ? k - 1.0 : ceil(p) - 1.0;
    float bw = 0.3 * flowK;
    float wU = bw > 0.0 ? 0.5 * (1.0 - smoothstep(0.0, bw, up - xm)) : 0.0;
    float wL = bw > 0.0 ? 0.5 * (1.0 - smoothstep(0.0, bw, xm - k)) : 0.0;
    float a = (tl.gen < 1.5 ? wash.x : tl.gen < 2.5 ? wash.y : wash.z) * tileK;
    float g1 = tl.gen - 1.0;
    // (glazed: one wash over the other, the geometric mix that paint() lays on the paper)
    vec3 pp = paper();
    c = pp * pow(max(byrne(mod(k + g1, 3.0)), 1e-4) / pp, vec3(a * (1.0 - wU - wL))) *
        pow(max(byrne(mod(kn + g1, 3.0)), 1e-4) / pp, vec3(a * wU)) * pow(max(byrne(mod(kp + g1, 3.0)), 1e-4) / pp, vec3(a * wL));
  }
  // edges: ink lines of constant screen width; tiny tiles fade to the paper
  float lod = smoothstep(2.0, 8.0, tilePx);
  c = mix(c, mix(paper(), INK, 0.25 * tileK), 1.0 - lod);
  c = mix(c, INK, ink(ePx, 1.1 * res.y / 1890.0) * tileK * lod);
  if (bound > 0.0) {
    float db = (bound - length(u)) / upx;
    c = mix(c, INK, ink(abs(db), 1.1 * res.y / 1890.0) * tileK);
  }
  return c;
}

// the regular n-gon P = (n, edges drawn, perpendiculars drawn, vertex alpha): perpendiculars from the
// last roots 2·cos(2πk/n) up to the circle, the vertices, the edges drawn in order around the circle
vec3 polygon(vec3 c, vec2 q, float U, float w, vec4 P, float pa) {
  float n = P.x;
  // nothing to draw, or nothing near: every stroke lies on or inside the circle (radius R), the vertex
  // dots reach 2.4w beyond it — most of the screen skips the ~10 trig calls below
  if (n < 3.0 || (P.w <= 0.0 && pa <= 0.0) || dot(q, q) > (R + 3.0 * w + 2.0) * (R + 3.0 * w + 2.0)) return c;
  vec2 x = q / U;
  float sect = TAU / n;
  float th = mod(atan(q.y, q.x), TAU);
  float kc = floor(acos(clamp(x.x * 0.5, -1.0, 1.0)) / sect + 0.5);
  for (float j = -1.0; j <= 1.0; j += 1.0) {
    float k = kc + j;
    if (k < 1.0 || k > (n - 1.0) * 0.5 || k > P.z + 0.999) continue;
    vec2 vk = 2.0 * vec2(cos(k * sect), sin(k * sect));
    float grow = clamp(P.z - k + 1.0, 0.0, 1.0);
    float dl = segDist(x, vec2(vk.x, -vk.y * grow), vec2(vk.x, vk.y * grow)) * U;
    c = mix(c, byrne(mod(k, 3.0)), pa * ink(dl, 0.6 * w));
  }
  // the vertices and edges lie in the thin ring between the edges' midpoints and the circle
  float rIn = max(R * cos(0.5 * sect) - 3.0 * w - 2.0, 0.0);
  if (dot(q, q) < rIn * rIn) return c;
  float kv = floor(th / sect + 0.5);
  c = mix(c, INK, P.w * ink(length(q - R * vec2(cos(kv * sect), sin(kv * sect))), 2.4 * w));
  float ke = floor(th / sect);
  for (float j = -1.0; j <= 1.0; j += 1.0) {
    float k = mod(ke + j + n, n);
    if (k > P.y) continue;
    vec2 a0 = R * vec2(cos(k * sect), sin(k * sect));
    vec2 a1 = R * vec2(cos((k + 1.0) * sect), sin((k + 1.0) * sect));
    c = mix(c, INK, min(1.0, P.w * 4.0) * ink(segDist(q, a0, mix(a0, a1, clamp(P.y - k, 0.0, 1.0))), w));
  }
  return c;
}

void main() {
  vec2 q0 = gl_FragCoord.xy - 0.5 * res;
  vec2 q = vec2(cos(spin) * q0.x - sin(spin) * q0.y, sin(spin) * q0.x + cos(spin) * q0.y);
  vec3 c = tiling(q);
  if (worldMix > 0.0) c = mix(c, texture(world, gl_FragCoord.xy / res).rgb, worldMix);
  if (mosK > 0.0 && s10on > 0.5) {
    vec2 s01 = gl_FragCoord.xy / res;
    vec3 hdr = s10block(s10coef, ivec2(floor(s01 * vec2(40.0, 25.0))));
    vec3 m = raw > 0.5 ? hdr : s10display(hdr * s10vignette(s01, res.x / res.y));
    c = mix(c, m, mosK);
  }

  // --- the construction (units: R px = 2)
  float U = 0.5 * R;                 // px per unit
  vec2 x = q / U;
  float w = 2.0 * res.y / 1890.0;    // half line width, px (Byrne draws boldly)
  // the x-axis and the n-gon circle (ink), the point (0, 1) (red)
  // drawn, not faded in: the ruler lays the axis out from the centre, the compass sweeps the circle
  float axisOn = step(abs(q.x), base.x * 0.62 * length(res));
  float circOn = step(mod(atan(q.y, q.x), TAU), base.y * TAU);
  c = mix(c, INK, axisOn * ink(abs(q.y), w * 0.8));
  c = mix(c, INK, circOn * ink(abs(length(q) - R), w * (0.8 + 0.8 * ring)));
  c += ring * circOn * hex2p3(C_BYRNE_Y) * 0.35 * exp(-abs(length(q) - R) / (6.0 * w));
  // (the Carlyle circles and their roots are drawn on top by s11-arcs: one instanced ribbon per circle)
  // the regular n-gons: the 17-gon (fading when the 257-gon begins) and the 257-gon
  c = polygon(c, q, U, w, poly17, perp17);
  c = polygon(c, q, U, w, poly, perpA);
  c = mix(c, hex2p3(C_BYRNE_R), base.z * ink(length(x - vec2(0.0, 1.0)) * U, 3.2 * w));
  // the compass point (pen) glows a little
  c += base.w * hex2p3(C_BYRNE_Y) * 0.6 * exp(-length(x - pen) * U / (4.0 * w));
  o = vec4(c, 1.0);
}
