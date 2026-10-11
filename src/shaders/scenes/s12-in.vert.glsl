// S12 · the particles inside the canvas (main context): attractor → window plane, until they leave.
// The Lorenz butterfly, alive: its wings flap (a display transform about the body axis, s12-lib), its
// heart beats — every kick a quick contraction (iBreath) and a #FACADE flush through the figure.
// Colour by velocity, Doppler-like: what flows towards us is cyan, what flows away magenta, across the
// view violet; speed lifts it to #FACADE and white-hot (HDR, for the bloom). Each wing carries an
// eye-spot: rings of light round its fixed point, which the orbits spiral out through.
#include "lib/common"
#include "scenes/s12-lib"
uniform sampler2D st;    // Lorenz state
uniform int stW;
uniform float aspect;
uniform float tRel;      // s since the hit (negative before)
uniform vec4 look;       // heat (inhale, hits), flush (the heartbeat), eye-spots, unused
uniform vec3 C0, C1, C2, C3, C4; // linear palette: approaching, receding, across, fast, white-hot
uniform vec2 band;       // NDC y range drawn by this pass
uniform float xk;        // speed → colour
uniform float depthK;    // brightness by depth
out vec3 col;

void main() {
  ivec2 ip = ivec2(gl_VertexID % stW, gl_VertexID / stW);
  vec4 s = texelFetch(st, ip, 0);
  vec3 P = baseFrame(flapQ(s.xyz));
  vec3 F = lorenzF(s.xyz);
  float sp = length(F) * 0.0104;
  F = flapV(s.xyz, F / (length(F) + 1e-6));
  // eye-spots: rings round the fixed point of each wing (the orbits spiral outwards through them)
  vec3 Cw = vec3(sign(s.x) * 8.485, sign(s.x) * 8.485, 27.0);
  float eye = 0.5 + 0.5 * cos(length(s.xyz - Cw) * 0.85);
  vec3 v = innerView(P);
  float depth = innerView(baseFrame(s.xyz)).z; // (the depth cue of the resting figure: a flap doesn't flicker it)
  bool gone = tRel >= launchAt(s.w) || v.y * 2.0 < band.x || v.y * 2.0 >= band.y;
  gl_Position = gone ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(v.x * 2.0 / aspect, v.y * 2.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  float dop = (iRot * F).z; // +1 towards the eye … −1 away
  vec3 c = dop > 0.0 ? mix(C2, C0, smoothstep(0.0, 0.8, dop)) : mix(C2, C1, smoothstep(0.0, 0.8, -dop));
  // the dye the flow carries and folds: grain in the light
  float dye = 0.5 + 0.5 * cos(TAU * 2.0 * s.w);
  float x = sp * xk + 0.1 * dye + look.x;
  c = mix(c, C3, smoothstep(0.45, 0.8, x));
  c = mix(c, C4, smoothstep(0.8, 1.1, x));
  float eyeK = look.z;
  c = mix(c, C3, 0.35 * eye * eye * eyeK);
  // the heartbeat's flush: the whole figure goes #FACADE pink for a moment, the core first
  float fl = look.y * (0.6 + 0.4 * dye);
  c = mix(c, C3 * vec3(1.0, 0.82, 0.9), clamp(fl, 0.0, 0.85));
  // the near side outshines the far one: the averaged colour of a bin is the front's, the cloud reads in depth
  col = c * (0.45 + 0.4 * dye + 0.6 * x) * mix(1.0, 0.35 + 1.1 * eye, 0.8 * eyeK) * (1.0 + 0.8 * smoothstep(0.85, 1.2, x)) * (1.0 + 0.7 * fl)
      * exp(depthK * clamp(depth, -2.0, 2.0));
}
