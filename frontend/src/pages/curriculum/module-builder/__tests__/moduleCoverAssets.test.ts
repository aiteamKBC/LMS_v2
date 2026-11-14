import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const manifest = JSON.parse(readFileSync(resolve(root, 'backend/scripts/data/module-cover-assets-20261113.json'), 'utf8')) as {
  version: number;
  covers: Array<{ moduleId: string; asset: string; sha256: string }>;
};

describe('deployable module cover mapping', () => {
  it('maps exactly thirty unique modules to thirty scoped static assets', () => {
    expect(manifest.version).toBe(1);
    expect(manifest.covers).toHaveLength(30);
    expect(new Set(manifest.covers.map(cover => cover.moduleId)).size).toBe(30);
    expect(new Set(manifest.covers.map(cover => cover.asset)).size).toBe(30);
    for (const cover of manifest.covers) {
      expect(cover.moduleId.trim()).not.toBe('');
      expect(cover.asset).toMatch(/^assets\/module-covers\/2026-11-13\/[a-z0-9-]+\.webp$/);
    }
  });

  it('ships every mapped picture with the exact recorded checksum', () => {
    for (const cover of manifest.covers) {
      const bytes = readFileSync(resolve(root, 'frontend/public', cover.asset));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(cover.sha256);
    }
  });
});
