// Stand-in for scenes that aren't built yet, so the whole running order can be played and timed.

import { type Gfx, program, fullscreen } from '../gfx/gl.ts';
import type { Scene } from './types.ts';
import { CH } from '../music/roster.ts';

const shared = new WeakMap<Gfx, ReturnType<typeof program>>();

export function createPlaceholder(g: Gfx, id: string, title: string, hue: number): Scene {
  let prog = shared.get(g);
  if (!prog) shared.set(g, (prog = program(g, 'scenes/placeholder')));
  const p = prog;
  const voice = document.getElementById('voice')!;
  let label: HTMLElement | null = null;
  return {
    id,
    title,
    programs: () => [p],
    post: { bloom: 0.1 },
    enter() {
      label = document.createElement('div');
      label.style.cssText = 'position:absolute;left:4%;bottom:6%;opacity:.55;letter-spacing:.08em';
      label.textContent = `${id} · ${title} — not built yet`;
      voice.appendChild(label);
    },
    leave() {
      label?.remove();
      label = null;
    },
    render(f) {
      if (!p.use()) return;
      p.set('res', f.w, f.h).set('t', f.t).set('k', f.k).set('beat', f.S[CH.kick - 1] ?? 0).set('hue', hue);
      fullscreen(g);
    },
  };
}
