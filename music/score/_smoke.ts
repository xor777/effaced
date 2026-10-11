// pipeline smoke test (not music): exercises the DSL, the XM writer and xm-check
import { song, rep, seq, rest, spread } from '../../src/music/score/dsl.ts';

const beat = rep('C-4 .*3', 16);
export default song({
  name: 'smoke',
  patterns: {
    a: {
      1: beat,
      5: spread(['A-2', 'A-2', 'E-2!047', 'G-2'], 16),
      7: 'A-3v40 .*30 == .*31',
      10: seq('C-5!400', rest(15), 'A-4', rest(15), 'G-4:bellv48', rest(15), 'E-4!A02', rest(15)),
      13: { 0: 'C-5', 16: 'A-4', 32: 'G-4', 48: 'E-4' },
      18: { 0: 'F-4', 16: 'F-4', 32: 'F-4', 48: 'F-4' },
    },
    b: { 1: beat, 18: { 0: 'D-4' } },
  },
  order: ['a', 'b', 'a', 'b'],
  echo: { from: 10, to: 11 },
});
