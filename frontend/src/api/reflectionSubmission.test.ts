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

it.each([undefined, { seconds: 1800, progressEntryId: 0 }, { seconds: 900, progressEntryId: 10 }])('does not confirm an addition without the matching server receipt (%s)', async lectureReflectionTime => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'R', status: 'submitted_for_tutor_review', lectureReflectionTime }), { status: 201 }));
  await expect(saveLearningReflectionSubmission({ learnerKind: 'apprenticeship', learnerId: '19', additionalReflectionSeconds: 1800 } as LearningReflectionSubmissionInput))
    .rejects.toThrow('Your reflection was saved, but its additional time was not confirmed.');
});

it('keeps a positive draft uncredited and confirms a new action using its input and operation ID', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ id: 'R', status: 'draft' }), { status: 201 }));
  const input = { learnerKind: 'apprenticeship', learnerId: '19', additionalReflectionSeconds: 1200,
    reflectionTimeOperation: { id: 'operation-1', choice: 'add', reason: '', expectedReflectionSeconds: 1800, expectedProgressEntryId: 10 } } as LearningReflectionSubmissionInput;
  await expect(saveLearningReflectionSubmission({ ...input, submissionMode: 'draft' })).resolves.toMatchObject({ status: 'draft' });
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'R', status: 'submitted_for_tutor_review',
    lectureReflectionTime: { seconds: 3000, inputSeconds: 1200, operationId: 'operation-1', progressEntryId: 11, countedSeconds: 10200 } }), { status: 201 }));
  await expect(saveLearningReflectionSubmission(input)).resolves.toMatchObject({ lectureReflectionTime: { seconds: 3000 } });
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'R', lectureReflectionTime: {
    seconds: 3000, inputSeconds: 1200, operationId: 'another-operation', progressEntryId: 11 } }), { status: 201 }));
  await expect(saveLearningReflectionSubmission(input)).rejects.toThrow('additional time was not confirmed');
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
