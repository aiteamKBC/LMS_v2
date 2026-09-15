import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateQuizReading } from '../quizzes';

afterEach(() => vi.unstubAllGlobals());

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
