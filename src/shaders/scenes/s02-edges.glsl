in float side;
in float bright;
in vec3 col;
out vec4 o;
void main() {
  float g = exp(-3.0 * side * side);
  o = vec4(col * bright * g, 1.0);
}
