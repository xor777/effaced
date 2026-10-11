// S11 · S10's last DC mosaic as a texture: one texel per block (linear HDR as S10 shows it, a = luma).
// Mipmapped, it lets the far, curled-up city show the mosaic prefiltered instead of aliasing.
#include "lib/common"
#include "lib/color"
#include "lib/mosaic"
out vec4 o;
uniform sampler2D s10coef;
void main() {
  ivec2 b = ivec2(gl_FragCoord.xy);
  o = vec4(s10block(s10coef, b), clamp((texelFetch(s10coef, b * 8, 0).r / 8.0 + 128.0) / 255.0, 0.0, 1.0));
}
