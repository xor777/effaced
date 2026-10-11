// S14 · Portrait (the word EFFACED in the creature's glyphs) and S15's black, beam and point. Exact
// colours, no post: linear Display P3 → sRGB curve + mean-preserving dither, straight to the canvas.
#include "scenes/s14-common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform float cap;          // frame heights per cap unit
uniform float wordOn;       // 1 = S14, 0 = S15
uniform float ignite[7];    // per letter: 0 ember-lit … 1 lit (> 1: the flash of lighting)
uniform vec4 consA;         // per letter: its construction (compass circles, ruler lines) flashing 0..1 — letters 0..3
uniform vec3 consB;         // … letters 4..6
uniform sampler2D cache0, cache1, cache2; // the static word (scenes/s14-cache), this resolution
uniform vec4 ruler;         // baseline + cap line: x half-length drawn (cap units), y opacity, z tip brightness, w 1 = burning
uniform vec3 inkC;          // linear: the lit stroke
uniform vec3 glowC;         // linear: its glow
uniform vec3 hotC;          // linear: a crumbling edge
uniform vec3 consC;         // linear: construction hairlines
uniform vec3 dotCol;        // linear: the point
uniform vec2 dotRA;         // radius (device px), opacity
uniform vec2 halo;          // the point's glow: amplitude, sigma (device px)
uniform sampler2D beamTex;  // S15: the beam's glow (linear, half resolution)
uniform vec3 beamU;         // x: on, y: exposure, z: reach from the point (frame heights)
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

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  vec2 p = q / cap;
  float px = 1.0 / (res.y * cap); // one device pixel in cap units
  vec3 col = vec3(0.0);
  if (wordOn > 0.5) {
    ivec2 ip = ivec2(gl_FragCoord.xy);
    vec4 w0 = texelFetch(cache0, ip, 0);
    float d = w0.x, dn = w0.y, t = w0.w;
    int k = int(w0.z + 0.5);
    float ph = S14.y, row = S14.x;
    float g = hashS(floor(gl_FragCoord.xy * 0.5)) - 0.5; // the grain of the fronts: the embers' size
    if (d < 0.5) {
      float R = 1.0, burn = 0.0;
      if (ph > 0.5 && ph < 1.5) {
        R = smoothstep(-1.0, 2.0, row + 2.0 * g - mix(landS[k], landE[k], t));
      } else if (ph > 1.5) {
        float x = row + 2.0 * g - (eraseS[k] + S14.z * (1.0 - t));
        R = 1.0 - smoothstep(-1.0, 1.5, x);
        burn = exp(-0.5 * (x + 0.5) * (x + 0.5));
      }
      float ink = max(smoothstep(GLY_STROKE + px, GLY_STROKE - px, d), smoothstep(GLY_NODE + px, GLY_NODE - px, dn));
      float glow = exp(-0.5 * d * d / (0.06 * 0.06));
      float ig = ignite[k];
      float b = R * (0.3 + 0.7 * min(ig, 1.0) + 0.8 * max(ig - 1.0, 0.0));
      col += (inkC * ink + glowC * glow) * b + hotC * burn * (ink + 0.4 * glow);
    }
    // the constructions: they flash while their letter forms and stay as a faint diagram behind it
    float cn = dot(texelFetch(cache1, ip, 0), consA) + dot(texelFetch(cache2, ip, 0).xyz, consB);
    col += consC * cn;
    // the baseline and the cap line, drawn out of the middle (and burnt from the ends at the erasure)
    if (ruler.y > 0.0) {
      float dl = abs(abs(p.y) - 0.5);
      float along = abs(p.x) - ruler.x;
      float line = clamp(1.2 - dl / px, 0.0, 1.0) * step(along, 0.0);
      float tip = exp(-0.5 * (along * along + dl * dl) / (0.035 * 0.035));
      col += consC * ruler.y * line + (ruler.w > 0.5 ? hotC : inkC) * ruler.z * tip * step(0.001, ruler.x);
    }
  } else if (beamU.x > 0.5 && length(q) < beamU.z) {
    // S15: the S00 beam returns — its phosphor glow, with a soft shoulder (no post in this scene)
    vec2 uvb = gl_FragCoord.xy / res, tx = 2.0 / res; // one texel of the half-resolution beam
    vec3 wide = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982 + 0.39;
      vec2 dd = vec2(cos(a), sin(a)) * tx;
      wide += texture(beamTex, uvb + 3.0 * dd).rgb + 0.5 * texture(beamTex, uvb + 9.0 * dd).rgb;
    }
    vec3 b = (texture(beamTex, uvb).rgb + 0.1 * wide) * beamU.y;
    col += b / (1.0 + max(max(b.r, b.g), b.b));
  }
  // the light point (S13 collapsed into it; the +1) and its glow
  float r = length(gl_FragCoord.xy - 0.5 * res);
  col += halo.x * exp(-0.5 * r * r / (halo.y * halo.y)) * vec3(0.95, 0.9, 1.0);
  col = mix(col, dotCol, dotRA.y * clamp(0.5 - (r - dotRA.x), 0.0, 1.0));
  o = vec4(encodeW(col), 1.0);
}
