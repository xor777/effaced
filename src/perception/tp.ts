// Tweakpane 4 + essentials, with a minimal local type surface. tweakpane's .d.ts re-exports its API
// from @tweakpane/core, which pnpm does not install as a direct dependency, so Pane would type as an
// empty class. (Adding `@tweakpane/core` as a devDependency would make these shims unnecessary.)

import { Pane } from 'tweakpane';
import * as Essentials from '@tweakpane/plugin-essentials';

export interface TpEvent<T> {
  value: T;
  last?: boolean;
}
export interface TpBlade {
  hidden: boolean;
  disabled: boolean;
  element: HTMLElement;
  dispose(): void;
}
export interface TpBinding<T = unknown> extends TpBlade {
  label?: string;
  on(ev: 'change', fn: (e: TpEvent<T>) => void): TpBinding<T>;
  refresh(): void;
}
export interface TpButton extends TpBlade {
  title: string;
  on(ev: 'click', fn: () => void): TpButton;
}
export interface TpFps extends TpBlade {
  begin(): void;
  end(): void;
}
export interface TpTab extends TpBlade {
  pages: TpFolder[];
  on(ev: 'select', fn: (e: { index: number }) => void): void;
}
export interface TpContainer {
  addBinding<O extends object, K extends keyof O>(obj: O, key: K, opts?: Record<string, unknown>): TpBinding<O[K]>;
  addFolder(opts: { title: string; expanded?: boolean }): TpFolder;
  addButton(opts: { title: string; label?: string }): TpButton;
  addBlade(opts: Record<string, unknown>): TpBlade & Record<string, any>;
  addTab(opts: { pages: { title: string }[] }): TpTab;
  refresh(): void;
  children: TpBlade[];
}
export interface TpFolder extends TpContainer, TpBlade {
  expanded: boolean;
  title?: string;
}
export interface TpPane extends TpFolder {
  on(ev: 'change', fn: (e: TpEvent<unknown>) => void): void;
}

export function createPane(container: HTMLElement, title: string): TpPane {
  const pane = new Pane({ container, title }) as unknown as TpPane & { registerPlugin(p: unknown): void };
  pane.registerPlugin(Essentials);
  return pane;
}
