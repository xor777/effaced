// S0 · Beam: phosphor persistence (exponential decay) and colour, read into the HDR target
#include "lib/common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform sampler2D phosphor;
uniform int mode;        // 0 = decay pass (writes phosphor), 1 = display pass (writes HDR)
uniform float decay;     // multiplier for this frame
uniform vec3 tint;       // beam colour (linear)
uniform float bright;

void main() {
  vec3 p = texture(phosphor, uv).rgb;
  if (mode == 0) { o = vec4(p * decay, 1.0); return; }
  // soft saturation: a beam parked on one spot must glow, not explode the bloom
  float e = 24.0 * (1.0 - exp(-p.r / 24.0));
  // hot core goes white, the glow keeps the phosphor's tint
  vec3 c = tint * e + vec3(1.0) * max(e - 1.0, 0.0) * 0.5;
  o = vec4(c * bright, 1.0);
}
