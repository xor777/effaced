import { defineConfig, type Plugin } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// every *.html in the project root is a page (index = the demo, techcheck, lab, perception, …)
const root = import.meta.dirname;
const input = Object.fromEntries(
  readdirSync(root)
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f.replace(/\.html$/, ''), resolve(root, f)]),
);

// The demo fetches /music/effaced.xm at runtime (music, city, S04 tracker). Dev serves it from the
// project root; the build ships it at the same path, read where `pnpm music` writes it.
const shipModule = (): Plugin => ({
  name: 'effaced:ship-xm',
  apply: 'build',
  generateBundle() {
    const file = resolve(root, 'music/effaced.xm');
    this.addWatchFile(file);
    this.emitFile({ type: 'asset', fileName: 'music/effaced.xm', source: readFileSync(file) });
  },
});

export default defineConfig({
  server: { port: 5173, strictPort: false },
  worker: { format: 'es' },
  plugins: [shipModule()],
  build: { target: 'es2022', rollupOptions: { input } },
});
