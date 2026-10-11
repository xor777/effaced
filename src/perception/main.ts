// EFFACED · perception lab — calibration of the two illusions that carry the story:
// S8 lilac chaser (green phantom) and S14→S15 portrait → afterimage (#FACE, never on screen).

import { defaults, mergeParams, clone, ROW, type Params, type Mode } from './params.ts';
import { createCtx, setSpace, type Ctx } from './gl.ts';
import {
  createRenderer, drawLilac, drawFace, drawHybrid, drawDrift, lilacColors, faceColors, isoluminantGray, matchHue,
  type Renderer,
} from './render.ts';
import { lilacTotal, faceTotal, faceS14, eraseSteps, lilacDuration, type LilacFrame, type FaceFrame } from './timeline.ts';
import { Meter, stats } from './meter.ts';
import { Trial } from './trial.ts';
import { buildUi, R, trialSetup, type Ui } from './ui.ts';
import * as store from './store.ts';
import { rgb2hex, css } from './color.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $<HTMLDivElement>('stage');
const canvas = $<HTMLCanvasElement>('gl');
const hintEl = $<HTMLDivElement>('hint');
const codaEl = $<HTMLDivElement>('coda');
const debugEl = $<HTMLPreElement>('debug');
const safeEl = $<HTMLDivElement>('safe');

let P: Params = mergeParams(defaults(), store.loadParams());
P.g.time = 0;

let ctx: Ctx;
let rr: Renderer;
try {
  ctx = createCtx(canvas, P.g.colorSpace);
  rr = createRenderer(ctx);
} catch (e) {
  const err = $('err');
  err.style.display = 'grid';
  err.textContent = String((e as Error).message ?? e);
  throw e;
}

// ---- frame geometry: the largest 16:10 rect (fullscreen on the target = exactly 1512×945 CSS px)
let cssW = 0, cssH = 0;
function layout() {
  const W = innerWidth, H = innerHeight;
  if (P.g.frame1610) {
    cssW = Math.min(W, H * 1.6);
    cssH = cssW / 1.6;
  } else (cssW = W), (cssH = H);
  Object.assign(stage.style, { width: `${cssW}px`, height: `${cssH}px`, left: `${(W - cssW) / 2}px`, top: `${(H - cssH) / 2}px` });
  // first guess; the ResizeObserver below replaces it with the exact device-pixel box
  canvas.width = Math.round(cssW * devicePixelRatio);
  canvas.height = Math.round(cssH * devicePixelRatio);
  safeEl.style.display = P.g.safeZone ? 'block' : 'none';
  debugEl.style.display = P.g.debug ? 'block' : 'none';
}
const ro = new ResizeObserver((entries) => {
  for (const e of entries) {
    const dp = e.devicePixelContentBoxSize?.[0];
    canvas.width = dp ? dp.inlineSize : Math.round(e.contentRect.width * devicePixelRatio);
    canvas.height = dp ? dp.blockSize : Math.round(e.contentRect.height * devicePixelRatio);
  }
});
ro.observe(canvas, { box: 'device-pixel-content-box' });
window.addEventListener('resize', layout);
layout();

// ---- state
const meter = new Meter();
let lastLilac: LilacFrame | null = null;
let lastFace: FaceFrame | null = null;
let lastDof = 0;
let lastTs = -1;
let frameNo = 0;
let saveTimer = 0;

const totalFor = (m: Mode) => (m === 'lilac' ? lilacTotal(P.lilac) : m === 'face' ? faceTotal(P.face) : 30);

const trial = new Trial({
  layer: $('layer'),
  params: () => P,
  env: () => ({
    canvas: `${canvas.width}×${canvas.height}`,
    css: `${Math.round(cssW)}×${Math.round(cssH)}`,
    dpr: devicePixelRatio,
    screen: `${screen.width}×${screen.height}`,
    fullscreen: !!document.fullscreenElement,
    buffer: ctx.space,
    gamutP3: matchMedia('(color-gamut: p3)').matches,
    dynamicRangeHigh: matchMedia('(dynamic-range: high)').matches,
    refreshHz: Math.round(meter.hz() * 10) / 10,
    ua: navigator.userAgent,
  }),
  timing: () => meter.summary(),
  onStateChange: () => {
    document.body.classList.toggle('trial', trial.active);
    document.body.classList.toggle('running', trial.state === 'run' || trial.state === 'ready');
    if (trial.state === 'run') meter.reset();
  },
  onSaved: () => (R.results = String(store.loadResults().length)),
});

// ---- UI
const ui: Ui = buildUi($('pane'), P, {
  changed: (key) => {
    if (key === 'space') setSpace(ctx, P.g.colorSpace);
    if (key === 'frame') layout();
    if (key === 'total') ui.rebuildTime();
    scheduleSave();
  },
  modeChanged: () => {
    ui.showMode(P.g.mode);
    ui.rebuildTime();
    restart();
  },
  restart: () => restart(),
  totalFor,
  lilacReset: () => {
    Object.assign(P.lilac, { hue: 255.9, sat: 0.64, light: 0.804 });
    ui.refreshAll();
    scheduleSave();
  },
  lilacIsoluminant: () => {
    P.lilac.bgGray = Math.round(isoluminantGray(P.lilac) * 1000) / 1000;
    ui.refreshAll();
    scheduleSave();
  },
  faceMatchHue: () => {
    P.face.hue = matchHue(P.face, ctx.space);
    ui.refreshAll();
    scheduleSave();
  },
  jumpToCut: () => {
    P.g.mode = 'face';
    ui.showMode('face');
    ui.rebuildTime();
    P.g.time = P.face.preRoll + faceS14(P.face) - 2;
    ui.refreshAll();
  },
  runTrial: () => {
    trial.begin({
      kind: trialSetup.kind,
      informed: trialSetup.informed,
      participant: trialSetup.participant,
      condition: trialSetup.condition,
      checklist: {
        trueToneOff: trialSetup.trueToneOff,
        nightShiftOff: trialSetup.nightShiftOff,
        autoBrightnessOff: trialSetup.autoBrightnessOff,
        dndOn: trialSetup.dndOn,
        naive: trialSetup.naive,
      },
    });
  },
  exportResults: () => store.download(`effaced-perception-results-${store.stamp()}.json`, store.loadResults()),
  clearResults: () => {
    if (confirm('Delete all saved trial results from this browser? Export them first if you need them.')) {
      store.saveResults([]);
      R.results = '0';
    }
  },
  presetSave: (name) => {
    const all = store.loadPresets();
    all[name] = { saved: new Date().toISOString(), params: clone(P) };
    store.savePresets(all);
  },
  presetLoad: (name) => {
    const pr = store.loadPresets()[name];
    if (!pr) return;
    applyParams(pr.params);
  },
  presetDelete: (name) => {
    const all = store.loadPresets();
    delete all[name];
    store.savePresets(all);
  },
  presetNames: () => Object.keys(store.loadPresets()),
  presetsExport: () => store.download(`effaced-perception-presets-${store.stamp()}.json`, store.loadPresets()),
  presetsImport: async () => {
    try {
      const data = (await store.pickJSON()) as store.Presets;
      store.savePresets({ ...store.loadPresets(), ...data });
      ui.rebuildPresetList();
    } catch (e) {
      console.warn('preset import failed', e);
    }
  },
  resetAll: () => {
    if (confirm('Reset all parameters to the defaults?')) applyParams(defaults());
  },
});
R.results = String(store.loadResults().length);

/** copy values into the live params object (the pane is bound to these exact objects) */
function applyParams(src: unknown) {
  const fresh = mergeParams(defaults(), src);
  for (const k of Object.keys(P) as (keyof Params)[]) Object.assign(P[k], fresh[k]);
  P.g.time = 0;
  setSpace(ctx, P.g.colorSpace);
  layout();
  ui.showMode(P.g.mode);
  ui.rebuildTime();
  ui.refreshAll();
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => store.saveParams(P), 300);
}

function restart() {
  P.g.time = 0;
  meter.reset();
  ui.refreshTime();
}

$('note-ok').addEventListener('click', () => $('note').classList.add('hidden'));
window.addEventListener('keydown', (e) => {
  if (trial.active || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
  if (e.code === 'KeyH') $('pane').style.display = $('pane').style.display === 'none' ? '' : 'none';
  else if (e.code === 'KeyD') (P.g.debug = !P.g.debug), layout(), ui.refreshAll();
  else if (e.code === 'KeyR') restart();
  else if (e.code === 'Space') {
    e.preventDefault();
    P.g.playing = !P.g.playing;
    ui.refreshAll();
  } else if (e.code === 'KeyF') document.documentElement.requestFullscreen().catch(() => {});
});

// ---- overlays (DOM "voice" text, sized relative to the 945-px-tall target frame)
function setVoice(el: HTMLElement, text: string, alpha: number, color: string, sizePx: number, offsetH: number) {
  if (alpha <= 0) {
    if (el.style.opacity !== '0') el.style.opacity = '0';
    return;
  }
  const k = cssH / 945;
  el.textContent = text;
  el.style.opacity = String(alpha);
  el.style.color = color;
  el.style.fontSize = `${sizePx * k}px`;
  el.style.top = `${(0.5 + offsetH) * cssH - 0.6 * sizePx * k}px`;
}

// ---- readouts
const deg = (h: number) => {
  // physical frame height: device px / 254 ppi (MacBook Pro 14" Liquid Retina XDR)
  const cm = (canvas.height / 254) * 2.54;
  return (Math.atan((h * cm) / P.g.viewDistanceCm) * 180) / Math.PI;
};
function readouts() {
  R.space = `${ctx.space}${P.g.colorSpace !== ctx.space ? ' (requested ' + P.g.colorSpace + ')' : ''} · P3 display: ${matchMedia('(color-gamut: p3)').matches}`;
  R.frame = `${canvas.width}×${canvas.height} px · ${(meter.hz() || 0).toFixed(1)} Hz`;
  const lc = lilacColors(P.lilac, ctx.space);
  const dY = lc.Yd - lc.Yb;
  R.lilacColour = `disc ${rgb2hex(lc.discEnc)} (sRGB) Y=${lc.Yd.toFixed(3)}\nbg ${rgb2hex([P.lilac.bgGray, P.lilac.bgGray, P.lilac.bgGray])} Y=${lc.Yb.toFixed(3)}\nhint ${lc.hintCss}`;
  R.lilacSafety = `ΔY disc/bg = ${dY.toFixed(3)} → ${Math.abs(dY) < 0.1 ? 'not a WCAG flash (<0.10)' : 'WARNING ≥ 0.10 at 8.3 Hz'}\n(each disc ≈ ${(2 * deg(P.lilac.discRadius)).toFixed(1)}°, small area)`;
  R.lilacSize = `ring r ${deg(P.lilac.ringRadius).toFixed(1)}° · disc r ${deg(P.lilac.discRadius).toFixed(2)}° · σ ${deg(P.lilac.blurSigma).toFixed(2)}°\n@ ${P.g.viewDistanceCm} cm`;
  const s = stats(meter.stepMs);
  R.lilacTiming = s.n
    ? `step ${s.mean.toFixed(2)} ms (sd ${s.sd.toFixed(2)}, ${s.min.toFixed(1)}–${s.max.toFixed(1)}) n=${s.n}\nframes/step ${meter.histogram()}\ntarget ${(P.lilac.stepTime * 1000).toFixed(1)} ms · rev ${(P.lilac.stepTime * 12).toFixed(2)} s`
    : 'play S8 to measure';
  const fc = faceColors(P.face, ctx.space);
  R.faceColour = `${fc.skinCss}\nsRGB: ${fc.sRGBhex}${fc.clipped ? ' · CLIPPED in this buffer' : ''}\nY = ${(fc.Ys * 100).toFixed(1)} % of white`;
  const dh = ((fc.predHue - fc.faceHue + 540) % 360) - 180;
  R.facePred = `≈ ${fc.predHex} (hue-normalised)\n${(fc.predY * 100).toFixed(0)} % of white (>100 = glows)\nOKLab hue Δ to #FACE ${dh.toFixed(1)}°`;
  if (lastFace)
    R.faceSeq = `${lastFace.scene} ${lastFace.stage} t=${lastFace.local.toFixed(2)} s row ${lastFace.row.toFixed(1)}\nsince cut ${lastFace.sinceCut.toFixed(2)} s`;
  const st = eraseSteps(P.face);
  R.faceFix = st.length ? `${st.length} steps, rows ${st[0]}–${st[st.length - 1] + P.face.eraseEase}` : 'none';
}

function debugText(ts: number, mode: Mode, t: number) {
  const lines = [
    `${mode}  t=${t.toFixed(3)} s  row=${(t / ROW).toFixed(2)}  frame=${frameNo}  ${meter.hz().toFixed(1)} Hz  ${canvas.width}×${canvas.height} ${ctx.space}`,
  ];
  if (mode === 'lilac' && lastLilac) {
    const f = lastLilac;
    const off: number[] = [];
    for (let j = 0; j < 12; j++) if (f.vis[j] === 0) off.push(j);
    lines.push(
      `step n=${f.step} (rev ${Math.floor(f.step / 12)})  missing #${f.missing}  phase ${(f.phase * 1000).toFixed(1)}/${(P.lilac.stepTime * 1000).toFixed(0)} ms  stage ${f.stage}`,
      `off [${off.join(',')}]  hint ${f.hint.toFixed(2)}  assist ${f.assistA.toFixed(2)}  scene ${lilacDuration(P.lilac).toFixed(2)} s`,
      `measured: ${JSON.stringify(meter.summary())}`,
    );
  } else if (mode === 'face' && lastFace) {
    const f = lastFace;
    lines.push(
      `${f.scene} ${f.stage} local=${f.local.toFixed(3)}  row=${f.row.toFixed(2)}  dawn=${f.field.toFixed(3)}  eyes=${f.eyes.toFixed(2)}  face=${f.face}  dot=${f.dot.toFixed(2)}  text=${f.text.toFixed(2)}`,
      `kick ${f.kick.toFixed(2)}  bell ${f.bell.toFixed(2)}  halo ${f.halo.toFixed(3)}  erase ${f.erase.toFixed(3)}  comet ${f.comet.toFixed(2)}`,
    );
  } else if (mode === 'hybrid') lines.push(`DOF blur ${lastDof.toFixed(4)} H`);
  debugEl.textContent = lines.join('\n');
  void ts;
}

// ---- main loop
let readoutClock = 0;
function frame(ts: number) {
  requestAnimationFrame(frame);
  tick(ts);
}
function tick(ts: number) {
  ui.fps.begin();
  const dt = lastTs < 0 ? 0 : Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  frameNo++;
  meter.frame(ts);

  let mode: Mode, t: number, Pf: Params;
  if (trial.active) {
    const s = trial.tick(ts);
    (mode = s.mode), (t = s.local), (Pf = trial.params);
  } else {
    Pf = P;
    mode = P.g.mode;
    if (P.g.playing) P.g.time += dt;
    const total = totalFor(mode);
    if (P.g.time > total) P.g.time = P.g.loop ? 0 : total;
    t = P.g.time;
  }

  const res: [number, number] = [canvas.width, canvas.height];
  const gl = ctx.gl;
  gl.viewport(0, 0, canvas.width, canvas.height);
  let hintA = 0, codaA = 0;
  if (mode === 'lilac') {
    lastLilac = drawLilac(rr, Pf, t, res, ctx.space);
    if (lastLilac.stage === 'chase' || lastLilac.stage === 'fadein' || lastLilac.stage === 'ending') meter.step(ts, lastLilac.missing);
    hintA = lastLilac.hint;
  } else if (mode === 'face') {
    lastFace = drawFace(rr, Pf, t, res, ctx.space);
    codaA = lastFace.text;
  } else if (mode === 'hybrid') lastDof = drawHybrid(rr, Pf, t, res, ctx.space);
  else drawDrift(rr, Pf, res, ctx.space);

  const L = Pf.lilac, F = Pf.face;
  setVoice(hintEl, L.hintText, mode === 'lilac' ? hintA : 0, lilacColors(L, ctx.space).hintCss, L.hintSizePx, L.hintOffset);
  setVoice(codaEl, F.text, mode === 'face' ? codaA : 0, css([F.textGray, F.textGray, F.textGray], 'srgb'), F.textSizePx, F.textOffset);

  if (ts - readoutClock > 100) {
    readoutClock = ts;
    if (!trial.active) {
      ui.refreshTime();
      readouts();
      if (P.g.debug) debugText(ts, mode, t);
    }
  }
  ui.fps.end();
}
requestAnimationFrame(frame);

// ---- debug handle (inspection / automated checks)
(window as any).__perception = {
  P,
  meter,
  trial,
  get lilac() { return lastLilac; },
  get face() { return lastFace; },
  ctx,
  setTime: (t: number) => ((P.g.time = t), ui.refreshTime()),
  setMode: (m: Mode) => ((P.g.mode = m), ui.showMode(m), ui.rebuildTime(), restart()),
  refresh: () => ui.refreshAll(),
  /** run one loop iteration by hand (rAF does not fire while the tab is hidden) */
  tick: (ts = performance.now()) => tick(ts),
  /** re-render the current preview frame and read back device pixels (x, y from the top-left) */
  probe: (pts: [number, number][]) => {
    const gl = ctx.gl, res: [number, number] = [canvas.width, canvas.height];
    const m = P.g.mode, t = P.g.time;
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (m === 'lilac') drawLilac(rr, P, t, res, ctx.space);
    else if (m === 'face') drawFace(rr, P, t, res, ctx.space);
    else if (m === 'hybrid') drawHybrid(rr, P, t, res, ctx.space);
    else drawDrift(rr, P, res, ctx.space);
    return pts.map(([x, y]) => {
      const b = new Uint8Array(4);
      gl.readPixels(Math.round(x), canvas.height - 1 - Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
      return [b[0], b[1], b[2]];
    });
  },
};
