// Camera + jitter uniforms for scenes resolved by src/gfx/taa.ts (set with taa.uniforms(prog)).
// The scene writes colour to location 0 and the ray distance (unit ray, world units) to location 1.
uniform vec3 camPos, camRight, camUp, camFwd;
uniform vec2 camTan;     // tan of the half field of view, x and y
uniform vec2 taaJitter;  // sub-pixel jitter of this frame, internal px in [-0.5, 0.5]
uniform vec2 taaRes;     // internal target size, px

// jittered primary ray through fragment `fc` (gl_FragCoord.xy)
vec3 camRay(vec2 fc) {
  vec2 ndc = (fc + taaJitter) / taaRes * 2.0 - 1.0;
  return normalize(camFwd + ndc.x * camTan.x * camRight + ndc.y * camTan.y * camUp);
}
// unjittered ray (for screen-space effects that must not shimmer)
vec3 camRay0(vec2 fc) {
  vec2 ndc = fc / taaRes * 2.0 - 1.0;
  return normalize(camFwd + ndc.x * camTan.x * camRight + ndc.y * camTan.y * camUp);
}
// project a world point to internal pixel coords (z = view depth; z <= 0 is behind the camera)
vec3 camProject(vec3 X) {
  vec3 v = X - camPos;
  float z = dot(v, camFwd);
  vec2 ndc = vec2(dot(v, camRight) / (z * camTan.x), dot(v, camUp) / (z * camTan.y));
  return vec3((ndc * 0.5 + 0.5) * taaRes, z);
}
