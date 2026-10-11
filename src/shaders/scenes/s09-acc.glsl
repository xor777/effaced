// S09 · supersampling the still: one jittered, MSAA-resolved pass × weight (additive)
in vec2 uv;
out vec4 o;
uniform sampler2D src;
uniform float w;
void main() { o = texture(src, uv) * w; }
