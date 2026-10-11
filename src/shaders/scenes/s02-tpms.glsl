// S02 · Cage, part 2: inside a triply periodic minimal surface lattice — gyroid morphing into
// Schwarz P. Sphere-traced; lit with a cold ACCEDE fog, cavity AO and glowing surface seams.
#include "lib/common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform float t;
uniform vec3 ro;       // camera position
uniform mat3 cam;      // camera basis (right, up, forward)
uniform float morph;   // 0 gyroid → 1 Schwarz P
uniform float thick;   // wall half-thickness
uniform float glow;    // seam glow
uniform float beat;    // kick envelope
uniform float fade;    // 0..1 overall

float gyroid(vec3 p) { return dot(sin(p), cos(p.yzx)); }
float schwarzP(vec3 p) { return cos(p.x) + cos(p.y) + cos(p.z); }

const float SCALE = 3.2; // lattice frequency (period 2π/SCALE units)
float field(vec3 p) { p *= SCALE; return mix(gyroid(p), schwarzP(p) * 0.85, morph); }

// the implicit fields are not distances: first-order estimate (|f| - thick) / |∇f| with the
// analytic gradients, slightly under-relaxed
vec3 fieldGrad(vec3 p) {
  vec3 q = p * SCALE;
  vec3 s = sin(q), c = cos(q);
  vec3 gg = vec3(c.x * c.y - s.z * s.x, c.y * c.z - s.x * s.y, c.z * c.x - s.y * s.z);
  vec3 gp = -s * 0.85;
  return mix(gg, gp, morph) * SCALE;
}
float map(vec3 p) {
  return 0.8 * (abs(field(p)) - thick) / max(length(fieldGrad(p)), 0.4 * SCALE);
}

vec3 normalAt(vec3 p) {
  // normal of the thickened sheet = ± the field gradient
  return normalize(fieldGrad(p)) * sign(field(p));
}

float ao(vec3 p, vec3 n) {
  float s = 0.0, w = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.06 * float(i);
    s += w * (h - map(p + n * h));
    w *= 0.6;
  }
  return sat(1.0 - 2.2 * s);
}

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  vec3 rd = normalize(cam * vec3(q, 1.1));
  // the camera flies through the lattice and crosses its walls: start beyond a near distance, step
  // out of a wall the ray starts in, and fade surfaces close to the lens (otherwise a crossing fills
  // a frame or two with the wall: the black/white single-frame flashes)
  const float NEAR = 0.3;
  float d = NEAR, h = 1.0;
  int steps = 0;
  bool hit = false;
  for (int i = 0; i < 110; i++) {
    h = map(ro + rd * d);
    if (h < 0.0 && d < NEAR + 0.4) { d += max(-h, 0.02); continue; } // still inside the wall at the lens
    if (h < 0.001 * d) { hit = true; break; }
    d += h;
    steps = i;
    if (d > 40.0) break;
  }
  vec3 fogc = hex2p3(C_ACCEDE) * 0.015;
  vec3 c = fogc;
  if (hit) {
    vec3 p = ro + rd * d;
    vec3 n = normalAt(p);
    float occ = ao(p, n);
    vec3 l = normalize(vec3(0.4, 0.8, -0.3));
    float dif = max(dot(n, l), 0.0);
    float fre = pow(1.0 - abs(dot(n, -rd)), 4.0);
    vec3 r = reflect(rd, n);
    float spec = pow(max(dot(r, l), 0.0), 40.0);
    // dark machine glass: mostly reflection of a cold sky gradient + a sharp highlight
    vec3 sky = mix(hex2p3(C_ACCEDE) * 0.02, hex2p3(C_ACCEDE) * 0.5, sat(r.y * 0.5 + 0.5));
    c = vec3(0.012) * dif * occ + sky * (0.04 + 0.9 * fre) * occ + vec3(1.0) * spec * 0.8 * occ;
    // seams: the surface's mid-sheet shows through the wall edges as thin glowing contour lines
    float iso = field(p);
    float lines = abs(fract(iso * 3.0 + t * 0.15) - 0.5);
    float seam = smoothstep(0.06, 0.0, lines) * smoothstep(thick * 1.2, 0.0, abs(iso));
    float cells = 0.6 + 0.4 * sin(dot(floor(p * SCALE / 6.2832), vec3(1.7, 2.3, 3.1)) + t);
    c += hex2p3(C_DECADE) * seam * glow * (0.7 + 0.6 * beat) * cells;
    c = mix(c, fogc, 1.0 - exp(-d * 0.07));
    c = mix(fogc, c, smoothstep(NEAR, NEAR + 0.6, d));
#ifdef DEBUG_NORMALS
    c = (n * 0.5 + 0.5) * exp(-d * 0.1);
#endif
  }
  o = vec4(c * fade, 1.0);
}
