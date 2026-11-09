import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readLearnerJson } from './learnerRead';
import { clearAllCachedResources } from './cachedRequest';

vi.mock('./learnerRead', () => ({ readLearnerJson: vi.fn() }));

import { fetchFreeCourseQuiz, fetchLearnerFreeCourse, fetchLearnerFreeCourses } from './freeCourses';


describe('Free Course quiz reads', () => {
  beforeEach(() => {
    clearAllCachedResources();
    vi.mocked(readLearnerJson).mockReset();
  });

  it('loads lightweight cards separately from one opened course', async () => {
    const summary = [{ freeCourseId: 'FREE 1', courseName: 'Course', weekCount: 1, activityCount: 2 }];
    const detail = { freeCourseId: 'FREE 1', courseName: 'Course', weeks: [] };
    vi.mocked(readLearnerJson)
      .mockResolvedValueOnce({ freeCourses: summary } as never)
      .mockResolvedValueOnce({ freeCourse: detail } as never);

    await expect(fetchLearnerFreeCourses('commercial', '19')).resolves.toEqual(summary);
    await expect(fetchLearnerFreeCourse('commercial', '19', 'FREE 1')).resolves.toEqual(detail);

    expect(readLearnerJson).toHaveBeenNthCalledWith(1, '/learner_api/free-courses/commercial/19/');
    expect(readLearnerJson).toHaveBeenNthCalledWith(2, '/learner_api/free-courses/commercial/19/courses/FREE%201/');
  });

  it('uses learner and component assignment context rather than a bare quiz id', async () => {
    const quiz = { id: 7, title: 'Assigned quiz', questions: [] };
    vi.mocked(readLearnerJson).mockResolvedValue(quiz as never);

    await expect(fetchFreeCourseQuiz('commercial', '19', 'FREECOMP 1')).resolves.toBe(quiz);

    expect(readLearnerJson).toHaveBeenCalledWith(
      '/learner_api/free-courses/commercial/19/quiz/FREECOMP%201/',
    );
  });
});
