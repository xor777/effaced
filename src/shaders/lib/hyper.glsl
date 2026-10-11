// {p,q} tilings of constant curvature in ONE conformal chart — the stereographic chart of the sphere
// (p < 6 for q = 3), the plane (p = 6), the Poincaré disc (p > 6) — by folding into the (p, q, 2)
// triangle: the x-axis, the line at angle π/p, and a generalised circle through the edge midpoint
// M = (xM, 0), centred on the x-axis, with signed curvature k (k > 0 hyperbolic, k = 0 a straight
// line, k < 0 spherical). Every step is a reflection or a circle inversion, written in a form that
// stays exact as k passes through 0, so p can flow continuously; for non-integer p the dihedral fold
// does not close and the tiling tears along a ray and all its images.
// T = (2π/p, xM, k, φ(origin)) — computed on the CPU (s11-inversion.ts, tileParams).
// The inverse of the fold is carried as an (anti-)Möbius matrix, so every pixel also knows the centre
// of its tile in the original chart — a per-tile identity that is the same for every pixel of it.
#include "lib/mobius"

struct Tile {
  vec2 u;       // folded point in the fundamental triangle
  float gen;    // circle inversions = tile distance from the central tile
  float sc;     // |du_folded / du| (conformal scale of the fold)
  float edge;   // chart distance to the tile edge, in folded coordinates (divide by sc)
  vec2 ctr;     // the tile's centre in the original chart (huge for the tile at ∞)
};

Tile tileFold(vec2 u, vec4 T) {
  float sector = T.x, xM = T.y, k = T.z, phiO = T.w;
  float gen = 0.0, sc = 1.0;
  // G = fold⁻¹ as z ↦ (m00 w + m01) / (m10 w + m11), w = conj(z) when cf = 1
  vec2 m00 = vec2(1.0, 0.0), m01 = vec2(0.0), m10 = vec2(0.0), m11 = vec2(1.0, 0.0);
  float cf = 0.0;
  // the inversion as a real anti-Möbius matrix (exact through k = 0)
  float s00 = k * xM + 1.0, s01 = -k * xM * xM - 2.0 * xM, s10 = k, s11 = -k * xM - 1.0;
  for (int i = 0; i < 48; i++) {
    float th = atan(u.y, u.x);
    float kk = floor(th / sector + 0.5);
    float a = kk * sector;
    th -= a;
    // G ← G ∘ rot(+a)   (rotation conjugated when G is anti-holomorphic)
    vec2 e = vec2(cos(a), cf > 0.5 ? -sin(a) : sin(a));
    m00 = cmul(m00, e);
    m10 = cmul(m10, e);
    if (th < 0.0) { th = -th; cf = 1.0 - cf; }                     // reflection in the x-axis
    u = length(u) * vec2(cos(th), sin(th));
    vec2 v = u - vec2(xM, 0.0);
    float vv = dot(v, v);
    if ((k * vv - 2.0 * v.x) * phiO >= 0.0) break;                // on the centre's side of the mirror
    float D = 1.0 - 2.0 * k * v.x + k * k * vv;
    u = vec2(xM + (v.x - (2.0 * v.x - k * vv)) / D, v.y / D);     // the inversion
    sc /= D;
    gen += 1.0;
    // G ← G ∘ inversion
    vec2 n00 = m00 * s00 + m01 * s10, n01 = m00 * s01 + m01 * s11;
    vec2 n10 = m10 * s00 + m11 * s10, n11 = m10 * s01 + m11 * s11;
    float mx = max(max(length(n00), length(n01)), max(length(n10), length(n11)));
    m00 = n00 / mx; m01 = n01 / mx; m10 = n10 / mx; m11 = n11 / mx;
    cf = 1.0 - cf;
  }
  vec2 v = u - vec2(xM, 0.0);
  float edge = abs(k * dot(v, v) - 2.0 * v.x) / (2.0 * length(k * v - vec2(1.0, 0.0)));
  vec2 ctr = dot(m11, m11) > 1e-12 ? cdiv(m01, m11) : vec2(1e6);
  return Tile(u, gen, sc, edge, ctr);
}
