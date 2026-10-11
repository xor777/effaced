// 3×3 tent upsample, additively blended into the next larger mip
in vec2 uv;
out vec4 o;
uniform sampler2D src;
uniform vec2 texel; // 1 / source size
uniform float radius;

void main() {
  vec2 d = texel * radius;
  vec3 r = texture(src, uv).rgb * 4.0;
  r += (texture(src, uv + vec2(-d.x, 0)).rgb + texture(src, uv + vec2(d.x, 0)).rgb +
        texture(src, uv + vec2(0, -d.y)).rgb + texture(src, uv + vec2(0, d.y)).rgb) * 2.0;
  r += texture(src, uv + vec2(-d.x, -d.y)).rgb + texture(src, uv + vec2(d.x, -d.y)).rgb +
       texture(src, uv + vec2(-d.x, d.y)).rgb + texture(src, uv + vec2(d.x, d.y)).rgb;
  o = vec4(r / 16.0, 1.0);
}
