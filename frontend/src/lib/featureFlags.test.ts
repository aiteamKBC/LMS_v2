import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('learner feedback feature flag', () => {
  it('is disabled in production builds', async () => {
    vi.stubEnv('DEV', false);
    const { LEARNER_FEEDBACK_ENABLED, LEARNER_POST_LECTURE_FEEDBACK_ENABLED } = await import('./featureFlags');
    expect(LEARNER_FEEDBACK_ENABLED).toBe(false);
    expect(LEARNER_POST_LECTURE_FEEDBACK_ENABLED).toBe(true);
  });

  it('is enabled automatically in local development', async () => {
    vi.stubEnv('DEV', true);
    const { LEARNER_FEEDBACK_ENABLED } = await import('./featureFlags');
    expect(LEARNER_FEEDBACK_ENABLED).toBe(true);
  });
});
