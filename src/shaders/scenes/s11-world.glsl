// S11 · Inversion — the world. The DC-mosaic city of S10 (flat-coloured blocks, the averages of what
// was there) under the inversion of space x ↦ r²x/|x|², curled up around the camera: with κ = 1/L,
// J⁻¹(x) = (x.x, x.y − κ|x|², x.z) / (1 − 2κ·x.y + κ²|x|²) maps the rendered space back to the world —
// the identity at κ = 0, the ground becomes a ball of diameter L resting on the origin, the sky (the
// world's infinity) its top point. Inversions are conformal, not isometric: the world's distance d at
// J⁻¹(x) shrinks to the exact safe radius d·D / (1 + κ·d·√D) around x (the image of a ball is a ball,
// this is its distance to x). On the ground lies the stereographic chart of the {p,3} tiling: folded
// up by the inversion it becomes the regular tiling of the ball.
#include "lib/common"
#include "lib/color"
#include "lib/hyper"
#include "lib/mosaic"
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform vec3 ro;
uniform mat3 cam;          // right, up, forward
uniform float focal;       // in units of the target height
uniform float kappa;       // 1/L
uniform float hk;          // block height scale (→ 0: the city is laid flat)
uniform float morph;       // 0 DC mosaic colours … 1 tiling colours (per block)
uniform float exactK;      // 0 per-block colour … 1 per-point colour (the mosaic dissolves)
uniform float Sg;          // world units per chart unit of the tiling
uniform vec4 T;
uniform float p;
uniform vec3 fogC;
uniform vec3 wash;         // paint strength by generation (as on the plane)

// the opening is S10's last frame: its DC mosaic (40×25 blocks over the screen at row 0)
uniform sampler2D s10coef;
uniform float s10on;       // 1 when S10's coefficients exist (else the fallback mosaic)
uniform float flatK;       // 1 = unlit flat blocks (S10's picture), → 0 as they rise
uniform float vigK;        // S10's vignette (it came before its tonemap), fading out
uniform float gK;          // grout width 0..1 (S10's blocks touch)
uniform float fogK;
uniform float raw;         // 1 for the first row: S10's own HDR values, posted with S10's own post

const float CITY = 26.0;   // the blocks stop here (beyond: flat ground, fog)

int mirrorIdx(int i, int n) { int m = i - 2 * n * int(floor(float(i) / float(2 * n))); return m < n ? m : 2 * n - 1 - m; }
// world cell (ix, iz) is S10's block (ix + 20, 12 − iz) at 16:00 (screen right = +x, up = −z); beyond the
// frame the mosaic continues mirrored
ivec2 s10cell(vec2 c) { return ivec2(mirrorIdx(int(c.x) + 20, 40), mirrorIdx(12 - int(c.y), 25)); }

// the DC terms rise into buildings: a block's height is its brightness (S10's luma), with a little
// variation so equal neighbours don't fuse
float cellH(vec2 c) {
  float h = hash2(c + vec2(31.0, 7.0));
  float r = length(c + 0.5);
  float tall = h * h * h;
  if (s10on > 0.5) {
    float y = clamp((texelFetch(s10coef, s10cell(c) * 8, 0).r / 8.0 + 128.0) / 255.0, 0.0, 1.0);
    tall = mix(tall, y * y * y, 0.7);
  }
  return (0.08 + 1.1 * tall) * hk * (1.0 - smoothstep(CITY - 6.0, CITY, r));
}

// world SDF: blocks with grout between them on the ground plane y = 0
float sdWorld(vec3 p) {
  vec2 c = floor(p.xz);
  vec2 f = p.xz - c - 0.5;
  float h = cellH(c);
  float g = 0.045 * gK;
  vec3 b = vec3(abs(f.x) - (0.5 - g), abs(p.y - 0.5 * h) - 0.5 * h, abs(f.y) - (0.5 - g));
  float dBox = length(max(b, 0.0)) + min(max(b.x, max(b.y, b.z)), 0.0);
  float d = min(dBox, p.y);
  // above every block the city is a plane; below that, never step over a cell wall (the neighbour
  // may be taller)
  float hmax = 1.18 * hk;
  if (p.y > hmax) return min(d, p.y - hmax + 0.02);
  vec2 wall = 0.5 - abs(f);
  if (p.y > 0.0 && hk > 0.0) d = min(d, max(min(wall.x, wall.y), 0.0) + 0.03);
  return d;
}

vec3 toWorld(vec3 x, out float D) {
  float xx = dot(x, x);
  D = 1.0 - 2.0 * kappa * x.y + kappa * kappa * xx;
  return vec3(x.x, x.y - kappa * xx, x.z) / D;
}

float sdRendered(vec3 x) {
  float D;
  vec3 y = toWorld(x, D);
  float d = sdWorld(y);
  return d * D / (1.0 + kappa * abs(d) * sqrt(D));
}

// S10 left the city as its DC terms: one flat average per block
vec3 dcColour(vec2 c, float vig) {
  if (s10on > 0.5) {
    vec3 hdr = s10block(s10coef, s10cell(c));
    return raw > 0.5 ? hdr : s10display(hdr * vig);
  }
  float h = hash2(c + vec2(3.0, 11.0)), l = hash2(c + vec2(5.0, 2.0));
  vec3 a = mix(hex2p3(C_DECADE), h < 0.5 ? hex2p3(C_BEADED) : hex2p3(C_FACADE), 0.3 * h);
  return a * (0.3 + 0.8 * l * l);
}

vec3 tileColour(vec2 g) {
  vec2 u = vec2(g.x, -g.y) / Sg;
  float a = PI / p;
  u = vec2(cos(a) * u.x - sin(a) * u.y, sin(a) * u.x + cos(a) * u.y);
  Tile tl = tileFold(u, T);
  vec3 paper = hex2p3(C_EFFACE);
  vec3 c = paper;
  if (tl.gen > 0.5) {
    float th = atan(tl.ctr.y, tl.ctr.x);
    float kt = floor(mod(th / T.x + 0.3, p));
    float idx = mod(kt + tl.gen - 1.0, 3.0);
    vec3 b = idx < 0.5 ? hex2p3(C_BYRNE_R) : idx < 1.5 ? hex2p3(C_BYRNE_Y) : hex2p3(C_BYRNE_B);
    float a = tl.gen < 1.5 ? wash.x : tl.gen < 2.5 ? wash.y : wash.z;
    c = paper * pow(max(b, 1e-4) / paper, vec3(a));
  }
  // the ink of the edge, as wide as on the plane (it fades with the block grout)
  float e = tl.edge / tl.sc * Sg;
  return mix(c, vec3(0.012), exactK * (1.0 - smoothstep(0.02, 0.06, e)));
}

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  vec3 rd = normalize(cam * vec3(q, focal));
  float t0 = 0.0, tmax = kappa > 0.0 ? 1.2 / kappa : 160.0;
  float tt = 0.02;
  bool hit = false;
  for (int i = 0; i < 160; i++) {
    float d = sdRendered(ro + rd * tt);
    if (d < 0.0011 * tt + 0.0005) { hit = true; break; }   // ≈ a third of a (half-res) pixel
    tt += d * 0.95;
    if (tt > tmax) break;
  }
  vec3 col = fogC;
  if (hit) {
    vec3 x = ro + rd * tt;
    float Dx;
    toWorld(x, Dx);
    // the normal's finite difference must stay small against the world as the inversion shrinks it
    vec2 e = vec2(1.0, -1.0) * 0.0015 * max(tt, 0.3) * clamp(4.0 * Dx, 0.04, 1.0);
    vec3 n = normalize(e.xyy * sdRendered(x + e.xyy) + e.yyx * sdRendered(x + e.yyx) +
                       e.yxy * sdRendered(x + e.yxy) + e.xxx * sdRendered(x + e.xxx));
    float D;
    vec3 y = toWorld(x, D);
    vec2 cell = floor(y.xz);
    vec2 f = y.xz - cell - 0.5;
    bool grout = max(abs(f.x), abs(f.y)) > 0.5 - 0.045 * gK && y.y < 0.002 + 0.001 * hk && exactK < 1.0;
    float mk = smoothstep(0.0, 1.0, morph * 1.8 - 0.8 * hash2(cell + vec2(9.0, 4.0)));   // blocks flip one by one
    float vig = mix(1.0, s10vignette(gl_FragCoord.xy / res, res.x / res.y), vigK);
    vec3 base = dcColour(cell, vig);
    if (mk > 0.0) base = mix(base, tileColour(cell + 0.5), mk);
    if (exactK > 0.0) base = mix(base, tileColour(y.xz), exactK);
    // museum light: a soft key, a fill from the eye, contact shadow at the foot of every block
    float h = cellH(cell);
    float top = step(h - 0.004, y.y);
    float ao = mix(mix(0.42, 1.0, smoothstep(0.0, 0.8, y.y)), 1.0, top);
    if (grout) ao *= 0.8;
    vec3 L = normalize(vec3(0.35, 0.85, 0.4));
    float dif = max(dot(n, L), 0.0);
    float fill = 0.5 + 0.5 * dot(n, normalize(ro - x));
    vec3 lit = base * ao * (0.75 * dif + 0.4 * fill + 0.06);
    col = mix(lit, base, max(exactK, flatK));         // flat at both ends: S10's picture, then the plane's
    // the world fades into its own infinity (which the inversion brings to a point)
    float r = length(y.xz);
    col = mix(col, fogC, (1.0 - exp(-r * r / 2400.0)) * (1.0 - exactK) * fogK);
  }
  o = vec4(col, 1.0);
}
