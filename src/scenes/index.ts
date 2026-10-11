// Scene registry. Every src/scenes/sNN-*.ts module is discovered automatically: its default export
// is a factory (g) => Scene | Scene[]. Scenes of the running order without a module get a placeholder.
// (No central list to edit — several people can add scenes in parallel.)

import type { Gfx } from '../gfx/gl.ts';
import type { Scene } from './types.ts';
import { SCRIPT } from '../timeline/script.ts';
import { createPlaceholder } from './placeholder.ts';

type Factory = (g: Gfx) => Scene | Scene[];
const modules = import.meta.glob('./s[0-9][0-9]-*.ts', { eager: true }) as Record<string, { default?: Factory }>;

export function createScenes(g: Gfx): Map<string, Scene> {
  const out = new Map<string, Scene>();
  for (const path of Object.keys(modules).sort()) {
    const make = modules[path].default;
    if (typeof make !== 'function') continue;
    const made = make(g);
    for (const s of Array.isArray(made) ? made : [made]) {
      if (out.has(s.id)) console.warn(`[scenes] ${s.id} defined twice (${path})`);
      out.set(s.id, s);
    }
  }
  SCRIPT.forEach((c, i) => {
    if (!out.has(c.scene)) out.set(c.scene, createPlaceholder(g, c.scene, c.title, i / SCRIPT.length));
  });
  return out;
}
