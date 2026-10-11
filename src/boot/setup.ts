// S-1 · Start screen: a bare DOS prompt in VGA text mode. The command types itself, then
// "press any key to start". That key (or a click) doubles as the user gesture for the
// AudioContext and fullscreen. No settings: native resolution, fullscreen, Web Audio.
// The joke sound modes stay reachable from the URL: ?sound=gus | ?sound=sb16.

import { TextMode } from './textmode.ts';

export type SoundDevice = 'gus' | 'sb16' | 'webaudio';

export interface SetupResult {
  /** output height in device pixels (0 = native) */
  height: number;
  /** render-scale multiplier for heavy scenes */
  quality: number;
  sound: SoundDevice;
  fullscreen: boolean;
}

const PROMPT = 'C:\\>';
const COMMAND = 'effaced';
// keys that don't count as "any key" (and Escape can't grant fullscreen)
const IGNORED = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape', 'Fn', 'Tab']);

export function runSetup(el: HTMLElement): Promise<SetupResult> {
  el.hidden = false;
  const tm = new TextMode(el, 'tk');
  const q = new URLSearchParams(location.search);
  const sound: SoundDevice = q.get('sound') === 'gus' ? 'gus' : q.get('sound') === 'sb16' ? 'sb16' : 'webaudio';

  let typed = 0; // characters of the command typed so far
  let ready = false; // the command has run: the prompt line is shown
  const draw = () => {
    tm.clear('tk');
    tm.put(0, 0, PROMPT + COMMAND.slice(0, typed), 'tk');
    if (ready) {
      tm.put(0, 2, 'press any key to start', 'tw');
      tm.put(0, 4, 'sound on, dark room.', 'td');
      tm.cursor = [22, 2];
    } else tm.cursor = [PROMPT.length + typed, 0];
    tm.flush();
  };

  // the command types itself, a key every ~90 ms with a little human jitter, then ENTER
  const timers: number[] = [];
  let at = 600;
  for (let i = 1; i <= COMMAND.length; i++) {
    at += 70 + Math.random() * 60;
    timers.push(window.setTimeout(() => ((typed = i), draw()), at));
  }
  timers.push(window.setTimeout(() => ((ready = true), draw()), at + 380));

  return new Promise((resolve) => {
    const finish = () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
      el.hidden = true;
      resolve({ height: 0, quality: 1, sound, fullscreen: true });
    };
    const onKey = (e: KeyboardEvent) => {
      if (IGNORED.has(e.key) || e.repeat) return;
      e.preventDefault();
      finish();
    };
    const onPointer = () => finish();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    draw();
  });
}
