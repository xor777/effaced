// S12 · particle histogram (half resolution) → colour. Log-density like the flame of S13.
// mode 0: the canvas — linear HDR into the post chain, over the canvas's own backdrop: a lit window
//         with a glowing frame (the canvas's own border), and its flash when the particles leave.
// mode 1: the outside — no post chain there: a glow from the histogram's mips, the window's
//         afterimages (frames left behind by its moves), the burst's flash and shock rings, AgX.
#include "lib/common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform sampler2D hist;
uniform vec2 htexel;
uniform vec2 res;
uniform float kNorm, ref, floor_, expo, gain;
uniform int mode;
uniform vec3 bgA, bgB;  // backdrop centre / edge (linear), mode 0
uniform float bgK;
uniform vec4 frame;     // mode 0: frame line colour (rgb, linear) and width (px)
uniform vec4 flash;     // flash colour (rgb) · amount (a)
uniform vec3 glow;      // mode 1: amount, mip, exposure (EV)
uniform vec2 look;      // mode 1: AgX look power, saturation
uniform vec4 ring[2];   // mode 1: centre (px), radius (px), intensity
uniform vec2 ghost[16]; // mode 1: 4 quads (px, counter-clockwise), the window's afterimages
uniform vec4 ghostI;    // their intensities
uniform vec3 ghostC;    // their colour

vec3 tone(vec4 c) {
  float d = c.a * kNorm;
  float l0 = log(1.0 + floor_);
  float al = pow(min(max(log(1.0 + d) - l0, 0.0) / (log(1.0 + ref) - l0), 8.0), expo);
  return c.rgb / max(c.a, 1e-9) * al;
}

// distance to the outline of quad i, and whether p is inside
vec2 quad(int i, vec2 p) {
  float d = 1e9, s = 1.0;
  for (int k = 0; k < 4; k++) {
    vec2 a = ghost[i * 4 + k], b = ghost[i * 4 + (k + 1) % 4];
    vec2 e = b - a, w = p - a;
    vec2 q = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
    d = min(d, length(q));
    if (e.x * w.y - e.y * w.x < 0.0) s = 0.0;
  }
  return vec2(d, s);
}

void main() {
  vec4 c = texture(hist, uv);
  if (c.a * kNorm < 6.0) {
    vec4 n = texture(hist, uv + vec2(-1.0, -1.0) * htexel) + texture(hist, uv + vec2(1.0, -1.0) * htexel)
           + texture(hist, uv + vec2(-1.0, 1.0) * htexel) + texture(hist, uv + vec2(1.0, 1.0) * htexel);
    c = mix(n * 0.25, c, smoothstep(0.0, 6.0, c.a * kNorm));
  }
  vec3 col = tone(c) * gain;
  vec2 px = gl_FragCoord.xy;
  if (mode == 0) {
    vec2 p = (px - 0.5 * res) / res.y;
    col += bgK * mix(bgA, bgB, smoothstep(0.0, 0.9, length(p * vec2(0.8, 1.0))));
    // the canvas's border, lit: a hairline and its inner glow
    vec2 e = min(px, res - px);
    float de = min(e.x, e.y);
    col += frame.rgb * (smoothstep(frame.w + 1.0, frame.w - 0.5, de) + 0.25 * exp(-de / (8.0 * frame.w)));
    col += flash.rgb * flash.a * (0.6 + 0.4 * smoothstep(0.8, 0.0, length(p)));
    o = vec4(col, 1.0);
  } else {
    // glow: the same tonemap on two blurred levels of the histogram (a mip texel = the mean density)
    vec4 g1 = textureLod(hist, uv, glow.y), g2 = vec4(0.0);
    for (int i = 0; i < 4; i++) {
      vec2 q = vec2(i & 1, i >> 1) - 0.5; // 2×2 bilinear taps half a coarse texel apart: no blocks
      g2 += 0.25 * textureLod(hist, uv + q * htexel * exp2(glow.y + 2.0), glow.y + 2.0);
    }
    col += glow.x * gain * (tone(g1) * 0.6 + tone(g2) * 0.4);
    // the window's afterimages: frames of light where it was a moment ago
    float lw = res.y * 0.0016;
    for (int i = 0; i < 4; i++) {
      if (ghostI[i] <= 0.0) continue;
      vec2 q = quad(i, px);
      col += ghostC * ghostI[i] * (smoothstep(lw + 1.0, lw * 0.3, q.x) + 0.2 * exp(-q.x / (lw * 8.0)));
    }
    // the burst: a flash around the window and two shock rings
    for (int i = 0; i < 2; i++) {
      if (ring[i].w <= 0.0) continue;
      float r = length(px - ring[i].xy);
      float wdt = res.y * 0.003 + ring[i].z * 0.015;
      col += ring[i].w * vec3(1.0, 0.86, 0.95) * exp(-pow((r - ring[i].z) / wdt, 2.0));
      col += ring[i].w * 0.06 * vec3(1.0, 0.15, 0.6) * exp(-pow((r - ring[i].z * 0.95) / (wdt * 3.0), 2.0));
    }
    if (flash.a > 0.0) {
      float r = length(px - ring[0].xy) / res.y;
      col += flash.rgb * flash.a * (0.04 + exp(-r * r * 8.0));
    }
    col = agxEotf(agxLook(agx(col * exp2(glow.z)), look.x, look.y));
    col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
    o = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
}
