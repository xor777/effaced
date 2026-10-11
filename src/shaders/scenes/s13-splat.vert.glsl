// S13 · one point per walker into the flame histogram (pulled from the state texture by gl_VertexID).
// flam3's "final transform" lives here: plotted, never iterated — a twist and a radial bulge of the
// whole flame about the camera's focus, then the camera (rotation·scale about the focus, + offset in H).
uniform sampler2D st;
uniform int stW;
uniform vec4 cam;      // rotation·scale (cos·S, sin·S) in H units, centre offset (H)
uniform vec4 fin;      // final transform: twist (rad per unit²), bulge exponent, colour shift, colour gain
uniform vec2 focus;    // the point of the flame (table units) at the centre of the screen
uniform float aspect;
uniform float burn;    // steps a walker needs before it is on the attractor
uniform vec3 PAL[6];   // palette, linear: [0] = the sigil's own colour
uniform vec2 band;     // NDC y range drawn by this pass (see BANDS)
out vec3 col;

vec3 palette(float x) {
  // index 0 is the sigil (colour coordinate 0); the flame cycles through 1..5, shifted by fin.z
  float y = fract(x * 1.25 + fin.z) * 5.0;
  int i = int(y);
  float f = y - float(i);
  vec3 c = mix(PAL[1 + i], PAL[1 + (i + 1) % 5], f * f * (3.0 - 2.0 * f));
  return mix(PAL[0], c, smoothstep(0.0, 0.2, x));
}

void main() {
  vec4 s = texelFetch(st, ivec2(gl_VertexID % stW, gl_VertexID / stW), 0);
  vec2 w = s.xy - focus;
  float r2 = dot(w, w);
  if (fin.x != 0.0) { float a = fin.x * r2; w = mat2(cos(a), sin(a), -sin(a), cos(a)) * w; }
  if (fin.y != 0.0) w *= pow(r2 + 1e-6, 0.5 * fin.y);
  vec2 p = mat2(cam.x, cam.y, -cam.y, cam.x) * w + cam.zw;
  bool off = s.w < burn || p.y * 2.0 < band.x || p.y * 2.0 >= band.y;
  gl_Position = off ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(p.x * 2.0 / aspect, p.y * 2.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  col = palette(s.z) * fin.w;
}
