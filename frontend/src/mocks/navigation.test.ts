import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('learner feedback navigation flag', () => {
  it('shows feedback in production builds', async () => {
    vi.stubEnv('DEV', false);
    const { roleNavMap } = await import('./navigation');
    expect(roleNavMap.learner.items.some(item => item.href === '/learner/feedback')).toBe(true);
  });

  it('shows feedback automatically in local development', async () => {
    vi.stubEnv('DEV', true);
    const { roleNavMap } = await import('./navigation');
    expect(roleNavMap.learner.items.some(item => item.href === '/learner/feedback')).toBe(true);
  });
});
