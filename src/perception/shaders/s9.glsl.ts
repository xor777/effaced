// S9 · Stillness — two optional prototypes.
//
// HYBRID_FS: hybrid image (Oliva–Torralba–Schyns). Low-pass = the FACE_LIB mask with closed eyes,
// rendered with gaussian-blurred contours of sigma lowS. High-pass = Villarceau circles of nested tori
// (the Hopf fibration seen along its axis), each line drawn as a zero-mean difference of gaussians, so
// the pattern carries no low frequencies at all. The DOF reveal is previewed ANALYTICALLY: blurring by
// a gaussian b turns every gaussian σ into sqrt(σ² + b²) (line DoG and face contours alike), so the
// pattern dissolves while the face survives — no render targets needed.
//
// DRIFT_FS: peripheral drift (Kitaoka's "Rotating Snakes"): repeating black → dark → white → light
// sequences; motion is seen from black towards dark and from white towards light, in the periphery.
// Layout 'concentric' = classic wheels, 'hopf' = the same snakes laid along Villarceau circles.

import { COMMON } from './common.glsl.ts';
import { FACE_LIB } from './face.glsl.ts';

const VILLARCEAU = /* glsl */ `
// Villarceau circle i of torus t, seen from above: an ellipse (R·cosα, R) whose centre is offset by r
// along direction th; α = asin(r/R). Returns the ellipse-local position.
vec2 villarceau(vec2 q, float t, float i, float circles, out vec2 axes) {
  float R = 0.16 + 0.11 * t, r = 0.8 * R;          // r/R = 0.8: the circles sweep over the centre
  float ca = sqrt(1.0 - (r * r) / (R * R));
  float th = TAU * (i + 0.5 * t) / circles;
  vec2 c = r * vec2(cos(th), sin(th));
  axes = vec2(R * ca, R);
  return rot(th) * (q - c);
}
`;

export const HYBRID_FS = /* glsl */ `
in vec2 uv;
out vec4 o;
uniform vec2 center;
uniform float scale;      // H per face unit
uniform float dofH;       // H: preview blur
uniform float faceAmp, patAmp, base;
uniform float lineS, surround; // H
uniform float tori, circles;
uniform vec3 colA, colB;  // linear palette ends
${VILLARCEAU}
float gl1(float d, float s0, float s) { return (s0 / s) * exp(-0.5 * d * d / (s * s)); }

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  // low-pass face, closed eyes; the DOF blur adds in quadrature
  // (edgeS = featS = sqrt(lowS² + (dofH/scale)²) are set from JS: the face blur adds in quadrature)
  pxF = 1.0 / (res.y * scale);
  float V = faceDesign((q - center) / scale);
  // high-pass Hopf lines (DoG: zero mean)
  float s1 = sqrt(lineS * lineS + dofH * dofH), s2 = sqrt(surround * surround * lineS * lineS + dofH * dofH);
  float P = 0.0;
  for (int t = 0; t < 4; t++) {
    if (float(t) >= tori) break;
    for (int i = 0; i < 48; i++) {
      if (float(i) >= circles) break;
      vec2 ax;
      vec2 lp = villarceau(q, float(t), float(i), circles, ax);
      float d = sdEllipse(lp, ax);
      P += gl1(d, lineS, s1) - gl1(d, lineS, s2);
    }
  }
  float g = base + faceAmp * (V / 1.3) + patAmp * P;
  vec3 col = mix(colA, colB, clamp(g, 0.0, 1.0));
  o = vec4(encodeOut(col), 1.0);
}
`;

export const DRIFT_FS = /* glsl */ `
in vec2 uv;
out vec4 o;
uniform float layout_;    // 0 concentric, 1 hopf
uniform float rings, segments, wheels, radius, contrast, width, circles;
uniform vec3 c0, c1, c2, c3; // linear: black, dark, white, light
uniform vec3 bgc;
${VILLARCEAU}
vec3 seq(float u, float aa) {
  // black [0,.18) dark [.18,.5) white [.5,.68) light [.68,1), antialiased boundaries
  u = fract(u);
  vec3 c = mix(c3, c0, smoothstep(-aa, aa, u));
  c = mix(c, c1, smoothstep(0.18 - aa, 0.18 + aa, u));
  c = mix(c, c2, smoothstep(0.5 - aa, 0.5 + aa, u));
  c = mix(c, c3, smoothstep(0.68 - aa, 0.68 + aa, u));
  c = mix(c, c0, smoothstep(1.0 - aa, 1.0 + aa, u));
  vec3 m = 0.5 * (c0 + c2);
  return m + contrast * (c - m);
}

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  float px = 1.0 / res.y;
  vec3 col = bgc;
  if (layout_ < 0.5) {
    // wheels on a grid
    float nx = wheels < 1.5 ? 1.0 : wheels < 2.5 ? 2.0 : wheels < 4.5 ? 2.0 : 3.0;
    float ny = wheels < 2.5 ? 1.0 : 2.0;
    float R = radius / max(nx * 0.8, ny);
    vec2 cell = vec2(2.0 * R + 0.02);
    vec2 g = q / cell + 0.5 * vec2(nx, ny);
    vec2 id = clamp(floor(g), vec2(0.0), vec2(nx - 1.0, ny - 1.0));
    vec2 c = (id + 0.5 - 0.5 * vec2(nx, ny)) * cell;
    vec2 l = q - c;
    float r = length(l);
    float flip = mod(id.x + id.y, 2.0) * 2.0 - 1.0;
    float r0 = 0.12 * R;                               // a small calm centre, as in Kitaoka's wheels
    if (r < R && r > r0) {
      float rw = (R - r0) / rings;
      float ri = floor((r - r0) / rw), rf = fract((r - r0) / rw);
      float segs = max(6.0, floor(segments * (r0 + (ri + 0.5) * rw) / R + 0.5)); // constant scale size
      float u = (atan(l.y, l.x) / TAU) * segs + 0.5 * mod(ri, 2.0);
      u += 0.12 * sin(PI * rf);                       // curved scales
      if (mod(ri, 2.0) > 0.5) u = -u;                 // neighbours drift the other way
      u *= flip;
      float aa = 1.2 * px * segs / (TAU * max(r, 1e-3));
      col = seq(u, aa);
      col = mix(col, c0, smoothstep(0.03, 0.0, min(rf, 1.0 - rf)) * 0.35); // ring seams
    }
  } else {
    for (int t = 0; t < 3; t++) {
      for (int i = 0; i < 48; i++) {
        if (float(i) >= circles) break;
        vec2 ax;
        vec2 lp = villarceau(q, float(t), float(i), circles, ax);
        float d = sdEllipse(lp, ax);
        float band = abs(d) - 0.5 * width;
        if (band < px) {
          float u = (atan(lp.y / ax.y, lp.x / ax.x) / TAU) * segments;
          if (mod(float(i) + float(t), 2.0) > 0.5) u = -u;
          float aa = 1.2 * px * segments / (TAU * ax.y);
          vec3 c = seq(u, aa);
          float edge = clamp(0.5 - band / px, 0.0, 1.0);
          col = mix(col, c0, clamp(0.5 - (band - px * 1.5) / px, 0.0, 1.0)); // dark outline
          col = mix(col, c, edge);
        }
      }
    }
  }
  o = vec4(encodeOut(col), 1.0);
}
`;

export const HYBRID_SRC = COMMON + FACE_LIB + HYBRID_FS;
export const DRIFT_SRC = COMMON + DRIFT_FS;
