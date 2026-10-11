// ENGINE TEST FIXTURE (technical, not music): 16 positions that exercise every instrument slot,
// the effects composers will use, the ghost scope, channel-18 markers and the engine's channel
// rules (bass fundamental cut + sub removal in 0D–0E), plus a plain groove to judge the balance.
//   node tools/build-xm.ts music/score/_engine-test.ts out/engine-test.xm
//   node tools/render-xm.ts out/engine-test.xm        # or open lab.html
import { song, rep, type PatternDef } from '../../src/music/score/dsl.ts';

const bar = (...toks: string[]) => toks.join(' ');
const every = (n: number, tok: string, rows = 64) => Array.from({ length: rows }, (_, i) => (i % n === 0 ? tok : '.')).join(' ');

// --- 00: the beam (scope tone, morph via 9xx) + a rising pad
const beam: PatternDef = {
  17: { 0: 'C-3:scope!900', 16: '.!940', 32: '.!980', 48: '.!9FF', 63: '==' },
  7: { 32: 'A-3:aahv20', 40: '.!A10', 48: '.!A10' },
  18: { 0: 'C-4' },
};
// --- 01: bell, one note per bar (marker F-4 on each)
const bell: PatternDef = {
  13: { 0: 'C-5:bell', 16: 'A-4', 32: 'G-4', 48: 'E-4' },
  18: { 0: 'F-4', 16: 'F-4', 32: 'F-4', 48: 'F-4' },
  7: { 0: 'A-3:aahv40' },
  8: { 0: 'E-3:stringsv36', 32: 'F-3' },
};
// --- 02: drum kit parade
const drums: PatternDef = {
  1: bar('C-4:kick .*3 C-4 .*3 C-3 .*3 C-5 .*3', '.*48'),
  2: bar('.*16 C-4:snare .*3 C-4v32 .*3 C-3 .*3 C-5', '.*28'),
  3: bar('.*32 C-4:hats .*3 D-4 .*3 E-4 .*7 C-4 C-4 C-4 C-4 E-4 .*3 ==', '.*7'),
  4: bar('.*48 F-4:hats .*3 G-4 .*3 A-4', '.*7'),
  16: { 0: 'A-2:timpani', 8: 'E-2', 12: 'A-2', 14: 'A-2' },
};
// --- 03: bass, sub, harp, e-piano
const low: PatternDef = {
  5: bar('A-1:bass .*3 E-2 .*3 A-2 .*3 E-3 .*3 ==', '.*47'),
  6: bar('.*20 A-1:sub .*7 D-2 .*7 A-2 .*3 ==', '.*23'),
  14: bar('.*40 C-4:harp E-4 G-4 C-5 E-5 G-5 C-6 E-6 G-6 C-7', '.*14'),
  12: bar('.*16 A-3:epiano .*3 C-4 .*3 E-4 .*3 A-4 .*3 ==', '.*27'),
};
// --- 04: choirs, strings, pad across their ranges
const pads: PatternDef = {
  7: bar('A-3:aah .*7 E-5 .*7 ==', '.*7', 'A-3:ooh .*7 E-5 .*7 ==', '.*15'),
  8: bar('.*8 E-2:strings .*7 A-4 .*7 E-6 .*7 ==', '.*31'),
  12: bar('.*40 C-3:pad .*7 C-4 .*7 C-5 .*3 =='),
};
// --- 05: brass stabs, lead with vibrato, orchestra hit, Shepard ascent
const leads: PatternDef = {
  12: bar('A-3:brass . == . C-4 . == . E-4 . == . A-4 .*3 ==', '.*47'),
  10: bar('.*16 A-4:lead .*3 .!446 .*3 C-5 .*3 .!448 .*3 ==', '.*27'),
  16: { 32: 'A-3:orchhit', 40: 'C-4', 44: 'E-4' },
  15: bar('.*48', 'C-4:shepard D-4 E-4 F-4 G-4 A-4 B-4 C-4 D-4 E-4 F-4 G-4 A-4 B-4 C-4 =='),
  18: { 32: 'D-4' },
};
// --- 06: effects test
const fx: PatternDef = {
  9: bar('A-4:lead!037 .!037 .!037 .!037 .!047 .!047 .!047 .!047 .!0C7 .!0C7 .!0C7 .!0C7 ==', '.*51'),
  10: bar('.*16 A-4:lead .!104 .!104 .!104 .!204 .!204 .!204 .!204 C-5 .!448 .!448 .!448 .!448 .!448 .!448 ==', '.*32'),
  12: bar('.*32 C-4:strings .*3 G-4!308 .!300 .!300 .!300 .!300 .!300 .!300 .!300 C-4!310 .!300 .!300 .!300 ==', '.*15'),
  8: bar('.*48 E-4:stringsv64 .!A04 .!A04 .!A04 .!A04 .!A40 .!A40 .!A40 .!A40 ==', '.*6'),
  2: bar('C-4:snare .*3 C-4!EC2 .*3 C-4!ED3 .*3 C-4!R03 .!R03 .!R03 .!R03', '.*48'),
  14: bar('.*16', every(2, 'C-5:harp', 16).split(' ').map((t, i) => (t === '.' ? '.' : `${t}!8${['00', 'FF', '80', '40', 'C0', '20', 'E0', '80'][i / 2]}`)).join(' '), '.*32'),
  17: { 0: 'E-3:scope!900', 8: '.!9FF', 16: 'G-3', 24: '.!980', 32: 'A-3!900', 48: 'C-4!9FF', 63: '==' },
  18: { 0: 'E-4', 63: 'E-4' },
};
// --- 07/08: a plain groove to judge the mix (i–VI–III–VII, technical)
const groove = (alt: boolean): PatternDef => ({
  1: rep('C-4:kick .*3 .*4 C-4 .*3 .*4', 4),
  2: rep('.*4 C-4:snare .*7 C-4 .*3', 4),
  3: rep('C-4:hatsv40 . C-4v24 . C-4v40 . E-4v32 .', 8),
  5: bar('A-1:bass . A-1 A-2 A-1 . A-1 A-2', 'A-1 . A-1 A-2 A-1 . A-1 A-2', 'F-1 . F-1 F-2 F-1 . F-1 F-2', 'F-1 . F-1 F-2 F-1 . F-1 F-2', 'C-2 . C-2 C-3 C-2 . C-2 C-3', 'C-2 . C-2 C-3 C-2 . C-2 C-3', 'G-1 . G-1 G-2 G-1 . G-1 G-2', 'G-1 . G-1 G-2 G-1 . G-1 G-2'),
  6: bar('A-1:sub .*15', 'F-1 .*15', 'C-2 .*15', 'G-1 .*15'),
  7: bar('E-4:aah .*15', 'F-4 .*15', 'E-4 .*15', 'D-4 .*15'),
  8: bar('C-4:strings .*15', 'C-4 .*15', 'G-3 .*15', 'B-3 .*15'),
  9: bar('A-4:lead!037 .!037 .!037 .!037 .*12', 'F-4!047 .!047 .!047 .!047 .*12', 'C-5!047 .!047 .!047 .!047 .*12', 'G-4!047 .!047 .!047 .!047 .*12'),
  10: alt ? bar('E-5:lead .*3 D-5 .*3 C-5 .*7', 'A-4 .*7 C-5 .*7', 'G-4 .*3 A-4 .*3 C-5 .*7', 'B-4 .*7 .!446 .*7') : bar('A-4:lead .*7 C-5 .*7', 'F-5 .*7 E-5 .*7', 'E-5 .*7 D-5 .*7', 'D-5 .*7 .!446 .*7'),
  13: bar('.*12 E-5:bell .*3', '.*16', '.*12 G-5 .*3', '.*16'),
  18: alt ? {} : { 0: 'D-4' },
});
// --- 09/0A: Shepard bridge on a G pedal
const shepard: PatternDef = {
  15: rep('C-4:shepard . D-4 . E-4 . F-4 . G-4 . A-4 . B-4 .', 4) + ' C-4 . D-4 . E-4 . F-4 .',
  6: bar('G-1:sub .*31 G-1 .*31'),
  8: bar('G-3:strings .*31 G-3 .*31'),
  1: rep('C-4:kick .*7', 8),
};
// --- 0D/0E: breakdown — the engine cuts the bass fundamental and removes the sub here
const breakdown: PatternDef = {
  5: rep('D-2:bass .*3 A-2 .*3 F-2 .*3 C-3 .*3', 4),
  6: rep('D-1:sub .*15', 4),
  12: bar('D-4:epiano .*7 F-4 .*7 A-4 .*7 C-5 .*7', 'B-4 .*7 E-4 .*7 A-4 .*7 D-4 .*7'),
  7: bar('D-4:ooh .*31 C-4 .*31'),
  18: { 0: 'E-4' },
};
// --- 0F: final chord rings into the tail (no key-off)
const coda: PatternDef = {
  7: { 0: 'A-3:aah' },
  8: { 0: 'E-4:strings' },
  12: { 0: 'C-5:pad' },
  13: { 0: 'A-5:bell', 16: 'E-5', 32: 'C-5' },
  5: { 0: 'A-1:bass', 8: '==' },
  18: { 0: 'D-4' },
};

export default song({
  name: 'engine test',
  patterns: { beam, bell, drums, low, pads, leads, fx, g1: groove(false), g2: groove(true), shepard, breakdown, coda },
  order: ['beam', 'bell', 'drums', 'low', 'pads', 'leads', 'fx', 'g1', 'g2', 'shepard', 'shepard', 'g1', 'g2', 'breakdown', 'breakdown', 'coda'],
  echo: { from: 10, to: 11, positions: [7, 8, 11, 12] },
});
