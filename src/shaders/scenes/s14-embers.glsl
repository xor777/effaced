// S14's embers: a soft round sprite, added onto the canvas
in vec4 vC;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  o = vC * (exp(-3.0 * r2) * step(r2, 1.0));
}
