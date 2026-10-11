// S12 · shared by the canvas (main context) and the outside (second context)
uniform mat3 iRot;    // inner camera: rotation
uniform vec4 iCam;    // inner camera: attractor centre xyz, focal length (H units)
uniform float iDist;  // inner camera: distance
uniform float iBreath;// the cloud breathes with the kick (scale about the centre)
uniform float burst;  // spread of the launch times (s)

// the attractor as the canvas shows it: window-plane coordinates (H units, y up, centre 0) + depth
vec3 innerView(vec3 p) {
  vec3 q = iRot * ((p - iCam.xyz) * iBreath);
  return vec3(q.xy * (iCam.w / (iDist - q.z)), q.z);
}
// when (s after the hit) particle `w` leaves the canvas: most at once, a tail trickles out
float launchAt(float w) { return burst * w * w * w; }

vec3 aizawaF(vec3 p) {
  return vec3((p.z - 0.7) * p.x - 3.5 * p.y, 3.5 * p.x + (p.z - 0.7) * p.y,
              0.6 + 0.95 * p.z - p.z * p.z * p.z / 3.0 - (p.x * p.x + p.y * p.y) * (1.0 + 0.25 * p.z) + 0.1 * p.z * p.x * p.x * p.x);
}
// Halvorsen (a = 1.89): three-fold cyclic — the triangle to the Aizawa's circle
vec3 halvorsenF(vec3 p) {
  const float a = 1.89;
  return vec3(-a * p.x - 4.0 * p.y - 4.0 * p.z - p.y * p.y,
              -a * p.y - 4.0 * p.z - 4.0 * p.x - p.z * p.z,
              -a * p.z - 4.0 * p.x - 4.0 * p.y - p.x * p.x);
}
// Halvorsen → the Aizawa's frame: its symmetry axis (1,1,1) on z, centred, scaled to the same size
vec3 halvorsenFrame(vec3 q) {
  const vec3 U = vec3(0.70710678, -0.70710678, 0.0), V = vec3(0.40824829, 0.40824829, -0.81649658), W = vec3(0.57735027);
  return vec3(dot(q, U), dot(q, V), dot(q, W) + 4.57) * 0.125 + vec3(0.0, 0.0, 0.62);
}

vec3 PAL5(vec3 a, vec3 b, vec3 c, float x) {
  return x < 0.5 ? mix(a, b, x * 2.0) : mix(b, c, x * 2.0 - 1.0);
}
