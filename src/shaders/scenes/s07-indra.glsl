// S07 · Indra's Pearls (PLAN §4). One program, three regimes:
//  2D   the limit set of a Maskit group, a(z) = μ + 1/z, b(z) = z + 2 (μ = i·t), seen through a Möbius
//       lens. Every pixel is folded into the fundamental domain (Jos Leys' iteration) while carrying
//       the exact first and second derivatives of the fold, so each disc of the ordinary set is shaded
//       as the exact hemisphere standing on it — a mirror pearl — with analytic edge coverage.
//  3D   Indra's net: twelve mutually tangent mirror pearls (a necklace = the circle of fifths), ray
//       traced analytically with many bounces. Light travels slowly here: every reflection is `delay`
//       seconds late, so a bell note lights its pearl and the mirror channel (ch16, +6 rows) is its
//       first reflection arriving.
//  unroll  the 2D pearl that fills the screen is a mirror ball; its reflection is unrolled into the
//       pinhole view of the 3D world (polar angle 2·asin(r/R) → atan(r/f)).
// Output: linear HDR (P3). The post tonemaps with AgX and blends to exact colours (`exact`) for S08;
// over the first rows S06's last frame dissolves into the pearl (`s06k`).
#include "lib/common"
#include "lib/color"
#include "lib/mobius"
in vec2 uv;
out vec4 o;
uniform vec2 res;

// --- 2D
uniform vec2 kt;            // trace of a: t = kt.x + i·kt.y
uniform vec4 lens0, lens1;  // Möbius view plane w → Maskit plane z
uniform vec4 view;          // w = view.xy · q + view.zw (complex), q in px from the centre
uniform float reveal;       // pearls smaller than this (w-plane radius) are not there yet
uniform vec4 cas[4];        // bell waves: seconds since the note, side (0 all, ∓1 left/right), amplitude
uniform float gdelay;       // seconds per generation of a wave
uniform vec2 pulse;         // e-piano and kick envelopes: the orient shimmers, the room breathes

// --- 3D
uniform float mode;         // 0 = 2D pearls, 1 = 3D camera
uniform float unroll;       // 0 mirror-ball mapping … 1 pinhole
uniform float ballR;        // px
uniform float focal;        // px
uniform vec3 camPos;
uniform mat3 camRot;        // columns right, up, forward (mirrored basis = we are inside the reflection)
uniform vec3 P[12];         // pearl centres (index = position on the circle of fifths, C at the top)
uniform float rp;           // pearl radius
uniform vec2 E[12];         // per pearl: seconds since its bell note, amplitude
uniform float delay;        // seconds of light travel per reflection
uniform int bounces;
uniform vec4 scr;           // the +1: direction of the glowing screen (xyz), its brightness
uniform float room;         // 0 museum … 1 S08's flat grey room

// --- hand-off to S08 (exact colours)
uniform float exact;        // 0 → the scene, 1 → S08's exact linear colours (the post blends AgX → clip alike)
uniform sampler2D s06;      // S06's last frame (HDR, same size)
uniform float s06k;         // how much of it is still on screen
uniform vec3 bg8, disc8;    // linear P3
uniform vec4 lil;           // ring radius, disc radius, sigma (fractions of H), cross alpha
uniform float vis[12];

#define MAXIT 96

float lstep(float a, float b, float x) { return clamp((x - a) / (b - a), 0.0, 1.0); }
float bellEnv(float tau) { return tau < 0.0 ? 0.0 : (1.0 - exp(-tau * 40.0)) * exp(-tau / 1.5); }

// ------------------------------------------------------------------------------------------------
// the room: museum light — an oculus at the zenith, a tall soft window to the upper left, lavender
// air — and the +1: a glowing 16:10 screen on the wall with somebody sitting in front of it
const vec3 WIN = vec3(-0.5735, 0.4588, 0.6786);
vec3 env(vec3 d, float win) {
  vec3 air = hex2p3(C_DECADE);
  float z = d.z;
  vec3 c = air * mix(0.15, 0.34, smoothstep(-0.4, 0.95, z));
  c *= 1.0 - 0.35 * exp(-z * z * 60.0);                                                    // the horizon line
  c *= mix(0.22, 1.0, win);           // seen directly the gallery stays dim; the pearls show it lit
  float ang = acos(clamp(z, -1.0, 1.0));
  c += vec3(1.0, 0.975, 0.95) * 7.0 * smoothstep(0.0, 1.0, lstep(0.165, 0.145, ang)) * lstep(0.6, 0.0, room); // oculus
  c += air * (0.35 + 0.1 * pulse.y) * exp(-ang * ang / 0.10);
  vec3 wu = normalize(cross(WIN, vec3(0.0, 0.0, 1.0))), wv = cross(wu, WIN);
  float cw = dot(d, WIN);
  if (cw > 0.2 && win > 0.0) {   // the window is only ever seen in the pearls
    vec2 g = vec2(dot(d, wu), dot(d, wv)) / cw;
    vec2 hb = abs(g) - vec2(0.22, 0.42);
    float rr = length(max(hb, 0.0)) + min(max(hb.x, hb.y), 0.0) - 0.05;
    c += vec3(0.92, 0.95, 1.0) * 1.6 * win * smoothstep(0.0, 1.0, lstep(0.06, -0.06, rr));
  }
  c += air * 0.06 * lstep(0.05, -0.5, z);                                                 // pale floor
  vec3 s0 = scr.xyz;
  float cs = dot(d, s0);
  if (cs > 0.85) {
    vec3 u = normalize(cross(s0, vec3(0.0, 0.0, 1.0))), v = cross(u, s0);
    vec2 g = vec2(dot(d, u), dot(d, v)) / cs;                    // gnomonic: the screen is flat
    vec2 hb = abs(g) - vec2(0.16, 0.10);
    float rect = length(max(hb, 0.0)) + min(max(hb.x, hb.y), 0.0);
    float head = length(g - vec2(0.0, -0.012)) - 0.030;
    float neck = length(max(abs(g - vec2(0.0, -0.05)) - vec2(0.012, 0.03), 0.0));
    float body = length((g - vec2(0.0, -0.125)) / vec2(1.0, 0.62)) - 0.075;
    float sil = min(min(head, neck), body);
    vec3 glow = vec3(0.80, 0.90, 1.0) * scr.w;
    c += glow * lstep(0.004, -0.004, rect) * lstep(-0.003, 0.003, sil);
    c += glow * 0.04 * exp(-max(rect, 0.0) * 30.0) * lstep(-0.01, 0.01, sil);   // its light on the wall
  }
  return mix(c, bg8, room);
}

// a mirror pearl: Schlick reflectance over a high F0, a nacre body lit by the room, a thin-film orient
const float F0 = 0.78;
vec3 pearlSpec(float ci, float k) {
  vec3 tint = mix(vec3(1.0), hex2p3(C_BEADED) / 0.83, 0.38);
  vec3 irid = 1.0 + (0.08 + 0.12 * pulse.x) * cos(TAU * (vec3(0.0, 0.33, 0.67) + 1.6 * (1.0 - ci) + k));
  return tint * irid * (F0 + (1.0 - F0) * pow(1.0 - ci, 5.0));
}
vec3 pearlBody(vec3 n, float ci) {
  vec3 alb = mix(vec3(0.9), hex2p3(C_BEADED), 0.65);
  float fr = F0 + (1.0 - F0) * pow(1.0 - ci, 5.0);
  float lit = 0.6 * max(dot(n, WIN), 0.0) + 0.25 * (0.5 + 0.5 * n.z);
  // the lustre at the rim (S06's pearl handed it over): a soft lilac glow, strongest towards the window
  vec3 rim = mix(hex2p3(C_BEADED), vec3(1.0, 0.9, 0.97), 0.4) * 0.45 * pow(1.0 - ci, 4.0) * (0.35 + 0.65 * max(dot(n, WIN), 0.0));
  return ((1.0 - fr) * alb * mix(lit, 0.6, room) + rim * (1.0 - room));
}
vec3 glowCol() { return mix(vec3(1.0, 0.96, 0.98), hex2p3(C_BEADED), 0.35); }

// ------------------------------------------------------------------------------------------------
// Indra's net: analytic ray tracing of the necklace with delayed light
// win0: how visible the window is to the first ray (0 for the camera, 1 for a reflected ray)
vec3 trace(vec3 ro, vec3 rd, int nb, float win0) {
  vec3 acc = vec3(0.0), thr = vec3(1.0);
  int last = -1;
  for (int b = 0; b < 16; b++) {
    float tm = 1e9;
    int hk = -1;
    for (int k = 0; k < 12; k++) {
      if (k == last) continue;
      vec3 oc = ro - P[k];
      float bb = dot(oc, rd);
      float h = bb * bb - dot(oc, oc) + rp * rp;
      if (h > 0.0 && bb < 0.0) {
        float tt = -bb - sqrt(h);
        if (tt > 0.0 && tt < tm) { tm = tt; hk = k; }
      }
    }
    if (hk < 0 || b >= nb) { acc += thr * env(rd, b == 0 ? win0 : 1.0); break; }
    vec3 p = ro + rd * tm;
    vec3 n = (p - P[hk]) / rp;
    float ci = clamp(-dot(rd, n), 0.0, 1.0);
    // the pearl's own light (its bell note), arriving `delay` later with every reflection
    float em = E[hk].y * bellEnv(E[hk].x - float(b) * delay);
    acc += thr * (glowCol() * em * (0.25 + 0.75 * ci * ci) * 1.4 + pearlBody(n, ci));
    thr *= pearlSpec(ci, 0.15 * float(hk));
    ro = p;
    rd = reflect(rd, n);
    last = hk;
    if (max(thr.r, max(thr.g, thr.b)) < 0.01) break;
  }
  return acc;
}

// ------------------------------------------------------------------------------------------------
// the 2D limit set
vec3 pearls(vec2 q) {
  // view → lens → Maskit plane, carrying the 2-jet
  vec2 w = cmul(view.xy, q) + view.zw;
  vec2 den = cmul(lens1.xy, w) + lens1.zw;
  vec2 det = cmul(lens0.xy, lens1.zw) - cmul(lens0.zw, lens1.xy);
  vec2 iden = cinv(den);
  vec2 i2 = cmul(iden, iden);
  Germ g;
  g.z = cmul(cmul(lens0.xy, w) + lens0.zw, iden);
  g.d1 = cmul(cmul(det, i2), view.xy);
  g.d2 = cmul(-2.0 * cmul(cmul(lens1.xy, det), cmul(i2, iden)), cmul(view.xy, view.xy));

  // Jos Leys: translate into the (sheared) strip, half-turn above the separation curve, apply a;
  // stop when the orbit closes into a 2-cycle (= the point has reached the fundamental domain)
  float a = kt.x, b = kt.y;
  vec2 mu = vec2(-b, a);
  float sk = b / a, sepA = sign(b) * (2.0 * a - 1.95) * 0.25, sepK = 7.2 - (1.95 - a) * 15.0;
  vec2 lz = g.z + vec2(1.0, 0.0), llz = g.z - vec2(1.0, 0.0);
  float n = 0.0;
  bool conv = false;
  for (int i = 0; i < MAXIT; i++) {
    g.z.x -= 2.0 * floor((g.z.x + sk * g.z.y + 1.0) * 0.5);
    float xh = g.z.x + 0.5 * b;
    if (g.z.y >= 0.5 * a + sepA * sign(xh) * (1.0 - exp(-sepK * abs(xh)))) {
      g = germNeg(g);
      g.z += mu;
    }
    g = germInv(g);
    g.z += mu;
    n += 1.0;
    vec2 dd = g.z - llz;
    if (dot(dd, dd) < 1e-7) { conv = true; break; }
    llz = lz;
    lz = g.z;
  }

  vec3 velvet = hex2p3(C_BEADED) * 0.004;
  // the invariant component (and points that did not settle): velvet
  if (!conv || g.z.y <= a) return velvet;

  // a pearl: the exact dome over its disc (all pearls are images of the half-plane Im z > a)
  vec3 dm = domeOf(g, a);
  float s = dm.x;
  vec2 gs = dm.yz;
  float gg = dot(gs, gs);
  if (gg >= 1.0) return velvet;                                   // the outside of a disc (∞ side)
  float edge = 2.0 * s / (1.0 + sqrt(gg));                        // px to the rim
  float R = 2.0 * s / (1.0 - gg);                                 // radius, px
  vec3 nrm = vec3(-gs, sqrt(1.0 - gg));

  // reflection of the room (and of the net hanging above it) in the pearl, seen from straight above
  vec3 rd = vec3(2.0 * nrm.z * nrm.xy, 2.0 * nrm.z * nrm.z - 1.0);
  vec3 refl = R > 6.0 ? trace(vec3(0.0), rd, R > 600.0 ? bounces : R > 60.0 ? 4 : 2, 1.0) : env(rd, 1.0);
  float ci = nrm.z;
  vec3 c = refl * pearlSpec(ci, 0.37 * n) + pearlBody(nrm, ci);

  // bell waves: light runs down the generations (the mirror channel: on its side of the screen only)
  vec2 cen = q + R * gs;
  float glow = 0.0;
  for (int i = 0; i < 4; i++) {
    float side = cas[i].y == 0.0 ? 1.0 : smoothstep(-0.1, 0.3, cas[i].y * cen.x / res.y);
    float tau = cas[i].x - max(n - 3.0, 0.0) * gdelay;
    glow += cas[i].z * side * (tau < 0.0 ? 0.0 : (1.0 - exp(-tau * 30.0)) * (exp(-tau / 0.3) + 0.15 * exp(-tau / 2.5)));
  }
  c += glowCol() * glow * (0.25 + 0.75 * ci) * 1.5;

  // pearls appear from the largest down; sub-pixel pearls fade to their mean
  float Rw = R * length(view.xy);
  float shown = smoothstep(0.6 * reveal, reveal, Rw);
  vec3 mean = hex2p3(C_BEADED) * 0.02 + glowCol() * glow * 0.5;
  c = mix(mean, c, smoothstep(0.7, 2.5, R));
  return mix(velvet, c, clamp(edge + 0.5, 0.0, 1.0) * shown);
}

// ------------------------------------------------------------------------------------------------
vec3 worldRay(vec2 q) {
  float r = length(q);
  vec2 dq = r > 0.0 ? q / r : vec2(0.0);
  float thB = 2.0 * asin(min(r / ballR, 1.0));
  float thP = atan(r / focal);
  float th = mix(thB, thP, unroll);
  return camRot * vec3(sin(th) * dq, cos(th));
}
vec3 worldSample(vec2 q) {
  vec3 c = trace(camPos, worldRay(q), bounces, 1.0 - unroll);
  if (unroll < 1.0) {
    // still the surface of the 2D pearl we dived into: its nacre and tint fade as the reflection unrolls
    float rr = min(length(q) / ballR, 1.0);
    vec3 nb = vec3(rr * normalize(q + 1e-6), sqrt(1.0 - rr * rr));
    c = mix(c * pearlSpec(nb.z, 0.37 * 3.0) + pearlBody(nb, nb.z), c, unroll);
  }
  return c;
}
vec3 world(vec2 q) {
  // pixels that see a pearl (or pass within two pixels of one) are supersampled 4× on a rotated grid:
  // silhouettes and the ever smaller reflections inside the mirrors would alias otherwise
  vec3 rd = worldRay(q);
  float pa = 2.5 / mix(ballR * 0.5, focal, unroll);           // ≈ two pixels, in radians
  bool edge = false;
  for (int k = 0; k < 12; k++) {
    vec3 oc = camPos - P[k];
    float b = dot(oc, rd);
    if (b < 0.0 && dot(oc, oc) - b * b < (rp - b * pa) * (rp - b * pa)) edge = true;
  }
  if (!edge) return worldSample(q);
  return 0.25 * (worldSample(q + vec2(0.125, 0.375)) + worldSample(q + vec2(-0.375, 0.125)) +
                 worldSample(q + vec2(-0.125, -0.375)) + worldSample(q + vec2(0.375, -0.125)));
}

// disc ⊗ gaussian, radial profile (close to S08's exact Marcum-Q profile for R ≳ 2σ)
float blurDisc(float r, float R, float s) {
  float x = (r - R) / (s * 1.41421356);
  float x2 = x * x;
  float erfx = sign(x) * sqrt(1.0 - exp(-x2 * (1.2732395 + 0.147 * x2) / (1.0 + 0.147 * x2)));
  return 0.5 - 0.5 * erfx;
}

void main() {
  vec2 q = gl_FragCoord.xy - 0.5 * res;
  vec3 col;
  if (mode < 0.5) col = pearls(q);
  else col = world(q);
  // the look (AgX, like the default post), applied here so the scene can end on exact colours
  if (s06k > 0.0) col = mix(col, texelFetch(s06, ivec2(gl_FragCoord.xy), 0).rgb, s06k);
  vec3 tm = col;
  if (exact > 0.0) {
    vec2 h = q / res.y;
    float a = 0.0;
    for (int j = 0; j < 12; j++) {
      if (vis[j] <= 0.0) continue;
      float th = 0.5 * PI - float(j) * TAU / 12.0;
      a += vis[j] * blurDisc(length(h - lil.x * vec2(cos(th), sin(th))), lil.y, lil.z);
    }
    vec3 ex = mix(bg8, disc8, clamp(a, 0.0, 1.0));
    vec2 aq = abs(h);
    vec2 d1 = aq - vec2(0.011, 0.00105), d2 = aq - vec2(0.00105, 0.011);
    float dc = min(length(max(d1, 0.0)) + min(max(d1.x, d1.y), 0.0), length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0));
    ex = mix(ex, vec3(0.0), lil.w * clamp(0.5 - dc * res.y, 0.0, 1.0));
    tm = mix(tm, ex, exact);
  }
  o = vec4(tm, 1.0);
}
