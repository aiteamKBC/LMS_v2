import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLearnerJson } from '@/api/learnerRead';
import { getActivityContent, getMonth, getSignoffs, getSummary } from './api';

vi.mock('@/api/learnerRead', async original => ({
  ...await original<typeof import('@/api/learnerRead')>(), readLearnerJson: vi.fn().mockResolvedValue({}),
}));

afterEach(() => { window.history.replaceState(null, '', '/'); vi.clearAllMocks(); });

describe('monitoring request perspective', () => {
  it('preserves the monitoring restriction on summaries, months, signatures and content', async () => {
    window.history.replaceState(null, '', '/old-otjh/coach/42/months/2026-07?workspace=monitor');
    await getSummary(42);
    await getMonth('2026-07', 42);
    await getSignoffs(42, '2026-07');
    await getActivityContent('2026-07', 3, 42);
    expect(vi.mocked(readLearnerJson).mock.calls).toHaveLength(4);
    for (const [url] of vi.mocked(readLearnerJson).mock.calls) {
      expect(new URL(url, 'http://localhost').searchParams.get('workspace')).toBe('monitor');
      expect(new URL(url, 'http://localhost').searchParams.get('aptem_id')).toBe('42');
    }
  });

  it('does not carry monitoring into the normal coach or learner workspace', async () => {
    for (const path of ['/old-otjh/coach/42', '/learner/home?workspace=monitor']) {
      window.history.replaceState(null, '', path);
      await getSummary(42);
      expect(new URL(vi.mocked(readLearnerJson).mock.lastCall![0], 'http://localhost').searchParams.has('workspace')).toBe(false);
    }
  });
});
