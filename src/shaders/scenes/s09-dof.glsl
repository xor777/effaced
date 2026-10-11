// S09 · depth of field at quarter resolution: a gather over a Vogel (golden-angle) spiral. Each tap
// counts if its own circle of confusion reaches this pixel (scatter as gather); farther taps may not
// bleed over a sharper nearer pixel by more than twice its own blur. a = the blur that reaches this
// pixel (its own CoC, or that of the defocused taps covering it), quarter px.
in vec2 uv;
out vec4 o;
uniform sampler2D src; // rgb, a = 1 / depth
uniform vec2 texel;
uniform vec3 coc;      // K (quarter px per unit of 1/depth), 1 / focus distance, max radius (quarter px)
uniform float frame;
const int N = 64;

float cocOf(float iz) { return min(coc.x * abs(iz - coc.y), coc.z); }

void main() {
  vec4 c0 = texture(src, uv);
  float r0 = cocOf(c0.a);
  vec3 acc = c0.rgb;
  float ws = 1.0, rc = 0.0;
  // the spiral turns from frame to frame (not per pixel: neighbours keep fetching neighbours, the texture
  // cache stays warm); its pattern changes faster than the eye can follow
  float rot = 2.39996323 * mod(frame, 97.0);
  for (int i = 0; i < N; i++) {
    float r = sqrt((float(i) + 0.5) / float(N)) * coc.z;
    float a = float(i) * 2.39996323 + rot;
    vec4 s = texture(src, uv + vec2(cos(a), sin(a)) * r * texel);
    float rs = cocOf(s.a);
    if (s.a < c0.a) rs = min(rs, 2.0 * r0 + 0.5);
    float w = smoothstep(r - 0.75, r + 0.75, rs);
    acc += s.rgb * w;
    ws += w;
    rc += rs * w;
  }
  o = vec4(acc / ws, max(r0, rc / ws));
}
