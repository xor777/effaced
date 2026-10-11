// CRT pass for the machine's scenes: the source image becomes the face of a curved picture tube
// (barrel distortion, aperture-grille mask, scanlines, glass reflection) seen at `zoom`.
// zoom = 1: the tube fills the frame (camera at the glass); smaller: we see the monitor in the dark.
#include "lib/common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform sampler2D src;
uniform vec2 res;
uniform float zoom;
uniform float curve;   // barrel amount
uniform float mask;    // shadow-mask strength
uniform float t;

void main() {
  vec2 p = (uv - 0.5) / zoom;                 // screen-space around the tube centre
  float aspect = res.x / res.y;
  vec2 q = p * vec2(aspect, 1.0);
  // barrel: the glass bulges towards us
  float r2 = dot(q, q);
  vec2 bq = q * (1.0 + curve * r2);
  vec2 tuv = bq / vec2(aspect, 1.0) + 0.5;
  vec3 c = vec3(0.0);
  vec2 edge = smoothstep(vec2(0.0), vec2(0.004 / zoom), tuv) * smoothstep(vec2(0.0), vec2(0.004 / zoom), 1.0 - tuv);
  float inside = edge.x * edge.y;
  if (inside > 0.0) {
    vec3 img = texture(src, tuv).rgb;
    // aperture grille (RGB stripes) + scanlines, sized relative to the tube so they read when zoomed out
    float px = tuv.x * 640.0, py = tuv.y * 360.0;
    vec3 grille = vec3(
      0.6 + 0.4 * cos(6.2832 * (px - 0.0) / 3.0),
      0.6 + 0.4 * cos(6.2832 * (px - 1.0) / 3.0),
      0.6 + 0.4 * cos(6.2832 * (px - 2.0) / 3.0));
    float scan = 0.75 + 0.25 * cos(6.2832 * py);
    vec3 m = mix(vec3(1.0), grille * scan * 1.35, mask);
    c = img * m * inside;
    // glass: faint reflection of a window-shaped highlight and a vignette in the tube corners
    float refl = smoothstep(0.35, 0.0, length(bq - vec2(-0.35 * aspect, 0.28))) * 0.02;
    c += vec3(refl);
    c *= smoothstep(1.25, 0.4, length(bq * vec2(0.9, 1.1)));
  }
  // bezel: a dim plastic frame catching some screen light
  vec2 b = abs(bq / vec2(aspect, 1.0));
  float bez = step(max(b.x, b.y), 0.56) * (1.0 - inside);
  c += vec3(0.012, 0.012, 0.014) * bez;
  o = vec4(c, 1.0);
}
