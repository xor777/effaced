// complex numbers as vec2, Möbius maps, circle / sphere inversion (S07 Indra, S11 Inversion)

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cinv(vec2 a) { return vec2(a.x, -a.y) / dot(a, a); }
vec2 cdiv(vec2 a, vec2 b) { return cmul(a, cinv(b)); }
vec2 cconj(vec2 a) { return vec2(a.x, -a.y); }

// Möbius map z -> (A z + B) / (C z + D); m0 = (A, B), m1 = (C, D) as complex pairs
vec2 mob(vec4 m0, vec4 m1, vec2 z) { return cdiv(cmul(m0.xy, z) + m0.zw, cmul(m1.xy, z) + m1.zw); }

// inversion in the circle / sphere (c, r²)
vec2 circInv(vec2 p, vec2 c, float r2) { vec2 d = p - c; return c + d * (r2 / dot(d, d)); }
vec3 sphInv(vec3 p, vec3 c, float r2) { vec3 d = p - c; return c + d * (r2 / dot(d, d)); }

// a holomorphic germ: value z and its first two derivatives w.r.t. the screen coordinate.
// Every step of a Möbius fold updates all three exactly, so circle geometry (centre, radius, normal of
// the dome over a disc) can be read back analytically at the end — no finite differences.
struct Germ { vec2 z, d1, d2; };

Germ germAdd(Germ g, vec2 c) { g.z += c; return g; }
Germ germNeg(Germ g) { return Germ(-g.z, -g.d1, -g.d2); }
// z -> 1/z
Germ germInv(Germ g) {
  vec2 w = cinv(g.z), w2 = cmul(w, w);
  return Germ(w, -cmul(g.d1, w2), -cmul(g.d2, w2) + 2.0 * cmul(cmul(g.d1, g.d1), cmul(w2, w)));
}

// For a germ that maps a disc D (in screen px) conformally onto the half-plane Im z > h:
// s = (Im z - h) / |z'| = (R² - r²) / 2R, r = distance to the disc centre, R its radius.
// Returns (s, ∇s): ∇s = -(p - centre)/R, i.e. minus the xy of the unit dome normal.
vec3 domeOf(Germ g, float h) {
  float m = length(g.d1);
  float Y = g.z.y - h;
  vec2 gY = vec2(g.d1.y, g.d1.x);                // ∇ Im z
  vec2 q = cmul(cconj(g.d1), g.d2);
  vec2 gM = vec2(q.x, -q.y) / m;                 // ∇ |z'|
  return vec3(Y / m, gY / m - Y * gM / (m * m));
}
