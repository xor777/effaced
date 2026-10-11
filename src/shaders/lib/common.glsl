// common constants, hashing, small math helpers
#define PI 3.14159265359
#define TAU 6.28318530718
#define PHI 1.61803398875
#define sat(x) clamp(x, 0.0, 1.0)

// integer hash (PCG-ish), no textures; seeded world-wide with 0xEFFACED
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
uint hashu(uvec2 v) { return pcg(v.x ^ pcg(v.y ^ 0xEFFACEDu)); }
uint hashu(uvec3 v) { return pcg(v.x ^ pcg(v.y ^ pcg(v.z ^ 0xEFFACEDu))); }
float hash1(uint v) { return float(pcg(v ^ 0xEFFACEDu)) * (1.0 / 4294967296.0); }
float hash2(vec2 p) { return float(hashu(uvec2(ivec2(floor(p))))) * (1.0 / 4294967296.0); }
float hash3(vec3 p) { return float(hashu(uvec3(ivec3(floor(p))))) * (1.0 / 4294967296.0); }

// interleaved gradient noise (Jimenez) for dithering
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// value noise
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
}
