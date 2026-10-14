import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('learner feedback feature flag', () => {
  it('is disabled in production builds', async () => {
    vi.stubEnv('DEV', false);
    const { LEARNER_FEEDBACK_ENABLED } = await import('./featureFlags');
    expect(LEARNER_FEEDBACK_ENABLED).toBe(false);
  });

  it('is enabled automatically in local development', async () => {
    vi.stubEnv('DEV', true);
    const { LEARNER_FEEDBACK_ENABLED } = await import('./featureFlags');
    expect(LEARNER_FEEDBACK_ENABLED).toBe(true);
  });
});
