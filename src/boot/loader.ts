// Loader (PLAN §3 S-1): while samples are synthesised and shaders compile, a hexdump of the demo's
// own source code runs down the screen — the world reading itself. The counter climbs to
// 0x10000 / 0x10000 and then, for one beat, shows 0x10001 / 0x10000: one byte too many.

import { TextMode, ROWS_TM } from './textmode.ts';

const sources = import.meta.glob(['../**/*.ts', '../shaders/**/*.glsl'], { query: '?raw', import: 'default' });

async function ownCode(): Promise<Uint8Array> {
  const keys = Object.keys(sources).sort();
  // start with the entry point, the loader itself next: the dump begins with the code doing the dumping
  const first = keys.filter((k) => /main\.ts$|loader\.ts$/.test(k));
  const order = [...first, ...keys.filter((k) => !first.includes(k))];
  const texts = await Promise.all(order.map((k) => sources[k]() as Promise<string>));
  return new TextEncoder().encode(texts.join('\n'));
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const hexN = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, '0');

export interface Loader {
  progress(p: number, label?: string): void;
  finish(): Promise<void>;
}

export function startLoader(el: HTMLElement): Loader {
  el.hidden = false;
  const tm = new TextMode(el, 'tk');
  let bytes: Uint8Array = new Uint8Array(0);
  ownCode().then((b) => (bytes = b));
  let target = 0;
  let shown = 0;
  let label = '';
  let over = false;
  let raf = 0;

  const line = (off: number) => {
    let h = '', a = '';
    for (let i = 0; i < 16; i++) {
      const b = bytes[off + i];
      if (b === undefined) {
        h += '   ';
        a += ' ';
      } else {
        h += hex2(b) + ' ';
        a += b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
      }
      if (i === 7) h += ' ';
    }
    return `${off.toString(16).padStart(8, '0')}  ${h} |${a}|`;
  };

  const draw = () => {
    // ease the visible progress towards the real one so the dump scrolls smoothly
    shown += (target - shown) * 0.15;
    if (target >= 1 && shown > 0.999) shown = 1;
    tm.clear('tk');
    const n = bytes.length;
    if (n) {
      const end = Math.floor((shown * n) / 16);
      for (let y = 0; y < ROWS_TM - 2; y++) {
        const ln = end - (ROWS_TM - 3) + y;
        if (ln < 0) continue;
        tm.put(1, y, line(ln * 16), y === ROWS_TM - 3 ? 'tw' : 'td');
      }
    }
    const v = over ? 0x10001 : Math.min(0x10000, Math.floor(shown * 0x10000));
    const counter = `0x${hexN(v, v > 0xffff ? 5 : 4)} / 0x10000`;
    tm.put(1, ROWS_TM - 1, (label || 'LOADING').toUpperCase().padEnd(40), 'tk');
    tm.put(79 - counter.length, ROWS_TM - 1, counter, over ? 'tw' : 'tk');
    tm.cursor = over ? null : [80 - 1, ROWS_TM - 1];
    tm.flush();
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  return {
    progress(p, l) {
      target = Math.max(target, Math.min(1, p));
      if (l) label = l;
    },
    async finish() {
      target = 1;
      label = 'READY';
      while (shown < 1) await new Promise((r) => setTimeout(r, 16));
      await new Promise((r) => setTimeout(r, 240));
      over = true; // one beat of the byte that doesn't fit
      label = '';
      await new Promise((r) => setTimeout(r, 480));
      cancelAnimationFrame(raf);
      el.hidden = true;
    },
  };
}
