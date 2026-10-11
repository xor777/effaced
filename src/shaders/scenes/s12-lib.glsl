// S12 · shared by the canvas (main context) and the outside (second context)
uniform mat3 iRot;    // inner camera: rotation
uniform vec4 iView;   // inner camera: scale (canvas units per Lorenz unit: magnification · breath), focal, distance, unused
uniform vec3 iRef;    // the reference trajectory relative to the camera's centre (Lorenz units, from the CPU in double)
uniform vec3 iPlus;   // the "+1" relative to the camera's centre
uniform float burst;  // spread of the launch times (s)

// a point relative to the camera's centre (Lorenz units) as the canvas shows it: window-plane coordinates
// (H units, y up, centre 0) + depth
vec3 innerView(vec3 rel) {
  vec3 q = iRot * (rel * iView.x);
  return vec3(q.xy * (iView.y / (iView.z - q.z)), q.z);
}
// when (s after the hit) the thread's particle i leaves the canvas: most at once, a tail trickles out
float launchW(int i) { return hash1(uint(i) * 2654435761u + 17u); }
float launchAt(float w) { return burst * w * w * w; }

// Lorenz (σ 10, ρ 28, β 8/3) …
vec3 lorenzF(vec3 p) {
  return vec3(10.0 * (p.y - p.x), p.x * (28.0 - p.z) - p.y, p.x * p.y - 2.6666667 * p.z);
}
// … and the same flow for an offset d from the reference point r: F(r + d) − F(r), exact (the field is
// quadratic), so an offset of 1/65536 of the attractor keeps all its digits in float32
vec3 lorenzD(vec3 r, vec3 d) {
  return vec3(10.0 * (d.y - d.x),
              d.x * (28.0 - r.z) - r.x * d.z - d.x * d.z - d.y,
              r.x * d.y + r.y * d.x + d.x * d.y - 2.6666667 * d.z);
}
