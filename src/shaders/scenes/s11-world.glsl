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
uniform float s10on;       // 1 when S10's coefficients exist (else the fallback mosaic)
uniform float flatK;       // 1 = unlit flat blocks (S10's picture), → 0 as they rise
uniform float vigK;        // S10's vignette (it came before its tonemap), fading out
uniform float gK;          // grout width 0..1 (S10's blocks touch)
uniform float fogK;
uniform float raw;         // 1 for the first row: S10's own HDR values, posted with S10's own post
uniform sampler2D mosT;    // S10's 40×25 block colours (HDR, a = luma), mipmapped, MIRRORED_REPEAT
uniform sampler2D hT;      // the blocks' tallness from it: r own, g the tallest of the 3×3 around

const float CITY = 26.0;   // the blocks stop here (beyond: flat ground, fog)

int mirrorIdx(int i, int n) { int m = i - 2 * n * int(floor(float(i) / float(2 * n))); return m < n ? m : 2 * n - 1 - m; }
// world cell (ix, iz) is S10's block (ix + 20, 12 − iz) at 16:00 (screen right = +x, up = −z); beyond the
// frame the mosaic continues mirrored (the texture wraps with MIRRORED_REPEAT, the same pattern)
ivec2 s10cell(vec2 c) { return ivec2(mirrorIdx(int(c.x) + 20, 40), mirrorIdx(12 - int(c.y), 25)); }
vec2 mosUV(vec2 w) { return vec2(w.x + 20.0, 13.0 - w.y) / vec2(40.0, 25.0); }

// Level of detail. A block is 1 world unit; `pxw` is how many world units one (half-res) pixel covers
// at a point — the inversion shrinks the world by D there. Where blocks get smaller than a few pixels
// they are laid flat, their colours prefiltered (mipmaps) and their grout and contact shadows faded:
// otherwise the far, curled-up city aliases into stripes and sparkle.
uniform float lodOn;       // dev: 0 disables the level of detail (for A/B checks)
float pxWorld(vec3 x, float D) { return lodOn * length(x - ro) / (focal * res.y * max(D, 1e-5)); }

// the DC terms rise into buildings: a block's height is its brightness (S10's luma, with a little
// variation so equal neighbours don't fuse); far away (sub-pixel blocks) they lie flat
float cityFade(float r) { return 1.0 - smoothstep(CITY - 6.0, CITY, r); }
float cellH(vec2 c, float lod) {
  return (0.08 + 1.1 * texelFetch(hT, s10cell(c), 0).r) * hk * cityFade(length(c + 0.5)) * (1.0 - lod);
}

// world SDF: blocks with grout between them on the ground plane y = 0. Returns (step, surface). The
// surface distance is exact for the point's own cell — its block and the ground — and alone decides a
// hit. The step also respects the neighbours: each is inset by the grout g from the shared wall and none
// is taller than the 3×3 maximum, so it is at least that far; but that is only a bound — taken for a
// surface (as it once was) it stops the march in mid-air, on a false plane over the blocks and on the
// grout lines, which then shade as stripes.
vec2 sdWorld(vec3 p, float lod) {
  vec2 c = floor(p.xz);
  vec2 f = p.xz - c - 0.5;
  vec2 t = texelFetch(hT, s10cell(c), 0).rg;
  float k = hk * (1.0 - lod);
  float r = length(c + 0.5);
  float h = (0.08 + 1.1 * t.x) * k * cityFade(r);
  float g = 0.045 * gK;
  vec3 b = vec3(abs(f.x) - (0.5 - g), abs(p.y - 0.5 * h) - 0.5 * h, abs(f.y) - (0.5 - g));
  float surf = min(length(max(b, 0.0)) + min(max(b.x, max(b.y, b.z)), 0.0), p.y);
  if (k <= 0.0) return vec2(surf);
  // the 3×3 around: inset by g, no taller than hn; beyond it: a cell further, no taller than any block
  float hn = (0.08 + 1.1 * t.y) * k * cityFade(r - 1.5);
  vec2 wall = 0.5 - abs(f);
  float w = max(min(wall.x, wall.y), 0.0) + g;
  float nb = min(length(vec2(w, max(p.y - hn, 0.0))), length(vec2(w + 1.0, max(p.y - 1.18 * k, 0.0))));
  return vec2(min(surf, nb), surf);
}

vec3 toWorld(vec3 x, out float D) {
  float xx = dot(x, x);
  D = 1.0 - 2.0 * kappa * x.y + kappa * kappa * xx;
  return vec3(x.x, x.y - kappa * xx, x.z) / D;
}

float lodOf(float pxw) { return smoothstep(0.25, 0.8, pxw); }

vec2 sdRendered(vec3 x) {
  float D;
  vec3 y = toWorld(x, D);
  vec2 d = sdWorld(y, lodOf(pxWorld(x, D)));
  return d * D / (1.0 + kappa * abs(d) * sqrt(D));
}

// S10 left the city as its DC terms: one flat average per block (prefiltered when blocks get small)
vec3 dcColour(vec2 c, vec2 w, float vig, float pxw) {
  if (s10on > 0.5) {
    vec3 hdr = texelFetch(mosT, s10cell(c), 0).rgb;
    float f = smoothstep(0.3, 1.0, pxw);
    if (f > 0.0) hdr = mix(hdr, textureLod(mosT, mosUV(w), max(log2(pxw), 0.0)).rgb, f);
    return raw > 0.5 ? hdr : s10display(hdr * vig);
  }
  float h = hash2(c + vec2(3.0, 11.0)), l = hash2(c + vec2(5.0, 2.0));
  vec3 a = mix(hex2p3(C_DECADE), h < 0.5 ? hex2p3(C_BEADED) : hex2p3(C_FACADE), 0.3 * h);
  return mix(a * (0.3 + 0.8 * l * l), hex2p3(C_DECADE) * 0.62, smoothstep(0.3, 1.0, pxw));
}

vec3 tileColour(vec2 g, float pxw) {
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
  // the ink of the edge, ~0.04 world units wide; never thinner than a pixel (it fades instead)
  float e = tl.edge / tl.sc * Sg;
  float wInk = max(0.04, 1.2 * pxw);
  return mix(c, vec3(0.012), exactK * (0.04 / wInk) * (1.0 - smoothstep(0.5 * wInk, wInk, e)));
}

// The march stops within a tolerance (≈ ⅓ pixel, magnified by 1/D in world units by the inversion), or
// a little inside a neighbour's block. So a hit is shaded not from where it landed but from the nearest
// surface around it — the ground, or a face of one of the 3×3 blocks around it — classified exactly,
// with that face's exact normal (a finite-difference normal there straddles edges and grout: facets and
// streaks). kind: 0 ground, 1 top, 2 wall.
struct Hit { vec2 cell; vec3 nW; float kind; float nearH; };
Hit classify(vec3 y, float lod) {
  Hit H;
  vec2 c0 = floor(y.xz);
  H.cell = c0; H.nW = vec3(0.0, 1.0, 0.0); H.kind = 0.0; H.nearH = 0.0;
  float best = abs(y.y), bestBox = 1e9;
  float g = 0.045 * gK;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 c = c0 + vec2(float(i), float(j));
      float h = cellH(c, lod);
      if (h <= 1e-4) continue;
      vec2 f = y.xz - c - 0.5;
      vec3 b = vec3(abs(f.x) - (0.5 - g), abs(y.y - 0.5 * h) - 0.5 * h, abs(f.y) - (0.5 - g));
      float d = length(max(b, 0.0)) + min(max(b.x, max(b.y, b.z)), 0.0);
      if (d < bestBox) { bestBox = d; H.nearH = h; }
      if (d < best) {
        best = d;
        H.cell = c;
        if (b.y >= max(b.x, b.z) && y.y > 0.5 * h) { H.kind = 1.0; H.nW = vec3(0.0, 1.0, 0.0); }
        else if (b.x >= b.z) { H.kind = 2.0; H.nW = vec3(sign(f.x), 0.0, 0.0); }
        else { H.kind = 2.0; H.nW = vec3(0.0, 0.0, sign(f.y)); }
      }
    }
  return H;
}

// a world normal in the rendered space: the inversion's Jacobian is (I − 2ŵŵᵀ)·diag(1, −1, 1) / D with
// w = κx − (0, 1, 0) — conformal, so normals map by the same reflection
vec3 renderedN(vec3 nW, vec3 x) {
  vec3 w = normalize(kappa * x - vec3(0.0, 1.0, 0.0));
  vec3 rn = vec3(nW.x, -nW.y, nW.z);
  return normalize(rn - 2.0 * w * dot(w, rn));
}

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  vec3 rd = normalize(cam * vec3(q, focal));
  float tmax = kappa > 0.0 ? 1.2 / kappa : 160.0;
  float tt = 0.02;
  bool hit = false;
  for (int i = 0; i < 160; i++) {
    vec2 d = sdRendered(ro + rd * tt);
    float eps = 0.0005 * tt + 0.0003;   // ≈ ⅓ pixel
    if (d.y < eps) { hit = true; break; }
    // never crawl: a step of ½ε can at worst enter a neighbour's block by less than that
    tt += max(d.x * 0.95, 0.5 * eps);
    if (tt > tmax) break;
  }
  hit = hit || tt < tmax;   // out of steps: shade the nearest surface rather than a hole of fog
  vec3 col = fogC;
  if (hit) {
    vec3 x = ro + rd * tt;
    float D;
    vec3 y = toWorld(x, D);
    vec3 v = -rd;
    float px0 = pxWorld(x, D);
    float lod = lodOf(px0);
    Hit H = classify(y, lod);
    vec3 n = renderedN(H.nW, x);
    // the curled ground's own normal (the image of y = 0 is the ball |x − (0, L/2, 0)| = L/2)
    vec3 nm = renderedN(vec3(0.0, 1.0, 0.0), x);
    // world units per pixel on the surface (grazing views stretch the footprint)
    float pxw = px0 / max(abs(dot(n, v)), 0.2);
    vec2 cell = H.cell;
    float g = 0.045 * gK;
    float mk = smoothstep(0.0, 1.0, morph * 1.8 - 0.8 * hash2(cell + vec2(9.0, 4.0)));   // blocks flip one by one
    float vig = mix(1.0, s10vignette(gl_FragCoord.xy / res, res.x / res.y), vigK);
    vec3 base = vec3(0.0);
    if (exactK < 1.0) {
      base = dcColour(cell, y.xz, vig, pxw);
      if (mk > 0.0) base = mix(base, tileColour(cell + 0.5, pxw), mk);
    }
    if (exactK > 0.0) base = mix(base, tileColour(y.xz, pxw), exactK);
    // museum light: a soft key, a fill from the eye, contact shadow at the foot of every block — the
    // grout and the shadows fade where they would be thinner than a pixel; far away the block normals
    // give way to the curled ground's own
    float detail = 1.0 - smoothstep(0.03, 0.12, pxw);
    float ao = 1.0;
    if (H.kind > 1.5) ao = mix(0.42, 1.0, smoothstep(0.0, 0.8, y.y));
    else if (H.kind < 0.5) ao = mix(1.0, 0.34, smoothstep(0.0, 0.1, H.nearH) * min(1.0, 2.0 * g / max(pxw, 1e-5)));
    ao = mix(1.0, ao, detail);
    vec3 nn = normalize(mix(nm, n, 1.0 - smoothstep(0.15, 0.6, pxw)));
    vec3 L = normalize(vec3(0.35, 0.85, 0.4));
    float dif = max(dot(nn, L), 0.0);
    float fill = 0.5 + 0.5 * dot(nn, v);
    vec3 lit = base * ao * (0.75 * dif + 0.4 * fill + 0.06);
    col = mix(lit, base, max(exactK, flatK));         // flat at both ends: S10's picture, then the plane's
    // the world fades into its own infinity (which the inversion brings to a point)
    float r = length(y.xz);
    col = mix(col, fogC, (1.0 - exp(-r * r / 2400.0)) * (1.0 - exactK) * fogK);
  }
  o = vec4(col, 1.0);
}
