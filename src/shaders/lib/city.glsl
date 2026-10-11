// The city of facades (S03 · S05 · S10). PLAN §4: an endless city built on domain repetition whose
// only non-repeating thing is the floor — a Penrose tiling (the creature's trace).
//
// Every building is a FLAT: a carved sheet of zero thickness, all of them facing -z, standing on a
// grid of cells (CPX × CPZ). Seen from the front it is a city; seen edge-on (S05) it is nothing.
// Tracing is hybrid: a 2D DDA walks the cells, each flat is an AABB test, and only rays that enter a
// flat's thin relief slab sphere-trace the ornament SDF (KIFS) — so the expensive part runs only where
// there is stone. Sun shadows and light shafts walk the rows analytically (flats are planes).
//
// The including scene must define, after including this file:
//   void cityOverride(vec2 cell, inout Fac F)   — avenues, gates, signs (may be empty)
// and set the uniforms below (src/gfx/city.ts: setCityUniforms).
#include "lib/common"
#include "lib/color"

#define CPX 7.0      // cell period, x
#define CPZ 6.0      // cell period, z
#define RELIEF 0.28  // relief depth in front of the wall plane (towards -z)
#define SHEET 0.022  // the sheet behind it
#define HMAX 15.8    // top of the tallest flat incl. roof ornaments

uniform vec3 uSunDir;     // unit, towards the sun
uniform vec3 uSunCol;     // sun radiance
uniform vec3 uSkyHor;     // sky at the horizon
uniform vec3 uSkyZen;     // sky at the zenith
uniform vec3 uFogCol;     // ambient in-scatter colour of the haze
uniform vec4 uFog;        // x density at y = 0, y height falloff, z sun in-scatter gain, w HG anisotropy
uniform vec3 uGround;     // floor bounce colour (lights the facades from below)
uniform float uAmb;       // sky-light scale (1 = the sky as it is)
uniform vec3 uPal[3];     // floor: thick rhomb, thin rhomb, grout · (unused)
uniform vec3 uStucco[4];  // stucco colours of the flats
uniform vec3 uTrim;       // stone of the trims
uniform vec3 uNeon;       // neon colour (radiance)
uniform vec3 uWinCol;     // lit-window colour (radiance)
uniform vec4 uWin;        // x lit fraction, y kick flash env, z kick count, w flash fraction
uniform float uTime;
uniform vec4 uFloor;      // xy Penrose origin (the 5-fold centre), z tile edge, w the creature's trace
uniform float uFloorLevels; // Robinson subdivisions of the floor (0 = 13); the tiled disc grows ×φ per level
uniform vec4 uCloud;      // x amount, y scale, z drift, w brightness (cirrus in the sky)
uniform sampler2D uText;  // sign atlas: r = signed distance (line heights, 0.5 = edge), g = letter index
uniform vec4 uTextLine[4];// per atlas line: v0, v1 (texture v), u1 (texture u of the line end), aspect
uniform vec4 uSign[4];    // per sign: cell.x, cell.y, atlas line + 1 (0 = off), letter height (world)
uniform float uSignY[4];  // per sign: centre height
uniform vec4 uSignLit[4]; // per sign: x characters lit, y level, z first igniting character, w ignition phase

struct Fac {
  float on;
  vec2 cell;
  float cx, cz;     // centre x, wall plane z
  float hw, h;      // half width, wall height (top of the cornice)
  float n, sh;      // storeys, storey height
  float bay, nb;    // bay width, number of bays
  float roof;       // 0 balustrade, 1 pediment, 2 attic
  float win;        // 0 rectangular, 1 arched, 2 tall arched
  float pil;        // 1 = pilasters
  float seed;
  float hollow;     // 1 = no glass: the windows are holes
  float gate;       // 1 = a central arch opening (a gate) through the flat
  float sign;       // sign index + 1 (0 = none)
};

void cityOverride(vec2 cell, inout Fac F);

float sdBox2(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
float sdBox3(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * sat(dot(pa, ba) / dot(ba, ba))); }
// 2D shape extruded over z ∈ [z0 - h, z0], i.e. standing out of a wall towards -z
float relief(float d2, float z, float z0, float h) {
  vec2 w = vec2(d2, abs(z - z0 + 0.5 * h) - 0.5 * h);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
}

float roofH(Fac F) { return F.roof < 0.5 ? 0.62 : F.roof < 1.5 ? 1.15 : 1.05; }

Fac facadeAt(vec2 cell) {
  Fac F;
  uint a = hashu(uvec2(ivec2(cell) + 8192));
  uint b = pcg(a + 0x9E3779B9u);
  float r0 = float(a & 255u) / 255.0, r1 = float((a >> 8) & 255u) / 255.0;
  float r2 = float((a >> 16) & 255u) / 255.0, r3 = float(a >> 24) / 255.0;
  float r4 = float(b & 255u) / 255.0, r5 = float((b >> 8) & 255u) / 255.0;
  float r6 = float((b >> 16) & 255u) / 255.0, r7 = float(b >> 24) / 255.0;
  F.cell = cell;
  F.on = step(0.08, r0);
  F.hw = mix(0.29, 0.45, r1) * CPX;
  F.cx = (cell.x + 0.5) * CPX + (r2 - 0.5) * 2.0 * max(0.5 * CPX - F.hw - 0.2, 0.0);
  F.cz = (cell.y + 0.5) * CPZ + (r3 - 0.5) * 0.26 * CPZ;
  F.n = 3.0 + floor(pow(r4, 1.3) * 10.0);
  F.sh = mix(0.95, 1.12, r5);
  F.nb = max(2.0, floor(2.0 * F.hw / mix(1.05, 1.45, r6) + 0.5));
  F.bay = 2.0 * F.hw / F.nb;
  F.roof = floor(r7 * 2.999);
  F.win = floor(fract(r7 * 7.31) * 2.999);
  F.pil = step(0.45, fract(r6 * 5.7));
  F.seed = fract(r5 * 13.1 + r1);
  F.hollow = step(0.9, fract(r4 * 11.3));
  F.gate = 0.0;
  F.sign = 0.0;
  for (int k = 0; k < 4; k++)
    if (uSign[k].z > 0.5 && all(equal(cell, uSign[k].xy))) F.sign = float(k) + 1.0;
  cityOverride(cell, F);
  F.h = F.n * F.sh + 1.05;
  return F;
}

// ---------------------------------------------------------------------------------------------
// Ornament: a KIFS fold (abs-fold, rotate, scale) of a ring — scrolls and rosettes. q ∈ [-1, 1]².
float kifsOrn(vec2 q, float s) {
  float sc = 1.0;
  mat2 R = rot(0.55 + 0.5 * s);
  for (int i = 0; i < 3; i++) {
    q = abs(q) - vec2(0.42, 0.18 + 0.1 * s);
    q = R * q;
    q.x = abs(q.x);
    q *= 1.65;
    sc *= 1.65;
  }
  return (abs(length(q - vec2(0.3, 0.0)) - 0.42) - 0.11) / sc;
}

// sign text lookup: p in sign space (letter-height units, centred) → (distance in letter heights, letter)
vec2 signText(vec2 p, float line) {
  vec4 L = uTextLine[int(line)];
  float w = L.w; // aspect (width / height)
  // outside the line's band: distance to the band (glyphs never touch its edges)
  vec2 out2 = max(abs(p) - vec2(0.5 * w, 0.5), 0.0);
  if (max(out2.x, out2.y) > 0.0) return vec2(length(out2) + 0.06, 0.0);
  // flats face -z: seen from the front, local +x runs right-to-left
  vec2 uv = vec2((-p.x / w + 0.5) * L.z, mix(L.y, L.x, p.y + 0.5));
  vec2 s = texture(uText, uv).rg;
  return vec2((s.r - 0.5) * 0.5, floor(s.g * 255.0 + 0.5));
}

// signed distance to a flat, local coords (x from the centre, y up from the floor, z from the wall
// plane, relief towards -z). lod: 0 full detail … 1 masses only. mat: 0 wall 1 trim 2 glass 3 ornament 4 neon
float facadeDE(vec3 p, Fac F, float lod, out float mat) {
  float hw = F.hw, h = F.h, sh = F.sh;
  float top = F.n * sh;                       // top of the window storeys; frieze + cornice above
  mat = 0.0;
  // the sheet
  float d = sdBox3(vec3(p.x, p.y - 0.5 * h, p.z - 0.5 * SHEET), vec3(hw, 0.5 * h, 0.5 * SHEET));
  float dt = 1e9; // trim
  float dg = 1e9; // glass
  float dor = 1e9; // ornament

  // the gate: a monumental arch through the flat
  float dGate = 1e9;
  if (F.gate > 0.5) {
    float ga = 1.55, gh = 5.2;
    vec2 q = vec2(p.x, p.y);
    float rect = sdBox2(q - vec2(0.0, 0.5 * (gh - ga)), vec2(ga, 0.5 * (gh - ga)));
    float circ = length(q - vec2(0.0, gh - ga)) - ga;
    dGate = min(rect, circ);
    // archivolt + rusticated piers
    float ring = abs(dGate - 0.22) - 0.22;
    dt = min(dt, relief(ring, p.z, 0.0, 0.16));
    float key = sdBox2(q - vec2(0.0, gh + 0.12), vec2(0.2, 0.3));
    dt = min(dt, relief(key, p.z, 0.0, 0.2));
  }
  // sign: a raised stone tablet with the letters cut into it; the letter floors are the neon
  float signK = F.sign - 1.0;
  float dn = 1e9;
  vec2 sbox = vec2(0.0);
  float sy = 0.0, shh = 0.0, sline = 0.0;
  if (signK > -0.5) {
    vec4 S = uSign[int(signK)];
    sline = S.z - 1.0;
    shh = S.w;
    sy = uSignY[int(signK)];
    sbox = vec2(0.5 * shh * uTextLine[int(sline)].w + 0.2, 0.5 * shh + 0.22);
    float tab = sdBox2(vec2(p.x, p.y - sy), sbox);
    float dTab = relief(tab, p.z, 0.0, 0.1);
    if (dTab < 0.25) {
      float glyph = signText(vec2(p.x, p.y - sy) / shh, sline).x * shh;
      // letters cut 0.07 deep into the tablet face (z = -0.1 … -0.03)
      dTab = max(dTab, -max(glyph, abs(p.z + 0.065) - 0.035));
      if (glyph < 0.0) { dn = dTab; dTab = 1e9; }
    }
    dt = min(dt, dTab);
  }

  // windows: bays × storeys (ground storey taller openings)
  float bx = p.x + hw;
  float bi = clamp(floor(bx / F.bay), 0.0, F.nb - 1.0);
  float lx = bx - (bi + 0.5) * F.bay;
  float si = clamp(floor(p.y / sh), 0.0, F.n - 1.0);
  float ly = p.y - si * sh;
  bool inWinZone = p.y < top && p.y > 0.0;
  bool blocked = (F.gate > 0.5 && abs(p.x) < 2.6 && p.y < 6.4) ||
                 (signK > -0.5 && abs(p.x) < sbox.x + 0.5 && abs(p.y - sy) < sbox.y + 0.55);
  float ww = F.bay * 0.24, wh = sh * (F.win > 1.5 ? 0.33 : 0.29), wy = sh * 0.52;
  if (si < 0.5) { wh = sh * 0.3; wy = sh * 0.64; }
  vec2 wq = vec2(lx, ly - wy);
  float dOpen = sdBox2(wq, vec2(ww, wh));
  if (F.win > 0.5) // arched head: the top `ww` of the opening is a half circle
    dOpen = min(sdBox2(wq + vec2(0.0, 0.5 * ww), vec2(ww, wh - 0.5 * ww)), length(wq - vec2(0.0, wh - ww)) - ww);
  if (!inWinZone || blocked) dOpen = 1e9;
  // cut the openings (and the gate) out of the sheet
  d = max(d, -min(dOpen, dGate));
  if (dOpen < 0.6) {
    // architrave around the opening, sill, hood
    float fr = abs(dOpen - 0.055) - 0.055;
    dt = min(dt, relief(fr, p.z, 0.0, 0.055));
    float sill = sdBox2(wq + vec2(0.0, wh + 0.07), vec2(ww + 0.1, 0.035));
    dt = min(dt, relief(sill, p.z, 0.0, 0.1));
    float hood = sdBox2(wq - vec2(0.0, wh + 0.16), vec2(ww + 0.14, 0.04));
    dt = min(dt, relief(hood, p.z, 0.0, 0.12));
    if (F.hollow < 0.5) {
      // glass, set back slightly, with a mullion and a transom
      dg = max(dOpen, abs(p.z - 0.008) - 0.004);
      if (lod < 0.5) {
        float mull = min(abs(wq.x) - 0.018, abs(wq.y - wh * 0.35) - 0.018);
        dt = min(dt, max(max(mull, dOpen), abs(p.z) - 0.02));
      }
    }
    // carved apron under the window
    if (lod < 0.5) {
      vec2 aq = vec2(lx / (ww + 0.05), (ly - (wy - wh - 0.2)) / 0.13);
      if (abs(aq.y) < 1.5) {
        float o = kifsOrn(aq, F.seed) * min(ww + 0.05, 0.13);
        o = max(o, sdBox2(aq * vec2(ww + 0.05, 0.13), vec2(ww + 0.02, 0.11)));
        dor = min(dor, relief(o, p.z, 0.0, 0.035));
      }
    }
  }
  // pilasters at the bay edges
  if (F.pil > 0.5 && p.y < top) {
    float pq = 0.5 * F.bay - abs(lx);
    dt = min(dt, relief(sdBox2(vec2(pq, p.y - 0.5 * top), vec2(0.075, 0.5 * top)), p.z, 0.0, 0.07));
  }
  // string courses between storeys, the plinth
  float yc = p.y - clamp(floor(p.y / sh + 0.5), 1.0, F.n) * sh;
  dt = min(dt, relief(sdBox2(vec2(p.x, yc), vec2(hw, 0.035)), p.z, 0.0, 0.06));
  dt = min(dt, relief(sdBox2(vec2(p.x, p.y - 0.15), vec2(hw, 0.15)), p.z, 0.0, 0.07));
  // frieze (carved band) and the crowning cornice
  float fy = top + 0.42;
  if (lod < 0.5 && abs(p.y - fy) < 0.4 && !(signK > -0.5 && abs(p.y - sy) < sbox.y + 0.2 && abs(p.x) < sbox.x + 0.3)) {
    float cw = 0.58;
    vec2 fq = vec2((fract(p.x / cw + 0.5) - 0.5) * 2.0, (p.y - fy) / (0.5 * cw));
    float o = kifsOrn(fq, F.seed * 0.7 + 0.2) * 0.5 * cw;
    o = max(o, sdBox2(vec2(p.x, p.y - fy), vec2(hw - 0.05, 0.24)));
    dor = min(dor, relief(o, p.z, 0.0, 0.04));
  }
  dt = min(dt, relief(sdBox2(vec2(p.x, p.y - top - 0.06), vec2(hw, 0.06)), p.z, 0.0, 0.08));
  {
    float cy = h - 0.2;
    float c1 = relief(sdBox2(vec2(p.x, p.y - cy - 0.07), vec2(hw + 0.12, 0.13)), p.z, 0.0, 0.27);
    float c2 = relief(sdBox2(vec2(p.x, p.y - cy + 0.12), vec2(hw + 0.04, 0.06)), p.z, 0.0, 0.15);
    // dentils under the corona
    float dx = fract(p.x / 0.12) - 0.5;
    float den = relief(sdBox2(vec2(dx * 0.12, p.y - cy + 0.02), vec2(0.03, 0.04)), p.z, 0.0, 0.2);
    den = max(den, abs(p.x) - hw);
    dt = min(dt, min(min(c1, c2), lod < 0.5 ? den : 1e9));
  }
  // roof: balustrade · pediment · attic
  float ry = p.y - h;
  if (ry > -0.1) {
    if (F.roof < 0.5) {
      float rail = sdBox3(vec3(p.x, ry - 0.52, p.z + 0.12), vec3(hw - 0.02, 0.05, 0.1));
      float base = sdBox3(vec3(p.x, ry - 0.04, p.z + 0.12), vec3(hw - 0.02, 0.05, 0.11));
      float bal;
      if (lod < 0.5) {
        float qx = (fract(p.x / 0.2) - 0.5) * 0.2;
        float prof = 0.035 + 0.025 * sin(clamp((ry - 0.08) / 0.4, 0.0, 1.0) * 3.14159);
        bal = max(length(vec2(qx, p.z + 0.12)) - prof, abs(ry - 0.28) - 0.22);
        bal = max(bal, abs(p.x) - hw + 0.05);
      } else bal = sdBox3(vec3(p.x, ry - 0.28, p.z + 0.12), vec3(hw - 0.05, 0.22, 0.03));
      dt = min(dt, min(min(rail, base), bal));
    } else if (F.roof < 1.5) {
      // triangular pediment over the middle bays with an oculus
      float pw = min(hw, 0.5 * F.bay * min(F.nb, 3.0) + 0.3);
      vec2 q = vec2(abs(p.x), ry);
      float tri = max(dot(q - vec2(pw, 0.0), normalize(vec2(1.0, pw / 1.05))), -ry);
      float ped = relief(tri, p.z, 0.0, 0.2);
      float rim = relief(abs(tri + 0.09) - 0.09, p.z, 0.0, 0.26);
      float ocu = length(vec2(p.x, ry - 0.42)) - 0.2;
      ped = max(min(ped, rim), -relief(ocu, p.z, -0.12, 0.2));
      dt = min(dt, ped);
    } else {
      float aw = hw * 0.62;
      float att = sdBox3(vec3(p.x, ry - 0.45, p.z + 0.06), vec3(aw, 0.45, 0.06));
      float cap = sdBox3(vec3(p.x, ry - 0.95, p.z + 0.1), vec3(aw + 0.08, 0.06, 0.1));
      float arch = length(vec2(p.x, ry - 0.25)) - 0.38;
      att = max(att, -max(arch, -ry));
      dt = min(dt, min(att, cap));
    }
  }
  if (F.gate > 0.5) {
    // nothing crosses the gate's opening
    dt = max(dt, -dGate);
    dor = max(dor, -dGate);
  }
  float res = d;
  if (dt < res) { res = dt; mat = 1.0; }
  if (dn < res) { res = dn; mat = 4.0; }
  if (dor < res) { res = dor; mat = 3.0; }
  if (dg < res) { res = dg; mat = 2.0; }
  return res;
}

float facadeDist(vec3 p, Fac F, float lod) {
  float m;
  return facadeDE(p, F, lod, m);
}

vec3 facadeNormal(vec3 p, Fac F, float lod, float eps) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * facadeDist(p + k.xyy * eps, F, lod) + k.yyx * facadeDist(p + k.yyx * eps, F, lod) +
                   k.yxy * facadeDist(p + k.yxy * eps, F, lod) + k.xxx * facadeDist(p + k.xxx * eps, F, lod));
}

// ---------------------------------------------------------------------------------------------
// tracing

struct CityHit {
  float kind;   // 0 nothing (sky) · 1 flat · 2 floor
  float t;
  float mat;
  vec3 lp;      // local coords on the flat
  Fac F;
};

vec2 boxHit(vec3 ro, vec3 ird, vec3 bmin, vec3 bmax) {
  vec3 t0 = (bmin - ro) * ird, t1 = (bmax - ro) * ird;
  vec3 a = min(t0, t1), b = max(t0, t1);
  return vec2(max(max(a.x, a.y), a.z), min(min(b.x, b.y), b.z));
}

vec3 safeInv(vec3 d) { return 1.0 / (sign(d) * max(abs(d), vec3(1e-7)) + vec3(equal(d, vec3(0.0))) * 1e-7); }

// trace the flats + the floor; `pixA` = pixel footprint angle (for the march tolerance and LOD)
CityHit traceCity(vec3 ro, vec3 rd, float tmax, float pixA) {
  CityHit H;
  H.kind = 0.0;
  H.t = tmax;
  H.mat = 0.0;
  H.lp = vec3(0.0);
  vec3 ird = safeInv(rd);
  float tA = 0.0, tB = tmax;
  if (rd.y < 0.0) tB = min(tB, -ro.y * ird.y);
  if (ro.y > HMAX) {
    if (rd.y >= 0.0) return H;
    tA = (HMAX - ro.y) * ird.y;
  } else if (rd.y > 0.0) tB = min(tB, (HMAX - ro.y) * ird.y);
  if (tA < tB) {
    vec2 csz = vec2(CPX, CPZ);
    vec2 p0 = ro.xz + rd.xz * tA;
    vec2 cell = floor(p0 / csz);
    vec2 st = sign(rd.xz);
    vec2 tDelta = abs(csz * ird.xz);
    vec2 tNext = tA + ((cell + max(st, 0.0)) * csz - p0) * ird.xz;
    for (int i = 0; i < 110; i++) {
      Fac F = facadeAt(cell);
      if (F.on > 0.5) {
        vec3 bmin = vec3(F.cx - F.hw - 0.13, 0.0, F.cz - RELIEF);
        vec3 bmax = vec3(F.cx + F.hw + 0.13, F.h + roofH(F), F.cz + SHEET);
        vec2 tb = boxHit(ro, ird, bmin, bmax);
        tb.x = max(tb.x, tA);
        tb.y = min(tb.y, tB);
        if (tb.x < tb.y) {
          float t = tb.x;
          vec3 off = vec3(F.cx, 0.0, F.cz);
          float lod = smoothstep(30.0, 55.0, t);
          for (int j = 0; j < 56; j++) {
            vec3 q = ro + rd * t - off;
            float m;
            float d = facadeDE(q, F, lod, m);
            if (d < pixA * t * 0.6 + 0.0004) {
              H.kind = 1.0;
              H.t = t;
              H.mat = m;
              H.lp = q;
              H.F = F;
              return H;
            }
            t += d * 0.9;
            if (t > tb.y) break;
          }
        }
      }
      float tExit = min(tNext.x, tNext.y);
      if (tExit >= tB) break;
      if (tNext.x < tNext.y) {
        cell.x += st.x;
        tNext.x += tDelta.x;
      } else {
        cell.y += st.y;
        tNext.y += tDelta.y;
      }
    }
  }
  if (rd.y < 0.0) {
    float tf = -ro.y * ird.y;
    if (tf <= tmax) {
      H.kind = 2.0;
      H.t = tf;
    }
  }
  return H;
}

// Sun visibility from p: walk the planes of the rows the sun ray crosses (flats are planes).
// Soft penumbra from the distance of the crossing to the flat's outline (grows with distance).
float sunVis(vec3 p, vec3 L, float soft, int rows) {
  if (abs(L.z) < 1e-4) return 1.0;
  float v = 1.0;
  float dz = sign(L.z);
  float k = floor(p.z / CPZ);
  for (int i = 0; i < 8; i++) {
    if (i >= rows) break;
    float zc = (k + 0.5) * CPZ;
    float s = (zc - p.z) / L.z;
    {
      vec3 q = p + L * max(s, 0.0);
      if (q.y > HMAX + 1.0) break;
      Fac F = facadeAt(vec2(floor(q.x / CPX), k));
      if (F.on > 0.5) {
        float s2 = (F.cz - p.z) / L.z;
        if (s2 > 0.02) {
          vec3 c = p + L * s2;
          float ex = F.hw - abs(c.x - F.cx);
          float ey = F.h + 0.3 - c.y;
          float e = min(ex, min(ey, c.y + 1.0));
          if (F.gate > 0.5) e = min(e, max(abs(c.x - F.cx) - 1.55, c.y - 5.2));
          float pen = soft * s2 + 0.02;
          v *= 1.0 - smoothstep(-pen, pen, e);
        }
      }
    }
    k += dz;
  }
  return v;
}

// self-shadowing of the relief (short, inside the slab)
float reliefShadow(vec3 lp, Fac F, vec3 L) {
  float res = 1.0, t = 0.012;
  for (int i = 0; i < 10; i++) {
    float d = facadeDist(lp + L * t, F, 0.0);
    res = min(res, 10.0 * d / t);
    t += clamp(d, 0.01, 0.08);
    if (res < 0.02 || t > 0.7 || lp.z + L.z * t < -RELIEF) break;
  }
  return sat(res);
}

// ---------------------------------------------------------------------------------------------
// the floor: Penrose P3 by Robinson-triangle deflation (Preshing). Returns
// x distance to the nearest tile edge, y 1 thick / 0 thin rhomb, zw the rhomb centre.
float side2(vec2 p, vec2 a, vec2 b) { vec2 e = b - a, q = p - a; return e.x * q.y - e.y * q.x; }
vec4 penrose(vec2 p, float tile) {
  int LEVELS = uFloorLevels > 0.5 ? int(uFloorLevels) : 13;
  float R = tile * pow(PHI, float(LEVELS));
  float ang = atan(p.y, p.x);
  float i = mod(floor(ang / (PI / 5.0) + 0.5), 10.0);
  float a0 = (2.0 * i - 1.0) * PI / 10.0, a1 = (2.0 * i + 1.0) * PI / 10.0;
  vec2 A = vec2(0.0);
  vec2 B = R * vec2(cos(a0), sin(a0)), C = R * vec2(cos(a1), sin(a1));
  if (mod(i, 2.0) < 0.5) { vec2 t = B; B = C; C = t; }
  float col = 0.0;
  for (int l = 0; l < 20; l++) {
    if (l >= LEVELS) break;
    if (col < 0.5) {
      vec2 P = A + (B - A) / PHI;
      if (side2(p, C, P) * side2(A, C, P) > 0.0) { vec2 nA = P, nB = C, nC = A; A = nA; B = nB; C = nC; col = 1.0; }
      else { vec2 nA = C, nB = P, nC = B; A = nA; B = nB; C = nC; col = 0.0; }
    } else {
      vec2 Q = B + (A - B) / PHI;
      vec2 Rr = B + (C - B) / PHI;
      if (side2(p, Rr, A) * side2(C, Rr, A) > 0.0) { vec2 nA = Rr, nB = C, nC = A; A = nA; B = nB; C = nC; col = 1.0; }
      else if (side2(p, Q, Rr) * side2(B, Q, Rr) > 0.0) { vec2 nA = Q, nB = Rr, nC = B; A = nA; B = nB; C = nC; col = 1.0; }
      else { vec2 nA = Rr, nB = Q, nC = A; A = nA; B = nB; C = nC; col = 0.0; }
    }
  }
  float e = min(sdSeg(p, A, B), sdSeg(p, A, C));
  return vec4(e, col, 0.5 * (B + C));
}

// ---------------------------------------------------------------------------------------------
// sky, haze

float fbm2(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = rot(0.7) * p * 2.03 + 3.1; a *= 0.5; }
  return s;
}

vec3 citySky(vec3 rd) {
  float y = max(rd.y, 0.0);
  vec3 c = mix(uSkyHor, uSkyZen, pow(y, 0.55));
  if (uCloud.x > 0.0 && rd.y > 0.01) {
    // high cirrus on a plane: long streaks, lit by the sun from below the horizon side
    vec2 q = rd.xz / (rd.y + 0.08) * uCloud.y;
    q = vec2(q.x * 0.35, q.y) + vec2(uCloud.z, 0.0);
    float n = fbm2(q) - 0.48;
    float cl = smoothstep(0.0, 0.35, n) * uCloud.x * smoothstep(0.01, 0.2, rd.y);
    float sunSide = 0.6 + 0.4 * sat(dot(normalize(vec3(rd.x, 0.0, rd.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))));
    c = mix(c, uSkyHor * uCloud.w * sunSide, cl);
  }
  float mu = dot(rd, uSunDir);
  c += uSunCol * (0.012 * pow(sat(mu), 6.0) + 0.06 * pow(sat(mu), 60.0));
  c += uSunCol * 6.0 * smoothstep(0.99965, 0.99985, mu);
  if (rd.y < 0.0) c = mix(c, uFogCol, sat(-rd.y * 8.0));
  return c;
}

// optical depth of the exponential height fog along ro + rd·[0, t]
float fogOD(vec3 ro, vec3 rd, float t) {
  // ∫ d0·exp(−y/H) along the ray, written as a difference of two exp(−y/H) ≤ 1 so it stays finite
  // from any height (S05 climbs to ~1300 units)
  // plus a thin constant haze: aerial perspective for very long views
  float k = rd.y / uFog.y;
  float a = exp(-ro.y / uFog.y);
  if (abs(k) < 1e-5) return uFog.x * a * t + 0.0003 * t;
  float b = exp(-max(ro.y + rd.y * t, -20.0) / uFog.y);
  return uFog.x * (a - b) / k + 0.0003 * min(t, 4000.0);
}

float hg(float mu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5)); }

// single scattering with the sun shadowed by the flats (light shafts). Returns in-scatter; T = transmittance.
vec3 cityHaze(vec3 ro, vec3 rd, float t, float jit, int N, out float T) {
  float tm = min(t, 160.0);
  float phase = mix(1.0 / (4.0 * PI), hg(dot(rd, uSunDir), uFog.w), 0.7) * 4.0 * PI;
  vec3 sunS = uSunCol * uFog.z * phase;
  vec3 acc = vec3(0.0);
  float Tp = 1.0;
  for (int i = 0; i < 16; i++) {
    if (i >= N) break;
    float a = float(i) / float(N), b = float(i + 1) / float(N);
    float t1 = tm * b * b;
    float tmid = tm * pow(mix(a, b, jit), 2.0);
    float Ti = exp(-fogOD(ro, rd, t1));
    vec3 p = ro + rd * tmid;
    float v = sunVis(p, uSunDir, 0.03, 4);
    acc += (Tp - Ti) * (uFogCol + sunS * v);
    Tp = Ti;
  }
  T = exp(-fogOD(ro, rd, t));
  acc += max(Tp - T, 0.0) * (uFogCol + sunS);
  return acc;
}

// ---------------------------------------------------------------------------------------------
// shading

vec3 skyLight(vec3 n) {
  vec3 sky = mix(uSkyHor, uSkyZen, 0.5 + 0.5 * n.y) * (0.3 + 0.15 * n.y);
  return mix(uGround, sky * uAmb, 0.5 + 0.5 * n.y);
}

// window bookkeeping at a point on a flat: x bay index, y storey, z window hash 0..1
vec3 windowId(Fac F, vec3 lp) {
  float bi = clamp(floor((lp.x + F.hw) / F.bay), 0.0, F.nb - 1.0);
  float si = clamp(floor(lp.y / F.sh), 0.0, F.n - 1.0);
  uint id = hashu(uvec3(uvec2(ivec2(F.cell) + 8192), uint(bi + si * 32.0)));
  return vec3(bi, si, float(id & 65535u) / 65535.0);
}

// interior light of a window: some are lit; on a kick a different handful flashes
vec3 windowGlow(Fac F, vec3 lp) {
  vec3 w = windowId(F, lp);
  float lit = step(w.z, uWin.x) * (0.35 + 0.65 * fract(w.z * 37.1));
  uint fh = pcg(uint(w.z * 65535.0) ^ (uint(uWin.z) * 2654435761u));
  float fl = (float(fh & 1023u) / 1023.0 < uWin.w) ? uWin.y : 0.0;
  // a soft falloff towards the frame, like a lamp deep in the room
  return uWinCol * (lit + 4.0 * fl);
}

float facadeAO(vec3 lp, vec3 n, Fac F, float lod) {
  float occ = 0.0, w = 1.0;
  for (int i = 1; i <= 3; i++) {
    float h = 0.035 * float(i * i);
    occ += w * max(h - facadeDist(lp + n * h, F, lod), 0.0) / h;
    w *= 0.6;
  }
  return sat(1.0 - 0.75 * occ);
}

vec3 neonAt(Fac F, vec3 lp, float glyphOnly) {
  if (F.sign < 0.5) return vec3(0.0);
  int k = int(F.sign - 1.0);
  vec4 S = uSign[k];
  vec4 lit = uSignLit[k];
  vec2 tx = signText(vec2(lp.x, lp.y - uSignY[k]) / S.w, S.z - 1.0);
  float e = step(tx.y, lit.x - 0.5);
  // ignition flicker of the letters that are just coming on
  if (e > 0.0 && tx.y > lit.z - 0.5 && lit.w < 1.0)
    e *= mix(step(0.5, hash1(uint(uTime * 45.0) + uint(tx.y) * 7919u)) * (0.3 + 0.7 * lit.w), 1.0, lit.w * lit.w);
  float d = tx.x * S.w; // world distance to the glyph
  float core = glyphOnly > 0.5 ? 1.0 : exp(-max(d, 0.0) / 0.12);
  return uNeon * e * lit.y * core;
}

vec3 cityShadeFacade(CityHit H, vec3 ro, vec3 rd, float pixA) {
  vec3 p = ro + rd * H.t;
  Fac F = H.F;
  vec3 lp = H.lp;
  float lod = smoothstep(30.0, 55.0, H.t);
  // far away (pixel footprint > 0.25 units) the relief is sub-pixel: plane normal, no probes
  bool far = pixA * H.t > 0.25;
  vec3 n = far ? (lp.y > F.h - 0.08 ? vec3(0.0, 1.0, 0.0) : lp.z > 0.5 * SHEET ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 0.0, -1.0))
               : facadeNormal(lp, F, lod, max(0.0015, pixA * H.t * 0.7));
  vec3 L = uSunDir;
  // stucco tinted per flat, trims lighter and cooler
  int si = int(F.seed * 3.999);
  vec3 stucco = uStucco[si] * (0.92 + 0.16 * fract(F.seed * 7.7));
  stucco *= 0.9 + 0.2 * vnoise(lp.xy * vec2(1.5, 0.7) + F.seed * 50.0);
  vec3 trim = mix(stucco, uTrim, 0.7);
  vec3 alb = H.mat < 0.5 ? stucco : H.mat < 3.5 ? trim : vec3(0.02);
  if (H.mat > 2.5 && H.mat < 3.5) alb *= 0.92;
  float dif = max(dot(n, L), 0.0);
  float sh = 0.0;
  if (dif > 0.0) {
    sh = sunVis(p + n * 0.03, L, 0.025, 6);
    if (sh > 0.02 && lod < 0.9 && !far) sh *= reliefShadow(lp + n * 0.006, F, L);
  }
  float ao = (far ? 0.85 : facadeAO(lp, n, F, lod)) * mix(0.55, 1.0, smoothstep(0.0, 3.0, p.y));
  vec3 col = alb * (uSunCol * dif * sh + skyLight(n) * ao);
  // a little sheen on the stone
  vec3 r = reflect(rd, n);
  float fre = pow(1.0 - sat(dot(n, -rd)), 5.0);
  col += citySky(r) * (0.02 + 0.2 * fre) * ao * (H.mat < 0.5 ? 0.5 : 1.0);
  if (H.mat > 1.5 && H.mat < 2.5) {
    // glass: dark interior, sky reflection, lamps
    // cool glass against the warm stucco: dark interior, a blue-grey (#ACCEDE) sheen, the sky
    float fg = 0.06 + 0.94 * pow(1.0 - sat(dot(n, -rd)), 5.0);
    vec3 refl = mix(citySky(r), hex2p3(C_ACCEDE) * 0.9, 0.55) * (0.35 + 0.65 * sunVis(p, r, 0.0, 2));
    col = vec3(0.006, 0.007, 0.012) + refl * fg + windowGlow(F, lp) * (1.0 - fg);
  }
  if (H.mat > 3.5) col = neonAt(F, lp, 1.0) * 1.0 + vec3(0.003);
  else if (F.sign > 0.5) col += alb * neonAt(F, lp, 0.0) * 0.18;
  return col;
}

vec3 cityShadeFloor(vec3 p, vec3 rd, float t, float pixA) {
  vec4 pt = penrose(p.xz - uFloor.xy, uFloor.z);
  float fp = pixA * t / max(abs(rd.y), 0.03);
  float lw = 0.018 * uFloor.z;
  float far = smoothstep(0.15, 0.6, fp / uFloor.z);
  float grout = (1.0 - smoothstep(lw - fp, lw + fp, pt.x)) * (1.0 - far);
  float th = hash2(floor(pt.zw * 37.0));
  vec3 thick = uPal[0] * (0.88 + 0.12 * th);
  vec3 thin = uPal[1] * (0.85 + 0.15 * th);
  vec3 alb = mix(mix(thin, thick, pt.y), mix(thin, thick, 0.62), far);
  alb = mix(alb, uPal[2], grout);
  // the creature's trace: a wandering line of tiles that glow faintly, a pulse running ahead
  float path = pt.z - 1.1 * sin(pt.w * 0.13) - 0.5 * sin(pt.w * 0.37 + 1.0);
  float trace = smoothstep(0.75, 0.15, abs(path)) * (1.0 - grout) * uFloor.w * (1.0 - far * 0.6);
  trace *= 0.35 + 0.65 * pow(0.5 + 0.5 * sin(pt.w * 0.9 - uTime * 5.0), 4.0);
  // contact shadow at the foot of the flats (current row and the one behind)
  float ao = 1.0;
  for (int i = 0; i < 2; i++) {
    Fac F = facadeAt(vec2(floor(p.x / CPX), floor(p.z / CPZ) + float(i) - 0.0));
    if (F.on > 0.5) {
      float dz = p.z < F.cz ? F.cz - RELIEF * 0.5 - p.z : p.z - F.cz;
      float dx = max(abs(p.x - F.cx) - F.hw, 0.0);
      ao *= 1.0 - 0.55 * exp(-max(length(vec2(dx, max(dz, 0.0))), 0.0) / 0.9);
    }
  }
  float sh = sunVis(p + vec3(0.0, 0.01, 0.0), uSunDir, 0.025, 6);
  vec3 col = alb * (uSunCol * max(uSunDir.y, 0.0) * sh + skyLight(vec3(0.0, 1.0, 0.0)) * ao);
  // polished stone: sky reflection with Fresnel
  float fre = 0.03 + 0.5 * pow(1.0 - sat(-rd.y), 5.0);
  col += citySky(reflect(rd, vec3(0.0, 1.0, 0.0))) * fre * ao * (1.0 - grout);
  col += hex2p3(C_DECADE) * trace * 0.6;
  return col;
}
