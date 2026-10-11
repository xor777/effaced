// S08 · Flow — a lattice of pearls in log-polar space (rings ρ = ln r, N pearls per ring, alternate rings
// half a pearl apart) translated at constant velocity: the pearls stream into the vanishing point and
// turn, at one speed. Scale-invariant: every ring passes in the same time and every pearl has the same
// angular size relative to its distance from the centre, so the flow looks alike at every eccentricity —
// the adapting stimulus for the motion aftereffect on S09's still. The phrases change what the pearls
// are made of (gloss, nacre, beads on strings, glass hoops) and how they are lit — never where they are.
// Exact colours.
#include "lib/common"
#include "lib/color"
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform vec3 bg, dark, light; // linear: the grey field, the deep rim, the highlight
uniform vec3 tint;   // linear body colour (#BEADED … #DECADE)
uniform vec4 lat;    // R0 (the chaser's ring radius, H), Δρ, pearls per ring, shear (ring offset in pearls)
uniform vec2 off;    // flow: screen (ρ, φ) = pattern (ρ, φ) + off
uniform vec4 look;   // pearl radius / r, blur sigma / r, shading 0…1, centre fade radius (H)
uniform vec3 reveal; // pearls of ring 0 lit (0…N, one per row), spokes of the other rings lit, —
uniform vec4 fx;     // glint spoke (fractional index), glint amount, sheen (bell), breathe
uniform vec4 mat;    // nacre, hoop (pearl → ring), glass, strings
uniform vec3 sweep;  // a light sweeping round: screen angle, amount, angular width
uniform vec3 Ldir;   // key light
uniform vec3 sheenC; // linear colour of the bell's sheen
uniform vec2 crossSz;
uniform vec3 crossCol;

float erfA(float x) { // Abramowitz–Stegun 7.1.26
  float s = sign(x);
  x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  return s * (1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x));
}

void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * res) / res.y;
  float px = 1.0 / res.y;
  float r = max(length(q), 1e-5), phi = atan(q.y, q.x);
  float R0 = lat.x, dr = lat.y, N = lat.z, sh = lat.w, st = TAU / N;
  float kf = (log(r / R0) - off.x) / dr;
  float kc = floor(kf + 0.5);
  vec3 L = normalize(Ldir), Hh = normalize(L + vec3(0.0, 0.0, 1.0));
  float sa = abs(mod(phi - sweep.x + PI, TAU) - PI);
  float swp = 1.0 + sweep.y * exp(-sa * sa / (sweep.z * sweep.z));
  vec3 col = bg;

  // beads on strings: every ring of pearls threaded on its circle (under the pearls)
  if (mat.w > 0.0) {
    float rr = R0 * exp(kc * dr + off.x);
    float e = abs(kf - kc) * dr * r - 0.011 * rr; // distance to the thread (radial, H) minus its half-width
    float fade = smoothstep(0.5 * look.w, look.w, rr) * clamp(reveal.y / N, 0.0, 1.0);
    col = mix(col, mix(dark, tint, 0.45) * swp, mat.w * fade * clamp(0.5 - e / px, 0.0, 1.0));
  }

  for (int dk = -1; dk <= 1; dk++) {
    float k = kc + float(dk);
    float rc = R0 * exp(k * dr + off.x);
    float Rp = look.x * rc;
    if (Rp < 0.75 * px) continue;
    float sig = max(look.y * rc, 0.55 * px);
    float a = (0.5 * PI - phi + off.y) / st - k * sh; // pearl index along the ring (j = 0 at the top)
    float jc = floor(a + 0.5);
    for (int dj = -1; dj <= 1; dj++) {
      float j = jc + float(dj);
      float ph = 0.5 * PI - (j + k * sh) * st + off.y;
      vec2 dv = q - rc * vec2(cos(ph), sin(ph));
      float d = length(dv);
      if (d > Rp + 4.0 * sig) continue;
      float jm = mod(j, N);
      // lit: ring 0 one pearl per row (the chaser's order), the other rings spoke by spoke
      float vis = k == 0.0 ? clamp(reveal.x - jm, 0.0, 1.0) : clamp(reveal.y - jm, 0.0, 1.0);
      vis *= smoothstep(0.5 * look.w, look.w, rc) * smoothstep(0.75 * px, 2.5 * px, Rp);
      if (vis <= 0.0) continue;
      // the shape: a sphere, or (hoop) a torus whose tube is a quarter of the pearl — S09's fibres to come
      float hr = 0.7 * Rp, hw = 0.24 * Rp;
      float dd = mix(d - Rp, abs(d - hr) - hw, mat.y);
      float cov = 0.5 - 0.5 * erfA(dd / (1.41421356 * sig));
      vec2 n2 = mix(dv / Rp, (dv / max(d, 1e-6)) * clamp((d - hr) / hw, -1.0, 1.0), mat.y);
      float l2 = min(dot(n2, n2), 1.0), edge = sqrt(l2);
      vec3 n3 = vec3(n2, sqrt(1.0 - l2));
      float g = max(0.0, 1.0 - abs(mod(jm - fx.x + 0.5 * N, N) - 0.5 * N)); // this pearl's share of the glint
      float dif = max(dot(n3, L), 0.0);
      float spec = pow(max(dot(n3, Hh), 0.0), 40.0);
      // nacre: thin-film colours that turn with the surface
      vec3 body = tint;
      if (mat.x > 0.0) {
        vec3 iri = 0.6 + 0.4 * cos(TAU * (1.7 * (1.0 - n3.z) + 0.15 * jm / N + vec3(0.0, 0.33, 0.67)));
        body = mix(tint, tint * iri * 1.3, mat.x);
      }
      vec3 gloss = body * (0.42 + 0.72 * dif) * (1.0 + fx.w);
      gloss = mix(gloss, dark, 0.9 * smoothstep(0.45, 1.0, edge));
      // glass: a clear body and a bright fresnel rim
      float fres = 0.0;
      vec3 pearl = gloss;
      if (mat.z > 0.0) {
        fres = pow(edge, 2.5);
        vec3 glass = mix(tint, light, 0.25 + 0.6 * fres);
        glass = mix(glass, dark, 0.75 * smoothstep(0.82, 1.0, edge)); // a fine dark edge keeps the hoops crisp
        pearl = mix(gloss, glass, mat.z);
      }
      pearl += sheenC * fx.z * smoothstep(0.3, 0.95, edge);
      pearl += light * spec * (0.85 + 1.6 * fx.y * g);
      pearl = mix(tint, pearl, look.z) * swp;
      float alpha = cov * vis * mix(1.0, 0.35 + 0.65 * fres, mat.z * look.z);
      col = mix(col, pearl, alpha);
    }
  }
  // S08's fixation cross, exactly
  vec2 aq = abs(q);
  vec2 d1 = aq - vec2(crossSz.x, 0.5 * crossSz.y), d2 = aq - vec2(0.5 * crossSz.y, crossSz.x);
  float dc = min(length(max(d1, 0.0)) + min(max(d1.x, d1.y), 0.0), length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0));
  col = mix(col, crossCol, clamp(0.5 - dc / px, 0.0, 1.0));
  vec3 e = lin2srgb(clamp(col, 0.0, 1.0));
  float n = hash1(uint(gl_FragCoord.x) + uint(gl_FragCoord.y) * 4099u) + hash1(uint(gl_FragCoord.y) * 7919u + uint(gl_FragCoord.x) * 31u) - 1.0;
  o = vec4(e + n * clamp(min(e, 1.0 - e) * 255.0, 0.0, 1.0) / 255.0, 1.0);
}
