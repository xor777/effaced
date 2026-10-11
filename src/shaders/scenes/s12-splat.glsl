// S12 · histogram bin (RGBA32F, additive): Σ colour, Σ count; round soft points when larger than 1 px
in vec3 col;
out vec4 o;
uniform float soft;
uniform float wgt; // this frame's weight (exponential decay of the histogram)
void main() {
  float w = 1.0;
  if (soft > 0.5) {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    w = max(0.0, 1.0 - dot(q, q));
    w *= w;
  }
  o = vec4(col, 1.0) * (w * wgt);
}
