// GLSL source registry. Every src/shaders/**/*.glsl is available by its path without extension,
// e.g. 'lib/color', 'scenes/s00-beam', 'post/composite'. `#include "lib/x"` is resolved recursively
// (each file at most once). In dev a changed .glsl hot-swaps the registry and rebuilds programs
// without touching the demo clock.

interface Registry {
  files: Record<string, string>;
  listeners: (() => void)[];
}
// shared across HMR instances of this module
const reg: Registry = ((globalThis as any).__effacedShaders ??= { files: {}, listeners: [] });
reg.files = import.meta.glob('../shaders/**/*.glsl', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export function onShadersChanged(fn: () => void) {
  reg.listeners.push(fn);
}

function lookup(name: string): string {
  const src = reg.files[`../shaders/${name}.glsl`];
  if (src === undefined) throw new Error(`shader not found: ${name}`);
  return src;
}

const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/**
 * Resolve a shader by name, or pass a full inline source (anything containing a newline).
 * Adds the version/precision prelude unless the source has its own #version; `defines` go right after it.
 */
export function resolveShader(nameOrSrc: string, defines = ''): string {
  let src = nameOrSrc.includes('\n') ? nameOrSrc : lookup(nameOrSrc);
  const seen = new Set<string>();
  const expand = (s: string): string =>
    s.replace(/^[ \t]*#include\s+"([^"]+)"[^\n]*$/gm, (_, inc: string) => {
      if (seen.has(inc)) return '';
      seen.add(inc);
      return `// --- ${inc}\n${expand(lookup(inc))}\n`;
    });
  src = expand(src);
  if (src.trimStart().startsWith('#version')) {
    src = src.trimStart();
    const nl = src.indexOf('\n');
    return src.slice(0, nl + 1) + defines + '\n' + src.slice(nl + 1);
  }
  return PRELUDE + defines + '\n' + src;
}

export function shaderNames(): string[] {
  return Object.keys(reg.files).map((p) => p.replace(/^\.\.\/shaders\//, '').replace(/\.glsl$/, ''));
}

if (import.meta.hot) {
  import.meta.hot.accept(() => reg.listeners.forEach((fn) => fn()));
}
