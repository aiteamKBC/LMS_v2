import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadLearningReflectionStatuses, saveLearningReflectionSubmission, type LearningReflectionSubmissionInput } from './reflectionSubmission';
import { CompletionValidationError } from '@/lib/completionValidation';

afterEach(() => {
  vi.restoreAllMocks();
});

it('retains the server receipt for an added lecture duration', async () => {
  const lectureReflectionTime = { seconds: 1800, progressEntryId: 10, addedAt: 'now', countedSeconds: 9000 };
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'R', status: 'submitted_for_tutor_review', lectureReflectionTime }), { status: 201 }));
  const result = await saveLearningReflectionSubmission({ learnerKind: 'apprenticeship', learnerId: '19', activityId: 'LECTURE' } as LearningReflectionSubmissionInput);
  expect(result.lectureReflectionTime).toEqual(lectureReflectionTime);
});

it('opens the existing correction flow for a working-time refusal instead of reporting success', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Confirm when the reflection was written.', validation: { reason: 'weekend', holidayName: '' } }), { status: 409 }));
  await expect(saveLearningReflectionSubmission({ learnerKind: 'apprenticeship', learnerId: '19' } as LearningReflectionSubmissionInput)).rejects.toBeInstanceOf(CompletionValidationError);
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
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }),
    );
    expect(statuses).toEqual({
      'quiz:quiz-68': 'accepted',
      'reading:COMP-1': 'submitted_for_tutor_review',
    });
  });
});
