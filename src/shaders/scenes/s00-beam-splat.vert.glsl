// expands segment p0→p1 (instanced, consecutive samples) into a quad covering the beam footprint
in vec2 p0;
in vec2 p1;
out vec2 lp;
out float len;
out float energy;
uniform vec2 scale;   // XY signal → clip space (aspect-corrected)
uniform float sigma;  // beam radius in signal units
uniform float gain;

void main() {
  // a pen-up sample (Beam.blank): neither segment touching it is drawn
  if (max(abs(p0.x), abs(p1.x)) > 1e3) {
    lp = vec2(0.0);
    len = 0.0;
    energy = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 d = p1 - p0;
  len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1, 0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float ext = 4.0 * sigma;
  // corners of the quad: (0,0) (1,0) (0,1) (1,1) as a triangle strip
  int v = gl_VertexID;
  float ax = (v & 1) == 0 ? -ext : len + ext;
  float ay = (v & 2) == 0 ? -ext : ext;
  lp = vec2(ax, ay);
  energy = gain;
  vec2 pos = p0 + dir * ax + nrm * ay;
  gl_Position = vec4(pos * scale, 0.0, 1.0);
}
