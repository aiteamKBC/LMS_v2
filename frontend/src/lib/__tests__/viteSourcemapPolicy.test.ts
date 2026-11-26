import { describe, expect, it } from 'vitest';
import type { UserConfig, UserConfigFn } from 'vite';

import config from '../../../vite.config';

// Production source maps would publish the original TypeScript — component logic,
// comments, internal paths — to anyone who opens devtools on the deployed site.
// Nothing consumes them (no error-monitoring service is installed), so the policy is
// "off in production, on everywhere else". These assertions fail if someone flips
// `sourcemap` back to a bare `true`.
const resolve = (mode: string): UserConfig =>
  (config as UserConfigFn)({ command: 'build', mode }) as UserConfig;

describe('vite source-map policy', () => {
  it('emits no source maps for a production build', () => {
    expect(resolve('production').build?.sourcemap).toBe(false);
  });

  it('keeps source maps for development builds', () => {
    expect(resolve('development').build?.sourcemap).toBe(true);
  });

  it('is mode-driven rather than a constant', () => {
    // Guards the actual regression: `sourcemap: true` would satisfy the dev case above
    // while still shipping maps to production.
    expect(resolve('production').build?.sourcemap).not.toBe(resolve('development').build?.sourcemap);
  });
});
