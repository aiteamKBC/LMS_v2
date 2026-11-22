import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readLearnerJson } from './learnerRead';
import { clearAllCachedResources } from './cachedRequest';

vi.mock('./learnerRead', () => ({ readLearnerJson: vi.fn() }));

import { fetchFreeCourseQuiz, fetchLearnerFreeCourse, fetchLearnerFreeCourses, saveFreeCourseActivityState } from './freeCourses';


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

describe('canonical Free Course activity events', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('records reading viewed without requesting completion', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ completed: false }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    await saveFreeCourseActivityState('commercial', '19', 'READ-1', 'reading_viewed');
    expect(request).toHaveBeenCalledWith('/learner_api/free-courses/commercial/19/complete/',
      expect.objectContaining({ method: 'POST',
        body: JSON.stringify({ componentId: 'READ-1', activityState: 'reading_viewed' }) }));
  });

  it('does not report an archived activity as successfully saved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Completion withdrawn' }), { status: 409 })));
    await expect(saveFreeCourseActivityState('commercial', '19', 'READ-1', 'completed'))
      .rejects.toThrow('Completion withdrawn');
  });
});
