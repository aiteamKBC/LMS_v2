import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('learner feedback feature flag', () => {
  it('enables every feedback type in production builds', async () => {
    vi.stubEnv('DEV', false);
    const { LEARNER_FEEDBACK_ENABLED, LEARNER_POST_LECTURE_FEEDBACK_ENABLED } = await import('./featureFlags');
    expect(LEARNER_FEEDBACK_ENABLED).toBe(true);
    expect(LEARNER_POST_LECTURE_FEEDBACK_ENABLED).toBe(true);
  });

  it('is enabled automatically in local development', async () => {
    vi.stubEnv('DEV', true);
    const { LEARNER_FEEDBACK_ENABLED, LEARNER_POST_LECTURE_FEEDBACK_ENABLED } = await import('./featureFlags');
    expect(LEARNER_FEEDBACK_ENABLED).toBe(true);
    expect(LEARNER_POST_LECTURE_FEEDBACK_ENABLED).toBe(true);
  });

  it.each([false, true])('keeps learner navigation consistent with local mode %s', async development => {
    vi.stubEnv('DEV', development);
    const { learnerNavItems } = await import('@/mocks/navigation');
    expect(learnerNavItems.some(item => item.id === 'learner-feedback')).toBe(true);
  });
});
