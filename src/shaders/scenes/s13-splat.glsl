// S13 · histogram bin: Σ colour, Σ count (RGBA32F, additive), × this frame's weight (exponential decay)
in vec3 col;
out vec4 o;
uniform float wgt;
void main() { o = vec4(col, 1.0) * wgt; }
