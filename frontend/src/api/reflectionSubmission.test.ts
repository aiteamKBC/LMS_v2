import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadLearningReflectionStatuses } from './reflectionSubmission';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reflection submission API', () => {
  it('loads all learner reflection statuses with one request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      statuses: [
        { activityType: 'quiz', activityId: 'quiz-68', status: 'accepted' },
        { activityType: 'reading', activityId: 'COMP-1', status: 'submitted_for_tutor_review' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const statuses = await loadLearningReflectionStatuses({
      learnerKind: 'commercial',
      learnerId: '19',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/learner_api/reflection/submissions/?learnerKind=commercial&learnerId=19',
    );
    expect(statuses).toEqual({
      'quiz:quiz-68': 'accepted',
      'reading:COMP-1': 'submitted_for_tutor_review',
    });
  });
});
