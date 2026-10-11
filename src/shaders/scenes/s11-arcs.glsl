// S11 · the compass (see s11-arcs.vert): Byrne-coloured arcs and ink dots, premultiplied over the plane
#include "lib/color"
in vec2 vP;
in vec4 vCirc;
flat in vec2 vInfo;
out vec4 o;
uniform float hw;

void main() {
  float isDot = vInfo.y;
  float d = abs(length(vP - vCirc.xy) - vCirc.z);
  float a = clamp((isDot > 0.5 ? 2.6 : 1.0) * hw + 0.5 - d, 0.0, 1.0) * vCirc.w;
  float i = vInfo.x;
  vec3 c = isDot > 0.5 ? vec3(0.010, 0.010, 0.012)
         : i < 0.5 ? hex2p3(C_BYRNE_R) : i < 1.5 ? hex2p3(C_BYRNE_Y) : hex2p3(C_BYRNE_B);
  o = vec4(c * a, a);
}
