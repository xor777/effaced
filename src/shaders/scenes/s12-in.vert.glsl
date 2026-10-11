// S12 · the particles inside the canvas (main context): attractor → window plane, until they leave.
// On the G/F bars the cloud morphs from the Lorenz butterfly into the Halvorsen (the triangle) and
// back: every particle has a home on both, and flies between them in a vortex, staggered by its number.
// Colour by velocity, Doppler-like: what flows towards us is cyan, what flows away magenta, across the
// view violet; speed lifts it to #FACADE and white-hot (HDR, for the bloom). Each wing of the butterfly
// carries an eye-spot: rings of light round its fixed point, which the orbits spiral out through.
#include "lib/common"
#include "scenes/s12-lib"
uniform sampler2D st;    // Lorenz state
uniform sampler2D sh;    // Halvorsen state
uniform int stW;
uniform float aspect;
uniform float tRel;      // s since the hit (negative before)
uniform vec4 morph;      // amount (0 Lorenz … 1 Halvorsen), vortex (rad), heat, unused
uniform vec3 C0, C1, C2, C3, C4; // linear palette: approaching, receding, across, fast, white-hot
uniform vec2 band;       // NDC y range drawn by this pass
uniform float xk;        // speed → colour
uniform float depthK;    // brightness by depth
out vec3 col;

void main() {
  ivec2 ip = ivec2(gl_VertexID % stW, gl_VertexID / stW);
  vec4 s = texelFetch(st, ip, 0);
  vec3 P = baseFrame(s.xyz);
  vec3 F = lorenzF(s.xyz);
  float sp = length(F) * 0.0104;
  // eye-spots: rings round the fixed point of each wing (the orbits spiral outwards through them)
  vec3 Cw = vec3(sign(s.x) * 8.485, sign(s.x) * 8.485, 27.0);
  float eye = 0.5 + 0.5 * cos(length(s.xyz - Cw) * 0.85);
  float eyeK = 1.0;
  F /= length(F) + 1e-6;
  float m = morph.x;
  if (m > 0.0) {
    vec3 hq = texelFetch(sh, ip, 0).xyz;
    // staggered by the particle's number: the change sweeps through the cloud
    float mi = smoothstep(0.0, 1.0, clamp(m * 1.6 - 0.6 * fract(s.w * 7.31), 0.0, 1.0));
    P = mix(P, halvorsenFrame(hq), mi);
    float tr = sin(PI * mi);
    float a = morph.y * tr * (0.6 + 0.8 * s.w);
    P.xy = mat2(cos(a), sin(a), -sin(a), cos(a)) * P.xy;
    P.z += 0.35 * tr * (fract(s.w * 3.7) - 0.5);
    vec3 Fh = halvorsenF(hq);
    float sh_ = length(Fh) * 0.022;
    Fh = halvorsenFrame(hq + Fh / (length(Fh) + 1e-6)) - halvorsenFrame(hq);
    F = normalize(mix(F, normalize(Fh), mi) + tr * vec3(-P.y, P.x, 0.0));
    sp = mix(sp, sh_, mi) + 0.7 * tr;
    eyeK = 1.0 - mi;
  }
  vec3 v = innerView(P);
  bool gone = tRel >= launchAt(s.w) || v.y * 2.0 < band.x || v.y * 2.0 >= band.y;
  gl_Position = gone ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(v.x * 2.0 / aspect, v.y * 2.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  float dop = (iRot * F).z; // +1 towards the eye … −1 away
  vec3 c = dop > 0.0 ? mix(C2, C0, smoothstep(0.0, 0.8, dop)) : mix(C2, C1, smoothstep(0.0, 0.8, -dop));
  // the dye the flow carries and folds: grain in the light
  float dye = 0.5 + 0.5 * cos(TAU * 2.0 * s.w);
  float x = sp * xk + 0.1 * dye + morph.z;
  c = mix(c, C3, smoothstep(0.45, 0.8, x));
  c = mix(c, C4, smoothstep(0.8, 1.1, x));
  // the near side outshines the far one: the averaged colour of a bin is the front's, the cloud reads in depth
  c = mix(c, C3, 0.35 * eye * eye * eyeK);
  col = c * (0.45 + 0.4 * dye + 0.6 * x) * mix(1.0, 0.35 + 1.1 * eye, 0.8 * eyeK) * (1.0 + 0.8 * smoothstep(0.85, 1.2, x)) * exp(depthK * clamp(v.z, -2.0, 2.0));
}
