// S14's embers: 65536 point sprites (the +1 is the light point). Each has a target on EFFACED's strokes
// (src/gfx/glyphs.ts sampleWord, uploaded once as a 256×256 table: x, y, letter, random). Assembly: it
// leaves the point on the last heartbeat that gives it time to fly and lands where its letter develops.
// Erasure: it lifts off as its letter crumbles and streams back into the point.
#include "scenes/s14-common"
uniform sampler2D table;
uniform vec2 res;
uniform float cap;
uniform vec4 kicks;  // heartbeat rows (unused slots far in the future)
uniform vec4 emb;    // x: brightness, y: point size (device px), z: spin (rad), w: shortest flight (rows)
uniform vec3 hotE, coolE, inkE; // display-encoded: hot near the point, cool in flight, the stroke's colour
out vec4 vC;
void main() {
  int i = gl_VertexID;
  vec4 e = texelFetch(table, ivec2(i & 255, i >> 8), 0);
  vec2 T = e.xy;
  int k = int(e.z + 0.5);
  float h1 = e.w, h2 = fract(h1 * 7.31 + 0.13), h3 = fract(h1 * 31.7 + 0.71), h4 = fract(h1 * 113.1 + 0.37);
  float row = S14.x;
  float rT = length(T), aT = atan(T.y, T.x);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 0.0;
  vC = vec4(0.0);
  vec2 p;
  float a, flash, heat;
  if (S14.y > 0.5 && S14.y < 1.5) {
    float L = landRow(T, k) - 0.5 - 1.2 * h2;
    float E = 0.0;
    for (int j = 0; j < 4; j++) if (kicks[j] <= L - emb.w) E = max(E, kicks[j]);
    E += 1.6 * h3 * h3;
    float s = (row - E) / max(L - E, 1.0);
    float after = row - L;
    if (s <= 0.0 || after > 4.0) return;
    s = min(s, 1.0);
    // an unwinding spiral out of the point, decelerating into place
    float u = 1.0 - (1.0 - s) * (1.0 - s);
    float ang = aT - emb.z * (0.5 + h4) * pow(1.0 - s, 1.5);
    p = rT * u * vec2(cos(ang), sin(ang)) + 0.06 * s * (1.0 - s) * vec2(sin(40.0 * h1 + 0.6 * row), cos(37.0 * h2 + 0.5 * row));
    a = smoothstep(0.0, 0.25, s) * (1.0 - smoothstep(0.0, 4.0, after));
    flash = after >= 0.0 ? exp(-after * 0.9) : 0.0;
    heat = 1.0 - s;
  } else if (S14.y > 1.5) {
    float X = eraseRow(T, k) + 0.3 + 1.2 * h2;
    float s = (row - X) / (7.0 + 4.0 * h3);
    if (s <= 0.0 || s >= 1.0) return;
    // streams into the point, winding up, accelerating
    float u = s * s * (3.0 - 2.0 * s);
    float ang = aT + emb.z * (0.5 + h4) * pow(u, 1.5);
    p = rT * (1.0 - u) * vec2(cos(ang), sin(ang)) + 0.05 * s * (1.0 - s) * vec2(sin(40.0 * h1 + 0.6 * row), cos(37.0 * h2 + 0.5 * row));
    a = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.85, 1.0, s));
    flash = exp(-s * 6.0);
    heat = u;
  } else {
    return;
  }
  vec2 q = p * cap;
  gl_Position = vec4(2.0 * q.x * res.y / res.x, 2.0 * q.y, 0.0, 1.0);
  vec3 c = mix(mix(inkE, coolE, smoothstep(0.0, 0.5, heat)), hotE, smoothstep(0.5, 0.95, heat));
  vC = vec4(c * emb.x * a * (0.45 + 0.55 * h2) * (1.0 + 1.2 * flash), 0.0);
  gl_PointSize = emb.y * (0.7 + 0.6 * h3) * (1.0 + 0.5 * flash);
}
