// Re-download the library recordings bank v1 is built from (they are not kept in the project).
//   node tools/bank/fetch-samples.ts            → samples/vsco2ce/…, samples/vcsl/… (79 WAV files, ≈90 MB)
// The file list is the "Files" block at the end of music/instruments/SOURCES.md (written by
// tools/build-instruments.ts). Sources: Versilian Studios VSCO 2 Community Edition and VCSL, both
// CC0 1.0, from GitHub (raw.githubusercontent.com, branch master). Only WAV data is downloaded;
// nothing in samples/ is ever executed. samples/ is gitignored.

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REPOS: Record<string, string> = { vsco2ce: 'sgossner/VSCO-2-CE', vcsl: 'sgossner/VCSL' };
const md = readFileSync(resolve('music/instruments/SOURCES.md'), 'utf8');
const block = md.slice(md.lastIndexOf('## Files'));
const files = block.split('```')[1].split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.wav'));
let got = 0, bytes = 0;
for (const f of files) {
  const out = resolve('samples', f);
  if (existsSync(out) && statSync(out).size > 0) continue;
  const [lib, ...rest] = f.split('/');
  const repo = REPOS[lib];
  if (!repo) throw new Error(`${f}: unknown library prefix`);
  const url = `https://raw.githubusercontent.com/${repo}/master/${rest.map(encodeURIComponent).join('/')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (String.fromCharCode(...buf.subarray(0, 4)) !== 'RIFF') throw new Error(`${url}: not a WAV`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  got++;
  bytes += buf.length;
  process.stdout.write(`\r${got} / ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
}
console.log(`\n${files.length} files listed, ${got} downloaded into samples/`);
