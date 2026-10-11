```
            ██▀▀▀▀  ██▀▀▀▀  ██▀▀▀▀  ▄█▀▀█▄  ▄█▀▀▀▀  ██▀▀▀▀  ██▀▀█▄
            ██▄▄▄░░ ██▄▄▄░░ ██▄▄▄░░ ██▄▄██░ ██░░░░░ ██▄▄▄░░ ██░░██░
            ██░░░░  ██░░░░  ██░░░░  ██░░██░ ██░     ██░░░░  ██░ ██░
            ▀▀▀▀▀▀  ▀▀░     ▀▀░     ▀▀░ ▀▀░  ▀▀▀▀▀  ▀▀▀▀▀▀  ▀▀▀▀▀░░
             ░░░░░░  ░░      ░░      ░░  ░░   ░░░░░  ░░░░░░  ░░░░░

                    ░▒▓█  6 5 5 3 6   +   1  █▓▒░

 ═════════════════════════════════════════════════════════════════════════════
        a browser demo  ·  WebGL2  ·  .xm + Web Audio  ·  4:18  ·  2026
 ═════════════════════════════════════════════════════════════════════════════

 ┌─[ intro ]──────────────────────────────────────────────────────────────────┐
 │                                                                            │
 │   i was the 65537th byte.                                                  │
 │                                                                            │
 │   the rest is in the picture, in the music, and in the places your         │
 │   screen can't quite show. pause it. read the tracker. look at the         │
 │   center.                                                                  │
 │                                                                            │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌─[ story ]──────────────────────────────────────────────────────────────────┐
 │                                                                            │
 │   64k is 65536 bytes, and one did not fit. this is the story of that       │
 │   one: the 65537th byte, a creature made of everything a machine has no    │
 │   room for. it lives in the seventeenth channel of a sixteen-channel       │
 │   tracker, in rounding errors, in the space between two frames.            │
 │                                                                            │
 │   the world it wakes up in is a cage: the triangle of your monitor's       │
 │   colours, a polytope turning in four dimensions, an endless city with     │
 │   no thickness, a staircase that goes nowhere. it only shows at the        │
 │   edges: a note that lands outside the triangle, a reflection that         │
 │   should not be there.                                                     │
 │                                                                            │
 │   the machine answers by effacing it. it compresses the world into 8×8     │
 │   blocks and turns it inside out. the creature breaks out through the      │
 │   frame of the canvas itself and burns down to a single point.             │
 │                                                                            │
 │   65536 + 1. the demo never says who the one is.                           │
 │                                                                            │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌─[ credits ]────────────────────────────────────────────────────────────────┐
 │                                                                            │
 │        code     opus                                                       │
 │       music     opus, xor777                                               │
 │         gfx     opus, xor777                                               │
 │                                                                            │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌─[ released at ]────────────────────────────────────────────────────────────┐
 │  an internal show of experimenters and dreamers. no compo. no rules.       │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌─[ runs on ]────────────────────────────────────────────────────────────────┐
 │                                                                            │
 │   Chrome  ·  MacBook Pro 14" M4 Pro  ·  fullscreen 3024×1890  ·  120 Hz    │
 │   Display P3, SDR. built for exactly one machine, and it shows.            │
 │                                                                            │
 │   sound on. dark room. press any key.                                      │
 │                                                                            │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌─[ the running order ]──────────────────────────────────────────────────────┐
 │                                                                            │
 │   ── act I ──────────────────────────────────────────────────────────────  │
 │   00:00  S00  beam             an oscilloscope draws what you hear         │
 │   00:08  S01  boundary         the CIE 1931 edge of colour vision          │
 │   00:23  S02  cage             the 600-cell, rotating in four dimensions   │
 │   ── act II ─────────────────────────────────────────────────────────────  │
 │   00:38  S03  city of facades  zero-thickness buildings, a Penrose floor   │
 │   00:54  S04  gallery          a FastTracker II screen on the wall         │
 │   01:09  S05  staircase        up, forever                                 │
 │   01:24  S06  escher gallery   the Droste spiral                           │
 │   ── act III ────────────────────────────────────────────────────────────  │
 │   01:40  S07  indra's pearls   a Kleinian limit set, then mirrors          │
 │   01:55  S08  flow             keep your eyes on the cross                 │
 │   02:18  S09  stillness        the render stops. the music doesn't.        │
 │   ── act IV ─────────────────────────────────────────────────────────────  │
 │   02:34  S10  compression      320×200, 8×8 DCT, quantised to nothing      │
 │   02:49  S11  inversion        a city turned inside out, Gauss's 17-gon    │
 │   03:04  S12  canvas           a million particles leave the frame         │
 │   03:20  S13  erasure          a flame grown from a sigil                  │
 │   ── act V ──────────────────────────────────────────────────────────────  │
 │   03:35  S14  portrait         65536 embers                                │
 │   03:58  S15  effaced          + 1                                         │
 │                                                                            │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌─[ under the hood ]─────────────────────────────────────────────────────────┐
 │                                                                            │
 │  ■ WebGL2, a linear Display P3 HDR pipeline: bloom, AgX, TAA, grain,       │
 │    every hex colour a word: #FACADE #DECADE #BEADED #EFFACE #ACCEDE        │
 │  ■ sixteen hand-written shader scenes: spectral loci, the 600-cell,        │
 │    gyroids behind CRT glass, Maskit limit sets, Hopf fibrations, a live    │
 │    JPEG codec, {p,q} tilings, strange attractors, a fractal flame          │
 │  ■ the soundtrack is a real FastTracker II module: 16 channels, a ghost    │
 │    channel that only the oscilloscope hears, and a silent channel of       │
 │    marker notes the picture listens to. composed as TypeScript, checked    │
 │    by a harmony analyser, rendered by libopenmpt, mixed through a          │
 │    hand-rolled FX bus. instruments: CC0 samples (VSCO 2 CE, VCSL) and      │
 │    PADsynth, 2.7 MB for the whole orchestra                                │
 │  ■ the picture is clocked by the tracker: 1 row = 0.12 s, 64 rows = 1      │
 │    pattern, 32 patterns = 1 demo                                           │
 │                                                                            │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌─[ watch it ]───────────────────────────────────────────────────────────────┐
 │                                                                            │
 │   pnpm install                                                             │
 │   pnpm dev                 → http://localhost:5173, press any key          │
 │                                                                            │
 │   pnpm build               → dist/   (static, serve it from anywhere)      │
 │   pnpm music               → rebuild music/effaced.xm from the score       │
 │                                                                            │
 │   load music/effaced.xm in your tracker of choice.                         │
 │   developer notes: DEVELOPING.md                                           │
 │                                                                            │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌─[ greetings ]──────────────────────────────────────────────────────────────┐
 │                                                                            │
 │   to everyone who still reads .nfo files,                                  │
 │   to the trackers that taught a generation to count in hex,                │
 │   and to the 65536 bytes that came before.                                 │
 │                                                                            │
 └────────────────────────────────────────────────────────────────────────────┘

                        FA CA DE · DE CA DE · EF FA CE D
                                   0xEFFACED
```
