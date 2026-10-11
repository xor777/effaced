// Channel layout and instrument slots — MUSIC_BRIEF.md §8 and §9 (v1). Channel and slot numbers
// here are 1-based exactly as the composer sees them in the tracker.

/** 18 channels: 1–16 music, 17 the ghost, 18 silent markers */
export const CHANNELS = 18;
export const GHOST_CH = 17;
export const MARKER_CH = 18;

export const CH = {
  kick: 1, // fixed: drives light
  snare: 2, // fixed: drives camera shake
  hats: 3,
  perc: 4, // crash / toms / timpani
  bass: 5, // engine cuts its fundamental in 0D–0E
  sub: 6, // engine removes it in 0D–0E
  padA: 7, // choir
  padB: 8, // strings
  arp: 9,
  lead: 10, // fixed: drives glyphs
  echo: 11, // lead echo: 3 rows later, 50 %, opposite pan
  counter: 12, // strings, brass
  bell: 13, // fixed: the picture reads its notes literally (CAGE in S1, FADE in S14)
  pluck: 14, // harp
  fx: 15, // Shepard, risers
  stab: 16, // orchestra hits
  ghost: 17, // fixed: scope tone in 00, E-G-A-C in 07–08
  marker: 18, // fixed: silent markers
} as const;
export type ChannelName = keyof typeof CH;

/** instrument slots (1-based, as in the tracker) */
export const INS = {
  aah: 1,
  ooh: 2,
  strings: 3,
  pad: 4,
  brass: 5,
  lead: 6,
  bell: 7,
  epiano: 8,
  harp: 9,
  bass: 10,
  sub: 11,
  kick: 12,
  snare: 13,
  hats: 14,
  timpani: 15,
  orchhit: 16,
  shepard: 17,
  scope: 18,
  spiccato: 19, // short-attack spiccato strings for ostinati (added on the lead composer's request)
  marker: 0x7f,
} as const;
export type InstrumentName = keyof typeof INS;

/** default instrument per channel when a note gives none */
export const CH_DEFAULT_INS: Record<number, number> = {
  1: INS.kick,
  2: INS.snare,
  3: INS.hats,
  4: INS.timpani,
  5: INS.bass,
  6: INS.sub,
  7: INS.aah,
  8: INS.strings,
  9: INS.lead,
  10: INS.lead,
  11: INS.lead,
  12: INS.strings,
  13: INS.bell,
  14: INS.harp,
  15: INS.shepard,
  16: INS.orchhit,
  17: INS.scope,
  18: INS.marker,
};

/** marker meanings (channel 18, instrument 7F), MUSIC_BRIEF §11 */
export const MARKERS: Record<string, string> = {
  'C-4': 'look', // "look here"
  'D-4': 'hit', // hit / accent
  'E-4': 'mode', // start or end of a special mode: cycle, freeze, silence
  'F-4': 'motif', // a motif note the picture must "see"
};

/** PLAN appendix B: the creature's diary, written into the names of instruments 01–16 (≤ 22 chars each).
 *  Readable only when paused: in any tracker, and in S04's "Instrument List" HUD block. */
export const DIARY = [
  'i was the 65537th',
  'byte. there was no',
  'room for me in here',
  'so i hid in the',
  'rounding errors,',
  'in the gaps between',
  'rows, in the colors',
  "your screen can't",
  'show. i can only',
  'sing in seven letters',
  'and shine in six.',
  'if you read this,',
  "don't look away",
  'at the end.',
  'look at the center.',
  'keep me.',
];
