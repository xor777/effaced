// The Tweakpane panel: transport, display, per-illusion parameters with live readouts, trial setup,
// presets. Readouts are plain strings in `R`, refreshed by main.ts and polled by the monitors.

import { createPane, type TpPane, type TpFolder, type TpBinding, type TpFps } from './tp.ts';
import type { Params, Mode } from './params.ts';
import type { TrialKind } from './trial.ts';

export const R = {
  space: '',
  frame: '',
  lilacColour: '',
  lilacSafety: '',
  lilacSize: '',
  lilacTiming: '',
  faceColour: '',
  facePred: '',
  faceSeq: '',
  faceFix: '',
  results: '0',
  presetsInfo: '',
};

export const trialSetup = {
  kind: 'lilac' as TrialKind,
  participant: '',
  condition: 'MacBook, dim room',
  informed: false,
  trueToneOff: false,
  nightShiftOff: false,
  autoBrightnessOff: false,
  dndOn: false,
  naive: true,
};

export interface UiHooks {
  changed: (key?: string) => void;
  modeChanged: () => void;
  restart: () => void;
  totalFor: (m: Mode) => number;
  lilacReset: () => void;
  lilacIsoluminant: () => void;
  faceMatchHue: () => void;
  jumpToCut: () => void;
  runTrial: () => void;
  exportResults: () => void;
  clearResults: () => void;
  presetSave: (name: string) => void;
  presetLoad: (name: string) => void;
  presetDelete: (name: string) => void;
  presetNames: () => string[];
  presetsExport: () => void;
  presetsImport: () => void;
  resetAll: () => void;
}

export interface Ui {
  pane: TpPane;
  fps: TpFps;
  refreshTime: () => void;
  rebuildTime: () => void;
  refreshAll: () => void;
  rebuildPresetList: () => void;
  showMode: (m: Mode) => void;
}

export function buildUi(el: HTMLElement, P: Params, h: UiHooks): Ui {
  const pane = createPane(el, 'EFFACED · perception lab');
  // programmatic refreshes (pane.refresh) re-emit 'change'; those must not trigger side effects
  let refreshing = false;
  const ch = (b: TpBinding<any>, key?: string) => b.on('change', () => !refreshing && h.changed(key));

  // ---- transport
  ch(pane.addBinding(P.g, 'mode', {
    options: { 'S8 · lilac chaser': 'lilac', 'S14→S15 · portrait': 'face', 'S9 · hybrid image': 'hybrid', 'S9 · peripheral drift': 'drift' },
  })).on('change', () => !refreshing && h.modeChanged());
  const fps = pane.addBlade({ view: 'fpsgraph', label: 'fps', rows: 2 }) as unknown as TpFps;
  ch(pane.addBinding(P.g, 'playing', { label: 'play' }));
  ch(pane.addBinding(P.g, 'loop'));
  // the slider is bound to a proxy: Tweakpane writes the step-quantised value back on refresh(),
  // which would nudge the running clock every 100 ms
  let timeB: TpBinding<number> | null = null;
  const proxy = { t: 0 };
  const timeHost = pane.addFolder({ title: 'time', expanded: true });
  const rebuildTime = () => {
    timeB?.dispose();
    timeB = timeHost.addBinding(proxy, 't', { min: 0, max: Math.max(1, h.totalFor(P.g.mode)), step: 0.01, label: 't (s)', index: 0 });
    timeB.on('change', (e) => {
      if (!refreshing) P.g.time = e.value;
    });
  };
  rebuildTime();
  timeHost.addButton({ title: 'restart (R)' }).on('click', h.restart);

  // ---- display
  const disp = pane.addFolder({ title: 'Display', expanded: false });
  ch(disp.addBinding(P.g, 'colorSpace', { options: { 'Display P3': 'display-p3', sRGB: 'srgb' } }), 'space');
  ch(disp.addBinding(P.g, 'dither'));
  ch(disp.addBinding(P.g, 'frame1610', { label: '16:10 frame' }), 'frame');
  ch(disp.addBinding(P.g, 'safeZone', { label: 'safe zone' }), 'frame');
  ch(disp.addBinding(P.g, 'debug', { label: 'debug (D)' }), 'frame');
  ch(disp.addBinding(P.g, 'viewDistanceCm', { min: 30, max: 300, step: 1, label: 'distance cm' }));
  disp.addBinding(R, 'space', { readonly: true, label: 'buffer', interval: 500 });
  disp.addBinding(R, 'frame', { readonly: true, label: 'frame', interval: 500 });

  // ---- S8
  const L = P.lilac;
  const fL = pane.addFolder({ title: 'S8 · Lilac chaser', expanded: true });
  const lc = fL.addFolder({ title: 'Discs', expanded: true });
  ch(lc.addBinding(L, 'hue', { min: 0, max: 360, step: 0.1 }));
  ch(lc.addBinding(L, 'sat', { min: 0, max: 1, step: 0.005, label: 'saturation' }));
  ch(lc.addBinding(L, 'light', { min: 0, max: 1, step: 0.005, label: 'lightness' }));
  ch(lc.addBinding(L, 'bgGray', { min: 0, max: 1, step: 0.005, label: 'background' }));
  lc.addButton({ title: '#BEADED' }).on('click', h.lilacReset);
  lc.addButton({ title: 'isoluminant background' }).on('click', h.lilacIsoluminant);
  ch(lc.addBinding(L, 'discRadius', { min: 0.005, max: 0.15, step: 0.0005, label: 'disc radius H' }));
  ch(lc.addBinding(L, 'blurSigma', { min: 0, max: 0.08, step: 0.0005, label: 'blur σ H' }));
  ch(lc.addBinding(L, 'ringRadius', { min: 0.05, max: 0.48, step: 0.001, label: 'ring radius H' }));
  lc.addBinding(R, 'lilacColour', { readonly: true, label: 'colour', multiline: true, rows: 3, interval: 300 });
  lc.addBinding(R, 'lilacSafety', { readonly: true, label: 'safety', multiline: true, rows: 2, interval: 300 });
  lc.addBinding(R, 'lilacSize', { readonly: true, label: 'angles', multiline: true, rows: 2, interval: 300 });
  const lt = fL.addFolder({ title: 'Timing', expanded: false });
  ch(lt.addBinding(L, 'stepTime', { min: 0.05, max: 0.3, step: 0.001, label: 'step s' }), 'total');
  ch(lt.addBinding(L, 'offTime', { min: 0.02, max: 0.3, step: 0.001, label: 'disc off s' }));
  ch(lt.addBinding(L, 'clockwise'));
  ch(lt.addBinding(L, 'fadeIn', { min: 0, max: 4, step: 0.01, label: 'fade in s' }));
  ch(lt.addBinding(L, 'durationRows', { min: 24, max: 384, step: 1, label: 'scene rows' }), 'total');
  ch(lt.addBinding(L, 'endAtRows', { min: 0, max: 384, step: 1, label: 'ending at row' }));
  ch(lt.addBinding(L, 'endMode', { options: { 'erase (phantom eats the ring)': 'erase', 'cut (all vanish)': 'cut', fade: 'fade' }, label: 'ending' }));
  ch(lt.addBinding(L, 'endFade', { min: 0.05, max: 4, step: 0.01, label: 'end fade s' }));
  ch(lt.addBinding(L, 'tail', { min: 0, max: 6, step: 0.01, label: 'tail s' }), 'total');
  ch(lt.addBinding(L, 'assist', { min: 0, max: 0.3, step: 0.005, label: 'phantom assist' }));
  ch(lt.addBinding(L, 'assistSteps', { min: 1, max: 24, step: 1, label: 'assist steps' }));
  lt.addBinding(R, 'lilacTiming', { readonly: true, label: 'measured', multiline: true, rows: 3, interval: 300 });
  const lx = fL.addFolder({ title: 'Fixation + hint', expanded: false });
  ch(lx.addBinding(L, 'crossStyle', { options: { cross: 'cross', dot: 'dot', none: 'none' } }));
  ch(lx.addBinding(L, 'crossSize', { min: 0.002, max: 0.04, step: 0.0005, label: 'size H' }));
  ch(lx.addBinding(L, 'crossThickness', { min: 0.0005, max: 0.01, step: 0.0001, label: 'thickness H' }));
  ch(lx.addBinding(L, 'crossGray', { min: 0, max: 1, step: 0.01, label: 'gray' }));
  ch(lx.addBinding(L, 'hint', { label: 'hint text' }));
  ch(lx.addBinding(L, 'hintText', { label: 'text' }));
  ch(lx.addBinding(L, 'hintContrast', { min: -0.3, max: 0.3, step: 0.001, label: 'Weber contrast' }));
  ch(lx.addBinding(L, 'hintStartRows', { min: 0, max: 192, step: 1, label: 'start row' }));
  ch(lx.addBinding(L, 'hintRows', { min: 1, max: 96, step: 1, label: 'rows' }));
  ch(lx.addBinding(L, 'hintFadeRows', { min: 0, max: 32, step: 1, label: 'fade rows' }));
  ch(lx.addBinding(L, 'hintSizePx', { min: 8, max: 32, step: 0.5, label: 'size px' }));
  ch(lx.addBinding(L, 'hintOffset', { min: -0.3, max: 0.45, step: 0.001, label: 'below centre H' }));

  // ---- S14/S15
  const F = P.face;
  const fF = pane.addFolder({ title: 'S14→S15 · Portrait → Effaced', expanded: true });
  const fc = fF.addFolder({ title: 'Face colour', expanded: true });
  ch(fc.addBinding(F, 'gamut', { options: { 'Display P3 (wider)': 'p3', sRGB: 'srgb' }, label: 'authored in' }));
  ch(fc.addBinding(F, 'hue', { min: 0, max: 360, step: 0.5 }));
  ch(fc.addBinding(F, 'sat', { min: 0, max: 1, step: 0.005, label: 'saturation' }));
  ch(fc.addBinding(F, 'light', { min: 0.02, max: 0.9, step: 0.005, label: 'lightness' }));
  ch(fc.addBinding(F, 'deep', { min: 0.05, max: 1, step: 0.01, label: 'deep (ink 2)' }));
  fc.addButton({ title: 'match afterimage hue to #FACE' }).on('click', h.faceMatchHue);
  fc.addBinding(R, 'faceColour', { readonly: true, label: 'stimulus', multiline: true, rows: 3, interval: 300 });
  fc.addBinding(R, 'facePred', { readonly: true, label: 'predicted', multiline: true, rows: 3, interval: 300 });
  const fd = fF.addFolder({ title: 'Design', expanded: false });
  ch(fd.addBinding(F, 'featureContrast', { min: -1.5, max: 2, step: 0.01, label: 'feature contrast' }));
  ch(fd.addBinding(F, 'modelling', { min: 0, max: 2, step: 0.01 }));
  ch(fd.addBinding(F, 'hairTone', { min: 0, max: 2, step: 0.01, label: 'hair' }));
  ch(fd.addBinding(F, 'haloTone', { min: 0, max: 2, step: 0.01, label: 'nimbus' }));
  ch(fd.addBinding(F, 'ringTone', { min: 0, max: 2, step: 0.01, label: '65537-gon' }));
  ch(fd.addBinding(F, 'garmentTone', { min: 0, max: 2, step: 0.01, label: 'garment' }));
  ch(fd.addBinding(F, 'strands', { min: 0, max: 2, step: 0.01 }));
  ch(fd.addBinding(F, 'edgeBlur', { min: 0, max: 0.1, step: 0.001, label: 'edge blur σ' }));
  ch(fd.addBinding(F, 'featureSoft', { min: 0, max: 0.05, step: 0.0005, label: 'feature σ' }));
  ch(fd.addBinding(F, 'eyesOpen', { label: 'eyes open' }));
  const fl = fF.addFolder({ title: 'Layout', expanded: false });
  ch(fl.addBinding(F, 'size', { min: 0.2, max: 0.8, step: 0.001, label: 'size H/unit' }));
  ch(fl.addBinding(F, 'offsetY', { min: -0.3, max: 0.3, step: 0.001, label: 'offset y H' }));
  ch(fl.addBinding(F, 'frameRadius', { min: 0.5, max: 1.2, step: 0.001, label: 'nimbus r' }));
  ch(fl.addBinding(F, 'ringWidth', { min: 0, max: 0.05, step: 0.0005, label: 'ring width' }));
  ch(fl.addBinding(F, 'sides', { min: 3, max: 65537, step: 1, label: 'sides' }));
  const fs = fF.addFolder({ title: 'Sequence', expanded: false });
  ch(fs.addBinding(F, 'ending', { options: { 'erased into the point (show)': 'erase', 'cut to white (afterimage)': 'afterimage' } }));
  ch(fs.addBinding(F, 'white14', { min: 0.5, max: 1, step: 0.005, label: 'white S14' }));
  ch(fs.addBinding(F, 'white15', { min: 0.5, max: 1, step: 0.005, label: 'white S15 (afterimage)' }));
  ch(fs.addBinding(F, 'preRoll', { min: 0, max: 5, step: 0.05, label: 'S13 black s' }), 'total');
  ch(fs.addBinding(F, 's14Rows', { min: 32, max: 384, step: 1, label: 'S14 rows' }), 'total');
  ch(fs.addBinding(F, 's15', { min: 2, max: 40, step: 0.1, label: 'S15 s' }), 'total');
  ch(fs.addBinding(F, 'pointOut', { min: 0.1, max: 15, step: 0.1, label: 'point goes out s' }));
  ch(fs.addBinding(F, 'dotRadiusPx', { min: 0, max: 10, step: 0.1, label: 'dot r px' }));
  ch(fs.addBinding(F, 'dotGray', { min: 0, max: 1, step: 0.01, label: 'dark dot gray' }));
  ch(fs.addBinding(F, 's15Dot', { options: { 'stays': 'on', 'gone at cut': 'off', 'fades': 'fade' }, label: 'dot in S15 (afterimage)' }));
  ch(fs.addBinding(F, 's15DotFade', { min: 0.1, max: 10, step: 0.1, label: 'dot fade s' }));
  ch(fs.addBinding(F, 'text', { label: 'coda text' }));
  ch(fs.addBinding(F, 'textAt', { min: 0, max: 30, step: 0.1, label: 'text at s' }));
  ch(fs.addBinding(F, 'textOut', { min: 0, max: 30, step: 0.1, label: 'text out s' }));
  ch(fs.addBinding(F, 'textFade', { min: 0, max: 5, step: 0.1, label: 'text fade s' }));
  ch(fs.addBinding(F, 'textSizePx', { min: 8, max: 32, step: 0.5, label: 'text px' }));
  ch(fs.addBinding(F, 'textGray', { min: 0, max: 1, step: 0.005, label: 'text gray' }));
  ch(fs.addBinding(F, 'textOffset', { min: -0.45, max: 0.45, step: 0.001, label: 'below centre H' }));
  fs.addButton({ title: 'jump to 2 s before the cut' }).on('click', h.jumpToCut);
  fs.addBinding(R, 'faceSeq', { readonly: true, label: 'now', multiline: true, rows: 2, interval: 200 });
  const fa = fF.addFolder({ title: 'S14 · assembly + erasure', expanded: true });
  ch(fa.addBinding(F, 'assembleRows', { min: 16, max: 160, step: 1, label: 'assembly rows' }));
  ch(fa.addBinding(F, 'dawnFrom', { min: 0, max: 128, step: 1, label: 'dawn from row@64' }));
  ch(fa.addBinding(F, 'dawnTo', { min: 1, max: 160, step: 1, label: 'dawn to row@64' }));
  ch(fa.addBinding(F, 'eyesRow', { min: 0, max: 160, step: 1, label: 'eyes open row' }));
  ch(fa.addBinding(F, 'eyesRows', { min: 1, max: 32, step: 1, label: 'eyes open rows' }));
  ch(fa.addBinding(F, 'embers', { min: 0, max: 3, step: 0.01, label: 'embers' }));
  ch(fa.addBinding(F, 'life', { min: 0, max: 3, step: 0.01, label: 'point glow' }));
  ch(fa.addBinding(F, 'eraseRow', { min: 0, max: 190, step: 1, label: 'erase from row' }));
  ch(fa.addBinding(F, 'eraseSteps', { min: 1, max: 16, step: 1, label: 'erase steps' }));
  ch(fa.addBinding(F, 'eraseStepRows', { min: 1, max: 32, step: 1, label: 'rows per step' }));
  ch(fa.addBinding(F, 'eraseEase', { min: 1, max: 32, step: 1, label: 'step takes rows' }));
  fa.addBinding(R, 'faceFix', { readonly: true, label: 'erasure', interval: 300 });
  const fp = fF.addFolder({ title: 'Preview', expanded: true });
  ch(fp.addBinding(F, 'preview', { options: { 'stimulus (what is shown)': 'stimulus', 'predicted afterimage': 'afterimage', 'design map (positive)': 'design' } }));
  ch(fp.addBinding(F, 'predictP', { min: 0.05, max: 1, step: 0.01, label: 'adaptation p' }));

  // ---- S9
  const Hy = P.hybrid;
  const fH = pane.addFolder({ title: 'S9 · Hybrid image', expanded: true });
  ch(fH.addBinding(Hy, 'lowSigma', { min: 0, max: 0.2, step: 0.001, label: 'face low-pass σ' }));
  ch(fH.addBinding(Hy, 'faceAmp', { min: 0, max: 1.5, step: 0.01, label: 'face amp' }));
  ch(fH.addBinding(Hy, 'lineSigma', { min: 0.0003, max: 0.01, step: 0.0001, label: 'line σ H' }));
  ch(fH.addBinding(Hy, 'surround', { min: 1.5, max: 10, step: 0.1, label: 'DoG surround' }));
  ch(fH.addBinding(Hy, 'patternAmp', { min: 0, max: 2, step: 0.01, label: 'pattern amp' }));
  ch(fH.addBinding(Hy, 'base', { min: 0, max: 1, step: 0.01 }));
  ch(fH.addBinding(Hy, 'sweep', { label: 'DOF sweep' }));
  ch(fH.addBinding(Hy, 'dof', { min: 0, max: 0.05, step: 0.0005, label: 'DOF blur H' }));
  ch(fH.addBinding(Hy, 'sweepMax', { min: 0, max: 0.06, step: 0.0005, label: 'sweep max H' }));
  ch(fH.addBinding(Hy, 'sweepPeriod', { min: 1, max: 30, step: 0.1, label: 'sweep period s' }));
  ch(fH.addBinding(Hy, 'tori', { min: 1, max: 4, step: 1 }));
  ch(fH.addBinding(Hy, 'circles', { min: 4, max: 48, step: 1 }));
  ch(fH.addBinding(Hy, 'size', { min: 0.2, max: 0.8, step: 0.001, label: 'face size' }));
  const Dr = P.drift;
  const fD = pane.addFolder({ title: 'S9 · Peripheral drift', expanded: true });
  ch(fD.addBinding(Dr, 'layout', { options: { concentric: 'concentric', 'Hopf circles': 'hopf' } }));
  ch(fD.addBinding(Dr, 'palette', { options: { Kitaoka: 'kitaoka', gray: 'gray', beaded: 'beaded' } }));
  ch(fD.addBinding(Dr, 'rings', { min: 2, max: 16, step: 1 }));
  ch(fD.addBinding(Dr, 'segments', { min: 8, max: 96, step: 1 }));
  ch(fD.addBinding(Dr, 'wheels', { options: { 1: 1, 2: 2, 4: 4, 6: 6 } }));
  ch(fD.addBinding(Dr, 'radius', { min: 0.1, max: 0.6, step: 0.001 }));
  ch(fD.addBinding(Dr, 'contrast', { min: 0, max: 1, step: 0.01 }));
  ch(fD.addBinding(Dr, 'width', { min: 0.005, max: 0.1, step: 0.001, label: 'band width' }));
  ch(fD.addBinding(Dr, 'circles', { min: 4, max: 48, step: 1 }));

  // ---- trial
  const fT = pane.addFolder({ title: 'Calibration trial', expanded: true });
  fT.addBinding(trialSetup, 'kind', { options: { 'S8 lilac chaser (≈24 s)': 'lilac', 'S14→S15 afterimage (≈41 s)': 'face', 'story order S8 → S14→S15': 'story' }, label: 'sequence' });
  fT.addBinding(trialSetup, 'participant', { label: 'participant' });
  fT.addBinding(trialSetup, 'condition', { label: 'condition' });
  fT.addBinding(trialSetup, 'informed', { label: 'informed (hold SPACE)' });
  fT.addBinding(trialSetup, 'naive', { label: 'never saw it' });
  fT.addBinding(trialSetup, 'trueToneOff', { label: 'True Tone off' });
  fT.addBinding(trialSetup, 'nightShiftOff', { label: 'Night Shift off' });
  fT.addBinding(trialSetup, 'autoBrightnessOff', { label: 'auto-bright off' });
  fT.addBinding(trialSetup, 'dndOn', { label: 'DND on' });
  fT.addButton({ title: '▶ Run trial (fullscreen)' }).on('click', h.runTrial);
  fT.addBinding(R, 'results', { readonly: true, label: 'saved results', interval: 500 });
  fT.addButton({ title: 'Export results JSON' }).on('click', h.exportResults);
  fT.addButton({ title: 'Clear results…' }).on('click', h.clearResults);

  // ---- presets
  const fP = pane.addFolder({ title: 'Presets', expanded: false });
  const pr = { name: 'preset-1', pick: '' };
  fP.addBinding(pr, 'name');
  fP.addButton({ title: 'Save current as name' }).on('click', () => {
    h.presetSave(pr.name);
    rebuildPresetList();
  });
  let pickB: TpBinding<string> | null = null;
  const pickHost = fP.addFolder({ title: 'saved', expanded: true });
  const rebuildPresetList = () => {
    pickB?.dispose();
    const names = h.presetNames();
    pr.pick = names.includes(pr.pick) ? pr.pick : (names[0] ?? '');
    const opts: Record<string, string> = {};
    for (const n of names) opts[n] = n;
    pickB = pickHost.addBinding(pr, 'pick', { options: names.length ? opts : { '(none)': '' }, label: 'preset' });
  };
  rebuildPresetList();
  pickHost.addButton({ title: 'Load' }).on('click', () => pr.pick && h.presetLoad(pr.pick));
  pickHost.addButton({ title: 'Delete' }).on('click', () => {
    if (pr.pick) h.presetDelete(pr.pick);
    rebuildPresetList();
  });
  fP.addButton({ title: 'Export presets JSON' }).on('click', h.presetsExport);
  fP.addButton({ title: 'Import presets JSON' }).on('click', h.presetsImport);
  fP.addButton({ title: 'Reset all parameters to defaults' }).on('click', h.resetAll);

  const sections: Record<Mode, TpFolder[]> = { lilac: [fL], face: [fF], hybrid: [fH], drift: [fD] };
  const showMode = (m: Mode) => {
    for (const [k, fs_] of Object.entries(sections)) for (const f of fs_) f.hidden = k !== m;
  };
  showMode(P.g.mode);

  return {
    pane,
    fps,
    refreshTime: () => {
      proxy.t = P.g.time;
      refreshing = true;
      timeB?.refresh();
      refreshing = false;
    },
    rebuildTime,
    refreshAll: () => {
      proxy.t = P.g.time;
      refreshing = true;
      pane.refresh();
      refreshing = false;
    },
    rebuildPresetList,
    showMode,
  };
}
