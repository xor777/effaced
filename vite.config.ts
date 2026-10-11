import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// every *.html in the project root is a page (index = the demo, techcheck, lab, perception, …)
const root = import.meta.dirname;
const input = Object.fromEntries(
  readdirSync(root)
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f.replace(/\.html$/, ''), resolve(root, f)]),
);

export default defineConfig({
  server: { port: 5173, strictPort: false },
  worker: { format: 'es' },
  build: { target: 'es2022', rollupOptions: { input } },
});
