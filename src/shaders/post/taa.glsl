// TAA resolve + upscale (src/gfx/taa.ts): jittered internal-res samples → output-res history.
// Reconstruction: Gaussian over the 3×3 nearest jittered samples (the closer a sample lands to this
// output pixel, the more it counts) · reprojection by the camera with the closest depth of the 3×3 ·
// variance clip in YCoCg · 5-tap Catmull-Rom history · luminance-weighted blend (Karis).
#include "lib/common"
in vec2 uv;
layout(location = 0) out vec4 oHist;
layout(location = 1) out vec4 oOut;
uniform sampler2D cur;       // internal colour (NEAREST)
uniform sampler2D curDepth;  // internal ray distance (NEAREST)
uniform sampler2D hist;      // previous output (LINEAR)
uniform vec2 inRes;
uniform vec2 outRes;
uniform vec2 jitter;         // internal px
uniform vec3 cPos, cRight, cUp, cFwd;
uniform vec2 cTan;
uniform vec3 pPos, pRight, pUp, pFwd;
uniform vec2 pTan;
uniform float alpha;
uniform float gamma;
uniform float reset;
uniform vec3 rigDelta;       // motion since the last frame of geometry carried with the camera rig
                             // (pixels whose depth is written negative), see TAA.rigDelta

vec3 toYCoCg(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
float maxc(vec3 c) { return max(c.r, max(c.g, c.b)); }
// reversible "tonemap" so fireflies don't dominate the blend
vec3 tm(vec3 c) { return c / (1.0 + maxc(c)); }
vec3 itm(vec3 c) { return c / max(1.0 - maxc(c), 1e-3); }

// 5-tap bicubic Catmull-Rom (Jimenez), relies on bilinear filtering of `tex`
vec3 catmullRom(sampler2D tex, vec2 p, vec2 res) {
  vec2 pos = p - 0.5;
  vec2 tp = floor(pos) + 0.5;
  vec2 f = pos + 0.5 - tp;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 t0 = (tp - 1.0) / res, t3 = (tp + 2.0) / res, t12 = (tp + o12) / res;
  vec3 r = texture(tex, vec2(t12.x, t0.y)).rgb * w12.x * w0.y
         + texture(tex, vec2(t0.x, t12.y)).rgb * w0.x * w12.y
         + texture(tex, vec2(t12.x, t12.y)).rgb * w12.x * w12.y
         + texture(tex, vec2(t3.x, t12.y)).rgb * w3.x * w12.y
         + texture(tex, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / wsum, 0.0);
}

vec3 clipAABB(vec3 q, vec3 mn, vec3 mx) {
  vec3 c = 0.5 * (mx + mn), e = 0.5 * (mx - mn) + 1e-5;
  vec3 v = q - c;
  vec3 a = abs(v / e);
  float m = max(a.x, max(a.y, a.z));
  return m > 1.0 ? c + v / m : q;
}

void main() {
  vec2 op = gl_FragCoord.xy;
  vec2 scale2 = outRes / inRes;                // output px per input px
  float scale = scale2.y;
  vec2 ip = op / scale2;                        // continuous input-pixel coords
  ivec2 base = ivec2(floor(ip - jitter));       // texel whose jittered sample is nearest
  ivec2 hi = ivec2(inRes) - 1;
  float sig = 0.62;                             // reconstruction sigma, output px
  vec3 sum = vec3(0.0), wide = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0);
  float wsum = 0.0, wwide = 0.0, dmin = 1e30, rig = 0.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      ivec2 q = clamp(base + ivec2(i, j), ivec2(0), hi);
      vec3 c = tm(max(texelFetch(cur, q, 0).rgb, 0.0));
      vec2 d = (vec2(q) + 0.5 + jitter - ip) * scale2;
      float dd = dot(d, d);
      float w = exp(-0.5 * dd / (sig * sig));
      float ww = exp(-0.5 * dd / (scale * scale * 0.36));
      sum += c * w;
      wsum += w;
      wide += c * ww;
      wwide += ww;
      vec3 y = toYCoCg(c);
      m1 += y;
      m2 += y * y;
      float z = texelFetch(curDepth, q, 0).r;
      if (abs(z) < dmin) { dmin = abs(z); rig = step(z, 0.0); }
    }
  vec3 cWide = wide / max(wwide, 1e-6);
  vec3 cNear = wsum > 1e-4 ? sum / wsum : cWide;
  vec3 mu = m1 / 9.0;
  vec3 sd = sqrt(max(m2 / 9.0 - mu * mu, 0.0));

  // reproject this output pixel's surface into the previous frame
  vec2 ndc = op / outRes * 2.0 - 1.0;
  vec3 dir = normalize(cFwd + ndc.x * cTan.x * cRight + ndc.y * cTan.y * cUp);
  vec3 X = cPos + dir * min(dmin, 1e5) - rig * rigDelta;
  vec3 v = X - pPos;
  float z = dot(v, pFwd);
  vec2 puv = vec2(dot(v, pRight) / (z * pTan.x), dot(v, pUp) / (z * pTan.y)) * 0.5 + 0.5;
  bool valid = reset < 0.5 && z > 1e-4 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)));

  vec3 res;
  if (!valid) {
    res = cWide;
  } else {
    vec3 h = tm(catmullRom(hist, puv * outRes, outRes));
    vec3 hy = clipAABB(toYCoCg(h), mu - gamma * sd, mu + gamma * sd);
    h = fromYCoCg(hy);
    // a sample right on this pixel replaces `alpha` of the history; far samples barely count
    float a = clamp(alpha * wsum, 0.02, 0.6);
    res = mix(h, cNear, a);
  }
  res = itm(max(res, 0.0));
  if (any(isnan(res))) res = vec3(0.0);
  oHist = vec4(res, 1.0);
  oOut = vec4(res, 1.0);
}
