// S13 · flame histogram (half resolution: one bin per CSS pixel) → HDR at full resolution:
// log-density tonemapping (Draves & Reckase) with a cheap density estimation — sparse bins are
// widened to a 4×4-bin footprint — plus the light point the flame collapses into.
#include "lib/common"
in vec2 uv;
out vec4 o;
uniform sampler2D hist;
uniform vec2 res;
uniform vec2 htexel;  // 1 / histogram size
uniform float kNorm;  // count → density relative to an even spread over the whole frame
uniform float ref;    // density at which alpha = 1
uniform float floor_; // density below which a bin stays black (no haze from the sparsest dust)
uniform float expo;   // 2.2 / flam3 gamma
uniform float gain;
uniform vec2 dotP;    // the point: radius (px), linear intensity
uniform float satur;  // saturation of the mean colour (flam3's vibrancy, pushed: averaging greys the palette)

void main() {
  vec4 c = texture(hist, uv);
  float d = c.a * kNorm;
  if (d < 8.0) {
    vec4 n = texture(hist, uv + vec2(-1.0, -1.0) * htexel) + texture(hist, uv + vec2(1.0, -1.0) * htexel)
           + texture(hist, uv + vec2(-1.0, 1.0) * htexel) + texture(hist, uv + vec2(1.0, 1.0) * htexel);
    c = mix(n * 0.25, c, smoothstep(0.0, 8.0, d));
    d = c.a * kNorm;
  }
  vec3 avg = c.rgb / max(c.a, 1e-9);
  float lum = dot(avg, vec3(0.2289746, 0.6917385, 0.0792869)); // linear P3 → Y
  avg = max(mix(vec3(lum), avg, satur), 0.0);
  float l0 = log(1.0 + floor_);
  float al = min(max(log(1.0 + d) - l0, 0.0) / (log(1.0 + ref) - l0), 6.0);
  vec3 col = avg * pow(al, expo) * gain;
  float r = length(gl_FragCoord.xy - 0.5 * res);
  col += vec3(dotP.y * clamp(dotP.x + 0.5 - r, 0.0, 1.0));
  o = vec4(col, 1.0);
}
