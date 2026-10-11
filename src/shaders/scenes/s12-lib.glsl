// S12 · shared by the canvas (main context) and the outside (second context)
uniform mat3 iRot;    // inner camera: rotation
uniform vec4 iCam;    // inner camera: attractor centre xyz, focal length (H units)
uniform float iDist;  // inner camera: distance
uniform float iBreath;// the cloud breathes: a heartbeat contracts it (scale about the centre)
uniform float iFlap;  // the wings' angle (rad): each wing turns about the body axis
uniform float iHeart; // 0 butterfly … 1 heart: the lower half is drawn in to a point
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
// face-on seen along (1, −1, 0): inner-camera yaw −π/4)
vec3 baseFrame(vec3 q) { return vec3(q.x, q.y, q.z - 24.5) * 0.072 + vec3(0.0, 0.0, 0.35); }

// The wings flap (a display transform — the simulation never sees it): the two lobes lie either side of
// the body axis (x = y = 0, vertical) along the span (1, 1, 0)/√2; each wing turns about the body by
// iFlap, the angle growing from nothing at the body to full at the wing, so the body never tears. The
// Lorenz's wings are each other's half-turn (x, y → −x, −y), not mirror images: turning them the same way
// round keeps them each other's half-turn, so seen face-on both narrow and widen alike.
mat2 flapRot(vec3 q) {
  float a = (q.x + q.y) * 0.70710678;
  float ph = iFlap * smoothstep(0.0, 7.0, abs(a));
  return mat2(cos(ph), sin(ph), -sin(ph), cos(ph));
}
// q (Lorenz coordinates) with its wing turned; v any vector at q turned with it
vec3 flapQ(vec3 q) {
  vec2 ab = vec2(q.x + q.y, q.x - q.y) * 0.70710678; // span, depth
  ab = flapRot(q) * ab;
  // the heart: below the wings' eyes the span narrows towards the bottom, the lobes close into a point
  ab.x *= 1.0 - 0.6 * iHeart * smoothstep(27.0, 4.0, q.z);
  return vec3(vec2(ab.x + ab.y, ab.x - ab.y) * 0.70710678, q.z);
}
vec3 flapV(vec3 q, vec3 v) {
  vec2 ab = vec2(v.x + v.y, v.x - v.y) * 0.70710678;
  ab = flapRot(q) * ab;
  return vec3(vec2(ab.x + ab.y, ab.x - ab.y) * 0.70710678, v.z);
}

vec3 PAL5(vec3 a, vec3 b, vec3 c, float x) {
  return x < 0.5 ? mix(a, b, x * 2.0) : mix(b, c, x * 2.0 - 1.0);
}
