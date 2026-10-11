// S04 / S06 shared: VGA palettes, the classic tunnel texture (also the T level of the S06 Droste),
// rectangle area lights. Include after lib/common.

// 18-bit VGA DAC: 6 bits per channel
vec3 vga(vec3 c) { return floor(clamp(c, 0.0, 1.0) * 63.0 + 0.5) / 63.0; }

// the 256-entry palettes of the memories (cosine palettes, read through the DAC)
vec3 palPlasma(float x) { return vga(pal(x, vec3(0.5), vec3(0.5), vec3(1.0, 1.0, 1.0), vec3(0.0, 0.33, 0.67))); }
vec3 palCopper(float x) { return vga(pal(x, vec3(0.5, 0.35, 0.45), vec3(0.5, 0.35, 0.4), vec3(1.0), vec3(0.0, 0.1, 0.2))); }
vec3 palFire(float v) {
  // black → red → orange → yellow → white, in 64-step DAC ramps
  vec3 c = vec3(sat(v * 3.0), sat(v * 3.0 - 1.0), sat(v * 3.0 - 2.0));
  return vga(c * c * (3.0 - 2.0 * c));
}

// The tunnel of the memories: log-polar, so flying = scrolling in log r — the same map as the
// Droste (S06), which is why the tunnel can turn into Escher's spiral without a seam.
// q: position relative to the tunnel centre (any unit), t: time. Returns VGA-ish colour.
// the 64×64 XOR texture every 90s effect borrowed
float xorTex(vec2 uv) {
  ivec2 i = ivec2(floor(uv)) & 63;
  return float(i.x ^ i.y) / 63.0;
}
// u: around the tunnel (period 1), v: depth (period 1 = one texture height)
vec3 tunnelTex(float u, float v) {
  float x = xorTex(vec2(u * 64.0, v * 64.0));
  vec3 c = mix(vec3(0.07, 0.02, 0.22), vec3(0.93, 0.62, 0.93), x);
  return mix(c, vec3(0.55, 0.95, 1.0), smoothstep(0.8, 1.0, x));
}
// the memory's tunnel at a position q relative to its centre (q in tunnel units, r = 1 ≈ the
// screen half-height), flying at `depth` (texture heights)
vec3 tunnelAt(vec2 q, float depth) {
  float r = length(q);
  float u = atan(q.y, q.x) / TAU;
  float v = -log(max(r, 1e-6)) * 0.45 + depth;
  return tunnelTex(u, v) * smoothstep(0.02, 0.6, r);
}

// Form factor of a Lambertian rectangle seen from point p with normal n (corners in order): the
// vector form factor of a polygon, sum of edge integrals (Arvo; LTC's IntegrateEdge). A diffuse
// surface of albedo A lit by an emitter of radiance L returns A·L·FF.
vec3 edgeVec(vec3 v1, vec3 v2) {
  float x = dot(v1, v2);
  float y = abs(x);
  float a = 0.8543985 + (0.4965155 + 0.0145206 * y) * y;
  float b = 3.4175940 + (4.1616724 + y) * y;
  float v = a / b;
  float th = (x > 0.0) ? v : 0.5 * inversesqrt(max(1.0 - x * x, 1e-7)) - v;
  return cross(v1, v2) * th;
}
float rectIrr(vec3 p, vec3 n, vec3 a, vec3 b, vec3 c, vec3 d) {
  vec3 v0 = normalize(a - p), v1 = normalize(b - p), v2 = normalize(c - p), v3 = normalize(d - p);
  vec3 f = edgeVec(v0, v1) + edgeVec(v1, v2) + edgeVec(v2, v3) + edgeVec(v3, v0);
  return abs(dot(f, n)) * (0.5 / PI);
}
