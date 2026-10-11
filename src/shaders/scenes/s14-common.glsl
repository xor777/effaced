// S14 · Portrait (the word): shared by the word pass and the embers, so a stroke appears exactly where and
// when its embers land, and crumbles exactly where they lift off. Word frame: lib/glyphs (cap units, origin
// at the light point inside the A). The word lies in the plane z = 0 of a slowly moving camera that always
// looks at the point, so the point stays at the centre of the frame.
#include "lib/glyphs"
#define S14_TAU 6.2831853

uniform vec4 S14;       // x: rows since 1C:00, y: 1 assembling, 2 erasing, 0 still, z: rows an erasure step takes
uniform float landS[7]; // per letter of EFFACED: its embers land between these rows…
uniform float landE[7]; // …
uniform float eraseS[7];// per letter: the row of the erasure step that crumbles it
uniform vec2 woff[7];   // per letter: offset in the word frame (flinching, FACE closing up)
uniform float bells[16];// rows of the bell's notes (each sends a wave of light across the word), far future = unused
uniform mat3 camR;      // camera → world
uniform vec3 camC;      // camera position (frame heights)
uniform float camF;     // focal length (frame heights)
uniform float cap;      // frame heights per cap unit

float hashS(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoiseS(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashS(i), hashS(i + vec2(1.0, 0.0)), f.x), mix(hashS(i + vec2(0.0, 1.0)), hashS(i + vec2(1.0, 1.0)), f.x), f.y);
}

// screen (frame heights from the centre) → word frame
vec2 toWord(vec2 q) {
  vec3 dir = camR * vec3(q, -camF);
  return (camC.xy - camC.z / dir.z * dir.xy) / cap;
}
// word frame → screen (frame heights from the centre); z = the zoom there (screen per world size)
vec3 toScreen(vec2 p) {
  vec3 c = transpose(camR) * (vec3(p * cap, 0.0) - camC);
  return vec3(camF * c.xy / -c.z, camF / -c.z);
}

// 0 on a letter's side nearest the point … 1 on its far side (the A: from the point outwards), with a
// turbulent front. q: letter-local (word frame minus the letter's place)
float sideT(vec2 q, int k) {
  float t;
  vec2 p = q + vec2(GLY_WX[k], -0.5);
  if (k == 3) {
    t = length(p) / 0.95;
  } else {
    vec2 xb = GLY_XB[GLY_WL[k]] + GLY_WX[k];
    float inner = GLY_WX[k] < 0.0 ? xb.y : xb.x, outer = GLY_WX[k] < 0.0 ? xb.x : xb.y;
    t = (p.x - inner) / (outer - inner);
  }
  return clamp(t + 0.35 * (vnoiseS(p * 7.0 + float(k) * 3.1) - 0.5), 0.0, 1.0);
}
float landRow(vec2 q, int k) { return mix(landS[k], landE[k], sideT(q, k)); }
// a letter crumbles from its far side towards the point
float eraseRow(vec2 q, int k) { return eraseS[k] + S14.z * (1.0 - sideT(q, k)); }

// the bell's waves: light running out of the point across the word (x: distance from the point, cap units)
float bellWave(float x, float row) {
  float w = 0.0;
  for (int i = 0; i < 16; i++) {
    float t = row - bells[i];
    if (t > 0.0 && t < 30.0) {
      float e = (x - 0.5 * t) / 0.6;
      w += exp(-e * e) * exp(-t / 16.0);
    }
  }
  return w;
}

// ink primitive pg (global index into GLY_D) at u ∈ 0..1: letter-local point, unit tangent (pen direction)
vec4 primAt(int pg, float u) {
  int o = 6 * pg;
  vec4 a = vec4(GLY_D[o + 1], GLY_D[o + 2], GLY_D[o + 3], GLY_D[o + 4]);
  if (GLY_D[o] < 0.5) return vec4(mix(a.xy, a.zw, u), normalize(a.zw - a.xy));
  float an = radians(mix(a.w, GLY_D[o + 5], u));
  return vec4(a.xy + a.z * vec2(cos(an), sin(an)), -sin(an), cos(an));
}
float primLen(int pg) {
  int o = 6 * pg;
  return GLY_D[o] < 0.5 ? length(vec2(GLY_D[o + 3] - GLY_D[o + 1], GLY_D[o + 4] - GLY_D[o + 2]))
                        : GLY_D[o + 3] * radians(GLY_D[o + 5] - GLY_D[o + 4]);
}

// lower bound of the distance from p (word frame) to letter i's box
float letterBound(int i, vec2 p) {
  int L = GLY_WL[i];
  vec2 q = p - vec2(GLY_WX[i], -0.5) - woff[i];
  vec2 b = max(vec2(GLY_XB[L].x - q.x, -q.y), vec2(q.x - GLY_XB[L].y, q.y - 1.0));
  return length(max(b, 0.0));
}

// the strokes of letter i: keeps the nearest in d (letter k, arc length s along it) and the nearest marked
// point in dn
void letterAt(int i, vec2 p, inout float d, inout int k, inout float dn, inout float s) {
  int L = GLY_WL[i];
  vec2 q = p - vec2(GLY_WX[i], -0.5) - woff[i];
  int st = GLY_R[2 * L], n = GLY_R[2 * L + 1];
  for (int j = 0; j < 8; j++) {
    if (j >= n) break;
    int o = 6 * (st + j);
    float kind = GLY_D[o];
    if (kind > 1.5) continue;
    vec4 a = vec4(GLY_D[o + 1], GLY_D[o + 2], GLY_D[o + 3], GLY_D[o + 4]);
    float dj, sj;
    vec2 e0, e1;
    if (kind < 0.5) {
      vec2 pa = q - a.xy, ba = a.zw - a.xy;
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      dj = length(pa - ba * h);
      sj = h * length(ba);
      e0 = a.xy;
      e1 = a.zw;
    } else {
      vec2 an = radians(vec2(a.w, GLY_D[o + 5]));
      dj = glyArc(q, a.xy, a.z, an);
      vec2 r = q - a.xy;
      float ang = an.x + mod(atan(r.y, r.x) - an.x, S14_TAU), span = an.y - an.x;
      float u = ang <= an.y ? (ang - an.x) / span : (ang - an.y < 0.5 * (S14_TAU - span) ? 1.0 : 0.0);
      sj = u * a.z * span;
      e0 = a.xy + a.z * vec2(cos(an.x), sin(an.x));
      e1 = a.xy + a.z * vec2(cos(an.y), sin(an.y));
    }
    if (dj < d) {
      d = dj;
      k = i;
      s = sj;
    }
    dn = min(dn, min(length(q - e0), length(q - e1)));
  }
}

// the nearest stroke of the word: distance; k = letter 0..6; dn = distance to the nearest marked point;
// s = arc length along the stroke from its start (the pen direction). p: word frame. The nearest letter box
// is evaluated first, so the others are culled by their boxes; `reach`: give up (return ≥ reach) beyond it
float wordAt(vec2 p, float reach, out int k, out float dn, out float s) {
  float d = 1e9;
  k = 0;
  dn = 1e9;
  s = 0.0;
  int k0 = 0;
  float b0 = 1e9;
  for (int i = 0; i < 7; i++) {
    float b = letterBound(i, p);
    if (b < b0) {
      b0 = b;
      k0 = i;
    }
  }
  if (b0 >= reach) return b0;
  letterAt(k0, p, d, k, dn, s);
  for (int i = 0; i < 7; i++) {
    if (i == k0 || letterBound(i, p) >= min(d, dn)) continue;
    letterAt(i, p, d, k, dn, s);
  }
  return d;
}
