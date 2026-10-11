// S14 · Portrait (the word): shared by the word pass and the embers, so a stroke appears exactly where and
// when its embers land, and crumbles exactly where they lift off. Word frame: lib/glyphs (cap units,
// origin at the light point inside the A).
#include "lib/glyphs"

uniform vec4 S14;      // x: rows since 1C:00, y: 1 assembling, 2 erasing, 0 still, z: rows an erasure step takes
uniform float landS[7]; // per letter of EFFACED: its embers land between these rows…
uniform float landE[7]; // …
uniform float eraseS[7];// per letter: the row of the erasure step that crumbles it

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

// 0 on a letter's side nearest the point … 1 on its far side (the A: from the point outwards), with a
// turbulent front
float sideT(vec2 p, int k) {
  float t;
  if (k == 3) {
    t = length(p) / 0.95;
  } else {
    vec2 xb = GLY_XB[GLY_WL[k]] + GLY_WX[k];
    float inner = GLY_WX[k] < 0.0 ? xb.y : xb.x, outer = GLY_WX[k] < 0.0 ? xb.x : xb.y;
    t = (p.x - inner) / (outer - inner);
  }
  return clamp(t + 0.35 * (vnoiseS(p * 7.0 + float(k) * 3.1) - 0.5), 0.0, 1.0);
}
float landRow(vec2 p, int k) { return mix(landS[k], landE[k], sideT(p, k)); }
// a letter crumbles from its far side towards the point
float eraseRow(vec2 p, int k) { return eraseS[k] + S14.z * (1.0 - sideT(p, k)); }
