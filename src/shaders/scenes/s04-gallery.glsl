// S04 · Gallery: a dark exhibition hall inside the facade city, traced analytically (it is a box).
// Right wall: six VGA memories as emissive billboards under picture lights. Left wall: the tracker
// wall (its picture is real DOM laid over this exact rectangle via CSS matrix3d; GL draws the same
// panel underneath so it can bloom, light the room and reflect in the floor). Light: the screens,
// the tracker, the skylight panes and the doorways to the #FACADE city are rectangle area lights
// (vector form factors; a convex room needs no shadows), plus six warm picture spots whose cones
// show in the lilac air. The floor is polished stone with roughness-blurred analytic reflections.
// Geometry constants come from s04-gallery.ts as #defines.
#include "lib/common"
#include "lib/color"
#include "scenes/s04-common"
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform vec3 eye;
uniform mat3 cam;          // right, up, forward
uniform float tanH;        // tan(vertical fov / 2)
uniform float t;
uniform sampler2D atlas;   // the memories
uniform sampler2D hudTex;  // tracker cells (rgb ≈ cell colour), COLS × LINES
uniform vec3 hudInfo;      // radiance of the tracker's panels (FT2 blue)
uniform vec3 hudPat;       // radiance of its pattern editor
uniform vec4 scope[18];    // the tracker's channel scopes: amplitude, cycles, waveform, ghost glow
uniform float hudGL;       // brightness of the GL copy of the tracker (the DOM covers it)
uniform float screenGain;
uniform float doorGain;
uniform float skyGain;
uniform float spotGain;
uniform float expo;        // linear exposure multiplier
uniform int hole;          // memory index drawn as alpha 0 (the S06 Droste level), -1 none
uniform float kick;          // screen pulse (kick/snare onsets), also lights the room
uniform float memOn[6];      // seconds since each screen was switched on (< 0: still off)
uniform vec4 chase;          // ages (s) of the last four kicks: a light runs down the skylight
uniform float beamGain;      // the picture lights' beams in the air (snare)
uniform sampler2D lmap;     // the room's diffuse light, baked every frame (LIGHTMAP pass)

const vec3 WALL = vec3(0.16, 0.145, 0.14);
const vec3 CEIL = vec3(0.06, 0.057, 0.06);
const vec3 SPOT = vec3(1.0, 0.86, 0.72);   // warm picture lights
// the bench: centre, half size
const vec3 BENCH_C = vec3(0.0, 0.23, -15.6);
const vec3 BENCH_H = vec3(0.26, 0.23, 1.1);

vec3 MEML[6]; // screen radiance (average colour × gain), filled once per pixel

float memZ(int i) { return MEM_Z0 + float(i) * MEM_DZ; }
vec2 memAtlas(int i) { return vec2(float(i % 3) * 384.0 + 32.0, float(i / 3) * 264.0 + 32.0); }

// --- the city seen through the doorways: #FACADE sky, a street of lit facades
vec3 outside(vec3 ro, vec3 rd) {
  vec3 sky = mix(hex2p3(C_FACADE) * 1.25, hex2p3(C_DECADE) * 0.7, sat(rd.y * 1.4));
  float dz = rd.z < 0.0 ? (ZF - 16.0 - ro.z) / rd.z : (ZN + 16.0 - ro.z) / rd.z;
  vec3 p = ro + rd * dz;
  float bw = 5.3, bi = floor(p.x / bw + 0.5);
  float top = 8.0 + 9.0 * hash2(vec2(bi, rd.z < 0.0 ? 1.0 : 2.0));
  if (p.y < top) {
    vec3 fc = mix(hex2p3(C_FACADE), hex2p3(C_DECADE), hash2(vec2(bi, 7.0))) * 0.5;
    vec2 w = fract(vec2(p.x / 1.3, p.y / 2.2));
    float win = step(0.3, w.x) * step(w.x, 0.7) * step(0.35, w.y) * step(w.y, 0.8);
    fc = mix(fc, vec3(1.0, 0.8, 0.6) * (0.4 + 0.9 * hash2(floor(vec2(p.x / 1.3, p.y / 2.2)))), win * 0.55);
    fc *= 0.8 + 0.2 * smoothstep(0.0, 3.0, p.y);
    fc *= 1.0 - 0.25 * smoothstep(0.3, 0.0, abs(fract(p.x / bw + 0.5) - 0.5)); // gaps between houses
    return mix(fc, sky, 0.3);
  }
  return sky;
}

struct Hit { float t; vec3 p; vec3 n; int id; };
// ids: 0 floor · 1 ceiling · 2 right wall (memories) · 3 left wall (tracker) · 4 far wall · 5 entrance · 6 bench
Hit room(vec3 ro, vec3 rd) {
  vec3 d = mix(rd, vec3(1e-6), vec3(equal(rd, vec3(0.0))));
  vec3 inv = 1.0 / d;
  vec3 tA = (vec3(HW, HH, ZN) - ro) * inv;
  vec3 tB = (vec3(-HW, 0.0, ZF) - ro) * inv;
  vec3 tx = max(tA, tB);
  Hit h;
  if (tx.x < tx.y && tx.x < tx.z) { h.t = tx.x; h.id = rd.x > 0.0 ? 2 : 3; h.n = vec3(-sign(rd.x), 0.0, 0.0); }
  else if (tx.y < tx.z) { h.t = tx.y; h.id = rd.y > 0.0 ? 1 : 0; h.n = vec3(0.0, -sign(rd.y), 0.0); }
  else { h.t = tx.z; h.id = rd.z > 0.0 ? 5 : 4; h.n = vec3(0.0, 0.0, -sign(rd.z)); }
  // the bench (a box seen from outside)
  vec3 m = inv * (ro - BENCH_C), k = abs(inv) * BENCH_H;
  vec3 t1 = -m - k, t2 = -m + k;
  float tn = max(max(t1.x, t1.y), t1.z), tf = min(min(t2.x, t2.y), t2.z);
  if (tn < tf && tn > 0.0 && tn < h.t) {
    h.t = tn;
    h.id = 6;
    h.n = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
  }
  h.p = ro + rd * h.t;
  return h;
}

// --- lights
float doorMask(vec3 p, float soft) {
  return (1.0 - smoothstep(DOOR_HW - soft, DOOR_HW + soft, abs(p.x))) * (1.0 - smoothstep(DOOR_H - soft, DOOR_H + soft, p.y));
}
// small-source form factor (centre c, normal nl, area A): good beyond ~2 sizes
float ptIrr(vec3 p, vec3 n, vec3 c, vec3 nl, float A) {
  vec3 l = c - p;
  float d2 = dot(l, l);
  l *= inversesqrt(d2);
  return A * max(dot(n, l), 0.0) * max(-dot(nl, l), 0.0) / (PI * d2 + A);
}
// picture light i: ceiling spot aimed at the wall above its screen
vec3 spotPos(int i) { return vec3(HW - 1.5, HH - 0.08, memZ(i)); }
vec3 spotDir(int i) { return normalize(vec3(HW, MEM_Y + 0.75, memZ(i)) - spotPos(i)); }
float spotCone(float c) { return smoothstep(0.86, 0.95, c) * (0.6 + 0.4 * smoothstep(0.95, 0.99, c)); }

// a tube switching on: dark → a bright line → the picture opens vertically, with a white flash
float power(float a) { return a < 0.0 ? 0.0 : smoothstep(0.0, 0.2, a) * (1.0 + 2.5 * exp(-a / 0.08)); }
vec3 switchOn(vec3 scr, vec2 suv, float a) {
  if (a < 0.0) return vec3(0.0);
  if (a > 0.6) return scr;
  float open = smoothstep(0.035, 0.2, a);              // vertical opening
  float wide = smoothstep(0.0, 0.05, a);               // the line grows from the centre first
  float dy = abs(suv.y - 0.5), dx = abs(suv.x - 0.5);
  float inside = (1.0 - smoothstep(0.5 * open, 0.5 * open + 0.012, dy)) * (1.0 - smoothstep(0.5 * wide, 0.5 * wide + 0.01, dx));
  float line = exp(-dy * dy / 0.00015) * (1.0 - open) * 6.0;
  return (scr + vec3(1.0, 0.96, 1.0) * (2.5 * exp(-a / 0.07) + line)) * inside;
}

vec3 diffuseLight(vec3 p, vec3 n, bool cheap) {
  vec3 e = vec3(0.0);
  // memories (right wall, facing -x): seen by everything but their own wall
  if (n.x > -0.5) {
    float kx = HW - 0.002;
    for (int i = 0; i < 6; i++) {
      float zc = memZ(i);
      bool exact = !cheap;
      e += MEML[i] * (exact
        ? rectIrr(p, n, vec3(kx, MEM_Y - MEM_HH, zc - MEM_HW), vec3(kx, MEM_Y + MEM_HH, zc - MEM_HW),
                        vec3(kx, MEM_Y + MEM_HH, zc + MEM_HW), vec3(kx, MEM_Y - MEM_HH, zc + MEM_HW))
        : ptIrr(p, n, vec3(kx, MEM_Y, zc), vec3(-1.0, 0.0, 0.0), 4.0 * MEM_HW * MEM_HH));
    }
  }
  // the tracker (left wall, facing +x): khaki info panel on top, the darker pattern below
  if (n.x < 0.5) {
    float kx = -HW + 0.002;
    // one emitter for the whole panel; its radiance is the area-weighted mix of the khaki info band and
    // the dark pattern field, biased upwards where the khaki is
    vec3 L = mix(hudPat, hudInfo, HUD_SPLIT);
    e += L * rectIrr(p, n, vec3(kx, HUD_Y0, HUD_Z0), vec3(kx, HUD_Y1, HUD_Z0), vec3(kx, HUD_Y1, HUD_Z1), vec3(kx, HUD_Y0, HUD_Z1));
  }
  // skylight slit
  if (n.y > -0.5) {
    float ky = HH - 0.002;
    e += hex2p3(C_DECADE) * skyGain * 0.8 * rectIrr(p, n, vec3(-SKY_HW, ky, ZF), vec3(SKY_HW, ky, ZF), vec3(SKY_HW, ky, ZN), vec3(-SKY_HW, ky, ZN));
  }
  // the doorways: the city's light
  vec3 door = hex2p3(C_FACADE) * doorGain;
  if (n.z < 0.5)
    e += door * (cheap
      ? ptIrr(p, n, vec3(0.0, DOOR_H * 0.5, ZF), vec3(0.0, 0.0, 1.0), 2.0 * DOOR_HW * DOOR_H)
      : rectIrr(p, n, vec3(-DOOR_HW, 0.0, ZF), vec3(DOOR_HW, 0.0, ZF), vec3(DOOR_HW, DOOR_H, ZF), vec3(-DOOR_HW, DOOR_H, ZF)));
  if (n.z > -0.5)
    e += door * 0.6 * ptIrr(p, n, vec3(0.0, DOOR_H * 0.5, ZN), vec3(0.0, 0.0, -1.0), 2.0 * DOOR_HW * DOOR_H);
  // picture lights
  for (int i = 0; i < 6; i++) {
    vec3 l = spotPos(i) - p;
    float d2 = dot(l, l);
    l *= inversesqrt(d2);
    e += SPOT * spotGain * spotCone(dot(-l, spotDir(i))) * max(dot(n, l), 0.0) / d2 * smoothstep(0.0, 0.12, memOn[i]);
  }
  return e + vec3(0.003, 0.0026, 0.0034); // a breath of lilac ambient
}

// corner occlusion of the box (cheap, analytic)
float boxAO(vec3 p) {
  float dx = HW - abs(p.x), dy = min(p.y, HH - p.y), dz = min(p.z - ZF, ZN - p.z);
  float a = smoothstep(0.0, 0.9, dx) * smoothstep(0.0, 0.9, dy) + smoothstep(0.0, 0.9, dx) * smoothstep(0.0, 0.9, dz) + smoothstep(0.0, 0.9, dy) * smoothstep(0.0, 0.9, dz);
  return 0.55 + 0.45 * sat(a / 3.0 + 0.34);
}
// the bench's contact shadow on the floor
float benchAO(vec3 p) {
  vec2 q = abs(p.xz - BENCH_C.xz) - BENCH_H.xz;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  return 0.35 + 0.65 * smoothstep(-0.05, 0.6, d);
}

// --- the light map: every surface of the box at 5 cm, re-lit every frame (the screens change).
// rows: right wall 0–99 · left wall 100–199 · floor 200–343 · ceiling 344–487 · end walls 488–587
#define LMR 0.05
#define LM_SIZE vec2(560.0, 588.0)
vec4 lmRegion(int id) {
  if (id == 2) return vec4(0.0, 0.0, 560.0, 100.0);
  if (id == 3) return vec4(0.0, 100.0, 560.0, 200.0);
  if (id == 0) return vec4(0.0, 200.0, 560.0, 344.0);
  if (id == 1) return vec4(0.0, 344.0, 560.0, 488.0);
  if (id == 4) return vec4(0.0, 488.0, 144.0, 588.0);
  return vec4(144.0, 488.0, 288.0, 588.0);
}
vec3 lit(Hit h) {
  vec3 p = h.p;
  float u = (p.z - ZF) / LMR, w = (p.x + HW) / LMR, y = p.y / LMR;
  vec2 px = h.id == 2 || h.id == 3 ? vec2(u, y) : h.id <= 1 ? vec2(u, w) : vec2(w, y);
  vec4 r = lmRegion(h.id);
  px = clamp(px + r.xy, r.xy + 0.5, r.zw - 0.5);
  return textureLod(lmap, px / LM_SIZE, 0.0).rgb;
}

// --- FT2's channel scopes: q in FT2 pixels; returns linear colour and coverage
float scopeWave(float x, float shape, float t) {
  if (shape < 0.5) return sin(TAU * x);
  if (shape < 1.5) return 1.0 - 2.0 * fract(x);
  if (shape < 2.5) return clamp(sin(TAU * x) * 6.0, -1.0, 1.0);
  if (shape < 3.5) return (vnoise(vec2(x * 23.0, t * 60.0)) - 0.5) * 2.4;
  if (shape < 4.5) return 0.65 * sin(TAU * x) + 0.3 * sin(2.0 * TAU * x + 1.3) + 0.18 * sin(3.0 * TAU * x + 0.4);
  return sin(TAU * x) * (0.55 + 0.45 * cos(PI * fract(x * 0.25)));
}
vec4 scopeAt(vec2 q, float px) {
  vec2 cell = SCOPE_RECT.zw / vec2(float(SCOPE_COLS), float(SCOPE_ROWS));
  vec2 r = (q - SCOPE_RECT.xy) / cell;
  if (r.x < 0.0 || r.y < 0.0 || r.x >= float(SCOPE_COLS) || r.y >= float(SCOPE_ROWS)) return vec4(0.0);
  int ch = int(floor(r.y)) * SCOPE_COLS + int(floor(r.x));
  vec2 l = fract(r) * cell;                     // FT2 px inside the scope
  vec2 in_ = cell - vec2(3.0);                  // inside the 1.5 px frame
  vec2 u = (l - 1.5) / in_;
  if (any(lessThan(u, vec2(0.0))) || any(greaterThan(u, vec2(1.0)))) return vec4(0.0);
  vec4 s = scope[ch];
  float ph = t * (3.0 + s.y * 2.7);
  float x = u.x * s.y + ph;
  float y = 0.5 - 0.42 * s.x * scopeWave(x, s.z, t);
  float y2 = 0.5 - 0.42 * s.x * scopeWave(x + s.y * 0.01, s.z, t);
  float slope = (y2 - y) / 0.01 * in_.y / in_.x;
  float d = abs(u.y - y) * in_.y / sqrt(1.0 + slope * slope); // distance to the trace, FT2 px
  float w = max(px, 0.35);
  float line = 1.0 - smoothstep(0.45, 0.45 + w * 1.5, d);
  float glow = exp(-d * d / 6.0) * 0.25;
  vec3 ink = mix(hex2p3(vec3(0.62, 0.83, 1.0)), hex2p3(C_DECADE) * 1.8, s.w); // #9ed3ff · the ghost lilac
  return vec4(ink * (line + glow) * (0.55 + 0.45 * s.w + 0.45 * step(0.02, s.x)), 1.0);
}

// emissive + diffuse colour of a hit. blur: world-space blur radius (glossy reflections), 0 = sharp.
// primary: the camera ray — screens get scanlines and pixel-exact sampling, using the analytic
// footprint dpx/dpy of a pixel on the surface (no derivatives inside branches).
vec4 shade(Hit h, vec3 rd, float blur, bool primary, vec3 dpx, vec3 dpy) {
  vec3 p = h.p;
  vec3 col = vec3(0.0);
  float alpha = 1.0;
  float soft = max(blur, 0.004);
  if (h.id == 2) { // right wall: memories
    int i = clamp(int(floor((p.z - MEM_Z0) / MEM_DZ + 0.5)), 0, 5);
    float zc = memZ(i);
    vec2 q = vec2(p.z - zc, p.y - MEM_Y);
    vec2 aq = abs(q);
    float inScreen = (1.0 - smoothstep(MEM_HW - soft, MEM_HW + soft, aq.x)) * (1.0 - smoothstep(MEM_HH - soft, MEM_HH + soft, aq.y));
    float inFrame = (1.0 - smoothstep(MEM_HW + FRAME - soft, MEM_HW + FRAME + soft, aq.x)) * (1.0 - smoothstep(MEM_HH + FRAME - soft, MEM_HH + FRAME + soft, aq.y));
    vec3 dl = lit(h);
    vec3 wall = WALL * dl;
    // frame: near-black lacquer, a lit bevel on its outer edge
    float edge = max(aq.x - MEM_HW - FRAME, aq.y - MEM_HH - FRAME);
    float bevel = smoothstep(0.014, 0.0, abs(edge + 0.007));
    vec3 frame = 0.025 * dl + bevel * 0.12 * dl;
    vec3 scr = vec3(0.0);
    if (inScreen > 0.0) {
      vec2 suv = q / vec2(2.0 * MEM_HW, 2.0 * MEM_HH) + 0.5;
      vec2 tc = suv * vec2(320.0, 200.0);
      vec2 base = memAtlas(i);
      vec2 isz = 1.0 / vec2(ATLAS_W, ATLAS_H);
      if (primary) {
        // pixel-exact sampling of the VGA tile with antialiased texel edges
        vec2 k = vec2(320.0 / (2.0 * MEM_HW), 200.0 / (2.0 * MEM_HH));
        vec2 gx = dpx.zy * k, gy = dpy.zy * k;
        vec2 fw = max(abs(gx) + abs(gy), vec2(1e-3));
        vec2 tp = floor(tc) + 0.5 + clamp((fract(tc) - 0.5) / fw, -0.5, 0.5);
        tp = clamp(tp, vec2(0.5), vec2(319.5, 199.5));
        scr = textureGrad(atlas, (base + tp) * isz, gx * isz, gy * isz).rgb;
        // scanlines, fading out before they would alias
        float sl = 0.74 + 0.26 * cos(TAU * tc.y);
        scr *= mix(sl, 0.87, smoothstep(0.2, 0.55, fw.y));
      } else {
        float lod = log2(max(blur * 200.0 / (2.0 * MEM_HH), 1.0));
        scr = textureLod(atlas, (base + clamp(tc, vec2(0.5), vec2(319.5, 199.5))) * isz, lod).rgb;
      }
      scr = hex2p3(scr); // the VGA DAC values are sRGB-encoded
      vec2 cq = suv * 2.0 - 1.0;
      scr *= 1.0 - 0.3 * dot(cq * cq, cq * cq); // tube falloff towards the corners
      scr *= screenGain * (1.0 + 0.3 * kick);
      scr = switchOn(scr, suv, memOn[i]);
      if (primary && i == hole) alpha = 1.0 - inScreen;
    }
    col = mix(mix(wall, frame, inFrame), scr, inScreen);
  } else if (h.id == 3) { // left wall: the tracker
    vec2 sz = vec2(HUD_Z0 - HUD_Z1, HUD_Y1 - HUD_Y0);
    vec2 st = vec2(HUD_Z0 - p.z, HUD_Y1 - p.y) / sz;
    vec2 ast = abs(st - 0.5) * sz; // metres from the centre
    vec2 hs = 0.5 * sz;
    float inPanel = (1.0 - smoothstep(hs.x - soft, hs.x + soft, ast.x)) * (1.0 - smoothstep(hs.y - soft, hs.y + soft, ast.y));
    float inBezel = (1.0 - smoothstep(hs.x + 0.07 - soft, hs.x + 0.07 + soft, ast.x)) * (1.0 - smoothstep(hs.y + 0.07 - soft, hs.y + 0.07 + soft, ast.y));
    vec3 dl = lit(h);
    vec3 wall = WALL * dl;
    float edge = max(ast.x - hs.x - 0.07, ast.y - hs.y - 0.07);
    vec3 bezel = 0.025 * dl + smoothstep(0.014, 0.0, abs(edge + 0.007)) * 0.12 * dl;
    vec3 pan = vec3(0.0);
    if (inPanel > 0.0) {
      float lod = primary ? 0.0 : log2(max(blur * HUD_TEXW / sz.x, 1.0));
      vec3 c = hex2p3(textureLod(hudTex, st, lod).rgb);
      // the scopes are holes in the DOM: drawn here, live
      if (primary) {
        float ftpx = length(dpx) * FT_W / sz.x; // one screen pixel in FT2 pixels
        vec4 sc = scopeAt(st * vec2(FT_W, FT_H), ftpx);
        c = mix(c, sc.rgb, sc.a);
      }
      pan = c * (primary ? hudGL : 1.0) * HUD_GAIN;
    }
    col = mix(mix(wall, bezel, inBezel), pan, inPanel);
  } else if (h.id == 0) { // floor
    col = vec3(0.02, 0.019, 0.021) * lit(h);
  } else if (h.id == 1) { // ceiling: a skylight slit, divided into panes by beams
    float beam = smoothstep(0.17 + soft, 0.17 - soft, abs(fract((p.z - MEM_Z0) / MEM_DZ) - 0.5) * abs(MEM_DZ));
    float sl = (1.0 - smoothstep(SKY_HW - soft, SKY_HW + soft, abs(p.x))) * (1.0 - beam);
    vec3 c = CEIL * lit(h);
    vec3 s = hex2p3(C_DECADE) * skyGain * (0.45 + 0.15 * smoothstep(SKY_HW, 0.0, abs(p.x)));
    // on every kick a pulse of light runs down the skylight, entrance → far door
    float run = 0.0;
    for (int k = 0; k < 4; k++) {
      float age = chase[k];
      if (age < 0.0 || age > 1.2) continue;
      float d = (ZN - p.z) - 32.0 * age;
      run += exp(-d * d / 5.0) * exp(-age / 0.6);
    }
    s *= 1.0 + 3.5 * run;
    col = mix(c, s, sl);
  } else if (h.id == 6) { // bench: dark oiled wood, a soft top
    Hit f = h;
    f.id = 0;
    f.p.xz += h.n.xz * 0.4; // its sides see roughly what the floor next to them sees
    col = vec3(0.05, 0.035, 0.028) * lit(f) * (h.n.y > 0.5 ? 2.2 : 0.9);
  } else { // end walls with the doorways
    float dm = doorMask(p, soft);
    vec3 wall = WALL * lit(h);
    vec3 city = outside(p, rd) * doorGain;
    col = mix(wall, city, dm);
  }
  // skirting
  if (h.id >= 2 && h.id < 6) col *= mix(0.45, 1.0, smoothstep(0.1, 0.12, p.y));
  return vec4(col, alpha);
}

// footprint of one pixel on the plane hit by a ray (ray differentials for a plane)
vec3 footprint(vec3 rd, vec3 drd, vec3 n, float t) {
  return t * (drd - rd * dot(n, drd) / dot(n, rd));
}

// in-scattering of a point light along a ray segment [0, T]: ∫ ds / |l - x(s)|² in closed form
float fastAtan(float x) { // |error| < 0.005
  float a = abs(x), z = a > 1.0 ? 1.0 / a : a;
  float r = z * (0.7853982 + 0.273 * (1.0 - z));
  r = a > 1.0 ? 1.5707963 - r : r;
  return sign(x) * r;
}
float pointScatter(vec3 ro, vec3 rd, vec3 lp, float T) {
  vec3 w = lp - ro;
  float sc = dot(w, rd);
  float h2 = max(dot(w, w) - sc * sc, 1e-4), ih = inversesqrt(h2);
  return (fastAtan((T - sc) * ih) - fastAtan(-sc * ih)) * ih;
}

void main() {

#ifdef LIGHTMAP
  {
  for (int i = 0; i < 6; i++)
    MEML[i] = hex2p3(textureLod(atlas, (memAtlas(i) + vec2(160.0, 100.0)) / vec2(ATLAS_W, ATLAS_H), 6.0).rgb) * screenGain
      * (1.0 + 0.3 * kick) * power(memOn[i]);
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec2 c = vec2(q) + 0.5;
  vec3 p, n;
  if (q.y < 100) { p = vec3(HW, c.y * LMR, ZF + c.x * LMR); n = vec3(-1.0, 0.0, 0.0); }
  else if (q.y < 200) { p = vec3(-HW, (c.y - 100.0) * LMR, ZF + c.x * LMR); n = vec3(1.0, 0.0, 0.0); }
  else if (q.y < 344) { p = vec3(-HW + (c.y - 200.0) * LMR, 0.0, ZF + c.x * LMR); n = vec3(0.0, 1.0, 0.0); }
  else if (q.y < 488) { p = vec3(-HW + (c.y - 344.0) * LMR, HH, ZF + c.x * LMR); n = vec3(0.0, -1.0, 0.0); }
  else if (q.x < 144) { p = vec3(-HW + c.x * LMR, (c.y - 488.0) * LMR, ZF); n = vec3(0.0, 0.0, 1.0); }
  else { p = vec3(-HW + (c.x - 144.0) * LMR, (c.y - 488.0) * LMR, ZN); n = vec3(0.0, 0.0, -1.0); }
  vec3 e = diffuseLight(p, n, false) * boxAO(p);
  if (n.y > 0.5) e *= benchAO(p);
  o = vec4(e, 1.0);
  return;
  }
#endif
  vec2 ndc = uv * 2.0 - 1.0;
  float aspect = res.x / res.y;
  vec3 rv = cam * vec3(ndc.x * tanH * aspect, ndc.y * tanH, 1.0);
  float rl = length(rv);
  vec3 rd = rv / rl;
  // derivative of the (normalised) ray direction per pixel
  vec3 ex = cam[0] * (2.0 * tanH * aspect / res.x), ey = cam[1] * (2.0 * tanH / res.y);
  vec3 drx = (ex - rd * dot(rd, ex)) / rl, dry = (ey - rd * dot(rd, ey)) / rl;
  Hit h = room(eye, rd);
  vec4 c = shade(h, rd, 0.0, true, footprint(rd, drx, h.n, h.t), footprint(rd, dry, h.n, h.t));
  vec3 col = c.rgb;

  if (h.id == 0) {
    // polished stone: large slabs, grout, roughness varying from slab to slab
    vec2 tile = h.p.xz / 1.2;
    vec2 g = abs(fract(tile) - 0.5);
    float grout = smoothstep(0.494, 0.499, max(g.x, g.y));
    float rough = 0.015 + 0.05 * vnoise(h.p.xz * 0.9) + 0.03 * hash2(floor(tile)) + 0.25 * grout;
    vec3 rr = reflect(rd, vec3(0.0, 1.0, 0.0));
    rr.xz += (vec2(vnoise(h.p.xz * 3.1), vnoise(h.p.zx * 2.7)) - 0.5) * 0.01; // slabs are never quite flat
    rr = normalize(rr);
    Hit r = room(h.p + rr * 1e-3, rr);
    vec3 refl = shade(r, rr, rough * r.t, false, vec3(0.0), vec3(0.0)).rgb;
    float cosT = sat(-rd.y);
    float F = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
    col = col * (1.0 - grout * 0.3) + refl * F * (1.0 - grout) * 0.9 * benchAO(h.p);
  }

  // the air: lilac haze lit by the city, beams of the picture lights
  float fogT = 1.0 - exp(-h.t * 0.016);
  vec3 air = hex2p3(C_DECADE) * 0.006 * (skyGain + 0.4 * doorGain);
  vec3 toDoor = normalize(vec3(0.0, DOOR_H * 0.5, ZF) - eye);
  air += hex2p3(C_FACADE) * doorGain * 0.02 * pow(sat(dot(rd, toDoor)), 20.0);
  col = mix(col, air, fogT);
  vec3 beams = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    vec3 sp = spotPos(i);
    // cone weight where the ray passes closest to the lamp (a cheap stand-in for the cone integral)
    float sc = clamp(dot(sp - eye, rd), 0.0, h.t);
    vec3 x = eye + rd * sc;
    vec3 dx = x - sp;
    float d2 = dot(dx, dx);
    if (d2 > 16.0) continue;
    float cone = smoothstep(0.8, 0.97, dot(dx, spotDir(i)) * inversesqrt(d2));
    beams += SPOT * cone * pointScatter(eye, rd, sp, h.t) * smoothstep(0.0, 0.12, memOn[i]);
  }
  col += beams * spotGain * 0.0009 * beamGain;
  o = vec4(col * expo * c.a, c.a); // a Droste hole is black (no bright bleeding in its mips)
}
