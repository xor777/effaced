// The running order (PLAN.md §2–3): which scene plays at which order position.
// Positions are tracker order-list positions (1 position = 64 rows = 7.68 s), written 0F:23 = pos 0F row 23.
// Scene changes happen on pattern boundaries; `row` offsets allow mid-pattern cuts if ever needed.

/** 125 BPM, speed 6: one row = 6 ticks × 0.02 s */
export const ROW = 0.12;
export const ROWS = 64;

export interface Cue {
  scene: string;
  /** start position (+ optional row offset) */
  pos: number;
  row?: number;
  /** length in positions */
  len: number;
  act: 'I' | 'II' | 'III' | 'IV' | 'V';
  title: string;
  prio: 1 | 2 | 3;
}

export const SCRIPT: Cue[] = [
  { scene: 'S00', pos: 0x00, len: 1, act: 'I', title: 'Beam', prio: 1 },
  { scene: 'S01', pos: 0x01, len: 2, act: 'I', title: 'Boundary', prio: 1 },
  { scene: 'S02', pos: 0x03, len: 2, act: 'I', title: 'Cage', prio: 1 },
  { scene: 'S03', pos: 0x05, len: 2, act: 'II', title: 'City of Facades', prio: 1 },
  { scene: 'S04', pos: 0x07, len: 2, act: 'II', title: 'Gallery', prio: 2 },
  { scene: 'S05', pos: 0x09, len: 2, act: 'II', title: 'Staircase', prio: 1 },
  { scene: 'S06', pos: 0x0b, len: 2, act: 'II', title: 'Escher Gallery', prio: 2 },
  { scene: 'S07', pos: 0x0d, len: 2, act: 'III', title: "Indra's Pearls", prio: 1 },
  { scene: 'S08', pos: 0x0f, len: 3, act: 'III', title: 'Flow', prio: 1 },
  { scene: 'S09', pos: 0x12, len: 2, act: 'III', title: 'Stillness', prio: 2 },
  { scene: 'S10', pos: 0x14, len: 2, act: 'IV', title: 'Compression', prio: 1 },
  { scene: 'S11', pos: 0x16, len: 2, act: 'IV', title: 'Inversion', prio: 2 },
  { scene: 'S12', pos: 0x18, len: 2, act: 'IV', title: 'Canvas', prio: 1 },
  { scene: 'S13', pos: 0x1a, len: 2, act: 'IV', title: 'Erasure', prio: 1 },
  { scene: 'S14', pos: 0x1c, len: 3, act: 'V', title: 'Portrait', prio: 1 },
  { scene: 'S15', pos: 0x1f, len: 1, act: 'V', title: 'Effaced', prio: 1 },
];

export const POSITIONS = 32;
/** seconds of afterimage tail after the last position */
export const TAIL = 12; // MUSIC_BRIEF §4: render continues 12 s after 1F:63
export const PATTERN_SEC = ROWS * ROW;
export const DURATION = POSITIONS * PATTERN_SEC + TAIL;

export const cueStart = (c: Cue) => (c.pos * ROWS + (c.row ?? 0)) * ROW;
export const cueEnd = (c: Cue, i: number) =>
  i + 1 < SCRIPT.length ? cueStart(SCRIPT[i + 1]) : DURATION;

/** index of the cue playing at time t */
export function cueAt(t: number): number {
  let i = 0;
  while (i + 1 < SCRIPT.length && cueStart(SCRIPT[i + 1]) <= t) i++;
  return i;
}
