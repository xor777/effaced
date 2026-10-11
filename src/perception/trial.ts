// Calibration trial (PLAN §5 protocol): fullscreen, the exact demo sequence, then a questionnaire.
// Results (answers + SPACE holds + parameter snapshot + environment + measured timing) go to
// localStorage and can be exported as JSON.

import type { Params } from './params.ts';
import { lilacTotal, faceTotal, faceS14 } from './timeline.ts';
import { addResult, type TrialResult } from './store.ts';
import { clone } from './params.ts';

export type TrialKind = 'lilac' | 'face' | 'story';
export interface Segment {
  mode: 'lilac' | 'face';
  start: number;
  dur: number;
}

export function segmentsFor(kind: TrialKind, P: Params): Segment[] {
  const L = lilacTotal(P.lilac), F = faceTotal(P.face);
  if (kind === 'lilac') return [{ mode: 'lilac', start: 0, dur: L }];
  if (kind === 'face') return [{ mode: 'face', start: 0, dur: F }];
  return [
    { mode: 'lilac', start: 0, dur: L },
    { mode: 'face', start: L, dur: F },
  ];
}

interface Q {
  id: string;
  text: string;
  type?: 'choice' | 'text' | 'number';
  options?: string[];
}
const YNU = ['yes', 'no', 'not sure'];
const COMFORT: Q = { id: 'comfort', text: 'Was anything uncomfortable (flicker, glare, eye strain)?', options: ['no', 'a little', 'yes'] };
const LILAC_Q: Q[] = [
  { id: 'describe', text: 'In a few words: what did you see?', type: 'text' },
  { id: 'green', text: 'Did you see a green disc?', options: YNU },
  { id: 'greenWhen', text: 'If yes: when did it first appear?', options: ['first 5 s', '5–10 s', '10–20 s', 'near the end', 'never'] },
  { id: 'fading', text: 'Did the lilac discs fade or vanish while you looked at the centre?', options: ['yes', 'partly', 'no', 'not sure'] },
  { id: 'ending', text: 'After the lilac discs were gone, did a green disc keep running?', options: ['yes', 'no', 'not sure', 'saw no green at all'] },
  { id: 'text', text: 'Did you notice any text? If so, what did it say?', type: 'text' },
  { id: 'gaze', text: 'Where did you look most of the time?', options: ['at the cross', 'around the circle', 'it varied'] },
  COMFORT,
];
const FACE_Q: Q[] = [
  { id: 'describe', text: 'In a few words: what did you see on the white screen?', type: 'text' },
  { id: 'face', text: 'Did you see a face on the white screen?', options: YNU },
  { id: 'brighter', text: 'Compared with the white background it looked…', options: ['brighter than white', 'about the same', 'darker', 'no face'] },
  { id: 'colour', text: 'What colour was it?', options: ['pink', 'red', 'magenta / purple', 'orange', 'yellow', 'green / teal', 'no colour', 'other'] },
  { id: 'features', text: 'Could you make out eyes, nose or mouth?', options: ['clearly', 'vaguely', 'no'] },
  { id: 'duration', text: 'Roughly how many seconds did it last?', type: 'number' },
  { id: 'fadedBefore', text: 'Before the white screen: did the coloured face fade while you looked at it?', options: ['yes', 'partly', 'no', 'not sure'] },
  { id: 'text', text: 'Did you notice any text at the end? What did it say?', type: 'text' },
  { id: 'gaze', text: 'Did you keep looking at the dot?', options: ['all the time', 'mostly', 'no'] },
  COMFORT,
];

export interface TrialHost {
  layer: HTMLElement; // fullscreen overlay for cards
  params: () => Params;
  env: () => Record<string, unknown>;
  timing: () => Record<string, number | string>;
  onStateChange: () => void;
  onSaved: () => void;
}

export interface TrialSetup {
  kind: TrialKind;
  informed: boolean;
  participant: string;
  condition: string;
  checklist: Record<string, boolean>;
}

export class Trial {
  state: 'idle' | 'ready' | 'run' | 'questions' = 'idle';
  setup: TrialSetup | null = null;
  segments: Segment[] = [];
  total = 0;
  t = 0;
  private t0 = -1;
  private holds: { down: number; up: number }[] = [];
  private downAt = -1;
  private snapshot: Params | null = null;
  private aborted = false;
  private savedTitle = document.title;

  private host: TrialHost;
  constructor(host: TrialHost) {
    this.host = host;
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && (this.state === 'ready' || this.state === 'run')) this.abort();
    });
  }

  get active() {
    return this.state !== 'idle';
  }

  async begin(setup: TrialSetup) {
    this.setup = setup;
    this.snapshot = clone(this.host.params());
    this.snapshot.face.preview = 'stimulus'; // never run a trial on a preview mode
    this.segments = segmentsFor(setup.kind, this.snapshot);
    this.total = this.segments.reduce((a, s) => Math.max(a, s.start + s.dur), 0);
    this.holds = [];
    this.downAt = -1;
    this.aborted = false;
    this.t = 0;
    this.t0 = -1;
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      /* allowed to continue windowed (kiosk mode is already fullscreen) */
    }
    this.state = 'ready';
    this.showReady();
    this.host.onStateChange();
  }

  /** the sequence parameters used by this trial (frozen at begin) */
  get params(): Params {
    return this.snapshot ?? this.host.params();
  }

  /** current segment + local time; call once per rAF with its timestamp */
  tick(ts: number): { mode: 'lilac' | 'face'; local: number } {
    if (this.state === 'run') {
      if (this.t0 < 0) this.t0 = ts;
      this.t = (ts - this.t0) / 1000;
      if (this.t >= this.total) this.finish();
    }
    const t = this.state === 'ready' ? 0 : this.t;
    let seg = this.segments[0];
    for (const s of this.segments) if (t >= s.start) seg = s;
    // before the start: lilac shows the empty gray + cross, face shows the black + point of S13
    const local = this.state === 'ready' ? (seg.mode === 'lilac' ? -1 : 0) : Math.min(t - seg.start, seg.dur - 1e-3);
    if (seg.mode === 'face' && this.state === 'run') {
      const p = this.params.face;
      document.title = local >= p.preRoll + faceS14(p) ? '#FACE' : this.savedTitle;
    }
    return { mode: seg.mode, local };
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (down && e.code === 'Escape' && (this.state === 'ready' || this.state === 'run')) {
      this.abort();
      return;
    }
    if (this.state === 'ready' && down && e.code === 'Space') {
      e.preventDefault();
      this.layerHide();
      this.state = 'run';
      this.host.onStateChange();
      return;
    }
    if (this.state !== 'run' || e.code !== 'Space') return;
    e.preventDefault();
    if (down && !e.repeat && this.downAt < 0) this.downAt = this.t;
    if (!down && this.downAt >= 0) {
      this.holds.push({ down: r3(this.downAt), up: r3(this.t) });
      this.downAt = -1;
    }
  }

  abort() {
    if (this.state === 'idle') return;
    this.aborted = true;
    if (this.state === 'run') this.finish();
    else this.close();
  }

  private finish() {
    if (this.downAt >= 0) this.holds.push({ down: r3(this.downAt), up: r3(this.t) }), (this.downAt = -1);
    document.title = this.savedTitle;
    this.state = 'questions';
    this.host.onStateChange();
    this.showQuestions();
  }

  private close() {
    this.state = 'idle';
    this.layerHide();
    document.title = this.savedTitle;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.host.onStateChange();
  }

  private marks(): Record<string, number> {
    const m: Record<string, number> = {};
    const P = this.params;
    for (const s of this.segments) {
      if (s.mode === 'lilac') m.lilacStart = s.start;
      else {
        m.s14Start = s.start + P.face.preRoll;
        m.cut = s.start + P.face.preRoll + faceS14(P.face);
        m.textAt = m.cut + P.face.textAt;
      }
    }
    m.end = this.total;
    m.stoppedAt = r3(this.t);
    return m;
  }

  // ---- DOM -------------------------------------------------------------------------------------
  private layerHide() {
    this.host.layer.classList.remove('show');
    this.host.layer.innerHTML = '';
  }

  private showReady() {
    const s = this.setup!;
    const L = this.host.layer;
    L.className = 'show ready ' + (s.kind === 'lilac' || s.kind === 'story' ? 'on-gray' : 'on-black');
    const len = Math.round(this.total);
    let what = `Watch the screen (about ${len} s).`;
    if (s.informed) {
      what =
        s.kind === 'lilac'
          ? 'Keep your eyes on the cross. Hold SPACE whenever you see a green disc.'
          : s.kind === 'face'
            ? 'Keep your eyes on the dot. When the picture disappears, hold SPACE for as long as you still see a face.'
            : 'Keep your eyes on the centre. Hold SPACE whenever you see something that is not on the screen.';
    }
    L.innerHTML = `<div class="card ready-card"><p>${what}</p><p class="dim">SPACE to start · ESC to abort</p></div>`;
  }

  private showQuestions() {
    const s = this.setup!;
    const L = this.host.layer;
    L.className = 'show questions';
    const qs: Q[] =
      s.kind === 'lilac' ? LILAC_Q : s.kind === 'face' ? FACE_Q : [
        ...LILAC_Q.map((q) => ({ ...q, id: 'S8.' + q.id, text: 'Circle of discs — ' + q.text })),
        ...FACE_Q.map((q) => ({ ...q, id: 'S14.' + q.id })),
      ];
    const form = document.createElement('form');
    form.className = 'card q-card';
    form.innerHTML =
      `<h2>${this.aborted ? 'Trial stopped early' : 'Thank you — a few questions'}</h2>` +
      qs
        .map((q, i) => {
          const name = `q${i}`;
          if (q.type === 'text') return `<label class="q"><span>${q.text}</span><input name="${name}" type="text" autocomplete="off"></label>`;
          if (q.type === 'number') return `<label class="q"><span>${q.text}</span><input name="${name}" type="number" min="0" step="0.5"></label>`;
          return `<fieldset class="q"><legend>${q.text}</legend>${q.options!
            .map((o) => `<label class="opt"><input type="radio" name="${name}" value="${o}"> ${o}</label>`)
            .join('')}</fieldset>`;
        })
        .join('') +
      `<div class="row"><button type="submit">Save</button><button type="button" class="discard">Discard</button></div>`;
    L.innerHTML = '';
    L.appendChild(form);
    (form.querySelector('input') as HTMLInputElement | null)?.focus();
    form.querySelector('.discard')!.addEventListener('click', () => this.close());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const answers: Record<string, string> = {};
      qs.forEach((q, i) => (answers[q.id] = String(fd.get(`q${i}`) ?? '')));
      const P = this.params;
      const params: Record<string, unknown> = { g: P.g };
      if (s.kind !== 'face') params.lilac = P.lilac;
      if (s.kind !== 'lilac') params.face = P.face;
      const res: TrialResult = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        savedAt: new Date().toISOString(),
        kind: s.kind,
        participant: s.participant,
        condition: s.condition,
        informed: s.informed,
        aborted: this.aborted,
        checklist: s.checklist,
        answers,
        holds: this.holds,
        marks: this.marks(),
        timing: this.host.timing(),
        env: this.host.env(),
        params,
      };
      const ok = addResult(res);
      L.innerHTML = `<div class="card"><p>${ok ? 'Saved.' : 'Could not write to localStorage — copy the JSON below.'}</p>${
        ok ? '' : `<textarea readonly>${JSON.stringify(res)}</textarea>`
      }<div class="row"><button type="button" class="close">Close</button></div></div>`;
      L.querySelector('.close')!.addEventListener('click', () => this.close());
      this.host.onSaved();
    });
  }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
