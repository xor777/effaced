// HDR → bloom mix → lens (CA, vignette) → AgX → grain + IGN dither → display
#include "lib/common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform sampler2D hdr;
uniform sampler2D bloom;
uniform vec2 res;        // output size, px
uniform float bloomNorm; // 1 / number of summed mips
uniform float exposure;  // EV
uniform float bloomAmt;
uniform float vignette;
uniform float grain;
uniform float ca;        // chromatic aberration, px at the corner
uniform float time;
uniform vec4 look;       // power, saturation, lift, fade-to-black (0..1)
uniform float exact;     // 0 AgX … 1 clip (exact colours); in between: a blend, for hand-overs between scenes

void main() {
  vec2 p = uv - 0.5;
  vec3 c;
  if (ca > 0.0) {
    vec2 dir = p * ca / res * 2.0;
    c = vec3(texture(hdr, uv + dir).r, texture(hdr, uv).g, texture(hdr, uv - dir).b);
  } else {
    c = texture(hdr, uv).rgb;
  }
  c = mix(c, texture(bloom, uv).rgb * bloomNorm, bloomAmt);
  c *= exp2(exposure);
  c *= mix(1.0, smoothstep(1.2, 0.2, length(p * vec2(res.x / res.y, 1.0))), vignette);
  if (exact >= 1.0) {
    c = lin2srgb(clamp(c, 0.0, 1.0));
  } else {
    vec3 a = agxEotf(agxLook(agx(c), look.x, look.y));
    c = exact > 0.0 ? mix(a, lin2srgb(clamp(c, 0.0, 1.0)), exact) : a;
  }
  c = c + look.z * (1.0 - c);
  c *= 1.0 - look.w;
  // film grain (luma-weighted) + dither
  float n = hash1(uint(gl_FragCoord.x) + uint(gl_FragCoord.y) * 4099u + uint(time * 60.0) * 16769023u) - 0.5;
  c += n * grain * (0.3 + 0.7 * sqrt(sat(dot(c, vec3(0.333)))));
  c += (ign(gl_FragCoord.xy + time * 113.0) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}
