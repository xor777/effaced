// S14 · Portrait (the word EFFACED in the creature's glyphs) and S15's black, beam and point. Exact colours,
// no post: linear Display P3 → sRGB curve + mean-preserving dither, straight to the canvas.
// The word is evaluated analytically in its plane (s14-common: a slow camera looks at the point).
#include "scenes/s14-common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform float wordOn;       // 1 = S14, 0 = S15
uniform float ignite[7];    // per letter: 0 ember-lit … 1 lit (> 1: the flash of lighting)
uniform float react[7];     // per letter: flaring up (a neighbour crumbled; its own last flare)
uniform float cons[7];      // per letter: its construction's opacity
uniform float consP[7];     // per letter: how far the pen has drawn its construction 0..1
uniform vec4 kicksR;        // the heartbeat rows: each sends a pulse along the strokes
uniform vec4 ruler;         // baseline + cap line: x half-length drawn (cap units), y opacity, z tip brightness, w 1 = burning
uniform vec3 inkC;          // linear: the lit stroke
uniform vec3 glowC;         // linear: its glow
uniform vec3 hotC;          // linear: a crumbling edge
uniform vec3 consC;         // linear: construction hairlines
uniform vec3 dotCol;        // linear: the point
uniform vec2 dotRA;         // radius (device px), opacity
uniform vec2 halo;          // the point's glow: amplitude, sigma (device px)
uniform vec2 dotP;          // where the point is (device px from the centre): S15's lockup moves it left
uniform sampler2D beamTex;  // S15: the beam's glow (linear, half resolution)
uniform vec2 beamU;         // x: on, y: exposure
uniform vec4 beamBox;       // where the beam can be: centre, half size (frame heights, from the frame's centre)
uniform float dither;

uint pcgW(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
// sRGB curve + TPDF dither, off at 0 and 1 (black stays 0: the hand-off from S13 is exact)
vec3 encodeW(vec3 lin) {
  vec3 e = lin2srgb(clamp(lin, 0.0, 1.0));
  uvec2 ip = uvec2(gl_FragCoord.xy);
  uint h = pcgW(ip.x ^ pcgW(ip.y ^ 0xEFFACEDu)), h2 = pcgW(h);
  vec3 n = vec3(float(h & 1023u), float((h >> 10) & 1023u), float((h >> 20) & 1023u)) / 1023.0;
  vec3 n2 = vec3(float(h2 & 1023u), float((h2 >> 10) & 1023u), float((h2 >> 20) & 1023u)) / 1023.0;
  return e + dither * (n + n2 - 1.0) * clamp(min(e, 1.0 - e) * 255.0, 0.0, 1.0) / 255.0;
}

// a letter's construction as it is drawn: compass circles swept from their start by a pen-light, ruler lines
// ruled out of their anchor; returns the distance to what is drawn so far, `head` = to the compass pen-lights
float consDraw(int L, vec2 q, float prog, out float head) {
  int st = GLY_R[2 * L], n = GLY_R[2 * L + 1];
  float d = 1e9;
  head = 1e9;
  for (int j = 0; j < 8; j++) {
    if (j >= n) break;
    int o = 6 * (st + j);
    float kind = GLY_D[o];
    vec4 a = vec4(GLY_D[o + 1], GLY_D[o + 2], GLY_D[o + 3], GLY_D[o + 4]);
    if (kind < 0.5 || kind > 2.5) {
      // a ruler line: through a segment (from its middle) or a construction line (from its point)
      vec2 c = kind < 0.5 ? 0.5 * (a.xy + a.zw) : a.xy;
      vec2 t = kind < 0.5 ? normalize(a.zw - a.xy) : vec2(cos(radians(a.z)), sin(radians(a.z)));
      float along = dot(q - c, t), reach = 2.6 * prog;
      if (abs(along) < reach) d = min(d, abs(dot(q - c, vec2(-t.y, t.x)))); // (ruled: no pen-light)
    } else {
      // a compass circle: an arc's own circle (from the arc's start) or a construction circle (from the top)
      float a0 = kind < 1.5 ? radians(a.w) : 1.5707963;
      vec2 r = q - a.xy;
      if (prog >= 1.0) {
        d = min(d, abs(length(r) - a.z)); // drawn: no sweep, no pen
      } else {
        float swept = mod(atan(r.y, r.x) - a0, S14_TAU), reach = S14_TAU * prog;
        if (swept < reach) d = min(d, abs(length(r) - a.z));
        head = min(head, length(r - a.z * vec2(cos(a0 + reach), sin(a0 + reach))));
      }
    }
  }
  return d;
}

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  vec3 col = vec3(0.0);
  if (wordOn > 0.5) {
    vec2 p = toWord(q);
    vec2 dp = fwidth(p);
    float px = 0.7 * length(dp); // one device pixel in cap units, here
    float ph = S14.y, row = S14.x;
    {
      int k;
      float dn, s;
      float d = wordAt(p, 0.5, k, dn, s);
      if (min(d, dn) < 0.5) {
        vec2 qk = p - vec2(GLY_WX[k], -0.5) - woff[k];
        float g = hashS(floor(gl_FragCoord.xy * 0.5)) - 0.5; // the grain of the fronts: the embers' size
        float R = 1.0, burn = 0.0;
        if (ph > 0.5 && ph < 1.5) {
          R = smoothstep(-1.0, 2.0, row + 2.0 * g - landRow(qk, k));
        } else if (ph > 1.5) {
          float x = row + 2.0 * g - eraseRow(qk, k);
          R = 1.0 - smoothstep(-1.0, 1.5, x);
          burn = exp(-0.5 * (x + 0.5) * (x + 0.5));
        }
        float ink = max(smoothstep(GLY_STROKE + px, GLY_STROKE - px, d), smoothstep(GLY_NODE + px, GLY_NODE - px, dn));
        float glow = exp(-0.5 * d * d / (0.06 * 0.06));
        // life: a current along the pen, the heartbeat's pulses along the strokes, the bell's waves across
        float cur = 1.0 + 0.16 * sin(S14_TAU * (s / 0.3 - row * 0.2));
        float pulse = 0.0;
        for (int i = 0; i < 4; i++) {
          float t = row - kicksR[i];
          if (t > 0.0 && t < 16.0) {
            float e = (s - 0.4 * t) / 0.12;
            pulse += exp(-e * e) * exp(-t / 9.0);
          }
        }
        float wave = bellWave(abs(p.x), row);
        float ig = ignite[k];
        float b = R * ((0.3 + 0.7 * min(ig, 1.0)) * cur + 0.8 * max(ig - 1.0, 0.0) + 0.45 * wave + react[k] + 1.2 * pulse);
        col += (inkC * ink + glowC * glow * (1.0 + 2.0 * wave)) * b + hotC * burn * (ink + 0.5 * glow);
      }
    }
    // the constructions, drawn by a pen-light while their letter forms, then fading
    for (int i = 0; i < 7; i++) {
      if (cons[i] <= 0.02) continue;
      vec2 lp = p - vec2(GLY_WX[i], -0.5) - woff[i];
      vec2 rc = lp - vec2(0.0, 0.5);
      float near = exp(-0.5 * dot(rc, rc));
      if (near * cons[i] < 0.04) continue;
      float head;
      float dc = consDraw(GLY_WL[i], lp, consP[i], head);
      float pen = consP[i] < 1.0 ? exp(-0.5 * head * head / (0.035 * 0.035)) : 0.0;
      col += cons[i] * (consC * near * clamp(1.3 - dc / px, 0.0, 1.0) + inkC * 0.7 * pen);
    }
    // the baseline and the cap line, ruled out of the middle (and burnt from the ends at the erasure)
    if (ruler.y > 0.0) {
      float dl = abs(abs(p.y) - 0.5);
      float along = abs(p.x) - ruler.x;
      float line = clamp(1.2 - dl / px, 0.0, 1.0) * step(along, 0.0);
      float tip = exp(-0.5 * (along * along + dl * dl) / (0.035 * 0.035));
      col += consC * ruler.y * line + (ruler.w > 0.5 ? hotC : inkC) * ruler.z * tip * step(0.001, ruler.x);
    }
  } else if (beamU.x > 0.5 && all(lessThan(abs(q - beamBox.xy), beamBox.zw))) {
    // S15: the S00 beam returns — its phosphor glow, with a soft shoulder (no post in this scene)
    vec2 uvb = gl_FragCoord.xy / res;
    // the shoulder: the beam's own mip levels, a smooth blur (taps would show as copies of a thin line: the letters);
    // faint, as the trace itself saturates (~26 in the texture) and a stronger halo would saturate into a slab
    vec3 b = (textureLod(beamTex, uvb, 0.0).rgb + 0.012 * textureLod(beamTex, uvb, 2.5).rgb + 0.008 * textureLod(beamTex, uvb, 4.5).rgb) * beamU.y;
    col += b / (1.0 + max(max(b.r, b.g), b.b));
  }
  // the light point (S13 collapsed into it; the +1) and its glow — the camera's anchor, the centre (but in S15's lockup)
  float r = length(gl_FragCoord.xy - 0.5 * res - dotP);
  col += halo.x * exp(-0.5 * r * r / (halo.y * halo.y)) * vec3(0.95, 0.9, 1.0);
  col = mix(col, dotCol, dotRA.y * clamp(0.5 - (r - dotRA.x), 0.0, 1.0));
  o = vec4(encodeW(col), 1.0);
}
