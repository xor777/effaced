// S09 · full → quarter resolution (4×4 box from four bilinear taps): colour, a = 1 / depth
in vec2 uv;
out vec4 o;
uniform sampler2D src;
uniform vec2 texel; // source texel
void main() {
  o = 0.25 * (texture(src, uv + vec2(-1.0, -1.0) * texel) + texture(src, uv + vec2(1.0, -1.0) * texel) +
              texture(src, uv + vec2(-1.0, 1.0) * texel) + texture(src, uv + vec2(1.0, 1.0) * texel));
}
