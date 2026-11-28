import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assignCurriculumLearners, fetchLearnerAssignments } from '../curriculumLearnerAssignments';
import { clearCurriculumGetCache, fetchCurriculumJson } from '@/lib/curriculumApi';
import { invalidateLearnerDetailCache } from '../learnerDetail';
import { invalidateWizardCacheById } from '../extendedIlr';

vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumJson: vi.fn(), clearCurriculumGetCache: vi.fn() }));
vi.mock('../learnerDetail', () => ({ invalidateLearnerDetailCache: vi.fn() }));
vi.mock('../extendedIlr', () => ({ invalidateWizardCacheById: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('curriculum learner assignment API', () => {
  it('reads the correct module directory with authentication and cancellation', async () => {
    const signal = new AbortController().signal;
    await fetchLearnerAssignments({ scope: 'module', id: 'MOD/1', name: 'Module' }, signal);
    expect(fetchCurriculumJson).toHaveBeenCalledWith('/curriculum/modules/MOD%2F1/learner-assignments/', {
      signal, revalidate: true, credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  });

  it('posts only selected IDs and invalidates both curriculum and learner caches after saving', async () => {
    vi.mocked(fetchCurriculumJson).mockResolvedValueOnce({ assignedCount: 2, changedCount: 2, moduleCount: 3 });
    await assignCurriculumLearners({ scope: 'cohort', id: 'COHORT-1', name: 'Cohort' }, ['1', '2']);
    expect(fetchCurriculumJson).toHaveBeenCalledWith('/curriculum/cohorts/COHORT-1/learner-assignments/', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ learnerIds: ['1', '2'] }), credentials: 'include',
    }));
    expect(clearCurriculumGetCache).toHaveBeenCalledOnce();
    expect(invalidateWizardCacheById).toHaveBeenCalledWith('1');
    expect(invalidateWizardCacheById).toHaveBeenCalledWith('2');
    expect(invalidateLearnerDetailCache).toHaveBeenCalledOnce();
  });

  it('propagates a save failure without treating it as a successful learner update', async () => {
    vi.mocked(fetchCurriculumJson).mockRejectedValueOnce(new Error('Save failed'));
    await expect(assignCurriculumLearners({ scope: 'module', id: 'MOD-1', name: 'Module' }, ['1'])).rejects.toThrow('Save failed');
    expect(invalidateLearnerDetailCache).not.toHaveBeenCalled();
    expect(clearCurriculumGetCache).not.toHaveBeenCalled();
  });
});
