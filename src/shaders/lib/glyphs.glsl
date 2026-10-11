// lib/glyphs — the creature's alphabet (PLAN §2.5): it has no font, only constructions. Six letters A–F,
// each a few compass arcs and ruler segments cut from the geometry of its sigil: the module circle
// (diameter = cap height), its diameters and radii, the equilateral triangle. One pen for everything.
//
//   A  Euclid I.1: the two sides of an equilateral triangle on the baseline (apex at the cap line,
//      found by two circles of radius = the base around its ends) and, for the bar, an arc of the
//      compass set in the apex (r = 3/4), sagging between the legs.
//   B  a stem and two half circles stacked on it (the lower one larger).
//   C  the module circle with an 80° gap on the right (the two radii at ±40° mark it).
//   D  a stem and the half of a circle whose diameter it is.
//   E  the left half of the module circle, its horizontal diameter, two tangents at the cap and base.
//   F  E's construction with the lower quarter straightened into a stem and no foot.
//
// Units: cap height 1. Letter-local: baseline y = 0, cap line y = 1, x = 0 on the letter's axis.
// Word frame (EFFACED): x right, y up, origin at the centre of the A's module circle (local (0, 0.5)) —
// the point S14's light sits on, inside the A's triangle; mid-cap height is y = 0.
//
// API (no dependencies; safe to include next to lib/common or the perception COMMON):
//   GLY_STROKE                          half-width of the creature's pen (cap units): ink = d < GLY_STROKE
//   GLY_NODE                            radius of the marked points (stroke ends and joints, as in a diagram)
//   float glySeg(vec2 p, vec2 a, vec2 b)                distance to a segment
//   float glyArc(vec2 p, vec2 c, float r, vec2 a01)     distance to a circular arc, angles in radians, ccw
//   float glyph(int L, vec2 p)          distance to the skeleton of letter L (0 A, 1 B, 2 C, 3 D, 4 E, 5 F),
//                                       p letter-local
//   float glyphNodes(int L, vec2 p)     distance to the nearest marked point of letter L (stroke ends), letter-local
//   float glyphConstruction(int L, vec2 p)   distance to L's construction: the full circles of its arcs,
//                                       the lines of its segments, and its construction-only circles/lines
//   float glyphWord(vec2 p, out int i)  EFFACED: distance to the nearest skeleton, i = letter 0..6 in the word;
//                                       p in the word frame. Letters are culled by their boxes, so it's cheap
//   GLY_WL[7], GLY_WX[7]                the word: alphabet index and axis x of each letter (word frame)
//   GLY_XB[6]                           ink extent of each letter on x (letter-local, skeleton, no stroke)
//   GLY_WORD_BOX                        the word's skeleton box (word frame): x0, y0, x1, y1
// Typical use: ink = smoothstep(GLY_STROKE + px, GLY_STROKE - px, glyphWord(p, i)), plus the nodes of letter i
// (glyphNodes < GLY_NODE); a low-pass of the word = a wide smoothstep (or a gaussian) of glyphWord alone.
//
// The block between @glyphs-data and @end is parsed by src/gfx/glyphs.ts (sampled points and
// polylines for particles and beams): keep its format — numbers only, // comments allowed.
// Primitive = 6 floats: kind, then
//   kind 0  ink segment     x0 y0 x1 y1 0
//   kind 1  ink arc         cx cy r a0 a1     (degrees, counter-clockwise from +x, a0 < a1)
//   kind 2  construction circle   cx cy r 0 0
//   kind 3  construction line     x y angle 0 0 (degrees)

// @glyphs-data
#define GLY_STROKE 0.024
#define GLY_NODE 0.052
const float GLY_D[150] = float[150](
  // A
  0.0,  0.0, 1.0, -0.57735, 0.0, 0.0,
  0.0,  0.0, 1.0, 0.57735, 0.0, 0.0,
  1.0,  0.0, 1.0, 0.75, 240.0, 300.0,
  2.0,  -0.57735, 0.0, 1.1547, 0.0, 0.0,
  2.0,  0.57735, 0.0, 1.1547, 0.0, 0.0,
  3.0,  0.0, 0.0, 0.0, 0.0, 0.0,
  // B
  0.0,  -0.14, 0.0, -0.14, 1.0, 0.0,
  1.0,  -0.14, 0.77, 0.23, -90.0, 90.0,
  1.0,  -0.14, 0.27, 0.27, -90.0, 90.0,
  // C
  1.0,  0.0, 0.5, 0.5, 40.0, 320.0,
  3.0,  0.0, 0.5, 40.0, 0.0, 0.0,
  3.0,  0.0, 0.5, -40.0, 0.0, 0.0,
  // D
  0.0,  -0.25, 0.0, -0.25, 1.0, 0.0,
  1.0,  -0.25, 0.5, 0.5, -90.0, 90.0,
  3.0,  -0.25, 0.5, 0.0, 0.0, 0.0,
  // E
  1.0,  0.0, 0.5, 0.5, 90.0, 270.0,
  0.0,  0.0, 1.0, 0.42, 1.0, 0.0,
  0.0,  0.0, 0.0, 0.42, 0.0, 0.0,
  0.0,  -0.5, 0.5, 0.3, 0.5, 0.0,
  3.0,  0.0, 0.5, 90.0, 0.0, 0.0,
  // F
  1.0,  0.0, 0.5, 0.5, 90.0, 180.0,
  0.0,  -0.5, 0.5, -0.5, 0.0, 0.0,
  0.0,  0.0, 1.0, 0.42, 1.0, 0.0,
  0.0,  -0.5, 0.5, 0.3, 0.5, 0.0,
  2.0,  0.0, 0.5, 0.5, 0.0, 0.0
);
// first primitive and count per letter A B C D E F
const int GLY_R[12] = int[12](0, 6, 6, 3, 9, 3, 12, 3, 15, 5, 20, 5);
// ink extent on x per letter A B C D E F (skeleton)
const vec2 GLY_XB[6] = vec2[6](vec2(-0.57735, 0.57735), vec2(-0.14, 0.13), vec2(-0.5, 0.383), vec2(-0.25, 0.25),
                              vec2(-0.5, 0.42), vec2(-0.5, 0.42));
// the word EFFACED: letters, and the x of each letter's axis in the word frame
const int GLY_WL[7] = int[7](4, 5, 5, 0, 2, 4, 3);
const float GLY_WX[7] = float[7](-3.577, -2.357, -1.177, 0.0, 1.277, 2.52, 3.49);
const vec4 GLY_WORD_BOX = vec4(-4.077, -0.5, 3.74, 0.5);
// @end

float glySeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

float glyArc(vec2 p, vec2 c, float r, vec2 a01) {
  float am = 0.5 * (a01.x + a01.y), ha = 0.5 * (a01.y - a01.x);
  vec2 q = p - c;
  float cm = cos(am), sm = sin(am);
  q = vec2(cm * q.x + sm * q.y, abs(-sm * q.x + cm * q.y)); // mid-angle along +x, folded
  vec2 e = r * vec2(cos(ha), sin(ha));                       // the arc's end
  return e.x * q.y > e.y * q.x ? length(q - e) : abs(length(q) - r);
}

float glyph(int L, vec2 p) {
  int s = GLY_R[2 * L], n = GLY_R[2 * L + 1];
  float d = 1e9;
  for (int k = 0; k < 8; k++) {
    if (k >= n) break;
    int o = 6 * (s + k);
    float kind = GLY_D[o];
    vec4 a = vec4(GLY_D[o + 1], GLY_D[o + 2], GLY_D[o + 3], GLY_D[o + 4]);
    if (kind < 0.5) d = min(d, glySeg(p, a.xy, a.zw));
    else if (kind < 1.5) d = min(d, glyArc(p, a.xy, a.z, radians(vec2(a.w, GLY_D[o + 5]))));
  }
  return d;
}

float glyphNodes(int L, vec2 p) {
  int s = GLY_R[2 * L], n = GLY_R[2 * L + 1];
  float d = 1e9;
  for (int k = 0; k < 8; k++) {
    if (k >= n) break;
    int o = 6 * (s + k);
    float kind = GLY_D[o];
    vec4 a = vec4(GLY_D[o + 1], GLY_D[o + 2], GLY_D[o + 3], GLY_D[o + 4]);
    if (kind < 0.5) {
      d = min(d, min(length(p - a.xy), length(p - a.zw)));
    } else if (kind < 1.5) {
      vec2 an = radians(vec2(a.w, GLY_D[o + 5]));
      d = min(d, min(length(p - a.xy - a.z * vec2(cos(an.x), sin(an.x))), length(p - a.xy - a.z * vec2(cos(an.y), sin(an.y)))));
    }
  }
  return d;
}

float glyphConstruction(int L, vec2 p) {
  int s = GLY_R[2 * L], n = GLY_R[2 * L + 1];
  float d = 1e9;
  for (int k = 0; k < 8; k++) {
    if (k >= n) break;
    int o = 6 * (s + k);
    float kind = GLY_D[o];
    vec4 a = vec4(GLY_D[o + 1], GLY_D[o + 2], GLY_D[o + 3], GLY_D[o + 4]);
    if (kind < 0.5) {
      vec2 t = normalize(a.zw - a.xy);
      d = min(d, abs(dot(p - a.xy, vec2(-t.y, t.x))));
    } else if (kind < 2.5) {
      d = min(d, abs(length(p - a.xy) - a.z));
    } else {
      float an = radians(a.z);
      d = min(d, abs(dot(p - a.xy, vec2(-sin(an), cos(an)))));
    }
  }
  return d;
}

float glyphWord(vec2 p, out int i) {
  float d = 1e9;
  i = 0;
  for (int k = 0; k < 7; k++) {
    int L = GLY_WL[k];
    vec2 q = p - vec2(GLY_WX[k], -0.5);
    // lower bound of the distance to this letter (its box): skip it if it can't beat the best so far
    vec2 b = max(vec2(GLY_XB[L].x - q.x, -q.y), vec2(q.x - GLY_XB[L].y, q.y - 1.0));
    if (length(max(b, 0.0)) >= d) continue;
    float dk = glyph(L, q);
    if (dk < d) {
      d = dk;
      i = k;
    }
  }
  return d;
}
