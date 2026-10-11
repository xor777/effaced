// DOM "voice" layer helpers (PLAN §8): text over the canvas in the OS's own monospace font.
// The frame counter `F:0x…` appears in S07, freezes in S09 (when the render stops) and goes on.

const stage = () => document.getElementById('stage')!;

let counter: HTMLElement | null = null;
let frames = 0;

/** show the counter (idempotent); call every rendered frame with `tick()` */
export function frameCounter(on: boolean) {
  if (on && !counter) {
    counter = document.createElement('div');
    counter.style.cssText =
      'position:absolute;right:2.2%;top:2.2%;font:400 1.4vh/1 ui-monospace,Menlo,monospace;color:#fff;opacity:.38;mix-blend-mode:difference;letter-spacing:.06em;pointer-events:none';
    stage().appendChild(counter);
  } else if (!on && counter) {
    counter.remove();
    counter = null;
  }
}

/** advance the counter by one rendered frame (don't call while frozen) */
export function tickFrameCounter() {
  frames++;
  if (counter) counter.textContent = `F:0x${frames.toString(16).toUpperCase().padStart(5, '0')}`;
}

/** a positioned DOM text element on the stage; remove it with el.remove() */
export function textEl(css: string, text = ''): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;pointer-events:none;${css}`;
  el.textContent = text;
  stage().appendChild(el);
  return el;
}
