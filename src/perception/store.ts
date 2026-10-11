// localStorage persistence (always wrapped: private windows / blocked storage must not break the lab)
// and JSON download/upload helpers.

const K_PARAMS = 'effaced.perception.params.v1';
const K_PRESETS = 'effaced.perception.presets.v1';
const K_RESULTS = 'effaced.perception.results.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadParams = () => read<unknown>(K_PARAMS, null);
export const saveParams = (p: unknown) => write(K_PARAMS, p);

export type Presets = Record<string, { saved: string; params: unknown }>;
export const loadPresets = () => read<Presets>(K_PRESETS, {});
export const savePresets = (p: Presets) => write(K_PRESETS, p);

export interface TrialResult {
  id: string;
  savedAt: string;
  kind: string;
  participant: string;
  condition: string;
  informed: boolean;
  aborted: boolean;
  checklist: Record<string, boolean>;
  answers: Record<string, string>;
  /** SPACE holds (informed mode), seconds since the trial sequence started */
  holds: { down: number; up: number }[];
  /** key times of the sequence, seconds (e.g. cut to white) */
  marks: Record<string, number>;
  timing: Record<string, number | string>;
  env: Record<string, unknown>;
  params: unknown;
}
export const loadResults = () => read<TrialResult[]>(K_RESULTS, []);
export const saveResults = (r: TrialResult[]) => write(K_RESULTS, r);
export function addResult(r: TrialResult): boolean {
  const all = loadResults();
  all.push(r);
  return saveResults(all);
}

export function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickJSON(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return reject(new Error('no file'));
      try {
        resolve(JSON.parse(await f.text()));
      } catch (e) {
        reject(e);
      }
    };
    inp.click();
  });
}

export const stamp = () => {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
};
