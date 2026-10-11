// colour: hex words, sRGB transfer, cosine palettes, AgX tonemapping, CIE 1931 analytic CMFs

// the creature's hex words (PLAN §1.4), sRGB-encoded
#define C_DECADE vec3(0.870588, 0.792157, 0.870588)
#define C_FACADE vec3(0.980392, 0.792157, 0.870588)
#define C_BEADED vec3(0.745098, 0.678431, 0.929412)
#define C_ACCEDE vec3(0.674510, 0.807843, 0.870588)
#define C_DEFACE vec3(0.870588, 0.980392, 0.807843)
#define C_EFFACE vec3(0.937255, 0.980392, 0.807843)
// Byrne's Euclid primaries
#define C_BYRNE_R vec3(0.827, 0.200, 0.153)
#define C_BYRNE_Y vec3(0.945, 0.737, 0.169)
#define C_BYRNE_B vec3(0.149, 0.329, 0.580)

vec3 srgb2lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 lin2srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

// The working space is LINEAR DISPLAY P3 (PLAN §7.1). Display P3 uses the sRGB transfer curve, so
// lin2srgb() is also the P3 encoder. Hex words are sRGB: convert them with hex2p3() so the canvas shows
// exactly the CSS colour.
const mat3 SRGB_TO_P3 = mat3(0.8224621, 0.0331941, 0.0170827,
                             0.1775380, 0.9668058, 0.0723974,
                             0.0000000, 0.0000000, 0.9105199);
const mat3 P3_TO_SRGB = mat3(1.2249401, -0.0420569, -0.0196376,
                             -0.2249404, 1.0420571, -0.0786361,
                             0.0000000, 0.0000000, 1.0982735);
vec3 hex2p3(vec3 srgbEncoded) { return SRGB_TO_P3 * srgb2lin(srgbEncoded); }

// IQ cosine palette
vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return a + b * cos(6.28318530718 * (c * t + d)); }

// --- AgX (Sobotka; polynomial fit by B. Wrensch) — input linear Rec.709, output display-encoded
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 v) {
  const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const float lo = -12.47393, hi = 4.026069;
  v = m * max(v, vec3(1e-10));
  v = clamp(log2(v), lo, hi);
  return agxContrast((v - lo) / (hi - lo));
}
vec3 agxEotf(vec3 v) {
  const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  return mi * v;
}
// look: slope/power/saturation in AgX log space (punchy = power 1.35, sat 1.4)
vec3 agxLook(vec3 v, float power, float satur) {
  float l = dot(v, vec3(0.2126, 0.7152, 0.0722));
  v = pow(max(v, 0.0), vec3(power));
  return l + satur * (v - l);
}

// --- CIE 1931 2° colour matching functions, multi-lobe gaussian fit (Wyman, Sloan, Shirley 2013)
float g2(float x, float mu, float s1, float s2) { float t = (x - mu) / (x < mu ? s1 : s2); return exp(-0.5 * t * t); }
vec3 cie_cmf(float nm) {
  return vec3(
    1.056 * g2(nm, 599.8, 37.9, 31.0) + 0.362 * g2(nm, 442.0, 16.0, 26.7) - 0.065 * g2(nm, 501.1, 20.4, 26.2),
    0.821 * g2(nm, 568.8, 46.9, 40.5) + 0.286 * g2(nm, 530.9, 16.3, 31.1),
    1.217 * g2(nm, 437.0, 11.8, 36.0) + 0.681 * g2(nm, 459.0, 26.0, 13.8));
}
vec2 xyz2xy(vec3 c) { return c.xy / (c.x + c.y + c.z); }
vec3 xyY2xyz(vec2 xy, float Y) { return vec3(xy.x * Y / xy.y, Y, (1.0 - xy.x - xy.y) * Y / xy.y); }
vec3 xyz2rgb(vec3 c) { // linear sRGB / Rec.709, D65
  return mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570) * c;
}
vec3 xyz2p3(vec3 c) { // linear Display P3, D65
  return mat3(2.4934969, -0.8294890, 0.0358458, -0.9313836, 1.7626641, -0.0761724, -0.4027108, 0.0236247, 0.9568845) * c;
}
