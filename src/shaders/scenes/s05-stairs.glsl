// S05 · Staircase: a forced-perspective Penrose staircase on a tower in the city of facades.
// Four flights (uniforms built by src/scenes/s05-stairs.ts), each a stepped stone block whose steps
// slide up one tread per Shepard note; the city behind is lib/city.
#include "lib/city"
#include "lib/taa"
layout(location = 0) out vec4 o;
layout(location = 1) out float oDepth;
uniform float uFrame;
uniform vec4 uFA[4]; // start xyz, treads along the straight part (fractional)
uniform vec4 uFB[4]; // u.xz, run, rise
uniform vec4 uFC[4]; // width, global tread index at the start, winder treads in the corner, escalator phase
uniform vec4 uFD[4]; // fall offset xyz, tilt
uniform vec4 uTower; // xz centre of the tower, clear radius
uniform float uKick;
uniform vec3 uBoxMin, uBoxMax; // bounds of the four flights (incl. their fall)
#define SEAM 2.0       // at most this many treads of the seam are drawn by the last flight instead of the first
uniform vec4 uMark;    // the lit tread: x global tread index, y treads per loop
uniform vec4 uMarkPos; // its centre (world), w = intensity

void cityOverride(vec2 cell, inout Fac F) {
  // keep the tower's block clear
  vec2 c = (cell + 0.5) * vec2(CPX, CPZ);
  if (length(max(abs(c - uTower.xy) - vec2(0.5 * CPX, 0.5 * CPZ), 0.0)) < uTower.z) F.on = 0.0;
}

// one flight: a straight run of treads, then a winder corner (a quarter turn about the inner corner
// of the court), standing on a block that goes down to the ground. Treads are numbered globally
// round the loop; tread m spans global coordinate [m + φ, m + 1 + φ] and its top rises continuously
// with it (the escalator), so every tread on the loop — straight or winder — moves.
// Returns the distance; `id` 0 stairs · 2 block below; lq = (along, local y, across); S = global tread coordinate
float flightDE(vec3 p, int k, out float id, out vec3 lq, out float S) {
  vec4 A = uFA[k], B = uFB[k], C = uFC[k], D = uFD[k];
  vec3 q = p - A.xyz - D.xyz;
  vec2 u = B.xy, v = vec2(-u.y, u.x);
  float a = dot(q.xz, u), b = dot(q.xz, v), y = q.y;
  float n = A.w, r = B.z, h = B.w, w = C.x, S0 = C.y, cn = C.z, phi = C.w;
  if (D.w != 0.0) {
    vec2 by = rot(D.w) * vec2(b, y - 0.5 * n * h);
    b = by.x;
    y = by.y + 0.5 * n * h;
  }
  lq = vec3(a, y, b);
  float L = n * r;
  float bottom = -A.y - 2.0; // into the ground
  float d = 1e9;
  // straight part: columns of the treads near a, clipped to [0, L]
  float s = a / r;
  S = S0 + s;
  float m0 = floor(S0 + s - phi);
  // the seam's first 1 + φ treads are drawn by the last flight (near); here they sink by a riser so
  // they stay hidden inside its silhouette instead of fighting it for the same pixels
  for (int i = -1; i <= 1; i++) {
    float m = m0 + float(i);
    float a0 = max(0.0, (m + phi - S0) * r), a1 = min(L, (m + 1.0 + phi - S0) * r);
    if (a1 <= a0) continue;
    float yt = (m + 1.0 + phi - S0) * h - (k == 0 && m < 0.5 ? 1.2 * h : 0.0);
    d = min(d, sdBox2(vec2(a - 0.5 * (a0 + a1), y - 0.5 * (yt + bottom)), vec2(0.5 * (a1 - a0), 0.5 * (yt - bottom))));
  }
  d = max(d, abs(b) - 0.5 * w);
  // winder corner: the square [L, L + w] × [−w/2, w/2]; treads are wedges about its inner corner
  // (only worked out when the square is closer than what we already have — its box is a bound)
  float sq = sdBox2(vec2(a - L - 0.5 * w, b), vec2(0.5 * w));
  float dc = 1e9;
  if (sq < d) {
    float Rc = 0.5 * w;
    vec2 c2 = vec2(a - L, b - 0.5 * w);                 // from the inner corner; inside: x ≥ 0, y ≤ 0
    float th = atan(min(c2.y, 0.0), max(c2.x, 1e-5));   // −π/2 (entry) … 0 (exit)
    float sc = n + (th + 0.5 * PI) * Rc / r;            // local tread coordinate in the corner
    if (a > L) S = S0 + sc;
    float mc = floor(S0 + sc - phi);
    for (int i = -1; i <= 1; i++) {
      float m = mc + float(i);
      float ta = max((m + phi - S0 - n) * r / Rc - 0.5 * PI, -0.5 * PI - 0.01);
      float tb = min((m + 1.0 + phi - S0 - n) * r / Rc - 0.5 * PI, 0.01);
      if (tb <= ta) continue;
      float yt = (m + 1.0 + phi - S0) * h;
      float da = dot(c2, vec2(sin(ta), -cos(ta)));
      float db = dot(c2, vec2(-sin(tb), cos(tb)));
      dc = min(dc, max(max(da, db), max(y - yt, bottom - y)));
    }
    dc = max(dc, sq);
  }
  d = min(d, dc);
  if (k == 3 && sdBox2(vec2(a - L - 0.5 * w, b - 0.5 * w - r), vec2(0.5 * w, r)) < d) {
    // the seam: the last corner runs on for 1 + φ treads straight into the first flight's direction,
    // drawn here, near, instead of far away at the start of flight 1 (which begins at that tread
    // boundary) — near and far copies of the same steps would fight for the same pixels, and the
    // hand-over at a riser hides the small difference in scale
    float bt = b - 0.5 * w;
    float st = n + cn + bt / r;
    float mt = floor(S0 + st - phi);
    float dt = 1e9;
    for (int i = -1; i <= 1; i++) {
      float m = mt + float(i);
      float b0 = max(0.0, (m + phi - S0 - n - cn) * r), b1 = min((1.0 + phi) * r, (m + 1.0 + phi - S0 - n - cn) * r);
      if (b1 <= b0) continue;
      float yt = (m + 1.0 + phi - S0) * h;
      dt = min(dt, sdBox2(vec2(bt - 0.5 * (b0 + b1), y - 0.5 * (yt + bottom)), vec2(0.5 * (b1 - b0), 0.5 * (yt - bottom))));
    }
    dt = max(dt, abs(a - L - 0.5 * w) - 0.5 * w);
    if (dt < d) { d = dt; if (bt > 0.0) S = S0 + st; }
  }
  id = y < -0.05 ? 2.0 : 0.0;
  return d;
}

// cheap bound of a flight: its oriented box (steps + landing + the block below)
float flightBound(vec3 p, int k) {
  vec4 A = uFA[k], B = uFB[k], C = uFC[k], D = uFD[k];
  vec3 q = p - A.xyz - D.xyz;
  vec2 u = B.xy, v = vec2(-u.y, u.x);
  float len = A.w * B.z + C.x;
  float hgt = (A.w + C.z + 1.0 + (k == 3 ? SEAM : 0.0)) * B.w;
  float tail = k == 3 ? 0.5 * SEAM * B.z : 0.0; // the last flight's seam treads stick out sideways
  vec3 l = vec3(dot(q.xz, u) - 0.5 * len, q.y - 0.5 * (hgt - A.y - 2.0), dot(q.xz, v) - tail);
  return sdBox3(l, vec3(0.5 * len, 0.5 * (hgt + A.y + 2.0), 0.5 * C.x + tail)) - (D.w != 0.0 ? 2.0 : 0.0);
}

float stairsDE(vec3 p, out float id, out vec3 lq, out int fk, out float S) {
  float d = 1e9;
  id = 0.0;
  fk = 0;
  lq = vec3(0.0);
  S = 0.0;
  for (int k = 0; k < 4; k++) {
    if (flightBound(p, k) > d) continue;
    float i, sk;
    vec3 l;
    float dk = flightDE(p, k, i, l, sk);
    if (dk < d) { d = dk; id = i; lq = l; fk = k; S = sk; }
  }
  return d;
}
float stairsDist(vec3 p) { float i, s; vec3 l; int k; return stairsDE(p, i, l, k, s); }

vec3 stairsNormal(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0015;
  return normalize(e.xyy * stairsDist(p + e.xyy) + e.yyx * stairsDist(p + e.yyx) + e.yxy * stairsDist(p + e.yxy) + e.xxx * stairsDist(p + e.xxx));
}

// distance to the stairs without one flight: the two ends of the seam must not shadow each other —
// in 3D the last corner hangs above the first steps, and its shadow would give the trick away
float stairsDistEx(vec3 p, int ex) {
  float d = 1e9;
  for (int k = 0; k < 4; k++) {
    if (k == ex || flightBound(p, k) > d) continue;
    float i, sk;
    vec3 l;
    d = min(d, flightDE(p, k, i, l, sk));
  }
  return d;
}

float stairsShadow(vec3 p, vec3 L, int fk) {
  float res = 1.0, t = 0.03;
  vec2 tb = boxHit(p, safeInv(L), uBoxMin, uBoxMax);
  float tend = min(tb.y, 14.0);
  int ex = fk == 0 ? 3 : fk == 3 ? 0 : -1;
  for (int i = 0; i < 20; i++) {
    float d = stairsDistEx(p + L * t, ex);
    res = min(res, 12.0 * d / t);
    t += clamp(d, 0.04, 0.9);
    if (res < 0.01 || t > tend) break;
  }
  return sat(res);
}

void main() {
  vec3 ro = camPos;
  vec3 rd = camRay(gl_FragCoord.xy);
  float pixA = 2.0 * camTan.y / taaRes.y;
  // the stairs first, inside their bounds; then the city up to them
  float ts = 1e9;
  vec2 tb = boxHit(ro, safeInv(rd), uBoxMin, uBoxMax);
  if (tb.x < tb.y && tb.y > 0.0) {
    float t = max(tb.x, 0.0);
    float dl = 1e9;
    for (int i = 0; i < 90; i++) {
      vec3 p = ro + rd * t;
      float d = stairsDist(p);
      dl = d;
      if (d < 0.0009 * t) { ts = t; break; }
      t += d;
      if (t > tb.y) break;
    }
    // rays that graze an edge (at the seam the near corner and the far first steps share the same
    // pixels) can run out of steps right at the surface: take those as hits, not holes
    if (ts > 1e8 && t < tb.y && dl < 0.006 * t) ts = t;
  }
  CityHit H = traceCity(ro, rd, min(ts, 6000.0), pixA);
  float tc = H.kind > 0.5 ? H.t : 6000.0;
  vec3 col;
  float t;
  if (ts < tc) {
    t = ts;
    vec3 p = ro + rd * t;
    float id, S; vec3 lq; int fk;
    stairsDE(p, id, lq, fk, S);
    vec3 L = uSunDir;
    // deep on the tower's walls (well below the steps) everything is a flat face: analytic normal,
    // light and occlusion instead of SDF probes — the tower can fill half the frame in the climb
    bool deep = lq.y < -2.5;
    vec3 n;
    if (deep) {
      vec2 u = uFB[fk].xy, v = vec2(-u.y, u.x);
      float len = uFA[fk].w * uFB[fk].z + uFC[fk].x;
      float db = 0.5 * uFC[fk].x - abs(lq.z), da0 = lq.x, da1 = len - lq.x;
      vec2 n2 = db < min(da0, da1) ? v * sign(lq.z) : da0 < da1 ? -u : u;
      n = vec3(n2.x, 0.0, n2.y);
    } else n = stairsNormal(p);
    // stone: pale, treads lighter, the block below with courses and blind arches
    vec3 stone = mix(hex2p3(C_DECADE), vec3(0.95, 0.9, 0.86), 0.45) * 0.72;
    float tread = smoothstep(0.6, 0.9, n.y);
    // drawn like the classic figure: light treads, darker risers
    vec3 alb = stone * mix(id < 0.5 ? 0.58 : 0.9, 1.06, tread);
    float glass = 0.0;
    if (id > 1.5 && abs(n.y) < 0.5) {
      // the tower's walls: storeys, string courses, arched windows (painted, no geometry)
      // storeys are fixed in the world: as the stairs climb, the tower's windows stream down
      vec2 fq = vec2(abs(n.x * uFB[fk].x + n.z * uFB[fk].y) > 0.5 ? lq.z : lq.x, p.y);
      float sy = 1.15, bx = 1.25;
      vec2 c = vec2((fract(fq.x / bx) - 0.5) * bx, (fract(fq.y / sy) - 0.5) * sy);
      float win = min(sdBox2(c + vec2(0.0, 0.08), vec2(0.2, 0.2)), length(c - vec2(0.0, 0.12)) - 0.2);
      float frame = smoothstep(0.03, 0.0, abs(win - 0.05) - 0.03);
      float course = smoothstep(0.025, 0.0, abs(c.y + 0.5 * sy - 0.02) - 0.03);
      glass = step(win, 0.0);
      alb *= 1.0 + 0.18 * frame - 0.2 * course;
    }
    float dif = max(dot(n, L), 0.0);
    float sh, ao = 1.0;
    if (deep) {
      // the court (left of every flight) is deep: sun reaches only its upper storeys
      bool inner = lq.z > 0.0 && abs(lq.z) > 0.5 * uFC[fk].x - 0.02;
      sh = inner ? smoothstep(-9.0, -3.0, lq.y) : 1.0;
      ao = inner ? mix(0.4, 0.85, smoothstep(-14.0, -3.0, lq.y)) : 0.92;
    } else {
      sh = dif > 0.0 ? stairsShadow(p + n * 0.01, L, fk) : 0.0;
      ao = 1.0;
    }
    if (!deep) {
      float occ = 0.0;
      for (int i = 1; i <= 3; i++) {
        float hh = 0.07 * float(i * i);
        occ += max(hh - stairsDistEx(p + n * hh, fk == 0 ? 3 : fk == 3 ? 0 : -1), 0.0) / hh * pow(0.65, float(i));
      }
      ao = sat(1.0 - occ);
    }
    col = alb * (uSunCol * dif * sh + skyLight(n) * ao * (1.0 + 0.4 * uKick));
    col += citySky(reflect(rd, n)) * 0.03 * ao;
    if (glass > 0.5) {
      float fg = 0.06 + 0.94 * pow(1.0 - sat(dot(n, -rd)), 5.0);
      col = vec3(0.006, 0.007, 0.012) + mix(citySky(reflect(rd, n)), hex2p3(C_ACCEDE) * 0.9, 0.55) * fg * ao;
    }
    if (uMarkPos.w > 0.0) {
      // the lit tread (the creature's step) and its glow on the stone around it
      vec3 dc = mix(hex2p3(C_DECADE), vec3(0.62, 0.22, 1.0), 0.75);
      float phi = uFC[fk].w;
      float tm = floor(S - phi);                                   // global index of this tread
      float top = (tm + 1.0 + phi - uFC[fk].y) * uFB[fk].w;        // its top, flight-local
      bool onIt = id < 0.5 && abs(mod(tm - uMark.x + 0.5 * uMark.y, uMark.y) - 0.5 * uMark.y) < 0.5 &&
                  lq.y > top - uFB[fk].w * 1.05;
      if (onIt) col = col * 0.4 + dc * uMarkPos.w * (0.7 + 0.5 * tread);
      float r2 = dot(p - uMarkPos.xyz, p - uMarkPos.xyz);
      col += alb * dc * uMarkPos.w * 1.4 * exp(-r2 / 1.4) * max(dot(n, normalize(uMarkPos.xyz - p)), 0.0);
    }
  } else {
    t = tc;
    if (H.kind > 1.5) col = cityShadeFloor(ro + rd * t, rd, t, pixA);
    else if (H.kind > 0.5) col = cityShadeFacade(H, ro, rd, pixA);
    else col = citySky(rd);
  }
  float T;
  float jit = fract(ign(gl_FragCoord.xy) + uFrame * 0.618034);
  vec3 ins = cityHaze(ro, rd, t, jit, 7, T);
  col = col * T + ins;
  o = vec4(col, 1.0);
  // the stairs ride with the camera rig: negative depth → TAA reprojects them in rig space
  oDepth = ts < tc ? -t : H.kind > 0.5 ? t : 1e5;
}
