// S14's embers: a soft round sprite added onto the canvas; as line pairs (the erasure's streaks) the colour as is
in vec4 vC;
out vec4 o;
uniform float lines;
void main() {
  if (lines > 0.5) {
    o = vC;
    return;
  }
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  o = vC * (exp(-3.0 * r2) * step(r2, 1.0));
}
