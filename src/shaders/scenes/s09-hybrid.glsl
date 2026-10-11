// S09 · the hybrid image (Oliva, Torralba, Schyns): high-pass of the (defocused) fibration + low-pass of
// the creature's word EFFACED, in the log domain (so colours keep their chroma): the fibres' own low
// frequencies — their local mean luminance — are divided out and the word's light multiplied in,
// log C − log LP(C) + log LP(word). In focus the fine fibres dominate and mask the soft shading;
// defocused, C → LP(C) and only the word is left. hk fades the exchange in.
#include "lib/common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform sampler2D sharp; // rgb, a = 1 / depth (full)
uniform sampler2D dofQ;  // defocused (quarter), a = CoC (quarter px)
uniform sampler2D lpQ;   // gaussian of dofQ (quarter)
uniform sampler2D lowQ;  // the low-pass target (quarter): r = the word, g = the field around it
uniform vec2 res;
uniform vec3 coc;        // as in s09-dof
uniform float hk;
uniform float dofAll;    // the whole frame through the defocus path (when the sweep is wide open)
uniform vec3 base;       // linear colour of the word's light
uniform vec2 lowAB;      // field, word: luminance = field · (a + b·word)
uniform float tm;        // 0 = exact (the still), 1 = AgX look (written back as linear for the clip post)
uniform float gain;      // the kick's light (after the exchange, which would divide it out)
uniform vec2 crossSz;
uniform vec4 crossCol;   // rgb, alpha

// cubic B-spline filtered lookup from four bilinear taps (the quarter-res defocus, magnified 4×)
vec4 bicubic(sampler2D t, vec2 p) {
  vec2 sz = vec2(textureSize(t, 0));
  vec2 q = p * sz - 0.5, f = fract(q);
  q -= f;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (q - 0.5 + w1 / g0) / sz, h1 = (q + 1.5 + w3 / g1) / sz;
  return g0.y * (g0.x * texture(t, vec2(h0.x, h0.y)) + g1.x * texture(t, vec2(h1.x, h0.y))) +
         g1.y * (g0.x * texture(t, vec2(h0.x, h1.y)) + g1.x * texture(t, vec2(h1.x, h1.y)));
}

void main() {
  vec4 s = texture(sharp, uv);
  vec4 d = bicubic(dofQ, uv);
  float cf = max(4.0 * max(min(coc.x * abs(s.a - coc.y), coc.z), d.a), 8.0 * dofAll);
  vec3 C = mix(s.rgb, d.rgb, smoothstep(1.5, 7.0, cf));
  vec3 L = texture(lpQ, uv).rgb;
  vec2 V = texture(lowQ, uv).rg;
  const vec3 Y = vec3(0.2126, 0.7152, 0.0722);
  float target = V.g * (lowAB.x + lowAB.y * V.r);
  vec3 col = C * mix(1.0, target / max(dot(L, Y), 1e-3), hk);
  col = mix(col, col * base / dot(base, Y), 0.35 * hk) * gain; // the word's light has a colour
  vec3 ag = srgb2lin(clamp(agxEotf(agxLook(agx(col), 1.12, 1.12)), 0.0, 1.0));
  col = mix(col, ag, tm);
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y, aq = abs(q);
  vec2 d1 = aq - vec2(crossSz.x, 0.5 * crossSz.y), d2 = aq - vec2(0.5 * crossSz.y, crossSz.x);
  float dc = min(length(max(d1, 0.0)) + min(max(d1.x, d1.y), 0.0), length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0));
  col = mix(col, crossCol.rgb, crossCol.a * clamp(0.5 - dc * res.y, 0.0, 1.0));
  o = vec4(col, 1.0);
}
