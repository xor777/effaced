// The tracker HUD (PLAN §4 S4, §8, §9): a FastTracker II screen — our music IS an .xm — as REAL DOM,
// hung on the gallery wall with CSS matrix3d and locked to the WebGL camera (the CSS3DRenderer
// construction: perspective = 0.5·H / tan(fov/2), camera = view matrix with Y flipped, object = world
// matrix with Y flipped). It plays music/effaced.xm exactly as we hear it: song EFFACED, the real
// order list, pattern, row, BPM/speed, the instrument list — whose names are the creature's diary
// (PLAN appendix B) — and the pattern editor scrolling with the song. FT2 shows 8 channels at a time:
// the window follows the busy channels and swings to the ghost (channel 17) whenever its E-G-A-C
// notes come. The channel scopes are holes in the DOM: the GL draws them live underneath.
//
// Layout in FT2's own 640 × 400 pixels (1em = 1 FT2 pixel). DOM work per frame: the camera
// transform and the channel window's translateX. Per row: the pattern blocks' translateY and a few
// small fields. Per pattern (7.68 s): the next block, prepared at row 40 in a hidden buffer.

import type { TrackInfo, TrackCell } from '../audio/types.ts';

export const FT_W = 640;
export const FT_H = 400;
/**
 * CSS px per FT2 pixel: the raster resolution of the panel (1920 × 1200 CSS px). Chrome rasters the
 * 3D panel on the GPU whenever new tiles come into view or its scale changes: keep it just above
 * 1:1 for the full-frame shot (08:16–08:47), not more.
 */
const U = 3.0;
/** the top (panels) / bottom (pattern editor) split, as a fraction of the height */
export const HUD_SPLIT = 176 / FT_H;
/** the scope grid (FT2 px): 6 × 3 scopes for the 18 channels — drawn by the GL */
export const SCOPES = { x: 176, y: 52, w: 206, h: 124, cols: 6, rows: 3 };
/** the GL's copy of the screen (reflections, bloom, light): a small canvas */
export const HUD_TEX_W = 320;
export const HUD_TEX_H = 200;

const CH = 18;
const GHOST = 16; // channel 17, 0-based
const VIS = 8; // channels in view
const CHW = 73.5; // channel column width (FT2 px)
const PROWS = 19; // rows in view (the play row is the 10th)
const PAD = 9; // rows of the neighbouring patterns above/below
const PE = { x: 26, y: 188, w: VIS * CHW, h: 198 }; // the rows' viewport
const ROWH = PE.h / PROWS;

// FastTracker II 2.08's default palette (sampled from a 2.08 screenshot)
export const FT2 = {
  desk: '#285586',
  hi: '#4996eb',
  lo: '#102034',
  btn: '#9696b6',
  btnHi: '#e7e7ff',
  btnLo: '#343441',
  text: '#ffffff',
  val: '#9ed3ff',
  dim: '#3a6699',
  black: '#000000',
  ghost: '#decade',
};
const rgbCache = new Map<string, number[]>();
const rgb = (h: string): number[] => {
  let v = rgbCache.get(h);
  if (!v) rgbCache.set(h, (v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))));
  return v;
};
/** the gallery's air as the DOM sees it (display-encoded) */
const HAZE = '#0d0b10';

const CSS = `
.ftv{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.ftv>div{position:absolute;left:0;top:0;transform-style:preserve-3d;will-change:transform}
.ft{--u:${U}px;position:absolute;width:${FT_W}em;height:${FT_H}em;font-size:${U}px;line-height:1;color:${FT2.text};white-space:pre;
 font-family:ui-monospace,Menlo,monospace;font-weight:700;letter-spacing:0;font-kerning:none;font-variant-ligatures:none;
 -webkit-font-smoothing:antialiased;will-change:transform;overflow:hidden}
.ft>*{position:absolute}
.ft .p{background:${FT2.desk};box-shadow:inset 1em 1em 0 ${FT2.hi},inset -1em -1em 0 ${FT2.lo}}
.ft .i{background:${FT2.black};box-shadow:inset 1em 1em 0 ${FT2.lo},inset -1em -1em 0 ${FT2.hi}}
.ft .b{background:${FT2.btn};color:#000;text-align:center;
 box-shadow:0 0 0 .7em #000,inset 1em 1em 0 ${FT2.btnHi},inset -1em -1em 0 ${FT2.btnLo}}
.ft .b.on{box-shadow:0 0 0 .7em #000,inset 1em 1em 0 ${FT2.btnLo},inset -1em -1em 0 ${FT2.btnHi};background:#8484a4}
.ft .v{color:${FT2.val}}
.ft .sc{box-shadow:inset 1.4em 1.4em 0 ${FT2.lo},inset -1.4em -1.4em 0 ${FT2.hi}}
.ft .g{color:${FT2.ghost};text-shadow:0 0 .5em ${FT2.ghost}}
.ft .logo{font-style:italic;letter-spacing:-.04em;color:#fff;text-shadow:.12em .12em 0 ${FT2.desk},-.06em -.06em 0 ${FT2.hi}}
.ft .clip{overflow:hidden}
.ft .mv{position:absolute;left:0;top:0;will-change:transform}
.ft .row{height:calc(var(--u)*${ROWH});line-height:calc(var(--u)*${ROWH});color:${FT2.val}}
.ft .bk{background:repeating-linear-gradient(90deg,#000 0 ${CHW - 1.6}em,${FT2.desk} ${CHW - 1.6}em ${CHW}em)}
.ft .row.d{color:${FT2.dim}}
.ft .rn div div{height:calc(var(--u)*${ROWH});line-height:calc(var(--u)*${ROWH});text-align:center;color:${FT2.val}}
.ft .rn .w{color:#fff}
.ft .rn .d{color:${FT2.dim}}
.ft .band{background:${FT2.desk};will-change:opacity}
.ft .sel{background:rgba(150,150,182,.38);will-change:transform}
.ft .fl{inset:0;background:#fff;opacity:0;will-change:opacity}
.ft .fz{inset:0;will-change:opacity;opacity:0}
`;

// --- FT2 cells: "C-5 01 40 A0F" · empty "··· ·· ·· 000" · key off "==="
const DOT = '·';
const NOTES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
const hx = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
const FX = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const EMPTY = `${DOT.repeat(3)} ${DOT.repeat(2)} ${DOT.repeat(2)} 000`;
export function cellText(c: TrackCell | undefined): string {
  if (!c || (!c.note && !c.ins && !c.vol && !c.fx && !c.param)) return EMPTY;
  const note = c.note === 97 ? '===' : c.note ? NOTES[(c.note - 1) % 12] + Math.floor((c.note - 1) / 12) : DOT.repeat(3);
  const ins = c.ins ? hx(c.ins) : DOT + DOT;
  const vol = c.vol ? hx(c.vol) : DOT + DOT; // FT2 shows the volume-column byte (10–50 = volume 00–40)
  const fx = c.fx || c.param ? FX[c.fx] + hx(c.param) : '000';
  return `${note} ${ins} ${vol} ${fx}`;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const isNote = (s: string) => s[0] !== DOT && s[0] !== '=';

/** what each instrument slot is made of (NOTES §5) — FT2's sample list shows it */
const SYNTH = [
  '', 'padsynth choir', 'padsynth choir', 'padsynth strings', 'padsynth pad', 'supersaw + filter', 'detuned pulse',
  '2-op fm 1:3.5', 'fm 1:1 + 14:1 tine', 'karplus-strong', 'saw/pulse + sub', 'sine', 'sine sweep 150>45',
  'noise + 180hz body', '6 squares + hpf', 'bessel membrane', 'orchestra layer', 'shepard partials', 'xy scope',
];
/** scope waveform per slot: 0 sine · 1 saw · 2 pulse · 3 noise · 4 rich (pads) · 5 decaying sine */
const SHAPE = [0, 4, 4, 4, 4, 1, 2, 5, 5, 5, 1, 0, 5, 3, 3, 5, 4, 0, 0];
/** how long a note keeps its scope alive without audio (s) */
const SUSTAIN = [1, 2.5, 2.5, 2, 3, 1.2, 1, 1.6, 1.2, 0.5, 0.4, 1, 0.25, 0.15, 0.1, 0.8, 0.5, 1.5, 0.5];

export interface HudPlay {
  pos: number;
  row: number; // integer row in the pattern
  /** seconds since the current row started */
  rowT: number;
  t: number;
}

interface Rect { x: number; y: number; w: number; h: number; c: string }
interface Text { x: number; y: number; s: string; size: number; c: string; id?: string }

export class TrackerHud {
  view: HTMLDivElement;
  cam: HTMLDivElement;
  panel: HTMLDivElement;
  /** world size of the panel (m) — the DOM is scaled onto it exactly */
  worldW: number;
  worldH: number;
  /** the GL's copy of the screen: RGBA8 pixels, HUD_TEX_W × HUD_TEX_H, top line first */
  pixels = new Uint8Array(HUD_TEX_W * HUD_TEX_H * 4);
  private base: Uint8Array | null = null; // panels + static text, drawn once
  /** per channel: amplitude, cycles across the scope, waveform, ghost glow — for the GL scopes */
  scopes = new Float32Array(CH * 4);
  private rects: Rect[] = [];
  private texts: Text[] = [];
  private el = new Map<string, HTMLElement>();
  private txt = new Map<string, string>();
  private track: TrackInfo | null = null;
  private patCache = new Map<number, string[]>();
  private blocks: HTMLDivElement[] = [];
  private nums: HTMLDivElement[][] = [[], []]; // left/right row numbers, per buffer
  private blockOf = [-2, -2];
  private front = 0;
  private lastRow = -1;
  private lastKey = '';
  private lastBake = -1;
  private dirty = true;
  private shown = false;
  private vw = 0;
  private vh = 0;
  private fog: HTMLDivElement[] = [];
  private band!: HTMLDivElement;
  private flash!: HTMLDivElement;
  private ghostEl!: HTMLSpanElement;
  private head!: HTMLDivElement;
  private gwrap!: HTMLDivElement;
  private bk!: HTMLDivElement;
  private thumb!: HTMLDivElement;
  private selA!: HTMLDivElement;
  private play: HudPlay = { pos: 0, row: 0, rowT: 0, t: 0 };
  /** the channel window: first visible channel (animated) and its target */
  private win = 0;
  private winTarget = 0;
  private winBar = -1;
  private winGhost = false;
  private lastT = -1;
  private sel = 0;

  constructor(worldW: number, worldH: number) {
    this.worldW = worldW;
    this.worldH = worldH;
    if (!document.getElementById('ft2-css')) {
      const s = document.createElement('style');
      s.id = 'ft2-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.view = document.createElement('div');
    this.view.className = 'ftv';
    this.view.style.display = 'none';
    this.cam = document.createElement('div');
    this.panel = document.createElement('div');
    this.panel.className = 'ft';
    this.view.appendChild(this.cam);
    this.cam.appendChild(this.panel);
    this.build();
    const stage = document.getElementById('stage');
    if (stage) stage.insertBefore(this.view, document.getElementById('voice'));
    this.setTrack(null);
    new ResizeObserver((es) => {
      const r = es[es.length - 1].contentRect;
      this.vw = r.width;
      this.vh = r.height;
    }).observe(this.view);
  }

  // ------------------------------------------------------------------------------------------ layout

  private build() {
    let h = '';
    const box = (x: number, y: number, w: number, hh: number, cls: string, c: string, extra = '') => {
      this.rects.push({ x, y, w, h: hh, c });
      h += `<div class="${cls}" style="left:${x}em;top:${y}em;width:${w}em;height:${hh}em${extra}"></div>`;
    };
    const text = (x: number, y: number, s: string, size = 8, cls = '', id = '', c = FT2.text) => {
      this.texts.push({ x, y, s, size, c, id: id || undefined });
      h += `<div style="left:${x}em;top:${y}em"><span${cls ? ` class="${cls}"` : ''}${id ? ` data-id="${id}"` : ''} style="font-size:${size}em">${esc(s)}</span></div>`;
    };
    const button = (x: number, y: number, w: number, hh: number, label: string, size = 7, on = false) => {
      this.rects.push({ x, y, w, h: hh, c: FT2.btn });
      this.texts.push({ x: x + w / 2 - (label.length * size * 0.3), y: y + (hh - size) / 2, s: label, size, c: '#000' });
      h += `<div class="b${on ? ' on' : ''}" style="left:${x}em;top:${y}em;width:${w}em;height:${hh}em;line-height:${hh}em"><span style="font-size:${size}em;line-height:${hh / size}">${esc(label)}</span></div>`;
    };

    // ---- left panel: position editor, song length, BPM / speed, pattern, the logo
    box(0, 0, 176, 176, 'p', FT2.desk);
    box(4, 4, 96, 56, 'i', FT2.black);
    box(5, 25, 94, 11, 'p', FT2.desk); // the current position
    for (let i = 0; i < 5; i++) text(16, 7 + i * 10.6, '00  00', 8.6, i === 2 ? '' : 'v', `po${i}`, i === 2 ? FT2.text : FT2.val);
    button(104, 4, 68, 16, 'Ins.', 8);
    button(104, 22, 33, 14, '↑', 8);
    button(139, 22, 33, 14, '↓', 8);
    button(104, 40, 68, 16, 'Del.', 8);
    text(6, 66, 'Songlen.', 8);
    text(76, 66, '20', 8, 'v', 'len', FT2.val);
    button(128, 64, 21, 12, '↑', 7);
    button(151, 64, 21, 12, '↓', 7);
    text(6, 80, 'Repstart', 8);
    text(76, 80, '00', 8, 'v', '', FT2.val);
    button(128, 78, 21, 12, '↑', 7);
    button(151, 78, 21, 12, '↓', 7);
    box(4, 94, 168, 2, 'i', FT2.black);
    text(6, 101, 'BPM', 8);
    text(34, 101, '125', 8, 'v', 'bpm', FT2.val);
    text(6, 115, 'Spd.', 8);
    text(40, 115, '06', 8, 'v', 'spd', FT2.val);
    text(6, 129, 'Add.', 8);
    text(40, 129, '01', 8, 'v', '', FT2.val);
    text(96, 101, 'Ptn.', 8);
    text(130, 101, '00', 8, 'v', 'ptn', FT2.val);
    text(96, 115, 'Ln.', 8);
    text(124, 115, '040', 8, 'v', '', FT2.val);
    button(96, 127, 37, 12, 'Expd.', 7);
    button(135, 127, 37, 12, 'Srnk.', 7);
    box(4, 144, 168, 28, 'i', FT2.black);
    text(13, 148, 'Fasttracker II', 14, 'logo');
    text(136, 164, 'EFFACED.XM', 4.4, 'v', '', FT2.val);

    // ---- middle: transport buttons, the info line, the scopes (holes: the GL draws them)
    box(176, 0, 206, 52, 'p', FT2.desk);
    const labels = ['Play sng.', 'Play ptn.', 'Stop', 'Rec. sng.', 'Disk op.', 'Instr. Ed.', 'Smp. Ed.', 'Config'];
    labels.forEach((l, k) => button(180 + (k % 4) * 49.5, 4 + Math.floor(k / 4) * 17, 47.5, 15, l, 6.6, k === 0));
    text(181, 40, 'Avail 0(65536)k', 7);
    text(296, 40, 'Time 00:00:00', 7, '', 'time');
    const sw = SCOPES.w / SCOPES.cols, sh = SCOPES.h / SCOPES.rows;
    for (let c = 0; c < CH; c++) {
      const x = SCOPES.x + (c % SCOPES.cols) * sw, y = SCOPES.y + Math.floor(c / SCOPES.cols) * sh;
      this.rects.push({ x, y, w: sw, h: sh, c: FT2.black });
      h += `<div class="sc" style="left:${x}em;top:${y}em;width:${sw}em;height:${sh}em"></div>`;
      text(x + 3, y + 3, String(c + 1), 7, c === GHOST ? 'g' : '', '', c === GHOST ? FT2.ghost : FT2.text);
    }

    // ---- right: the instrument list (the diary), the sample list, the song name
    box(382, 0, 258, 176, 'p', FT2.desk);
    for (let col = 0; col < 2; col++) {
      const x0 = 386 + col * 127;
      box(x0, 4, 17, 92, 'i', FT2.black);
      box(x0 + 18, 4, 105, 92, 'i', FT2.black);
      for (let i = 0; i < 8; i++) {
        const n = col * 8 + i;
        text(x0 + 2.5, 7 + i * 11, hx(n + 1), 8, '', '', FT2.text);
        text(x0 + 20, 7.6 + i * 11, ''.padEnd(22), 7.2, '', `in${n}`);
      }
    }
    h += `<div class="sel" style="left:386em;top:5.5em;width:123em;height:11em"></div>`;
    box(386, 100, 17, 52, 'i', FT2.black);
    box(404, 100, 232, 52, 'i', FT2.black);
    for (let i = 0; i < 5; i++) {
      text(388.5, 102.5 + i * 10, hx(i), 7.6);
      text(407, 103 + i * 10, ''.padEnd(32), 7.2, i ? '' : 'v', `sm${i}`, i ? FT2.text : FT2.val);
    }
    box(386, 156, 250, 16, 'i', FT2.black);
    text(390, 159.5, ''.padEnd(20), 9.2, '', 'song');

    // ---- the pattern editor
    box(0, 176, 640, 224, 'p', FT2.desk);
    box(2, PE.y, 22, PE.h, 'i', FT2.black);
    box(616, PE.y, 22, PE.h, 'i', FT2.black);
    this.rects.push({ x: PE.x, y: PE.y, w: PE.w, h: PE.h, c: FT2.black });
    h += `<div class="clip" style="left:${PE.x}em;top:178em;width:${PE.w}em;height:10em"><div class="mv" data-id="head"></div></div>`;
    // behind the text: black columns with blue separators (they scroll with the channel window) and
    // the play-row band — no blend modes anywhere (each would make the 3D panel a render surface)
    h += `<div class="clip" style="left:${PE.x}em;top:${PE.y}em;width:${PE.w}em;height:${PE.h}em"><div class="mv bk" data-id="bk" style="width:${CH * CHW}em;height:${PE.h}em"></div></div>`;
    h += `<div class="band" data-id="band" style="left:2em;top:${PE.y + 9 * ROWH}em;width:636em;height:${ROWH}em"></div>`;
    h += `<div class="clip" style="left:${PE.x}em;top:${PE.y}em;width:${PE.w}em;height:${PE.h}em" data-id="pv"></div>`;
    h += `<div class="clip rn" style="left:2em;top:${PE.y}em;width:22em;height:${PE.h}em" data-id="rnL"></div>`;
    h += `<div class="clip rn" style="left:616em;top:${PE.y}em;width:22em;height:${PE.h}em" data-id="rnR"></div>`;
    h += `<div class="clip" style="left:${PE.x}em;top:${PE.y + 9 * ROWH}em;width:${PE.w}em;height:${ROWH}em"><div class="mv" data-id="gwrap"><span class="g" data-id="ghost" style="position:absolute;left:${GHOST * CHW}em;top:0;line-height:${ROWH}em;background:${FT2.desk};display:none"></span></div></div>`;
    button(4, 388, 20, 10, '◄', 6);
    button(616, 388, 20, 10, '►', 6);
    box(PE.x, 388, PE.w, 10, 'i', FT2.black);
    h += `<div style="left:${PE.x + 1}em;top:389em;width:${(PE.w * VIS) / CH - 2}em;height:8em;background:${FT2.val};will-change:transform" data-id="thumb"></div>`;
    // the hall's air in front of the screen: two fixed gradients whose opacities follow the camera
 h += `<div class="fl" data-id="flash"></div>`;
    h += `<div class="fz" data-id="fz0" style="background:linear-gradient(to left,transparent,${HAZE})"></div>`;
    h += `<div class="fz" data-id="fz1" style="background:linear-gradient(to right,transparent,${HAZE})"></div>`;
    this.panel.innerHTML = h;

    for (const e of Array.from(this.panel.querySelectorAll<HTMLElement>('[data-id]'))) this.el.set(e.dataset.id!, e);
    for (const [id, e] of this.el) this.txt.set(id, e.textContent ?? '');
    this.head = this.el.get('head') as HTMLDivElement;
    this.gwrap = this.el.get('gwrap') as HTMLDivElement;
    this.bk = this.el.get('bk') as HTMLDivElement;
    this.ghostEl = this.el.get('ghost') as HTMLSpanElement;
    this.band = this.el.get('band') as HTMLDivElement;
    this.flash = this.el.get('flash') as HTMLDivElement;
    this.thumb = this.el.get('thumb') as HTMLDivElement;
    this.selA = this.panel.querySelector('.sel') as HTMLDivElement;
    this.fog = [this.el.get('fz0') as HTMLDivElement, this.el.get('fz1') as HTMLDivElement];
    // channel numbers above the columns (they scroll with the channel window)
    this.head.innerHTML = Array.from({ length: CH }, (_, c) =>
      `<span${c === GHOST ? ' class="g"' : ''} style="position:absolute;left:${(c * CHW + 4) / 7}em;top:${1.6 / 7}em;font-size:7em">${c + 1}</span>`).join('');
    // two buffers of pattern rows and row numbers
    const pv = this.el.get('pv')!, rnL = this.el.get('rnL')!, rnR = this.el.get('rnR')!;
    for (let i = 0; i < 2; i++) {
      const b = document.createElement('div');
      b.className = 'mv';
      b.style.visibility = i ? 'hidden' : '';
      pv.appendChild(b);
      this.blocks.push(b);
      for (const [k, side] of [rnL, rnR].entries()) {
        const n = document.createElement('div');
        n.className = 'mv';
        n.style.width = `${22 / 8}em`; // in its own em (the 8 px row-number font)
        n.style.visibility = i ? 'hidden' : '';
        side.appendChild(n);
        this.nums[k].push(n);
      }
    }
    // the pattern text size: 14 monospace cells per channel column, measured
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;font-size:100px;visibility:hidden';
    probe.textContent = 'M'.repeat(100);
    this.panel.appendChild(probe);
    const hidden = this.view.style.display === 'none';
    if (hidden) this.view.style.display = '';
    const adv = probe.getBoundingClientRect().width / 100 / 100; // advance per em
    if (hidden) this.view.style.display = 'none';
    probe.remove();
    const fs = CHW / 14 / (adv || 0.6);
    for (const b of this.blocks) b.style.fontSize = `${fs}em`;
    this.ghostEl.style.fontSize = `${fs}em`;
    this.ghostEl.style.lineHeight = `${ROWH / fs}`;
    this.ghostEl.style.left = `${(GHOST * CHW) / fs}em`;
    this.blockFont = fs;
    for (const s of this.nums) for (const n of s) n.style.fontSize = '8em';
  }
  private blockFont = 8.75;

  private set(id: string, text: string, color?: string) {
    const e = this.el.get(id);
    if (!e || this.txt.get(id) === text) return;
    e.textContent = text;
    this.txt.set(id, text);
    const t = this.texts.find((x) => x.id === id);
    if (t) (t.s = text), color && (t.c = color);
    this.dirty = true;
  }

  setTrack(track: TrackInfo | null) {
    // the render's track and the module read in the loader are the same song: keep what's built
    const same = (a: TrackInfo | null, b: TrackInfo | null) =>
      !!a && !!b && a.title === b.title && a.patterns.length === b.patterns.length &&
      a.order.join() === b.order.join() && a.instruments.join('\n') === b.instruments.join('\n');
    if (same(this.track, track)) {
      this.track = track;
      return;
    }
    this.track = track;
    this.patCache.clear();
    this.blockOf = [-2, -2];
    this.lastKey = '';
    this.set('song', (track?.title || 'EFFACED').slice(0, 20));
    this.set('len', hx(track?.order.length ?? 32));
    for (let i = 0; i < 16; i++) this.set(`in${i}`, (track?.instruments[i] ?? '').slice(0, 22));
  }

  private patternText(p: number): string[] {
    let s = this.patCache.get(p);
    if (s) return s;
    const pat = this.track?.patterns[p];
    const n = this.track?.channels ?? CH;
    s = [];
    for (let r = 0; r < 64; r++)
      for (let c = 0; c < CH; c++) s.push(pat && c < n ? cellText(pat.cells[r * n + c]) : EMPTY);
    this.patCache.set(p, s);
    return s;
  }

  /** one row of pattern p (the ghost's column stays empty: it only shows through at the play row) */
  private rowLine(p: number, r: number, dim: boolean) {
    const text = p >= 0 ? this.patternText(p) : null;
    let line = '';
    for (let c = 0; c < CH; c++) line += ' ' + (text && c !== GHOST ? text[r * CH + c] : EMPTY);
    return `<div class="row${dim ? ' d' : ''}">${esc(line)}</div>`;
  }

  /** block i for order position pos: 9 rows of the previous position (dim), 00–3F, 9 of the next */
  private fillBlock(i: number, pos: number) {
    const o = this.track?.order;
    const pat = o?.[pos] ?? -1, prev = o?.[pos - 1] ?? -1, next = o?.[pos + 1] ?? -1;
    const empty = `<div class="row"></div>`;
    let h = '', nums = '';
    const num = (r: number, d: boolean) => `<div class="${d ? 'd' : r % 4 === 0 ? 'w' : ''}">${hx(r)}</div>`;
    for (let r = 64 - PAD; r < 64; r++) (h += prev >= 0 ? this.rowLine(prev, r, true) : empty), (nums += num(r, true));
    for (let r = 0; r < 64; r++) (h += this.rowLine(pat, r, false)), (nums += num(r, false));
    for (let r = 0; r < PAD; r++) (h += next >= 0 ? this.rowLine(next, r, true) : empty), (nums += num(r, true));
    this.blocks[i].innerHTML = h;
    this.nums[0][i].innerHTML = nums;
    this.nums[1][i].innerHTML = nums;
    this.blockOf[i] = pos;
  }

  private showBlock(pos: number) {
    let i = this.blockOf.indexOf(pos);
    if (i < 0) this.fillBlock((i = 1 - this.front), pos);
    if (i !== this.front) {
      for (const set of [this.blocks, this.nums[0], this.nums[1]]) {
        set[this.front].style.visibility = 'hidden';
        set[i].style.visibility = '';
      }
      this.front = i;
    }
    this.lastRow = -1;
  }

  show(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    this.view.style.display = on ? '' : 'none';
  }

  /**
   * Lay out and raster the panel before its scene: shown at opacity 0.001 (invisible, but Chrome
   * rasters it) at the scene's first camera, with the first pattern block in place — so the cut
   * doesn't pay for the first layout and the GPU raster of 2.3 Mpx of text.
   */
  prime(play: HudPlay, place: () => void) {
    this.view.style.display = '';
    this.shown = true;
    this.setOpacity(0.001);
    place();
    this.update(play);
  }

  /**
   * The channel window: on each bar line it moves to where the notes are (the 8 consecutive
   * channels with the most notes in the coming bar); whenever the ghost has a note close ahead it
   * swings over to show channel 17.
   */
  private channelWindow(pos: number, row: number): number {
    const tr = this.track;
    if (!tr) return 0;
    if (this.ghostAhead(pos, row)) return GHOST + 1 - VIS; // channels 10–17: lead, echo, counter-line … the ghost
    // melodic channels weigh more than the hats: the window should show the music, not just the grid
    const W = [1, 1, 0.5, 1, 1, 0.8, 1.2, 1.2, 1.2, 2.5, 1.6, 2, 1.5, 1.2, 1, 1];
    const counts = new Array<number>(16).fill(0);
    for (let g = Math.max(0, pos * 64 + row - 2); g < pos * 64 + row + 14; g++) {
      const p = tr.order[g >> 6];
      if (p === undefined) continue;
      const text = this.patternText(p);
      for (let c = 0; c < 16; c++) if (isNote(text[(g & 63) * CH + c])) counts[c] += W[c];
    }
    const score = (s: number) => {
      let n = 0;
      for (let c = s; c < s + VIS; c++) n += counts[c];
      return n;
    };
    let best = 0, bestN = -1;
    for (let s = 0; s <= 16 - VIS; s++) {
      const n = score(s);
      if (n > bestN + 1) (bestN = n), (best = s); // the leftmost window unless another is clearly busier
    }
    // stay put unless the new window is clearly busier (every swing makes Chrome raster new tiles)
    const cur = Math.round(this.winTarget);
    if (cur <= 16 - VIS && score(cur) * 1.35 >= bestN) return cur;
    return best;
  }

  /** follow the song: cheap unless the row changed */
  update(play: HudPlay) {
    this.play = play;
    const tr = this.track;
    const pat = tr ? tr.order[play.pos] ?? -1 : -1;
    if (play.pos !== this.blockOf[this.front]) this.showBlock(play.pos);
    if (play.row === 40 && tr && !this.blockOf.includes(play.pos + 1)) this.fillBlock(1 - this.front, play.pos + 1);
    // the channel window: re-aimed on bar lines (and whenever the ghost is due), glides there
    const bar = play.pos * 4 + (play.row >> 4);
    const ghostSoon = this.ghostAhead(play.pos, play.row);
    if (bar !== this.winBar || ghostSoon !== this.winGhost) {
      this.winGhost = ghostSoon;
      this.winBar = bar;
      this.winTarget = this.channelWindow(play.pos, play.row);
    }
    const dt = this.lastT < 0 ? 1 : Math.min(0.1, Math.abs(play.t - this.lastT));
    this.lastT = play.t;
    this.win += (this.winTarget - this.win) * (1 - Math.exp(-dt / 0.09));
    if (Math.abs(this.win - this.winTarget) < 0.002) this.win = this.winTarget;
    const x = (-this.win * CHW).toFixed(2);
    const y = -(play.row + PAD - 9) * ROWH;
    const bfs = this.blockFont;
    const b = this.blocks[this.front];
    // the blocks' em is the pattern font: convert
    const tfb = `translate(${(-this.win * CHW / bfs).toFixed(4)}em,${(y / bfs).toFixed(4)}em)`;
    if (b.style.transform !== tfb) b.style.transform = tfb;
    const tfn = `translateY(${(y / 8).toFixed(4)}em)`;
    for (const k of [0, 1]) if (this.nums[k][this.front].style.transform !== tfn) this.nums[k][this.front].style.transform = tfn;
    const tx = `translateX(${x}em)`;
    if (this.head.style.transform !== tx) (this.head.style.transform = tx), (this.gwrap.style.transform = tx), (this.bk.style.transform = tx);
    const th = `translateX(${((this.win / CH) * PE.w).toFixed(2)}em)`;
    if (this.thumb.style.transform !== th) this.thumb.style.transform = th;
    if (play.row !== this.lastRow) {
      this.lastRow = play.row;
      this.dirty = true;
    }

    const text = pat >= 0 ? this.patternText(pat) : null;
    // the ghost shows through for ~5 frames after its note reaches the play row
    const gcell = text ? text[play.row * CH + GHOST] : EMPTY;
    const ghostOn = !!text && isNote(gcell) && play.rowT < 0.045;
    const sec = Math.floor(play.t);
    const key = `${play.pos}:${play.row}:${ghostOn ? 1 : 0}:${sec}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (ghostOn) this.ghostEl.textContent = ' ' + gcell;
    this.ghostEl.style.display = ghostOn ? '' : 'none';
    const o = tr?.order ?? [];
    for (let i = 0; i < 5; i++) {
      const p = play.pos + i - 2;
      this.set(`po${i}`, p >= 0 && p < o.length ? `${hx(p)}  ${hx(o[p])}` : '');
    }
    this.set('ptn', hx(Math.max(0, pat)));
    const t = Math.max(0, play.t);
    this.set('time', `Time ${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`);
    // the instrument of the latest note on the play row: selected in the list, its sample shown
    if (text) {
      for (let c = 0; c < 16; c++) {
        const ins = parseInt(text[play.row * CH + c].slice(4, 6), 16);
        if (ins > 0 && ins <= 18) {
          if (ins !== this.sel) {
            this.sel = ins;
            const k = ins - 1;
            if (k < 16) this.selA.style.transform = `translate(${Math.floor(k / 8) * 127}em,${(k % 8) * 11}em)`;
            this.set('sm0', SYNTH[ins] ?? '');
          }
          break;
        }
      }
    }
  }

  private ghostAhead(pos: number, row: number) {
    const tr = this.track;
    if (!tr) return false;
    // from 6 rows before its note (the window needs a moment to get there) to 4 rows after
    for (let g = pos * 64 + row - 4; g <= pos * 64 + row + 6; g++) {
      const p = tr.order[g >> 6];
      if (p === undefined || g < 0) continue;
      if (isNote(this.patternText(p)[(g & 63) * CH + GHOST])) return true;
    }
    return false;
  }

  /**
   * The scopes (GL): per channel amplitude, cycles across the scope, waveform, ghost glow.
   * env: the channel envelopes (f.S) when the music is rendered, else note-on decays from the pattern.
   */
  updateScopes(t: number, env: Float32Array | null) {
    const tr = this.track;
    const p = this.play;
    const g0 = p.pos * 64 + p.row;
    for (let c = 0; c < CH; c++) {
      // the latest note on this channel (scan back up to two bars)
      let note = 0, ins = 0, age = 99;
      if (tr)
        for (let g = g0; g > g0 - 32 && g >= 0; g--) {
          const pat = tr.patterns[tr.order[g >> 6]];
          const cell = pat?.cells[(g & 63) * tr.channels + c];
          if (cell && cell.note > 0 && cell.note < 97) {
            note = cell.note;
            ins = cell.ins || ins;
            age = t - g * 0.12;
            break;
          }
        }
      const slot = Math.min(18, ins || [12, 13, 14, 15, 10, 11, 1, 3, 9, 6, 6, 3, 7, 9, 17, 16, 18, 0][c]);
      const fallback = age < 0 ? 0 : Math.exp(-age / (SUSTAIN[slot] ?? 1)) * 0.8;
      const a = env ? Math.min(1, (env[c] ?? 0) * 3.2) : fallback;
      const hz = note ? 440 * 2 ** ((note + 11 - 69) / 12) : 110;
      this.scopes[c * 4] = c === CH - 1 ? 0 : a;
      this.scopes[c * 4 + 1] = Math.min(9, Math.max(1, hz / 110));
      this.scopes[c * 4 + 2] = SHAPE[slot] ?? 0;
      this.scopes[c * 4 + 3] = c === GHOST ? Math.min(1, a * 4) : 0;
    }
  }

  // --- the GL's copy: plain pixels (no canvas, no fonts — nothing that can stall a frame). Text is
  // drawn as ink blocks: the copy is only seen blurred (floor reflection, bloom, the room's light).
  private fill(r: number, g: number, b: number, x0: number, y0: number, x1: number, y1: number, a = 1) {
    const k = HUD_TEX_W / FT_W, P = this.pixels;
    const X0 = Math.max(0, Math.round(x0 * k)), X1 = Math.min(HUD_TEX_W, Math.round(x1 * k));
    const Y0 = Math.max(0, Math.round(y0 * k)), Y1 = Math.min(HUD_TEX_H, Math.round(y1 * k));
    for (let y = Y0; y < Y1; y++)
      for (let x = X0, i = (y * HUD_TEX_W + X0) * 4; x < X1; x++, i += 4) {
        P[i] += (r - P[i]) * a;
        P[i + 1] += (g - P[i + 1]) * a;
        P[i + 2] += (b - P[i + 2]) * a;
        P[i + 3] = 255;
      }
  }
  private ink(s: string, x: number, y: number, size: number, c: string, adv = 0.6) {
    const [r, g, b] = rgb(c);
    const w = size * adv;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === ' ') continue;
      const dot = ch === DOT;
      this.fill(r, g, b, x + i * w + w * 0.15, y + size * (dot ? 0.4 : 0.15), x + (i + 1) * w - w * 0.1, y + size * (dot ? 0.55 : 0.85), dot ? 0.25 : 0.55);
    }
  }

  /** redraw the GL's copy of the screen (at most every `every` s); true if it changed */
  bake(t: number, every = 0.25): boolean {
    if (!this.dirty || (this.lastBake >= 0 && Math.abs(t - this.lastBake) < every)) return false;
    this.dirty = false;
    this.lastBake = t;
    if (!this.base) {
      this.pixels.fill(255);
      const [r, g, b] = rgb(FT2.desk);
      this.fill(r, g, b, 0, 0, FT_W, FT_H);
      for (const q of this.rects) {
        const [r2, g2, b2] = rgb(q.c);
        this.fill(r2, g2, b2, q.x, q.y, q.x + q.w, q.y + q.h);
      }
      for (const x of this.texts) if (!x.id) this.ink(x.s, x.x, x.y, x.size, x.c);
      this.base = this.pixels.slice();
    }
    this.pixels.set(this.base);
    for (const x of this.texts) if (x.id) this.ink(x.s, x.x, x.y, x.size, x.c);
    // the visible window of the pattern
    const tr = this.track, p = this.play;
    const c0 = Math.round(this.win);
    const [dr, dg, db] = rgb(FT2.desk);
    for (let i = 0; i < PROWS; i++) {
      const g = p.pos * 64 + p.row - 9 + i;
      const pat = g >= 0 && tr ? tr.order[g >> 6] : undefined;
      const y = PE.y + i * ROWH;
      if (i === 9) this.fill(dr, dg, db, 2, y, 638, y + ROWH);
      if (pat === undefined) continue;
      const text = this.patternText(pat);
      const col = (g >> 6) === p.pos ? FT2.val : FT2.dim;
      for (let c = 0; c < VIS; c++) {
        const ch = c0 + c;
        if (ch >= CH || ch === GHOST) continue;
        this.ink(text[(g & 63) * CH + ch], PE.x + c * CHW + this.blockFont * 0.6, y + 1.5, this.blockFont, col);
      }
    }
    return true;
  }

  /**
   * Lock the panel to the GL camera. view: world→camera (column-major 4×4, metres), fovY radians.
   * centre/right/up: the panel's world placement (unit right/up axes in the wall plane).
   */
  place(view: Float32Array | number[], fovY: number, centre: number[], right: number[], up: number[]) {
    // the view is the stage (100vw × 100vh): the window size needs no layout read in the frame loop
    const W = this.vw || innerWidth, H = this.vh || innerHeight;
    if (!W || !H) return;
    const K = 100; // CSS px per metre
    const fovPx = (0.5 * H) / Math.tan(fovY / 2);
    const persp = `${fovPx}px`;
    if (this.view.style.perspective !== persp) this.view.style.perspective = persp;
    const e = view;
    const f = (v: number) => (Math.abs(v) < 1e-10 ? 0 : v);
    // camera: view matrix (translation in px) with the Y row negated (CSS y points down)
    const cm = [
      e[0], -e[1], e[2], e[3],
      e[4], -e[5], e[6], e[7],
      e[8], -e[9], e[10], e[11],
      e[12] * K, -e[13] * K, e[14] * K, e[15],
    ].map(f);
    this.cam.style.width = `${W}px`;
    this.cam.style.height = `${H}px`;
    this.cam.style.transform = `translateZ(${fovPx}px) matrix3d(${cm.join(',')}) translate(${W / 2}px,${H / 2}px)`;
    // object: CSS px → metres → px, Y column negated
    const sx = (this.worldW / (FT_W * U)) * K, sy = (this.worldH / (FT_H * U)) * K;
    const n = [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]];
    const om = [
      right[0] * sx, right[1] * sx, right[2] * sx, 0,
      -up[0] * sy, -up[1] * sy, -up[2] * sy, 0,
      n[0], n[1], n[2], 0,
      centre[0] * K, centre[1] * K, centre[2] * K, 1,
    ].map(f);
    const tr = `translate(-50%,-50%) matrix3d(${om.join(',')})`;
    if (this.panel.style.transform !== tr) this.panel.style.transform = tr;
  }

  /**
   * Brightness of the panel above 1 (the eye adapting, the crash flashes): a white veil whose opacity
   * the compositor changes for free — a CSS filter would re-render the whole 3D panel every frame.
   */
  setBrightness(b: number) {
    const v = (Math.round(Math.min(0.6, Math.max(0, (b - 1) * 0.45)) * 100) / 100).toString();
    if (this.flash.style.opacity !== v) this.flash.style.opacity = v;
  }

  /** the play-row band breathes with the ride (opacity only: compositor work) */
  setPulse(p: number) {
    const v = (0.8 + 0.2 * Math.min(1, p)).toFixed(2);
    if (this.band.style.opacity !== v) this.band.style.opacity = v;
  }

  /** haze in front of the panel: a0 at its left end, a1 at its right end */
  setFog(a0: number, a1: number) {
    const v = [a0, a1].map((a) => (Math.round(Math.min(1, Math.max(0, a)) * 200) / 200).toString());
    if (this.fog[0].style.opacity !== v[0]) this.fog[0].style.opacity = v[0];
    if (this.fog[1].style.opacity !== v[1]) this.fog[1].style.opacity = v[1];
  }

  setOpacity(a: number) {
    const v = a.toFixed(3);
    if (this.view.style.opacity !== v) this.view.style.opacity = v;
  }

  destroy() {
    this.view.remove();
  }
}
