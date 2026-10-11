// A tiny 80×25 VGA text-mode screen rendered as DOM (crisp at any resolution, selectable, inspectable).
// Cells carry a CSS attribute class (see .tb/.th/... in style.css) and an optional hotspot id.

export const COLS = 80;
export const ROWS_TM = 25;

interface CellT {
  ch: string;
  a: string;
  id: string;
}

export class TextMode {
  el: HTMLElement;
  cells: CellT[][];
  cursor: [number, number] | null = null;

  constructor(el: HTMLElement, attr = 'tk') {
    this.el = el;
    this.cells = Array.from({ length: ROWS_TM }, () =>
      Array.from({ length: COLS }, () => ({ ch: ' ', a: attr, id: '' })),
    );
    fitFont(el);
  }

  clear(attr = 'tk', ch = ' ') {
    for (const row of this.cells) for (const c of row) Object.assign(c, { ch, a: attr, id: '' });
  }

  put(x: number, y: number, s: string, a?: string, id = '') {
    if (y < 0 || y >= ROWS_TM) return;
    const chars = Array.from(s);
    for (let i = 0; i < chars.length; i++) {
      const xx = x + i;
      if (xx < 0 || xx >= COLS) continue;
      const c = this.cells[y][xx];
      c.ch = chars[i];
      if (a) c.a = a;
      c.id = id;
    }
  }

  fill(x: number, y: number, w: number, h: number, a: string, ch = ' ') {
    for (let j = y; j < y + h; j++) this.put(x, j, ch.repeat(w), a);
  }

  box(x: number, y: number, w: number, h: number, a: string, title = '') {
    this.put(x, y, '╔' + '═'.repeat(w - 2) + '╗', a);
    for (let j = y + 1; j < y + h - 1; j++) {
      this.put(x, j, '║', a);
      this.put(x + w - 1, j, '║', a);
    }
    this.put(x, y + h - 1, '╚' + '═'.repeat(w - 2) + '╝', a);
    if (title) this.put(x + ((w - title.length - 2) >> 1), y, ` ${title} `, a);
  }

  center(y: number, s: string, a?: string, id = '') {
    this.put((COLS - Array.from(s).length) >> 1, y, s, a, id);
  }

  /** Render into the element; runs of equal attribute+id become one span. */
  flush() {
    const out: string[] = [];
    for (let y = 0; y < ROWS_TM; y++) {
      out.push('<div class="ln">');
      const row = this.cells[y];
      let x = 0;
      while (x < COLS) {
        const a = row[x].a, id = row[x].id;
        const isCur = this.cursor && this.cursor[0] === x && this.cursor[1] === y;
        let s = '';
        if (isCur) {
          s = row[x].ch;
          x++;
        } else {
          while (x < COLS && row[x].a === a && row[x].id === id && !(this.cursor && this.cursor[0] === x && this.cursor[1] === y)) {
            s += row[x].ch;
            x++;
          }
        }
        const cls = a + (isCur ? ' cursor' : '');
        out.push(`<span class="${cls}"${id ? ` data-id="${id}"` : ''}>${esc(s)}</span>`);
      }
      out.push('</div>');
    }
    this.el.innerHTML = out.join('');
  }
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Size the font so 80 monospace cells exactly span the element's width. */
export function fitFont(el: HTMLElement) {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:100px';
  probe.style.fontFamily = getComputedStyle(el).fontFamily;
  probe.textContent = 'M'.repeat(80);
  document.body.appendChild(probe);
  const chw = probe.getBoundingClientRect().width / 80 / 100; // em per ch
  probe.remove();
  const apply = () => {
    const w = el.getBoundingClientRect().width;
    if (w > 0 && chw > 0) el.style.fontSize = `${w / COLS / chw}px`;
  };
  apply();
  new ResizeObserver(apply).observe(el);
}
