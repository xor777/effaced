// S10's last frame, as S11 continues it: the DC mosaic of S10's codec (s10-dct.glsl). The block mean
// is decode(DC / 8), tinted #DECADE (S10's final look), then S10's post (vignette before AgX with the
// look 1.2 / 1.3) — returned display-referred and linearised, for a scene that posts with 'clip'.

// S10's codec domain → linear HDR (a copy of s10-dct.glsl decode())
vec3 s10decode(vec3 y) {
  y.x += 128.0;
  vec3 e = vec3(y.x + 1.402 * y.z, y.x - 0.344136 * y.y - 0.714136 * y.z, y.x + 1.772 * y.y) / 255.0;
  e = clamp(e, 0.0, 0.985);
  vec3 g = pow(e, vec3(2.2));
  return g / (1.0 - g);
}
// block b of the 40×25 grid (y up) as S10 shows it, linear HDR
vec3 s10block(sampler2D coef, ivec2 b) {
  vec3 m = s10decode(texelFetch(coef, b * 8, 0).rgb / 8.0);
  return hex2p3(C_DECADE) * dot(m, vec3(0.2627, 0.678, 0.0593)) * 1.35;
}
// S10's vignette factor (post/composite.glsl, vignette 0.34) at screen uv
float s10vignette(vec2 uv01, float aspect) {
  vec2 p = uv01 - 0.5;
  return mix(1.0, 1.0 - smoothstep(0.2, 1.2, length(p * vec2(aspect, 1.0))), 0.34);
}
// S10's tonemap (AgX, look 1.2 / 1.3) → linear display values
vec3 s10display(vec3 hdr) { return srgb2lin(clamp(agxEotf(agxLook(agx(max(hdr, 0.0)), 1.2, 1.3)), 0.0, 1.0)); }
