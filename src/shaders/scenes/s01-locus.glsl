// S01 · Boundary: the CIE 1931 chromaticity diagram. Spectral locus (the edge of human colour
// vision), filled with the true colours this P3 screen can show; the triangle of the machine's gamut
// (sRGB, then Display P3); everything outside is hatched. Output is LINEAR DISPLAY P3, no tonemap.
// The view is static, so the expensive part (inside-the-locus test + distance to its 65 segments,
// the colour of each chromaticity) is baked once per size with BAKE defined: rgb = the colour
// normalised to its largest component (negatives kept = out of gamut), a = signed distance to the
// outline in bake pixels, positive inside. The per-frame pass samples it (bilinear: a signed distance
// interpolates well, so the dive in 02 can magnify it ~7× and the outline stays crisp).
#include "lib/common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform float t;
uniform vec2 L[66];      // locus 380..700 nm, 5 nm steps (65 points); segment 64→0 closes it (purple line)
uniform int nL;
uniform vec3 view;       // chromaticity at screen centre (xy), chromaticity units per screen height
uniform float fill;      // reveal radius around the white point (chromaticity units)
uniform float outline;   // static outline brightness
uniform vec3 vtx;        // vertex brightness
uniform vec3 edgeK;      // edge visibility RG, GB, BR
uniform float p3;        // 0 sRGB triangle → 1 Display P3 triangle
uniform float hatch;     // 0..1 hatching outside the triangle
uniform vec3 anomaly;    // chromaticity xy, brightness
uniform float grid;
uniform vec3 bakeView;   // the view the bake was made with
uniform mat3 frame;      // screen units (y in ±0.5) → chromaticity: affine, so the triangle can fly to S02
uniform float solo;      // 0 → 1: everything but the gamut triangle dissolves (the hand-over to S02)
uniform vec4 pulse[8];   // harp notes running along the locus: xy, intensity, age (s)

const vec2 W = vec2(0.3127, 0.3290);

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }

#ifdef BAKE
void main() {
  float px = view.z / res.y;                       // chromaticity units per pixel
  vec2 xy = view.xy + (gl_FragCoord.xy - 0.5 * res) * px;

  // inside the locus (crossing number) + distance to its outline
  bool inside = false;
  float dL = 1e9;
  for (int i = 0; i < 66; i++) {
    if (i >= nL) break;
    vec2 a = L[i], b = L[(i + 1) % nL];
    if ((a.y > xy.y) != (b.y > xy.y) && xy.x < (b.x - a.x) * (xy.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    dL = min(dL, segDist(xy, a, b));
  }
  // the colour of this chromaticity in linear P3, as bright as it can be
  vec3 col = xyz2p3(xyY2xyz(xy, 1.0));
  col = clamp(col / max(max(col.r, col.g), max(col.b, 1e-6)), -64.0, 64.0);
  o = vec4(col, (inside ? 1.0 : -1.0) * min(dL / px, 64.0));
}
#else
uniform sampler2D bake;

void main() {
  vec2 sc = (gl_FragCoord.xy - 0.5 * res) / res.y;
  vec2 xy = (frame * vec3(sc, 1.0)).xy;
  float px = sqrt(abs(determinant(mat2(frame)))) / res.y;   // chromaticity units per pixel
  float bpx = bakeView.z / res.y;
  vec2 buv = ((xy - bakeView.xy) / bpx + 0.5 * res) / res;
  vec4 bk = texture(bake, buv);
  bool inside = bk.a > 0.0;
  float dL = abs(bk.a) * bpx;

  // the machine's gamut triangle
  vec2 R = mix(vec2(0.640, 0.330), vec2(0.680, 0.320), p3);
  vec2 G = mix(vec2(0.300, 0.600), vec2(0.265, 0.690), p3);
  vec2 B = mix(vec2(0.150, 0.060), vec2(0.150, 0.060), p3);
  float e0 = cross2(G - R, xy - R), e1 = cross2(B - G, xy - G), e2 = cross2(R - B, xy - B);
  bool inTri = (e0 >= 0.0 && e1 >= 0.0 && e2 >= 0.0) || (e0 <= 0.0 && e1 <= 0.0 && e2 <= 0.0);
  float dRG = segDist(xy, R, G), dGB = segDist(xy, G, B), dBR = segDist(xy, B, R);

  vec3 c = vec3(0.0);
  // faint machine grid every 0.1
  vec2 gq = abs(fract(xy * 10.0 + 0.5) - 0.5) / (px * 10.0);
  c += vec3(0.010, 0.012, 0.016) * grid * (1.0 - solo) * (smoothstep(1.5, 0.0, min(gq.x, gq.y)));

  if (inside) {
    vec3 col = bk.rgb;                             // baked, normalised to its largest component
    bool inGamut = min(col.r, min(col.g, col.b)) >= 0.0;
    col = max(col, 0.0);
    float reveal = smoothstep(fill, fill - 0.04, length(xy - W));
    float k = 0.62 * reveal;
    if (!inTri) {
      // outside the cage: dimmed, hatched — "your screen can't show this"
      // stripes anchored to the diagram (they grow during the dive), ~9 px apart at 1080p
      float spc = 9.0 / 1080.0;
      float hl = smoothstep(0.32, 0.18, abs(fract((xy.x + xy.y) / spc) - 0.5));
      float dim = mix(1.0, 0.16, hatch);
      c += (col * k * dim + vec3(0.30) * hl * hatch * reveal * (inGamut ? 0.35 : 0.55)) * (1.0 - solo);
    } else {
      c += col * k;
    }
  }

  // outlines: locus (static, after the beam has drawn it) and the triangle
  float lw = 1.1 * px;
  c += vec3(0.75, 0.70, 0.85) * outline * (1.0 - solo) * exp(-0.5 * dL * dL / (lw * lw));
  vec3 eg = vec3(dRG, dGB, dBR);
  // during the hand-over the edges take S02's face-edge profile (σ scales with the screen height)
  float lwe = mix(1.1, 0.88 * res.y / 1080.0, solo) * px;
  vec3 ew = exp(-0.5 * eg * eg / (lwe * lwe));
  c += mix(vec3(1.6), vec3(1.6, 1.47, 1.36), solo) * dot(ew, edgeK);   // warm white, like S02's face edges
  // vertices
  float vr = 5.0 * px;
  c += vec3(4.0, 1.2, 1.0) * vtx.x * exp(-0.5 * dot(xy - R, xy - R) / (vr * vr));
  c += vec3(1.2, 4.0, 1.2) * vtx.y * exp(-0.5 * dot(xy - G, xy - G) / (vr * vr));
  c += vec3(1.2, 1.4, 4.0) * vtx.z * exp(-0.5 * dot(xy - B, xy - B) / (vr * vr));
  // harp notes: a light running along the outline at the wavelength of the note's pitch
  for (int i = 0; i < 8; i++) {
    vec4 q = pulse[i];
    if (q.z <= 0.0) continue;
    float d = length(xy - q.xy);
    vec2 cuv = ((q.xy + (W - q.xy) * 0.04 - bakeView.xy) / bpx + 0.5 * res) / res;
    vec3 pc = max(texture(bake, cuv).rgb, 0.0) + 0.25;
    float rr = 0.006 + 0.05 * q.w;                                   // a ring opening from the note
    c += pc * q.z * (2.5 * exp(-0.5 * d * d / (vr * vr * 0.5))     // the spark
                   + 1.2 * exp(-0.5 * dL * dL / (lw * lw)) * exp(-0.5 * d * d / (0.025 * 0.025))  // the outline lights up
                   + 0.5 * exp(-0.5 * pow((d - rr) / (1.5 * px), 2.0)) * exp(-3.0 * q.w));
  }

  // the fourth note: a point the cage has no room for
  float da = length(xy - anomaly.xy);
  float ring = exp(-0.5 * pow((da - (0.012 + 0.006 * sin(t * 6.2832 / 0.48))) / (1.2 * px), 2.0));
  c += vec3(1.0) * anomaly.z * (3.0 * exp(-0.5 * da * da / (vr * vr * 0.6)) + 0.6 * ring);

  o = vec4(c, 1.0);
}
#endif
