# EFFACED — developer notes

Target: Chrome on a MacBook Pro 14" M4 Pro, fullscreen 3024×1890, Display P3.

```bash
pnpm install
pnpm dev                 # http://localhost:5173  (demo) · /techcheck.html · /perception.html · /lab.html
pnpm music               # score (music/score/*.ts) → music/effaced.xm + xm-check report
pnpm typecheck
pnpm build               # static build in dist/
```

| Page | What |
|---|---|
| `/` | the demo: start prompt → hexdump loader → show |
| `/techcheck.html` | GPU / audio-clock / fullscreen measurements on the target machine |
| `/perception.html` | calibration lab for the perception scenes |
| `/lab.html` | audio lab: instrument bank, engine FX, render analysis |

## Dev URLs and keys (index.html)

`?go` skip the start prompt · `?scene=S08` start at a scene (`&solo` to pin it) · `?pos=0F&row=8` · `?t=12.5` ·
`&silent` no music render (picture only) · `?bench[=WxH][&only=S09,S12]` per-scene frame-time sweep (nothing plays).
The last position is remembered per tab, so a reload resumes where you were.

Space play/pause · ←/→ ±1 bar (Shift ±1 pattern) · Home · R restart cue · L loop cue · S solo scene ·
M mute · H hide bar · `[` `]` playback rate. Click/drag the bar to seek (Alt = no bar snapping).
Editing a `.glsl` file hot-reloads the shaders without touching the clock.

## Layout

| Path | What |
|---|---|
| `src/main.ts` | start prompt → loader → demo |
| `src/demo.ts` | frame loop: picks the cue, builds `FrameCtx`, HDR target → scene → post |
| `src/timeline/` | `script.ts` running order (positions ↔ scenes), `clock.ts` audio clock, `events.ts` markers/hits, `music.ts` engine glue |
| `src/gfx/` | `gl.ts` WebGL2 layer (programs with parallel compile + HMR, targets), `post.ts` bloom + AgX/clip + grain, `beam.ts` oscilloscope beam, `taa.ts`, `city.ts`, `billboards.ts` |
| `src/shaders/` | `lib/` shared GLSL (`#include "lib/color"`), `post/`, `scenes/` |
| `src/scenes/` | one file per scene, auto-registered by `index.ts`; missing scenes get a placeholder |
| `src/boot/` | VGA text-mode start prompt and the hexdump loader |
| `src/meta/` | DOM layer: frame counter, the FastTracker II HUD |
| `src/perception/` | perception renderer (faces, flows) shared by the show and the lab |
| `src/music/` | `roster.ts` channels/slots/diary, `xm/` XM writer/reader/check/harmony analysis, `score/dsl.ts` score DSL |
| `src/audio/` | audio engine (libopenmpt render, FX bus, stems → envelopes/markers), `synth/` instrument bank |
| `music/score/` | the track as TypeScript (built by `pnpm music`) |
| `music/instruments/` | the instrument bank (WAV zones + `manifest.json`, sources in `SOURCES.md`) |
| `tools/` | Node tools: `build-xm`, `xm-check`, `harmony-check`, `render-xm`, `build-instruments`, `audio-tests`, … |

## Scene contract (`src/scenes/types.ts`)

```ts
export default function createMyScene(g: Gfx): Scene {
  const prog = program(g, 'scenes/s08-flow');              // src/shaders/scenes/s08-flow.glsl
  return {
    id: 'S08', title: 'Flow',
    post: false,                       // exact colours, no tonemap/bloom; or { bloom, exposure, tonemap: 'clip', exact, … } or (f) => …
    scale: 0.66,                       // internal resolution for heavy raymarching
    fps: 60,                           // optional: lock heavy scenes to 60 Hz
    programs: () => [prog],            // compiled in parallel during the loader
    init() {},                         // buffers etc. after compile
    render(f, hdr) { /* draw */ },     // hdr = linear-P3 RGBA16F target (bound), or null when post === false
  };
}
```

`FrameCtx`: `t` song seconds (audio clock) · `dt` · `row`, `pos`, `prow` · `local`, `localRow`, `k` (0..1 through the cue) ·
`S[ch-1]` channel envelopes · `M` markers fired this frame (`C-4` look, `D-4` hit, `E-4` mode, `F-4` motif) ·
`audio.notes` note events · `w`, `h`, `aspect` · `jumped` (seek: reset feedback buffers).

Colour: the working space is **linear Display P3**; hex words are sRGB — convert with `hex2p3()` from `lib/color`.
