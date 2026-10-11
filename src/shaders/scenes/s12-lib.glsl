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

// Lorenz (σ 10, ρ 28, β 8/3): the butterfly — the canvas's own figure, the one that bursts out
vec3 lorenzF(vec3 p) {
  return vec3(10.0 * (p.y - p.x), p.x * (28.0 - p.z) - p.y, p.x * p.y - 2.6666667 * p.z);
}
// Lorenz → the canvas's frame: centred on the camera's target, z up, about 3.3 units tall (the wings are
// face-on seen along (1, 1, 0): inner-camera yaw −π/4)
vec3 baseFrame(vec3 q) { return vec3(q.x, q.y, q.z - 24.5) * 0.072 + vec3(0.0, 0.0, 0.35); }
// Halvorsen (a = 1.89): three-fold cyclic — the triangle the butterfly turns into on the G/F bars
vec3 halvorsenF(vec3 p) {
  const float a = 1.89;
  return vec3(-a * p.x - 4.0 * p.y - 4.0 * p.z - p.y * p.y,
              -a * p.y - 4.0 * p.z - 4.0 * p.x - p.z * p.z,
              -a * p.z - 4.0 * p.x - 4.0 * p.y - p.x * p.x);
}
// Halvorsen → the canvas's frame: its symmetry axis (1,1,1) on z, centred, about the butterfly's size
vec3 halvorsenFrame(vec3 q) {
  const vec3 U = vec3(0.70710678, -0.70710678, 0.0), V = vec3(0.40824829, 0.40824829, -0.81649658), W = vec3(0.57735027);
  return vec3(dot(q, U), dot(q, V), dot(q, W) + 4.57) * 0.125 + vec3(0.0, 0.0, 0.62);
}

vec3 PAL5(vec3 a, vec3 b, vec3 c, float x) {
  return x < 0.5 ? mix(a, b, x * 2.0) : mix(b, c, x * 2.0 - 1.0);
}
