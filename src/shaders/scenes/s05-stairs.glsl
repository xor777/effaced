// S05 · Staircase: a forced-perspective Penrose staircase on a tower in the city of facades.
// Four flights (uniforms built by src/scenes/s05-stairs.ts), each a stepped stone block (its steps can
// slide up like an escalator: the phase in uFC.w), drawn like the classic figure (light treads, dark
// risers, a stringer band under the sawtooth of the side faces, ink at the nosings); a single file of
// walkers (capsule figures, positions from the CPU) climbs them, one step per Shepard note. The city
// behind is lib/city.
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
// the walkers: ground point (under the hip) + figure height, the feet, the chest (+ lean), a bounding
// sphere each and one round them all
uniform int uWN;
uniform vec4 uWB[16], uWL[16], uWR[16], uWC[16], uWS[16];
uniform vec4 uWAll;
uniform vec3 uTreadAlb, uRiserAlb, uStringer, uWalkCol, uInkCol;
uniform vec4 uInk; // x line width (internal px), y strength, z stringer band (risers)

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
  // the seam's first 1 + φ treads are drawn by the last flight (near), right in front of these: they
  // keep their height, so wherever the two copies don't quite match the far one just looks like the
  // same tread (sunk, its edges showed through as a stack of thin slabs)
  for (int i = -1; i <= 1; i++) {
    float m = m0 + float(i);
    float a0 = max(0.0, (m + phi - S0) * r), a1 = min(L, (m + 1.0 + phi - S0) * r);
    if (a1 <= a0) continue;
    float yt = (m + 1.0 + phi - S0) * h;
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

// the stairs: the nearest flight by its bound is evaluated first, so the others are mostly culled by
// their bounds (a point is near one flight); `ex` leaves one flight out (−1: none)
float stairsDEx(vec3 p, int ex, out float id, out vec3 lq, out int fk, out float S) {
  vec4 bb = vec4(flightBound(p, 0), flightBound(p, 1), flightBound(p, 2), flightBound(p, 3));
  if (ex >= 0) bb[ex] = 1e9;
  int k0 = 0;
  if (bb.y < bb[k0]) k0 = 1;
  if (bb.z < bb[k0]) k0 = 2;
  if (bb.w < bb[k0]) k0 = 3;
  float d = flightDE(p, k0, id, lq, S);
  fk = k0;
  for (int k = 0; k < 4; k++) {
    if (k == k0 || bb[k] > d) continue;
    float i, sk;
    vec3 l;
    float dk = flightDE(p, k, i, l, sk);
    if (dk < d) { d = dk; id = i; lq = l; fk = k; S = sk; }
  }
  return d;
}
float stairsDE(vec3 p, out float id, out vec3 lq, out int fk, out float S) { return stairsDEx(p, -1, id, lq, fk, S); }
float stairsDist(vec3 p) { float i, s; vec3 l; int k; return stairsDEx(p, -1, i, l, k, s); }

// the normal of the flight that was hit (one flight's field: cheaper, and the two ends of the seam
// never bleed into each other's normals)
float flightDist(vec3 p, int k) { float i, s; vec3 l; return flightDE(p, k, i, l, s); }
vec3 stairsNormal(vec3 p, int k) {
  const vec2 e = vec2(1.0, -1.0) * 0.0015;
  return normalize(e.xyy * flightDist(p + e.xyy, k) + e.yyx * flightDist(p + e.yyx, k) + e.yxy * flightDist(p + e.yxy, k) + e.xxx * flightDist(p + e.xxx, k));
}

// distance to the stairs without one flight: the two ends of the seam must not shadow each other —
// in 3D the last corner hangs above the first steps, and its shadow would give the trick away
float stairsDistEx(vec3 p, int ex) { float i, s; vec3 l; int k; return stairsDEx(p, ex, i, l, k, s); }

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

// ---- the drawing: edges of the steps at a surface point of flight k
// edge = distance to the nearest convex edge (nosings, the sawtooth line on the side faces, the riser
// ends), crease = distance to the nearest crease (the foot of a riser), side = on a side face (0/1)
// with its normal wn (flight-local u, v), below = depth below the tread top above the point;
// nl = the normal of the face the point lies on (flight-local u, y, v), fit = its distance to it
struct Ink { float edge, crease, side, below; vec2 wn; vec3 nl; float fit; };

// a straight run of treads: x along (x = 0 at global tread coordinate Sx), z across, y up
void runInk(float x, float z, float y, float Sx, float r, float h, float hw, float S0, float phi, inout Ink k) {
  float l = floor(Sx + x / r - phi);
  float yt = (l + 1.0 + phi - S0) * h;
  if (y > yt + 0.25 * h) { l += 1.0; yt += h; } // on the riser of the next tread
  float a0 = (l + phi - Sx) * r, a1 = a0 + r;
  float dx0 = abs(x - a0), dx1 = abs(a1 - x), dy = abs(yt - y), dz = hw - abs(z);
  k.edge = min(k.edge, length(vec2(dx0, dy)));                    // nosing
  k.edge = min(k.edge, length(vec2(dz, dy)));                     // the sawtooth on the side face
  if (y > yt - h - 0.02 * h) k.edge = min(k.edge, length(vec2(dz, dx0))); // riser end on the side face
  k.crease = min(k.crease, length(vec2(dx1, dy)));                // foot of the next riser
  k.side = step(dz, 0.004 + 0.02 * h);
  k.below = yt - y;
  // the face: tread top, the riser of this tread (back) or of the next (front), the side
  k.fit = min(min(dy, dz), min(dx0, dx1));
  k.nl = k.fit == dy ? vec3(0.0, 1.0, 0.0) : k.fit == dz ? vec3(0.0, 0.0, sign(z)) : vec3(-1.0, 0.0, 0.0);
}

Ink stairsInk(vec3 p, int k) {
  Ink I = Ink(1e9, 1e9, 0.0, 0.0, vec2(0.0), vec3(0.0, 1.0, 0.0), 1e9);
  vec4 A = uFA[k], B = uFB[k], C = uFC[k], D = uFD[k];
  vec3 q = p - A.xyz - D.xyz;
  vec2 u = B.xy, v = vec2(-u.y, u.x);
  float a = dot(q.xz, u), b = dot(q.xz, v), y = q.y;
  float n = A.w, r = B.z, h = B.w, w = C.x, S0 = C.y, cn = C.z, phi = C.w;
  float L = n * r, hw = 0.5 * w;
  if (a < L) {
    runInk(a, b, y, S0, r, h, hw, S0, phi, I);
    I.wn = vec2(0.0, sign(b));
  } else if (b > hw) {
    if (k == 3) runInk(b - hw, a - L - hw, y, S0 + n + cn, r, h, hw, S0, phi, I); // the seam's run-on
    I.wn = vec2(sign(a - L - hw), 0.0);
    I.nl = I.nl.zyx; // run-local (along v, across u) → flight-local
  } else {
    // winder corner: wedges about the inner corner (L, hw)
    vec2 c2 = vec2(a - L, b - hw);
    float th = atan(min(c2.y, 0.0), max(c2.x, 1e-5));
    float sc = n + (th + 0.5 * PI) * hw / r;
    float l = floor(S0 + sc - phi);
    float yt = (l + 1.0 + phi - S0) * h;
    if (y > yt + 0.25 * h) { l += 1.0; yt += h; }
    float ta = (l + phi - S0 - n) * r / hw - 0.5 * PI, tb = ta + r / hw;
    float dA = ta < -0.5 * PI - 1e-3 ? 1e9 : abs(dot(c2, vec2(sin(ta), -cos(ta))));
    float dB = tb > 1e-3 ? 1e9 : abs(dot(c2, vec2(sin(tb), -cos(tb))));
    float dy = abs(yt - y), dz = min(L + w - a, b + hw);
    I.edge = min(length(vec2(dA, dy)), length(vec2(dz, dy)));
    if (y > yt - 1.02 * h) I.edge = min(I.edge, length(vec2(dz, dA)));
    I.crease = length(vec2(dB, dy));
    I.side = step(dz, 0.004 + 0.02 * h);
    I.below = yt - y;
    I.wn = L + w - a < b + hw ? vec2(1.0, 0.0) : vec2(0.0, -1.0);
    I.fit = min(min(dy, dz), min(dA, dB));
    I.nl = I.fit == dy ? vec3(0.0, 1.0, 0.0) : I.fit == dz ? vec3(I.wn.x, 0.0, I.wn.y)
         : I.fit == dA ? vec3(sin(ta), 0.0, -cos(ta)) : vec3(sin(tb), 0.0, -cos(tb));
  }
  return I;
}

// ---- the walkers: architectural-model figures (a capsule body, a head, two legs), one flat colour
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  return length(pa - ba * sat(dot(pa, ba) / dot(ba, ba))) - r;
}
float walkerDE(vec3 p, int i) {
  vec4 B = uWB[i];
  float s = B.w;
  vec3 hip = B.xyz + vec3(0.0, 0.5 * s, 0.0);
  vec3 chest = uWC[i].xyz;
  vec3 ax = normalize(chest - hip);
  float d = sdCapsule(p, hip + ax * (0.02 * s), chest, 0.115 * s);   // body
  d = min(d, length(p - chest - ax * (0.2 * s)) - 0.085 * s);         // head (a gap for the neck)
  // legs: from the hip (a little towards its foot) to the foot
  vec3 fl = uWL[i].xyz, fr = uWR[i].xyz;
  vec3 hl = hip + clamp((fl - B.xyz) * vec3(0.25, 0.0, 0.25), -0.07 * s, 0.07 * s);
  vec3 hr = hip + clamp((fr - B.xyz) * vec3(0.25, 0.0, 0.25), -0.07 * s, 0.07 * s);
  float legs = min(sdCapsule(p, hl, fl + vec3(0.0, 0.035 * s, 0.0), 0.052 * s),
                   sdCapsule(p, hr, fr + vec3(0.0, 0.035 * s, 0.0), 0.052 * s));
  return smin(d, legs, 0.05 * s);
}
// bounds (from the CPU): uWS[i] one sphere per walker, uWAll one sphere round them all
bool hitSphere(vec3 ro, vec3 rd, vec4 S, out float t0, out float t1) {
  vec3 oc = ro - S.xyz;
  float bb = dot(oc, rd), hh = bb * bb - dot(oc, oc) + S.w * S.w;
  if (hh < 0.0) return false;
  hh = sqrt(hh);
  t0 = -bb - hh;
  t1 = -bb + hh;
  return t1 > 0.0;
}
float traceWalkers(vec3 ro, vec3 rd, float tmax, out int wi) {
  wi = -1;
  float best = tmax, g0, g1;
  if (uWN == 0 || !hitSphere(ro, rd, uWAll, g0, g1)) return best;
  for (int i = 0; i < 16; i++) {
    if (i >= uWN) break;
    float t, t1;
    if (!hitSphere(ro, rd, uWS[i], t, t1)) continue;
    t = max(t, 0.0);
    t1 = min(t1, best);
    for (int j = 0; j < 40; j++) {
      if (t >= t1) break;
      float d = walkerDE(ro + rd * t, i);
      if (d < 0.0004 * t) { best = t; wi = i; break; }
      t += d;
    }
  }
  return best;
}
vec3 walkerNormal(vec3 p, int i) {
  const vec2 e = vec2(1.0, -1.0) * 0.002;
  return normalize(e.xyy * walkerDE(p + e.xyy, i) + e.yyx * walkerDE(p + e.yyx, i) + e.yxy * walkerDE(p + e.yxy, i) + e.xxx * walkerDE(p + e.xxx, i));
}
// the walkers on the stone around them: their shadows (each figure as one capsule: the distance of
// the shadow ray to it) and a contact darkening under the feet
void walkersOcc(vec3 p, vec3 L, bool shadow, inout float sh, inout float ao) {
  float g0, g1;
  bool nearAll = length(p - uWAll.xyz) < uWAll.w;
  if (uWN == 0 || (!nearAll && !(shadow && hitSphere(p, L, uWAll, g0, g1)))) return;
  for (int i = 0; i < 16; i++) {
    if (i >= uWN) break;
    vec4 S = uWS[i];
    vec4 B = uWB[i];
    float s = B.w;
    if (length(p - S.xyz) < S.w) {
      vec3 a = uWL[i].xyz, ba = uWR[i].xyz - a, pa = p - a;
      float d = length(pa - ba * sat(dot(pa, ba) / max(dot(ba, ba), 1e-6)));
      ao *= 1.0 - 0.6 * exp(-d * d / (0.04 * s * s));
    }
    float t0, t1;
    if (!shadow || !hitSphere(p, L, vec4(S.xyz, S.w + 0.15 * s), t0, t1)) continue;
    vec3 a = B.xyz + vec3(0.0, 0.12 * s, 0.0), ba = uWC[i].xyz + (uWC[i].xyz - B.xyz - vec3(0.0, 0.5 * s, 0.0)) * 0.6 - a;
    vec3 w = p - a;
    float baba = dot(ba, ba), bard = dot(ba, L), baw = dot(ba, w), rdw = dot(L, w);
    float uu = sat((baw - rdw * bard) / max(baba - bard * bard, 1e-6));
    float t = max(uu * bard - rdw, 0.0);
    uu = sat(dot(w + L * t, ba) / baba);
    float d = length(w + L * t - ba * uu);
    sh = min(sh, smoothstep(0.0, 1.0, (d - 0.07 * s) / (0.02 + 0.06 * t)));
  }
}

void main() {
  vec3 ro = camPos;
  vec3 rd = camRay(gl_FragCoord.xy);
  float pixA = 2.0 * camTan.y / taaRes.y;
  // the stairs first, inside their bounds; then the walkers; then the city up to them
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
  int wi;
  float tw = traceWalkers(ro, rd, min(ts, 6000.0), wi);
  float tn = min(ts, tw);
  CityHit H = traceCity(ro, rd, min(tn, 6000.0), pixA);
  float tc = H.kind > 0.5 ? H.t : 6000.0;
  vec3 col;
  float t;
  vec3 L = uSunDir;
  if (wi >= 0 && tw < tc) {
    // a walker: one flat colour, sun + sky, the stairs' shadow
    t = tw;
    vec3 p = ro + rd * t;
    vec3 n = walkerNormal(p, wi);
    float dif = max(dot(n, L), 0.0);
    float sh = dif > 0.0 ? stairsShadow(p + n * 0.02, L, -1) : 0.0;
    col = uWalkCol * (uSunCol * dif * sh + skyLight(n) * (0.75 + 0.25 * n.y) * (1.0 + 0.4 * uKick));
    col += citySky(reflect(rd, n)) * 0.02;
  } else if (ts < tc) {
    t = ts;
    vec3 p = ro + rd * t;
    float id, S; vec3 lq; int fk;
    stairsDE(p, id, lq, fk, S);
    // the tower's walls (the side faces of the flights below the stringer band) are flat faces:
    // analytic normal, light and occlusion instead of SDF probes — the tower can fill half the frame
    float h = uFB[fk].w;
    bool deep = lq.y < -2.5;
    Ink I = Ink(1e9, 1e9, 1.0, 1e9, vec2(0.0), vec3(0.0), 1e9);
    if (!deep) I = stairsInk(p, fk);
    bool wall = deep || (I.side > 0.5 && I.below > (uInk.z + 0.35) * h);
    vec2 u = uFB[fk].xy, v = vec2(-u.y, u.x);
    vec3 n;
    if (deep) {
      float len = uFA[fk].w * uFB[fk].z + uFC[fk].x;
      float db = 0.5 * uFC[fk].x - abs(lq.z), da0 = lq.x, da1 = len - lq.x;
      vec2 n2 = db < min(da0, da1) ? v * sign(lq.z) : da0 < da1 ? -u : u;
      n = vec3(n2.x, 0.0, n2.y);
    } else if (wall) {
      vec2 n2 = u * I.wn.x + v * I.wn.y;
      n = vec3(n2.x, 0.0, n2.y);
    } else if (I.fit < 0.0015 * t) {
      // on a face of the drawing: its normal, no SDF probes
      vec2 n2 = u * I.nl.x + v * I.nl.z;
      n = vec3(n2.x, I.nl.y, n2.y);
    } else n = stairsNormal(p, fk);
    // stone: pale, the block below with courses and blind arches
    vec3 stone = mix(hex2p3(C_DECADE), vec3(0.95, 0.9, 0.86), 0.45) * 0.72;
    float tread = smoothstep(0.6, 0.9, n.y);
    vec3 alb = stone * 0.9;
    if (!deep) {
      // drawn like the classic figure: light treads, dark risers, a stringer band that follows the
      // sawtooth along the side faces, ink at every convex edge, a soft crease at the foot of each riser
      if (I.side > 0.5) alb = I.below < uInk.z * h ? uStringer : alb;
      else alb = mix(uRiserAlb, uTreadAlb, tread);
    }
    float glass = 0.0;
    if (id > 1.5 && abs(n.y) < 0.5 && I.below > uInk.z * h) {
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
    if (wall) {
      // the court (left of every flight) is deep: sun reaches only its upper storeys
      bool inner = lq.z > 0.0 && abs(lq.z) > 0.5 * uFC[fk].x - 0.02;
      sh = inner ? smoothstep(-9.0, -3.0, lq.y) : 1.0;
      ao = inner ? mix(0.4, 0.85, smoothstep(-14.0, -3.0, lq.y)) : 0.92;
      ao = mix(ao, 1.0, smoothstep(-2.5, 0.0, lq.y));
      if (!deep) { float wsh = 1.0, wao = 1.0; walkersOcc(p + n * 0.01, L, dif > 0.0, wsh, wao); sh *= wsh; }
    } else {
      float wsh = 1.0, wao = 1.0;
      walkersOcc(p + n * 0.01, L, dif > 0.0, wsh, wao);
      sh = dif > 0.0 ? stairsShadow(p + n * 0.01, L, fk) * wsh : 0.0;
      float occ = 0.0;
      for (int i = 1; i <= 3; i++) {
        float hh = 0.07 * float(i * i);
        occ += max(hh - stairsDistEx(p + n * hh, fk == 0 ? 3 : fk == 3 ? 0 : -1), 0.0) / hh * pow(0.65, float(i));
      }
      ao = sat(1.0 - occ) * wao * mix(0.55, 1.0, smoothstep(0.0, 0.5 * h, I.crease));
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
    // ink: a line of constant width on screen at every convex edge of the steps
    float px = pixA * t * uInk.x;
    col = mix(col, uInkCol * (uSunCol * 0.02 + skyLight(n) * 0.5), uInk.y * (1.0 - smoothstep(0.5 * px, px, I.edge)));
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
  // the stairs and the walkers ride with the camera rig: negative depth → TAA reprojects them in rig space
  oDepth = tn < tc ? -t : H.kind > 0.5 ? t : 1e5;
}
