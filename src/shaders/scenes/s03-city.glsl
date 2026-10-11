// S03 · City of Facades (PLAN §4): a flight down an avenue of carved flats under a #FACADE sky,
// through a gate whose neon title lights up letter by letter with the lead. Penrose floor, light
// shafts in the haze. Rendered at half resolution into the TAA (lib/taa).
#include "lib/city"
#include "lib/taa"
layout(location = 0) out vec4 o;
layout(location = 1) out float oDepth;
uniform vec4 uGates;   // z rows of up to 4 gates on the avenue (−999 = none)
uniform float uAvenue; // x cell of the avenue
uniform float uFrame;
uniform float uGlass;  // 05:00: the last of the CRT's aperture grille as we come through the glass

void cityOverride(vec2 cell, inout Fac F) {
  bool gateRow = any(equal(vec4(cell.y), uGates));
  if (cell.x == uAvenue) {
    F.on = 0.0;
    if (gateRow) {
      F.on = 1.0;
      F.gate = 1.0;
      F.hw = 0.49 * CPX;
      F.cx = (cell.x + 0.5) * CPX;
      F.cz = (cell.y + 0.5) * CPZ;
      F.n = 8.0;
      F.sh = 1.04;
      F.roof = 1.0;
      F.win = 1.0;
      F.pil = 1.0;
      F.hollow = 0.0;
      F.nb = 5.0;
      F.bay = 2.0 * F.hw / F.nb;
    }
  } else if (gateRow && abs(cell.x - uAvenue) < 1.5) {
    // the flanking flats close the gate's row like a city wall
    F.on = 1.0;
    F.hw = 0.49 * CPX;
    F.cx = (cell.x + 0.5) * CPX;
    F.cz = (cell.y + 0.5) * CPZ;
    F.n = max(F.n, 6.0);
    F.nb = 5.0;
    F.bay = 2.0 * F.hw / F.nb;
  } else if (abs(cell.x - uAvenue) < 1.5) {
    // the avenue's wings, like the flats of a stage: always there, inner edge on the avenue's line
    F.on = 1.0;
    float inner = cell.x < uAvenue ? (cell.x + 1.0) * CPX - 0.35 : cell.x * CPX + 0.35;
    F.cx = cell.x < uAvenue ? inner - F.hw : inner + F.hw;
  }
}

void main() {
  vec3 ro = camPos;
  vec3 rd = camRay(gl_FragCoord.xy);
  float pixA = 2.0 * camTan.y / taaRes.y;
  CityHit H = traceCity(ro, rd, 420.0, pixA);
  vec3 col;
  float t = H.t;
  if (H.kind > 1.5) col = cityShadeFloor(ro + rd * t, rd, t, pixA);
  else if (H.kind > 0.5) col = cityShadeFacade(H, ro, rd, pixA);
  else {
    col = citySky(rd);
    t = 420.0;
  }
  float T;
  float jit = fract(ign(gl_FragCoord.xy) + uFrame * 0.618034);
  vec3 ins = cityHaze(ro, rd, t, jit, 10, T);
  col = col * T + ins;
  if (uGlass > 0.0) {
    vec2 sp = gl_FragCoord.xy / taaRes;
    float px = sp.x * 210.0 * 3.0;
    vec3 grille = 0.55 + 0.45 * cos(6.2832 * (px - vec3(0.0, 1.0, 2.0)) / 3.0);
    float scan = 0.8 + 0.2 * cos(6.2832 * sp.y * 131.0);
    col *= mix(vec3(1.0), grille * scan * 1.5, uGlass);
  }
  o = vec4(col, 1.0);
  oDepth = H.kind > 0.5 ? H.t : 1e5;
}
