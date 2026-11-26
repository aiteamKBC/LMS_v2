import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateQuizReading, submitQuizAttempt } from '../quizzes';
import { startTimeTracking } from '../timeTracking';
import { ActivityTimeConflictError } from '@/lib/activityTimeConflict';

afterEach(() => vi.unstubAllGlobals());

describe('personal learning quiz transport', () => {
  it.each(['preview', 'all', 'study'] as const)('starts quiz timing and submits answers in %s mode', async mode => {
    const learnerId = `pl.7.${mode}.MOD-A`;
    const session = { sessionId: 'synthetic-session', trackingToken: 'synthetic-token',
      startedAt: '2026-11-24T10:00:00Z', countingMode: 'active_quiz', rewardTracking: false };
    const result = { preview: mode !== 'study', passed: true, grade: 1 };
    const request = vi.fn(async (input: string, options?: RequestInit) => {
      const headers = new Headers(options?.headers);
      // Mirror the gateway's exact-value check after browser normalization.
      if (headers.get('X-Requested-With') !== 'XMLHttpRequest') {
        return new Response(JSON.stringify({ error: 'Request verification is required.' }), { status: 403 });
      }
      const url = new URL(input, window.location.origin);
      expect(url.pathname).toBe(`/learner_api/personal-learning/${learnerId}/request/`);
      expect(options?.method).toBe('POST');
      expect(options?.credentials).toBe('include');
      expect(headers.get('Content-Type')).toBe('application/json');
      return new Response(JSON.stringify(url.searchParams.get('path')?.startsWith('/learner_api/time-tracking/') ? session : result));
    });
    vi.stubGlobal('fetch', request);

    const timing = await startTimeTracking('quiz', 7, 'commercial', learnerId, 'active_quiz');
    expect(timing).toEqual(session);
    const submission = { answers: { '1': [10, 11] }, timeTakenSeconds: 33,
      startedAt: timing.startedAt, trackingToken: timing.trackingToken };
    await expect(submitQuizAttempt(7, 'commercial', learnerId, submission)).resolves.toEqual(result);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toEqual({
      activityKind: 'quiz', activityId: '7', countingMode: 'active_quiz', persistent: true,
    });
    expect(JSON.parse(request.mock.calls[1][1]!.body as string)).toEqual(submission);
    expect(new URL(request.mock.calls[1][0], window.location.origin).searchParams.get('path'))
      .toBe(`/learner_api/quizzes/7/submit/?kind=commercial&learnerId=${learnerId}`);
  });
});

describe('quiz time conflicts', () => {
  const submission = { answers: { '1': 1 }, timeTakenSeconds: 120, startedAt: '2026-11-01T10:00:00Z', trackingToken: 'synthetic' };
  it.each([400, 409])('exposes authoritative time for an explicit retry on status %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Review the updated time.', code: 'activity_time_conflict', previousSeconds: 600,
    }), { status })));
    const failure = await submitQuizAttempt(7, 'commercial', '101', submission).catch(error => error);
    expect(failure).toBeInstanceOf(ActivityTimeConflictError);
    expect(failure.previousSeconds).toBe(600);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('keeps malformed conflicts as errors without inventing a time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Time unavailable.', code: 'activity_time_conflict', previousSeconds: null,
    }), { status: 400 })));
    const failure = await submitQuizAttempt(7, 'commercial', '101', submission).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ActivityTimeConflictError);
    expect(failure.message).toBe('Time unavailable.');
  });
});

describe('quiz reading API', () => {
  it('shares concurrent generation requests for the same attempt', async () => {
    let finish!: (response: Response) => void;
    const response = new Promise<Response>(resolve => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => response));

    const first = generateQuizReading(4330, 'commercial', '101', 1);
    const second = generateQuizReading(4330, 'commercial', '101', 1);

    expect(fetch).toHaveBeenCalledOnce();
    finish(new Response(JSON.stringify({
      id: 1,
      quizId: 4330,
      attempt: 1,
      material: { title: 'Review', summary: 'Summary', sections: [], keyTakeaways: [] },
      completed: false,
      startedAt: null,
      completedAt: null,
      timeTaken: null,
      verifiedSeconds: null,
    }), { status: 200 }));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
