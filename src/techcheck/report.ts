// Results model + table rendering + JSON export.

export type Status = 'PASS' | 'WARN' | 'FAIL' | 'INFO' | 'SKIP';
export type SectionId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K';

export const SECTION_TITLES: Record<SectionId, string> = {
  A: 'WebGL2 basics',
  B: 'Extensions',
  C: 'Float render targets & blending',
  D: 'Shader compilation',
  E: 'GPU timing (raymarch, bloom, AgX)',
  F: 'Particles (Thomas attractor, RK4)',
  G: 'Frame cadence',
  H: 'Color / HDR',
  I: 'Audio & workers',
  J: 'DOM / CSS',
  K: 'Misc',
};

export interface Row {
  section: SectionId;
  name: string;
  value: string;
  status: Status;
  note: string;
  data?: unknown;
}

export interface Report {
  meta: Record<string, unknown>;
  rows: Row[];
  done: boolean;
  startedAt: string;
  durationMs?: number;
}

export class Reporter {
  report: Report;
  private bodies = new Map<SectionId, HTMLTableSectionElement>();
  private counts: Record<Status, number> = { PASS: 0, WARN: 0, FAIL: 0, INFO: 0, SKIP: 0 };
  private summaryEl: HTMLElement;

  constructor(table: HTMLTableElement, summaryEl: HTMLElement) {
    this.summaryEl = summaryEl;
    this.report = { meta: {}, rows: [], done: false, startedAt: new Date().toISOString() };
    for (const id of Object.keys(SECTION_TITLES) as SectionId[]) {
      const tb = document.createElement('tbody');
      tb.dataset.section = id;
      const tr = document.createElement('tr');
      tr.className = 'sec';
      const th = document.createElement('th');
      th.colSpan = 4;
      th.textContent = `${id} · ${SECTION_TITLES[id]}`;
      tr.appendChild(th);
      tb.appendChild(tr);
      table.appendChild(tb);
      this.bodies.set(id, tb);
    }
  }

  add(section: SectionId, name: string, value: string, status: Status, note = '', data?: unknown): Row {
    const row: Row = { section, name, value, status, note };
    if (data !== undefined) row.data = data;
    this.report.rows.push(row);
    this.counts[status]++;
    const tr = document.createElement('tr');
    tr.className = `st-${status.toLowerCase()}`;
    const td = (txt: string, cls: string) => {
      const el = document.createElement('td');
      el.className = cls;
      el.textContent = txt;
      tr.appendChild(el);
      return el;
    };
    td(name, 'name');
    const v = td(value, 'value');
    if (data !== undefined) v.title = JSON.stringify(data, null, 1).slice(0, 4000);
    td(status, 'status');
    td(note, 'note');
    this.bodies.get(section)!.appendChild(tr);
    this.updateSummary();
    return row;
  }

  updateSummary() {
    const c = this.counts;
    this.summaryEl.textContent = `PASS ${c.PASS} · WARN ${c.WARN} · FAIL ${c.FAIL} · INFO ${c.INFO} · SKIP ${c.SKIP}`;
  }

  json(): string {
    return JSON.stringify(this.report, null, 2);
  }
}
