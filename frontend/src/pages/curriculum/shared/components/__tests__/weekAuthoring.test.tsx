import { describe, expect, it } from 'vitest';

// The shared week-authoring boundary exists so Module Builder stops importing
// Week Builder's page module directly (which dragged in @dnd-kit, the
// RichTextEditor and the rest of that ~159 kB chunk eagerly, and formed a
// page <-> page import cycle). These tests pin the contract that made the split
// safe: same components, same names, reachable from both entry points.

describe('shared week-authoring boundary', () => {
  it('re-exports the three shared components identically to the source module', async () => {
    const shared = await import('../weekAuthoring');
    const source = await import('@/pages/curriculum/week-builder/page');

    // Identity, not just presence: a re-export that wrapped or shadowed these would
    // change builder behaviour without failing a smoke render.
    expect(shared.WeekComponentRail).toBe(source.WeekComponentRail);
    expect(shared.WeekOverviewPanel).toBe(source.WeekOverviewPanel);
    expect(shared.ComponentEditor).toBe(source.ComponentEditor);
  });

  it('exposes lazy wrappers for all three components', async () => {
    const lazyModule = await import('../weekAuthoringLazy');
    for (const name of ['ComponentEditor', 'WeekComponentRail', 'WeekOverviewPanel'] as const) {
      expect(typeof lazyModule[name]).toBe('function');
    }
  });

  it('resolves the dynamic import the lazy wrappers depend on', async () => {
    // The lazy wrappers are only as good as the specifier inside them; a moved or
    // renamed page module would otherwise fail at runtime on first week expansion.
    const loaded = await import('@/pages/curriculum/week-builder/page');
    expect(loaded.ComponentEditor).toBeTypeOf('function');
    expect(loaded.WeekComponentRail).toBeTypeOf('function');
    expect(loaded.WeekOverviewPanel).toBeTypeOf('function');
  });

  it('keeps Module Builder off a direct week-builder page import', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    // Resolved from the vitest working directory (the frontend package root) —
    // import.meta.url is not a file: URL under the jsdom environment.
    const source = await fs.readFile(
      path.resolve(process.cwd(), 'src/pages/curriculum/module-builder/page.tsx'),
      'utf8',
    );
    // A value import of week-builder/page would silently undo the split; type-only
    // imports are erased at build time and stay allowed.
    const valueImport = /^import\s+(?!type\b)[^;]*from\s+'@\/pages\/curriculum\/week-builder\/page'/m;
    expect(valueImport.test(source)).toBe(false);
  });
});
