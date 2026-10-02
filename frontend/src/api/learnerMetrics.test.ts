import { beforeEach, describe, expect, it, vi } from 'vitest';
const read = vi.hoisted(() => vi.fn());
vi.mock('./learnerRead', () => ({ readLearnerJson: read, peekLearnerJson: vi.fn() }));
import { fetchLearnerMetrics } from './learnerMetrics';
import { fetchLearnerProfileMetrics } from '@/features/coach/learner-profile/api/learnerProfileApi';

describe('learner metrics perspectives', () => {
  beforeEach(() => { read.mockReset(); read.mockResolvedValue({ programme: { status: 'ready' }, ksb: { status: 'ready' }, otjh: {} }); });
  it('preserves the ordinary learner metrics URL', async () => {
    await fetchLearnerMetrics('commercial', '125');
    expect(read).toHaveBeenCalledWith('/learner_api/metrics/commercial/125/', expect.any(Object));
  });
  it('requests learner Overview totals with a separate cache key for the coach case file', async () => {
    const controller = new AbortController();
    await fetchLearnerProfileMetrics('commercial', '125', controller.signal, true);
    expect(read).toHaveBeenCalledWith('/learner_api/metrics/commercial/125/?view=learner-overview',
      expect.objectContaining({ signal: controller.signal, revalidate: true }));
  });
});
