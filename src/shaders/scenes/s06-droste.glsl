// S06 · Escher Gallery: a conformal Droste spiral after "Print Gallery" (de Smit & Lenstra).
// The straight picture D is self-similar under z → z/256 (2⁸, like Escher's): the gallery wall
// (G) holds the tunnel memory (T, a log-polar band) whose far end opens onto the city (C), whose
// window shows the gallery again. Escher's twist is the complex power z^α with
// α = (2πi + log 256) / 2πi: going once round the centre in the picture is going once round AND
// 256× deeper in D. Zooming is a shift in log space. While α ramps from 1 to Escher's value the
// branch cut is blended around the whole circle (two evaluations), so no seam ever shows.
// At the end the plane is wrapped onto the Riemann sphere (inverse stereographic projection):
// the spiral's two fixed points become the poles — a loxodrome on a pearl.
#include "lib/common"
#include "lib/color"
#include "scenes/s04-common"
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform sampler2D gTex;    // gallery level: x ∈ [-1.6, 1.6], y ∈ [-1, 1]; alpha 0 = the tunnel screen
uniform sampler2D cTex;    // city level: x ∈ [-4/3, 4/3], y ∈ [-1, 1]; alpha 0 = its window
uniform float logF;        // zoom: log of the magnification into G
uniform float twist;       // 0 straight Droste → 1 Escher
uniform float depth;       // the tunnel memory's own flight
uniform float vgaK;        // 1: the first screen still shows its VGA pixels
uniform float screenGain;
uniform float pearl;       // 0 flat → 1 the plane lives on a sphere
uniform float camD;        // camera distance from the sphere's centre (radius 1)
uniform float stScale;     // stereographic coordinate → picture coordinate
uniform float imageK;      // how much of the picture still glows in the pearl
uniform float t;

#define LOGS 5.545177444479562  // log 256
#define GX 1.6
#define SCR vec2(0.333333, 0.25) // the tunnel screen in G
#define RHO 0.03                 // far end of the tunnel band
#define KC 32.0                  // G → C coordinates
#define WIN vec2(0.17, 0.106)    // the city's gallery window (C coordinates), see s06-city

// 1 outside the rectangle of half size hs, 0 inside, antialiased over px
float outside(vec2 z, vec2 hs, float px) {
  vec2 d = abs(z) - hs;
  return smoothstep(-px, px, max(d.x, d.y));
}

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }
vec2 cexp(vec2 w) { return exp(w.x) * vec2(cos(w.y), sin(w.y)); }

vec4 sampleG(vec2 z, vec2 dx, vec2 dy) {
  vec2 k = 1.0 / vec2(2.0 * GX, 2.0);
  return textureGrad(gTex, z * k + 0.5, dx * k, dy * k);
}
vec4 sampleC(vec2 z, vec2 dx, vec2 dy) {
  vec2 k = 1.0 / vec2(8.0 / 3.0, 2.0);
  return textureGrad(cTex, z * k + 0.5, dx * k, dy * k);
}

// the tunnel band: the memory on the screen, flown through. cyc 0 = the first screen (VGA pixels).
vec4 tunnelBand(vec2 z, float px, bool first) {
  vec2 a = abs(z);
  if (a.x > SCR.x || a.y > SCR.y) return vec4(0.0);
  float k = first ? vgaK : 0.0;
  // the VGA grid of the memory tile (320×200 over the screen)
  vec2 cell = SCR * 2.0 / vec2(320.0, 200.0);
  vec2 zq = mix(z, (floor(z / cell) + 0.5) * cell, k);
  float r = length(zq);
  float u = atan(zq.y, zq.x) / TAU;
  float v = -log(max(r, 1e-6)) * 0.45 * 4.0 / 3.0 + depth; // same texture density as the atlas tunnel
  vec3 c = tunnelTex(u, v);
  c = mix(c, vga(c), k);
  // walls dim with depth, then the far end glows: the city is there
  float lr = log(r / RHO) / log(SCR.y / RHO); // 1 at the screen, 0 at the far end
  c *= mix(0.25, 1.0, smoothstep(0.0, 0.7, lr));
  c += hex2p3(C_FACADE) * 1.2 * exp(-lr * 9.0);
  c = hex2p3(c) * screenGain;
  if (first) {
    vec2 tc = (z / (SCR * 2.0) + 0.5) * vec2(320.0, 200.0);
    float fw = px / cell.y;
    c *= mix(1.0, mix(0.74 + 0.26 * cos(TAU * tc.y), 0.87, smoothstep(0.2, 0.55, fw)), k);
    vec2 cq = z / SCR;
    c *= 1.0 - 0.3 * k * dot(cq * cq, cq * cq);
  }
  float alpha = smoothstep(RHO * (1.0 - 2.0 * px / RHO), RHO, r);
  return vec4(c, alpha);
}

// the straight Droste picture D at z (already reduced to rect-norm ∈ (1/256, 1]); J = dz/dpixel
vec3 drosteD(vec2 z, vec2 dx, vec2 dy, bool first) {
  float px = max(length(dx), length(dy));
  vec3 col = vec3(0.0);
  float tr = 1.0;
  // the holes are known rectangles: their alpha is computed, not filtered from the textures
  float ga = outside(z, SCR, px);
  col += sampleG(z, dx, dy).rgb * ga;
  tr *= 1.0 - ga;
  if (tr > 0.002) {
    vec4 b = tunnelBand(z, px, first);
    col += tr * b.rgb * b.a;
    tr *= 1.0 - b.a;
  }
  if (tr > 0.002) {
    float ca = outside(z * KC, WIN, px * KC);
    col += tr * sampleC(z * KC, dx * KC, dy * KC).rgb * ca;
    tr *= 1.0 - ca;
  }
  if (tr > 0.002) col += tr * sampleG(z * 256.0, dx * 256.0, dy * 256.0).rgb;
  return col;
}

// Escher's picture at view point zv: L = log zv on a chosen branch
vec3 escher(vec2 L, vec2 alpha, vec2 dzv) {
  vec2 w = cmul(alpha, L) - vec2(logF, 0.0);
  // reduce into the base annulus by the rectangle norm of G
  float th = w.y;
  float ln = w.x + log(max(abs(cos(th)) / GX, abs(sin(th))));
  float k = ceil(ln / LOGS);
  w.x -= k * LOGS;
  vec2 z = cexp(w);
  // pixel footprint: dz = α z / zv · dzv
  vec2 J = cmul(alpha, cdiv(z, cexp(L)));
  vec2 dx = cmul(J, vec2(dzv.x, 0.0)), dy = cmul(J, vec2(0.0, dzv.y));
  bool first = k == 0.0; // the cycle we started in: its screen still shows VGA pixels
  return drosteD(z, dx, dy, first);
}

vec3 picture(vec2 zv, vec2 dzv) {
  vec2 alpha = vec2(1.0, -twist * LOGS / TAU);
  float r = max(length(zv), 1e-7);
  float th = atan(zv.y, zv.x);
  vec2 L = vec2(log(r), th);
  vec3 a = escher(L, alpha, dzv);
  if (twist > 0.001 && twist < 0.999) {
    // the branch cut, blended all the way round
    vec3 b = escher(L - vec2(0.0, TAU), alpha, dzv);
    a = mix(a, b, smoothstep(-PI, PI, th));
  }
  return a;
}

void main() {
  vec2 ndc = uv * 2.0 - 1.0;
  float aspect = res.x / res.y;
  vec2 zv = vec2(ndc.x * aspect, ndc.y);
  float pxv = 2.0 / res.y;
  if (pearl <= 0.0) {
    o = vec4(picture(zv, vec2(pxv)), 1.0);
    return;
  }
  // the pearl: a unit sphere, camera on -z looking at its south pole
  float tanH = 0.45;
  vec3 ro = vec3(0.0, 0.0, -camD);
  vec3 rd = normalize(vec3(zv * tanH, 1.0));
  float b = dot(ro, rd), c = dot(ro, ro) - 1.0, disc = b * b - c;
  // continue the picture analytically outside the silhouette so derivatives stay sane
  float tt = disc > 0.0 ? -b - sqrt(disc) : -b;
  vec3 p = ro + rd * tt;
  vec3 n = normalize(p);
  vec2 zs = n.xy / max(1.0 - n.z, 1e-4) * stScale;
  vec2 dzx = dFdx(zs), dzy = dFdy(zs);
  vec3 bg = hex2p3(C_BEADED) * 0.02 * exp(-length(zv) * 1.5);
  if (disc <= 0.0) {
    // dark lilac air with a halo around the pearl
    float h = sqrt(max(dot(ro, ro) - b * b, 0.0)); // distance of the ray from the centre
    o = vec4(bg + hex2p3(C_BEADED) * 0.25 * exp(-(h - 1.0) * 6.0) * (1.0 - smoothstep(0.0, 1.0, pearl - 1.0)), 1.0);
    return;
  }
  vec3 img = picture(zs, vec2(max(length(dzx), length(dzy))));
  vec3 v = -rd;
  float nv = sat(dot(n, v));
  vec3 L = normalize(vec3(-0.6, 0.7, -0.5));
  vec3 r = reflect(-v, n);
  // nacre: a lavender body, the orient (thin-film overtones towards the rim), a softbox highlight
  // like the one S07's first pearl carries, a lilac sky below in reflection
  vec3 body = hex2p3(C_BEADED) * (0.06 + 0.32 * max(dot(n, L), 0.0) + 0.05 * (0.5 + 0.5 * n.y));
  vec3 orient = pal(nv * 1.6 + 0.15, vec3(0.5), vec3(0.3), vec3(1.0), vec3(0.0, 0.33, 0.67)) * 0.08 * (1.0 - nv);
  vec3 ax = normalize(cross(L, vec3(0.0, 1.0, 0.0))), ay = cross(ax, L);
  vec2 q = vec2(dot(r, ax), dot(r, ay)) / max(dot(r, L), 1e-3);
  float box = (1.0 - smoothstep(0.18, 0.3, abs(q.x))) * (1.0 - smoothstep(0.26, 0.4, abs(q.y))) * step(0.0, dot(r, L));
  float sheen = pow(max(dot(r, L), 0.0), 6.0) * 0.12;
  float fres = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
  vec3 env = mix(hex2p3(C_BEADED) * 0.03, hex2p3(C_DECADE) * 0.18, sat(r.y * 0.5 + 0.5));
  vec3 nacre = body + orient + (box * 1.6 + sheen) * vec3(1.0, 0.97, 1.0) * (0.3 + 0.7 * fres + 0.25) + env * fres;
  float shell = smoothstep(0.0, 1.0, pearl);
  vec3 col = mix(img, nacre + img * imageK * (0.25 + 0.5 * nv), shell);
  o = vec4(col, 1.0);
}
