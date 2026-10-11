// S14 · Portrait → S15 · Effaced (the perception lab keeps the afterimage ending as an option).
//
// FACE_LIB is the procedural mask: a symmetric, icon-like, androgynous face built from compass-and-
// ruler primitives (ellipses, circle arcs, vesica eyes, quadratic Béziers) inside a nimbus that is a
// 65537-gon. It returns a DESIGN value V = the brightness the AFTERIMAGE should have (1 = skin glow,
// 0 = no afterimage = background white, > 1 = brighter). Because a negative afterimage is brightest
// where the adapting stimulus was darkest/most saturated, the stimulus ink is V itself: the face on
// screen is the colour negative of the face we want the retina to draw (dark-teal skin, dark sclera,
// pale iris/pupil, pale brows and lash lines, pale hair). Positive polarity in the afterimage is what
// makes it read as a face — negated faces are notoriously hard to recognise (Galper 1970).
//
// FACE_FS maps ink → colour: 0 = white field, 1 = face colour, 2 = face colour × deep (linear light,
// so ink is proportional to the change in cone excitation that drives adaptation).
// FACE_FS adds S14's assembly and erasure (ASM_LIB: the face develops where the embers land and crumbles
// where they lift off, the dawn and the dark, the spark drawing the 65537-gon) and S15's black with the
// point and the beam (or the lab's white afterimage field). The embers are point sprites (EMBER_VS/FS).
// Port: src/shaders/scenes/s14-portrait.glsl = COMMON + FACE_LIB + ASM_LIB + FACE_FS (S15: faceOn = 0).

import { COMMON } from './common.glsl.ts';

export const FACE_LIB = /* glsl */ `
uniform float featK;      // feature contrast (1 = as designed, 0 = flat, < 0 = stimulus-positive)
uniform float modelling;  // soft volume shading
uniform vec4 tones;       // hair, nimbus fill, ring, garment (design values)
uniform float strands;    // hair strand modulation
uniform float edgeS;      // gaussian sigma of outer contours (face units)
uniform float featS;      // gaussian sigma of inner features (face units)
uniform vec3 frame;       // nimbus apothem, ring width (face units), number of sides
uniform float eyesOpen;   // 1 = S14, 0 = S9 (closed)

float pxF;                // pixel size in face units (set by main)
float gN;                 // out: signed distance to the 65537-gon (set by faceDesign; S14 breathes on it)

float cv(float d, float s) { return cov(d, sqrt(s * s + 0.25 * pxF * pxF)); }
float fv(float v) { return 1.0 + featK * (v - 1.0); }
float bump(vec2 p, vec2 c, vec2 r) { return exp(-dot2((p - c) / r)); }

float faceOval(vec2 p) {
  float a = sdEllipse(p - vec2(0.0, -0.10), vec2(0.345, 0.50));   // cranium/cheeks: top 0.40
  float b = sdEllipse(p - vec2(0.0, -0.265), vec2(0.285, 0.402)); // jaw: chin at -0.667
  return smin(a, b, 0.05);
}

// p: face units, glabella (fixation) at the origin, y up; hairline +1/3, chin −2/3 (classical thirds)
float faceDesign(vec2 p) {
  vec2 s = vec2(abs(p.x), p.y);
  float V = 0.0;

  // nimbus: a 65537-gon (fill)
  float dN = sdNgon(p, frame.x, frame.z);
  gN = dN;
  float inN = cv(dN, edgeS);
  V = mix(V, tones.y, inN);
  // halo punchwork, behind the bust: an inner ring and 257 punched dots (257 = 2^8+1, act IV)
  float rIn = frame.x - 0.05;
  V = mix(V, tones.z * 0.7, cv(abs(length(p) - rIn) - 0.25 * frame.y, featS));
  float an257 = TAU / 257.0;
  float aq = (floor(atan(p.x, p.y) / an257) + 0.5) * an257;
  V = mix(V, tones.z * 0.8, cv(length(p - (frame.x - 0.025) * vec2(sin(aq), cos(aq))) - 0.0065, featS));

  // hair behind: skull + two curtains falling to the shoulders. Strands = lines of constant u, the
  // horizontal position normalised by the hair's half-width at that height: they leave the parting,
  // follow the skull and fall parallel to the silhouette (icon-style combed hair)
  float dFace = faceOval(p);
  float dSkull = sdEllipse(p - vec2(0.0, 0.07), vec2(0.455, 0.565));
  float dCurt = sdEllipse(s - vec2(0.33, -0.46), vec2(0.165, 0.62));
  float dHair = smin(dSkull, dCurt, 0.14);
  float yy = clamp((p.y - 0.07) / 0.6, 0.0, 1.0);
  float hwid = 0.47 * sqrt(max(1.0 - yy * yy, 0.0)) + 0.03;
  float u = s.x / hwid + 0.035 * sin(p.y * 7.0 + s.x * 6.0);
  float su = u * 10.0;
  float sAmp = strands * smoothstep(0.9, 0.3, fwidth(su));
  float str = sAmp * (0.75 * sin(su * TAU) + 0.25 * sin(su * 2.0 * TAU + 1.0));
  float hairV = tones.x * (1.0 + 0.16 * str);
  V = mix(V, hairV, cv(dHair, edgeS) * inN);

  // neck with the shadow under the jaw
  float nw = 0.105 + 0.05 * smoothstep(-0.70, -0.92, p.y);
  float dNeck = max(abs(p.x) - nw, p.y + 0.36);
  float neckV = 0.8 - modelling * (0.34 * bump(vec2(0.0, p.y), vec2(0.0, -0.69), vec2(1.0, 0.08))
                                 + 0.12 * smoothstep(0.03, 0.10, abs(p.x)));
  V = mix(V, neckV, cv(dNeck, featS * 3.0) * inN);

  // garment: shoulders under the hair, a round neckline with a trim (the ring's tone), soft folds
  float dG = sdEllipse(p - vec2(0.0, -1.42), vec2(0.95, 0.64));
  float dNl = sdEllipse(p - vec2(0.0, -0.75), vec2(0.23, 0.13));
  float fold = 0.08 * strands * sin(atan(p.x, -p.y - 0.3) * 18.0);
  V = mix(V, tones.w * (1.0 + fold), cv(max(dG, -dNl), edgeS) * inN);
  V = mix(V, tones.z * 0.8, cv(max(abs(dNl - 0.013) - 0.008, dG), featS) * inN);
  // the curtains of hair fall over the shoulders
  V = mix(V, hairV, cv(max(dCurt, -p.y - 0.62), edgeS) * inN * smoothstep(-1.05, -0.75, p.y));

  // skin + modelling (light where the afterimage should glow most)
  float sk = 1.0;
  sk -= modelling * 0.16 * (1.0 - smoothstep(0.0, 0.13, -dFace));       // form turning away
  sk += modelling * 0.07 * bump(s, vec2(0.19, -0.19), vec2(0.08, 0.06)); // cheekbones
  sk += modelling * 0.05 * bump(p, vec2(0.0, 0.17), vec2(0.15, 0.09));   // forehead
  sk -= modelling * 0.10 * bump(s, vec2(0.15, -0.05), vec2(0.115, 0.06)); // eye sockets
  sk -= modelling * 0.07 * bump(s, vec2(0.062, -0.19), vec2(0.02, 0.09)); // nose flanks
  sk += modelling * 0.06 * bump(p, vec2(0.0, -0.18), vec2(0.014, 0.1));  // nose ridge
  sk += modelling * 0.06 * bump(p, vec2(0.0, -0.29), vec2(0.026, 0.022)); // nose tip
  sk -= modelling * 0.12 * bump(p, vec2(0.0, -0.336), vec2(0.03, 0.009)); // under the nose
  sk += modelling * 0.05 * bump(p, vec2(0.0, -0.59), vec2(0.06, 0.04));  // chin
  sk -= modelling * 0.08 * bump(p, vec2(0.0, -0.512), vec2(0.05, 0.012)); // under the lower lip
  V = mix(V, sk, cv(dFace, edgeS));

  // eyes: vesica-like almonds = intersection of two discs (upper lid more curved than the lower)
  const float A = 0.088;
  const vec2 CU = vec2(0.0, -0.0768); const float RU = 0.1168; // upper lid apex +0.040
  const vec2 CL = vec2(0.0, 0.1243);  const float RL = 0.1523; // lower lid nadir −0.028
  vec2 e = rot(-0.07) * (s - vec2(0.150, -0.075));              // outer corners slightly raised
  float dU = length(e - CU) - RU, dL = length(e - CL) - RL;
  float dEye = max(dU, dL);
  if (eyesOpen > 0.999) {
    V = mix(V, fv(1.32), cv(dEye, featS));                         // sclera: darkest ink
    vec2 ir = e - vec2(-0.003, 0.004);
    float rr = length(ir), an = atan(ir.y, ir.x);
    float irisV = 0.46 + 0.07 * sin(an * 31.0 + 2.0 * sin(an * 7.0)) * smoothstep(0.012, 0.03, rr)
                - 0.22 * smoothstep(0.025, 0.036, rr);              // striations + limbal ring
    V = mix(V, fv(irisV), cv(max(rr - 0.036, dEye), featS));
    V = mix(V, fv(0.05), cv(max(rr - 0.0135, dEye), featS));       // pupil
    V = mix(V, fv(1.6), cv(length(ir - vec2(-0.009, 0.011)) - 0.0055, featS)); // catchlight
    // upper lash line, thickening outwards, with a short wing
    float th = mix(0.0022, 0.0085, smoothstep(-A, A, e.x));
    float dLash = max(max(abs(dU - 0.4 * th) - th, abs(e.x) - A * 0.985), -e.y - 0.006);
    float hw;
    float dWing = sdSegment(e, vec2(A * 0.95, 0.002), vec2(A + 0.026, 0.013), hw) - mix(0.0075, 0.0008, hw);
    V = mix(V, fv(0.12), cv(min(dLash, dWing), featS));
    V = mix(V, fv(0.62), 0.8 * cv(max(max(abs(dL) - 0.0018, abs(e.x) - A * 0.86), e.y), featS)); // lower lid
    V = mix(V, fv(0.66), cv(max(max(abs(length(e - CU - vec2(0.0, 0.004)) - RU - 0.021) - 0.0018,
                                abs(e.x + 0.004) - A * 0.86), -e.y), featS * 1.6));     // crease
  } else if (eyesOpen < 0.001) {
    // closed: lash line along the lower arc, the upper lid's crease above
    V = mix(V, fv(0.86), cv(dEye, featS * 2.0));
    float th = mix(0.003, 0.007, smoothstep(-A, A, e.x));
    V = mix(V, fv(0.14), cv(max(max(abs(dL + 0.003) - th, abs(e.x) - A * 0.98), e.y), featS));
    V = mix(V, fv(0.7), cv(max(max(abs(dU - 0.006) - 0.0018, abs(e.x) - A * 0.85), -e.y), featS * 1.6));
  } else {
    // opening (S14, on the bell's E): the upper lid rises from the lower lid's arc to its own. The lid is
    // the zero set of a blend of the two lid distances, so both corners stay put; at 1 this is exactly
    // the open eye above
    float op = eyesOpen;
    float dLid = mix(-dL, dU, op);
    float dAp = max(dLid, dL);
    V = mix(V, fv(0.86), (1.0 - op) * cv(dEye, featS * 2.0));       // the closed lid gives way
    V = mix(V, fv(1.32), cv(dAp, featS));
    vec2 ir = e - vec2(-0.003, 0.004);
    float rr = length(ir), an = atan(ir.y, ir.x);
    float irisV = 0.46 + 0.07 * sin(an * 31.0 + 2.0 * sin(an * 7.0)) * smoothstep(0.012, 0.03, rr)
                - 0.22 * smoothstep(0.025, 0.036, rr);
    V = mix(V, fv(irisV), cv(max(rr - 0.036, dAp), featS));
    V = mix(V, fv(0.05), cv(max(rr - 0.0135, dAp), featS));
    V = mix(V, fv(1.6), cv(max(length(ir - vec2(-0.009, 0.011)) - 0.0055, dAp), featS));
    float sx = smoothstep(-A, A, e.x);
    float th = mix(mix(0.003, 0.007, sx), mix(0.0022, 0.0085, sx), op);
    float dLash = max(max(abs(dLid - 0.4 * th) - th, abs(e.x) - A * 0.985), -e.y - mix(0.045, 0.006, op));
    float hw;
    float dWing = sdSegment(e, vec2(A * 0.95, 0.002), vec2(A + 0.026, 0.013), hw) - mix(0.0075, 0.0008, hw);
    V = mix(V, fv(0.12), cv(min(dLash, dWing + 0.05 * (1.0 - op)), featS));
    V = mix(V, fv(0.62), 0.8 * op * cv(max(max(abs(dL) - 0.0018, abs(e.x) - A * 0.86), e.y), featS));
    V = mix(V, fv(0.66), op * cv(max(max(abs(length(e - CU - vec2(0.0, 0.004)) - RU - 0.021) - 0.0018,
                                     abs(e.x + 0.004) - A * 0.86), -e.y), featS * 1.6));
    V = mix(V, fv(0.7), (1.0 - op) * cv(max(max(abs(dU - 0.006) - 0.0018, abs(e.x) - A * 0.85), -e.y), featS * 1.6));
  }

  // brows: crescents (two circles), thick at the inner head, tapering outwards
  float dBrow = max(max(length(s - vec2(0.158, -0.105)) - 0.170, -(length(s - vec2(0.170, -0.121)) - 0.172)),
                    max(max(0.046 - s.x, s.x - 0.276), -0.008 - s.y));
  V = mix(V, fv(0.2), cv(dBrow, featS));

  // nose: bridge lines flowing out of the brows (icon style), wings, nostrils
  float dBr = sdBezier(s, vec2(0.046, 0.004), vec2(0.026, -0.16), vec2(0.047, -0.272)) - 0.0028;
  V = mix(V, fv(0.66), 0.85 * cv(dBr, featS * 1.6));
  vec2 wc = s - vec2(0.047, -0.300);
  // wings: only the outer arc of each ala (compass arc from ~10 to ~5 o'clock on the outer side)
  V = mix(V, fv(0.66), cv(max(abs(length(wc) - 0.026) - 0.0022, max(wc.y - 0.012, -wc.x + 0.004)), featS * 1.3));
  // nostrils + the soft base of the nose between them
  V = mix(V, fv(0.28), cv(sdEllipse(rot(0.35) * (s - vec2(0.024, -0.322)), vec2(0.0135, 0.0058)), featS * 1.3));
  V = mix(V, fv(0.8), 0.7 * cv(max(abs(length(s - vec2(0.0, -0.290)) - 0.034) - 0.0018, max(-s.y - 0.33, s.y + 0.305)),
                              featS * 1.6));

  // philtrum
  float hp;
  V = mix(V, fv(0.86), 0.6 * cv(sdSegment(s, vec2(0.011, -0.345), vec2(0.017, -0.428), hp) - 0.0025, featS * 2.0));

  // mouth: lips as height fields around the mouth line, cupid's bow
  float ym = -0.455, x = s.x;
  float ml = ym + 0.004 * (x / 0.088) * (x / 0.088) - 0.0025 * exp(-pow(x / 0.02, 2.0));
  float uc = ym + 0.003 + 0.025 * pow(max(1.0 - pow(x / 0.09, 2.0), 0.0), 0.6) - 0.0065 * exp(-pow(x / 0.011, 2.0));
  float lc = ym - 0.004 - 0.033 * pow(max(1.0 - pow(x / 0.08, 2.0), 0.0), 0.55);
  V = mix(V, fv(0.62), cv(max(max(ml - s.y, s.y - uc), x - 0.09), featS));
  V = mix(V, fv(0.8), cv(max(max(lc - s.y, s.y - ml), x - 0.082), featS));
  V = mix(V, fv(1.0), 0.6 * cv(sdEllipse(p - vec2(0.0, ym - 0.019), vec2(0.03, 0.008)), featS * 2.0));
  V = mix(V, fv(0.1), cv(max(abs(s.y - ml) - 0.0022, x - 0.092), featS));

  // hair in front: fringe over the forehead and temples, centre parting
  float hl = 0.33 - 1.15 * x * x;
  float hls = -2.3 * x;
  float dFr = max(dSkull, (hl - p.y) / sqrt(1.0 + hls * hls));
  V = mix(V, hairV, cv(dFr, featS * 2.0) * inN);
  V = mix(V, tones.x * 0.45, cv(max(abs(p.x) - 0.0035, max(0.345 - p.y, dSkull)), featS));

  // the 65537-gon itself (on top of the bust it clips)
  V = mix(V, tones.z, cv(abs(dN) - 0.5 * frame.y, featS));
  return V;
}
`;

// The assembly and the erasure of S14, shared by the portrait (where the face develops / crumbles) and
// the embers (where they land / lift off): both evaluate landRow() / eraseRow() at the same point, so
// the face appears and disappears exactly where and when its embers arrive and leave. No COMMON here —
// the ember vertex shader includes it too.
export const ASM_LIB = /* glsl */ `
uniform vec4 asmT;   // x: rows since the S14 cue, y: first landing row, z: last landing row, w: 1 assembling, 2 erasing
uniform vec4 dawnU;  // x: dawn progress 0..1, y: width of the dawn front, z: farthest frame corner from the point (H)
uniform vec4 eraseU; // x: first step row, y: rows per step, z: steps, w: rows each step takes
uniform vec2 eraseL; // x: rows the dark arrives early, y: rows before the first step it starts at the frame's edge

float hashA(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoiseA(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashA(i), hashA(i + vec2(1.0, 0.0)), f.x), mix(hashA(i + vec2(0.0, 1.0)), hashA(i + vec2(1.0, 1.0)), f.x), f.y);
}
// the row at which the embers bound for p (face units, glabella = origin) land: from the point
// outwards, along a turbulent front
float landRow(vec2 p) {
  float n = 0.65 * vnoiseA(p * 3.3 + 11.0) + 0.35 * vnoiseA(p * 8.1 - 5.0);
  float k = clamp(pow(length(p) / 1.1, 0.8) + 0.32 * (n - 0.5), 0.0, 1.0);
  return mix(asmT.y, asmT.z, k);
}
// the white field blooming out of the fixation point (q: H units from the point)
float fieldAt(vec2 q) {
  float w = dawnU.y;
  return smoothstep(0.0, 1.0, (dawnU.x * (1.0 + w) - length(q) / dawnU.z) / w);
}
// the row at which p crumbles. The threshold sweeps from the outside in, one raised-cosine step per
// channel leaving; the metric is squeezed horizontally so that the eyes stay with the point to the end
float eraseRow(vec2 p) {
  float n = 0.6 * vnoiseA(p * 2.7 - 3.0) + 0.4 * vnoiseA(p * 7.7 + 9.0);
  float sx = mix(0.62, 1.0, smoothstep(0.35, 0.8, length(p))); // circles far out, the eyes' band near the point
  float e = pow(length(p * vec2(sx, 1.0)) / 1.05, 0.85) + 0.18 * (n - 0.5);
  float v = (1.0 - e) * eraseU.z;            // progress needed, in steps
  float i = clamp(floor(v), 0.0, eraseU.z - 1.0);
  float f = clamp(v - i, 0.0, 1.0);
  float r = eraseU.x + i * eraseU.y + eraseU.w * acos(1.0 - 2.0 * f) / PI;
  // beyond the nimbus (v < 0): the dark comes in from the frame's edge before the first step
  return v < 0.0 ? max(eraseU.x + v * eraseU.y, eraseU.x - eraseL.y) : r;
}
`;

export const FACE_FS = /* glsl */ `
in vec2 uv;
out vec4 o;
uniform vec2 center;      // H: glabella offset from the frame centre
uniform float scale;      // H per face unit
uniform vec3 white;       // linear field white
uniform vec3 skin;        // linear face colour (ink 1)
uniform vec3 deepC;       // linear deep colour (ink 2)
uniform float faceOn;     // 1 = S14 (the portrait), 0 = S15 (no face)
uniform float endWhite;   // S15: 1 = the white field (ending 'afterimage'), 0 = black
uniform float mode;       // 0 stimulus, 1 predicted afterimage (von Kries), 2 design map
uniform mat3 rgb2lms, lms2rgb;
uniform float predP, predScale;
uniform vec3 dotCol;      // linear
uniform vec2 dotRA;       // radius (device px), opacity
uniform vec2 halo;        // the point's glow: linear amplitude, sigma (device px) — as S13's collapse left it
uniform vec3 glowC;       // linear colour of the spark's glow
uniform vec4 comet;       // the spark drawing the ring: position (face units), brightness, sweep angle (rad)
uniform sampler2D vCache; // the static design at this resolution (FACE_CACHE_FS), eyes as in the end
uniform float eyesLive;   // 1 = the eyes are not (fully) open: evaluate the design live around them
uniform sampler2D beamTex;// S15: the oscilloscope beam's glow (linear, half resolution)
uniform vec3 beamU;       // x: 1 = composite the beam, y: exposure, z: radius it can reach (H, from the point)

vec3 inkCol(vec3 base, vec3 c1, vec3 c2, float ink) {
  return ink <= 1.0 ? mix(base, c1, ink) : mix(c1, c2, ink - 1.0);
}

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  vec2 qc = q - center;
  vec2 p = qc / scale;
  pxF = 1.0 / (res.y * scale);
  vec3 col;
  float V = 0.0;
  if (faceOn > 0.5) {
    float ph = asmT.w;
    float fl = 1.0, R = 1.0;
    float g = hashA(floor(gl_FragCoord.xy * 0.5)); // the grain of the fronts: the embers' own size
    if (ph > 1.5) {
      // erasure: the dark arrives, then the band crumbles into its embers
      float X = eraseRow(p);
      fl = 1.0 - smoothstep(X - eraseL.x - 2.0, X - eraseL.x + 1.0, asmT.x);
      R = 1.0 - smoothstep(X - 1.0, X + 2.5, asmT.x + 2.5 * (g - 0.5));
    }
    if (R > 0.0) {
      V = texelFetch(vCache, ivec2(gl_FragCoord.xy), 0).r;
      if (eyesLive > 0.5 && abs(p.x) < 0.31 && p.y > -0.17 && p.y < 0.04) V = faceDesign(p);
    }
    if (ph > 0.5 && ph < 1.5) {
      // assembly: the face develops where its embers land, the white blooms out of the point
      fl = fieldAt(qc);
      float L = landRow(p);
      R = smoothstep(L - 1.0, L + 3.0, asmT.x + 2.5 * (g - 0.5));
      // the 65537-gon is drawn by the spark, clockwise from the top
      float rp = length(p);
      if (abs(rp - frame.x) < 0.12) {
        float dN = sdNgon(p, frame.x, frame.z);
        R = max(R, exp(-dN * dN / 0.0009) * smoothstep(0.0, 0.2, comet.w - mod(atan(p.x, p.y), TAU)));
      }
    }
    float ink = clamp(V, 0.0, 2.0) * R;
    // the dawn is a little warm while it rises (icon gold), neutral once it has
    vec3 tint = mix(vec3(1.0, 0.88, 0.72), vec3(1.0), fl * fl);
    col = inkCol(white * fl * tint, skin, deepC, ink);
    if (comet.z > 0.0) {
      float dc = length(p - comet.xy);
      col += glowC * (comet.z * 1.3 * exp(-dc * dc / (2.0 * 0.013 * 0.013)) * (1.0 - fl));
    }
  } else {
    col = white * endWhite;
    if (beamU.x > 0.5 && length(qc) < beamU.z) {
      // the S00 beam returns: its phosphor glow, with a soft shoulder (no post in this scene)
      vec2 uvb = gl_FragCoord.xy / res, px = 2.0 / res; // one texel of the half-resolution beam
      vec3 wide = vec3(0.0);
      for (int k = 0; k < 8; k++) {
        float a = float(k) * (TAU / 8.0) + 0.39;
        vec2 d = vec2(cos(a), sin(a)) * px;
        wide += texture(beamTex, uvb + 3.0 * d).rgb + 0.5 * texture(beamTex, uvb + 9.0 * d).rgb;
      }
      vec3 b = (texture(beamTex, uvb).rgb + 0.1 * wide) * beamU.y;
      col += b / (1.0 + max(max(b.r, b.g), b.b));
    }
  }
  if (mode > 0.5 && mode < 1.5) {
    vec3 S = rgb2lms * col, W = rgb2lms * white;
    vec3 A = W * pow(W / max(S, 0.02 * W), vec3(predP));
    col = max(lms2rgb * A, 0.0) * predScale;
  } else if (mode > 1.5) {
    col = vec3(clamp(V / 1.6, 0.0, 1.0));
  }
  // the fixation point (the light point S13 collapsed into, the +1) and its glow
  float r = length(gl_FragCoord.xy - 0.5 * res - center * res.y);
  col += halo.x * exp(-0.5 * r * r / (halo.y * halo.y)) * vec3(0.95, 0.9, 1.0);
  col = mix(col, dotCol, dotRA.y * clamp(0.5 - (r - dotRA.x), 0.0, 1.0));
  o = vec4(encodeOut(col), 1.0);
}
`;

export const FACE_SRC = COMMON + FACE_LIB + ASM_LIB + FACE_FS;

/** the static design value at every pixel, for the cache */
export const FACE_CACHE_FS = COMMON + FACE_LIB + /* glsl */ `
out vec4 o;
uniform vec2 center;
uniform float scale;
void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  pxF = 1.0 / (res.y * scale);
  o = vec4(faceDesign((q - center) / scale));
}
`;

// ---------------------------------------------------------------------------------------------
// Embers: 65536 = 256² of them (the +1 is the light point). Their targets are drawn once from the face
// design (weighted reservoir sampling of candidates in the nimbus, weight ∝ ink^1.5) into a 256×256
// RGBA32F table: xy = target (face units), z = ink there, w = a random number.
export const EMBER_TABLE_FS = COMMON + FACE_LIB + /* glsl */ `
out vec4 o;
uniform int candidates; // a uniform, so the compiler can't unroll 12 copies of the face
void main() {
  uvec2 ip = uvec2(gl_FragCoord.xy);
  uint h = pcgP(ip.x + 256u * ip.y + 0x10001u);
  pxF = 0.0012;
  float tot = 0.0, pv = 0.0;
  vec2 pick = vec2(0.0);
  for (int k = 0; k < candidates; k++) {
    h = pcgP(h);
    float u1 = float(h & 0xFFFFu) / 65535.0, u2 = float(h >> 16u) / 65535.0;
    vec2 c = frame.x * 1.015 * sqrt(u1) * vec2(cos(TAU * u2), sin(TAU * u2));
    float v = clamp(faceDesign(c), 0.0, 2.0);
    float w = pow(v, 1.5) + 0.003;
    tot += w;
    h = pcgP(h);
    if (float(h & 0xFFFFFFu) / 16777215.0 * tot < w) {
      pick = c;
      pv = v;
    }
  }
  h = pcgP(h);
  o = vec4(pick, pv, float(h & 0xFFFFFFu) / 16777216.0);
}
`;

export const EMBER_VS = /* glsl */ `
#define PI 3.14159265359
uniform sampler2D table;
uniform vec2 res;
uniform vec2 center;
uniform float scale;
uniform vec4 kicks;   // heartbeat rows (unused slots far in the future): each exhales a wave
uniform vec4 emb;     // x: brightness, y: point size (device px), z: spin (rad), w: shortest flight (rows)
uniform vec3 hotE, coolE, inkE; // display-encoded: hot near the point, cool in flight, ink on the white
` + ASM_LIB + /* glsl */ `
out vec4 vC;
void main() {
  int i = gl_VertexID;
  vec4 e = texelFetch(table, ivec2(i & 255, i >> 8), 0);
  vec2 T = e.xy;
  float h1 = e.w, h2 = fract(h1 * 7.31 + 0.13), h3 = fract(h1 * 31.7 + 0.71), h4 = fract(h1 * 113.1 + 0.37);
  float row = asmT.x;
  float rT = length(T), aT = atan(T.y, T.x);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 0.0;
  vC = vec4(0.0);
  vec2 p;
  float a, flash, s, heat;
  if (asmT.w < 1.5) {
    // assembly: leaves the point on the last heartbeat that gives it time to fly, lands a little
    // ahead of the face developing there
    float L = landRow(T) - 0.5 - 1.5 * h2;
    float E = 0.0;
    for (int k = 0; k < 4; k++) if (kicks[k] <= L - emb.w) E = max(E, kicks[k]);
    E += 1.6 * h3 * h3;
    s = (row - E) / max(L - E, 1.0);
    float after = row - L;
    if (asmT.w < 0.5 || s <= 0.0 || after > 5.0) return;
    s = min(s, 1.0);
    // an unwinding spiral out of the point, decelerating into place
    float u = 1.0 - (1.0 - s) * (1.0 - s);
    float ang = aT - emb.z * (0.5 + h4) * pow(1.0 - s, 1.5);
    p = rT * u * vec2(cos(ang), sin(ang));
    p += 0.025 * s * (1.0 - s) * vec2(sin(40.0 * h1 + 0.6 * row), cos(37.0 * h2 + 0.5 * row));
    a = smoothstep(0.0, 0.3, s) * (1.0 - smoothstep(0.0, 5.0, after));
    flash = after >= 0.0 ? exp(-after * 0.8) : 0.0;
    heat = 1.0 - s;
  } else {
    // erasure: lifts off as its band crumbles and streams into the point, winding up, accelerating
    float X = eraseRow(T) + 0.3 + 1.2 * h2;
    float travel = 7.0 + 4.0 * h3;
    s = (row - X) / travel;
    if (s <= 0.0 || s >= 1.0) return;
    float u = s * s * (3.0 - 2.0 * s);
    float ang = aT + emb.z * (0.5 + h4) * pow(u, 1.5);
    p = rT * (1.0 - u) * vec2(cos(ang), sin(ang));
    p += 0.02 * s * (1.0 - s) * vec2(sin(40.0 * h1 + 0.6 * row), cos(37.0 * h2 + 0.5 * row));
    a = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.85, 1.0, s));
    flash = exp(-s * 6.0);
    heat = u;
  }
  vec2 qc = p * scale;
  vec2 q = center + qc;
  gl_Position = vec4(2.0 * q.x * res.y / res.x, 2.0 * q.y, 0.0, 1.0);
  float fl = asmT.w < 1.5 ? fieldAt(qc) : 0.0;
  // colour: the face's teal at its place, cooling light in flight, hot white near the point
  vec3 glow = mix(mix(inkE * 1.6, coolE, smoothstep(0.0, 0.5, heat)), hotE, smoothstep(0.5, 0.95, heat));
  float b = emb.x * a * (0.45 + 0.55 * h2) * (1.0 + 1.2 * flash);
  // on the dark field: light; on the white: a speck of the face's ink
  float ia = 0.75 * a * smoothstep(0.2, 1.0, 1.0 - heat) * min(1.0, emb.x);
  vC = vec4(mix(glow * b, inkE * ia, fl), ia * fl);
  gl_PointSize = emb.y * (0.7 + 0.6 * h3) * (1.0 + 0.5 * flash);
}
`;

export const EMBER_FS = /* glsl */ `
in vec4 vC;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  o = vC * (exp(-3.0 * r2) * step(r2, 1.0)); // premultiplied: ONE, ONE_MINUS_SRC_ALPHA
}
`;
