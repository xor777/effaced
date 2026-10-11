// quaternions as vec4 (xyz = vector part, w = scalar) — also used as points of R⁴ / S³
vec4 qmul(vec4 a, vec4 b) {
  return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}
vec4 qconj(vec4 q) { return vec4(-q.xyz, q.w); }
// unit quaternion exp(angle/2 · axis) style: rotation by `a` around unit `axis`
vec4 qaxis(vec3 axis, float a) { return vec4(normalize(axis) * sin(a * 0.5), cos(a * 0.5)); }
// rotate a 3D vector
vec3 qrot(vec4 q, vec3 v) { return qmul(qmul(q, vec4(v, 0.0)), qconj(q)).xyz; }
// stereographic projection S³ → R³ from the pole w = 1
vec3 stereo(vec4 p) { return p.xyz / max(1.0 - p.w, 1e-4); }
// great-circle interpolation on S³
vec4 slerp4(vec4 a, vec4 b, float t) {
  float c = clamp(dot(a, b), -1.0, 1.0);
  float th = acos(c);
  if (th < 1e-4) return normalize(mix(a, b, t));
  return (sin((1.0 - t) * th) * a + sin(t * th) * b) / sin(th);
}
