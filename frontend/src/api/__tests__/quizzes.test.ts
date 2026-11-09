import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateQuizReading, submitQuizAttempt } from '../quizzes';
import { ActivityTimeConflictError } from '@/lib/activityTimeConflict';

afterEach(() => vi.unstubAllGlobals());

describe('quiz time conflicts', () => {
  const submission = { componentId: 'PROGRAMME-Q1', answers: { '1': 1 }, timeTakenSeconds: 120, startedAt: '2026-11-01T10:00:00Z', trackingToken: 'synthetic' };
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
