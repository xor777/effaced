// S14's embers: 65536 point sprites (the +1 is the light point). Each has a place on EFFACED's strokes, kept
// as stroke parameters (src/gfx/glyphs.ts sampleWordStrokes: primitive, u, letter, random — a 256×256 table).
//   assembly  it leaves the point on the last heartbeat that gives it time to fly and lands where its letter
//             develops; then it stays: a faint twinkle on the stroke; one in six runs along the pen like a
//             current, a few drift off the stroke and come back; the bell's waves brighten them as they pass
//   erasure   it lifts off as its letter crumbles and arcs back into the point, with a streak behind it
// `lines` = 1 draws every ember as a line pair (head, tail): the streaks of the erasure only.
#include "scenes/s14-common"
uniform sampler2D table;
uniform vec2 res;
uniform vec4 kicks;  // heartbeat rows (unused slots far in the future)
uniform vec4 emb;    // x: brightness, y: point size (device px), z: spin (rad), w: shortest flight (rows)
uniform vec3 hotE, coolE, inkE; // display-encoded: hot near the point, cool in flight, the stroke's colour
uniform float lines;
uniform float settle; // brightness of the embers resting on the strokes
out vec4 vC;

void main() {
  bool asLines = lines > 0.5;
  int id = asLines ? gl_VertexID >> 1 : gl_VertexID;
  bool tail = asLines && (gl_VertexID & 1) == 1;
  vec4 e = texelFetch(table, ivec2(id & 255, id >> 8), 0);
  int pg = int(e.x + 0.5), k = int(e.z + 0.5);
  float h1 = e.w, h2 = fract(h1 * 7.31 + 0.13), h3 = fract(h1 * 31.7 + 0.71), h4 = fract(h1 * 113.1 + 0.37);
  float row = S14.x;
  vec2 place = vec2(GLY_WX[k], -0.5) + woff[k];

  // its place on the stroke, across the pen by a random offset; runners move along the pen
  float u = e.y, runA = 1.0;
  bool runner = h4 < 0.16, drifter = h4 >= 0.16 && h4 < 0.2;
  if (runner) {
    u = fract(u + row * (0.04 + 0.05 * h2) / primLen(pg));
    runA = sin(3.14159 * u);
  }
  vec4 pt = primAt(pg, u);
  vec2 nrm = vec2(-pt.w, pt.z);
  vec2 T = pt.xy + nrm * (h3 * 2.0 - 1.0) * GLY_STROKE * 0.9;
  if (drifter) T += nrm * (h1 > 0.5 ? 1.0 : -1.0) * 0.3 * pow(max(0.0, sin(row * 0.06 + h2 * 40.0)), 3.0);
  vec2 Tw = T + place; // word frame
  vec2 qk = primAt(pg, e.y).xy; // its own place (letter-local), for its land / erase rows

  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 0.0;
  vC = vec4(0.0);
  vec2 p;
  float a, flash, heat;
  float L = landRow(qk, k) - 0.5 - 1.2 * h2;
  float X = eraseRow(qk, k) + 0.3 + 1.2 * h2;
  float ph = S14.y;
  if (ph < -0.5) return; // the warm-up draw: nothing
  bool flying = false;
  if (ph > 0.5 && ph < 1.5 && row < L + 4.0) {
    if (asLines) return;
    float E = 0.0;
    for (int j = 0; j < 4; j++) if (kicks[j] <= L - emb.w) E = max(E, kicks[j]);
    E += 1.6 * h3 * h3;
    float s = (row - E) / max(L - E, 1.0);
    if (s <= 0.0) return;
    s = min(s, 1.0);
    float after = row - L;
    // an unwinding spiral out of the point, decelerating into place
    float rT = length(Tw), aT = atan(Tw.y, Tw.x);
    float uu = 1.0 - (1.0 - s) * (1.0 - s);
    float ang = aT - emb.z * (0.5 + h4) * pow(1.0 - s, 1.5);
    p = rT * uu * vec2(cos(ang), sin(ang)) + 0.06 * s * (1.0 - s) * vec2(sin(40.0 * h1 + 0.6 * row), cos(37.0 * h2 + 0.5 * row));
    flash = after >= 0.0 ? exp(-after * 0.9) : 0.0;
    a = smoothstep(0.0, 0.25, s) * mix(1.0, settle, smoothstep(0.0, 4.0, after));
    heat = 1.0 - s;
    flying = after < 0.0;
  } else if (ph > 1.5 && row > X) {
    // erasure: arcs back into the point, winding up and accelerating; the tail lags behind on the path
    float travel = 7.0 + 4.0 * h3;
    float s = (row - X) / travel - (tail ? 0.05 : 0.0);
    if (s >= 1.0 || (!tail && s <= 0.0) || (tail && s < -0.05)) return;
    s = max(s, 0.0);
    float rT = length(Tw), aT = atan(Tw.y, Tw.x);
    float uu = s * s * (3.0 - 2.0 * s);
    // each letter its own sweep: the arcs bend one way or the other, more or less
    float bend = (fract(float(k) * 0.618 + 0.3) > 0.5 ? 1.0 : -1.0) * (0.35 + 0.5 * fract(float(k) * 0.37 + h1));
    float ang = aT + emb.z * (0.5 + h4) * pow(uu, 1.5) + bend * sin(3.14159 * uu);
    p = rT * (1.0 - uu) * vec2(cos(ang), sin(ang)) * (1.0 + 0.18 * sin(3.14159 * uu));
    a = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.85, 1.0, s)) * (tail ? 0.0 : 1.0);
    flash = exp(-s * 6.0);
    heat = uu;
    flying = true;
  } else {
    // resting on the stroke
    if (asLines) return;
    p = Tw;
    float tw = 0.55 + 0.45 * sin(row * (0.25 + 0.3 * h2) + h1 * 40.0);
    float wave = bellWave(abs(p.x), row);
    a = settle * tw * (1.0 + 2.5 * wave) * (runner ? 4.0 * runA : drifter ? 2.5 : 1.0);
    flash = 0.0;
    heat = 0.0;
  }
  if (asLines && !flying) return;
  vec3 sc = toScreen(p);
  gl_Position = vec4(2.0 * sc.x * res.y / res.x, 2.0 * sc.y, 0.0, 1.0);
  vec3 c = mix(mix(inkE, coolE, smoothstep(0.0, 0.5, heat)), hotE, smoothstep(0.5, 0.95, heat));
  float b = emb.x * a * (0.45 + 0.55 * h2) * (1.0 + 1.2 * flash);
  vC = vec4(c * b * (asLines ? 0.22 : 1.0), 0.0); // a streak fades from its head (b) to its tail (a = 0)
  gl_PointSize = emb.y * sc.z * (0.7 + 0.6 * h3) * (1.0 + 0.5 * flash);
}
