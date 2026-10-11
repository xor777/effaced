// S09 · separable gaussian (the low-pass that the hybrid image subtracts from the fibres)
in vec2 uv;
out vec4 o;
uniform sampler2D src;
uniform vec2 dir;    // texel step along the pass direction
uniform float sigma; // texels
void main() {
  int R = int(ceil(2.5 * sigma));
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int i = -40; i <= 40; i++) {
    if (i < -R || i > R) continue;
    float w = exp(-0.5 * float(i * i) / (sigma * sigma));
    acc += texture(src, uv + float(i) * dir) * w;
    ws += w;
  }
  o = acc / ws;
}
