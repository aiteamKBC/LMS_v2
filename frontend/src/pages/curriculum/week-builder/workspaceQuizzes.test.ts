import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWorkspaceQuizzes } from './weekTemplateData';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const response = (id = 1) => new Response(JSON.stringify({ results: [{ id, title: 'Quiz', passingGrade: 70 }] }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('quiz picker reads', () => {
  it('shares concurrent mounts while cancellation only detaches one reader', async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const first = fetchWorkspaceQuizzes(controller.signal);
    const aborted = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    const second = fetchWorkspaceQuizzes(new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/quiz_api/quizzes/?status=all&assessmentType=quiz&view=picker');
    pending.resolve(response());
    await aborted;
    expect(await second).toEqual([{ id: 1, title: 'Quiz', passingGrade: 70 }]);
  });

  it('refresh after an edit starts a fresh read and an older response cannot clear it', async () => {
    const older = deferred<Response>();
    const fresh = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(fresh.promise);
    vi.stubGlobal('fetch', fetch);
    const first = fetchWorkspaceQuizzes();
    const refreshed = fetchWorkspaceQuizzes(undefined, { refresh: true });
    older.resolve(response(1));
    await first;
    const joined = fetchWorkspaceQuizzes();
    expect(fetch).toHaveBeenCalledTimes(2);
    fresh.resolve(response(2));
    expect(await refreshed).toEqual(await joined);
    expect((await joined)[0].id).toBe(2);
  });

  it('does not retain errors or a settled list across refreshes', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(response(2)).mockResolvedValueOnce(response(3));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchWorkspaceQuizzes()).rejects.toThrow('503');
    expect((await fetchWorkspaceQuizzes())[0].id).toBe(2);
    expect((await fetchWorkspaceQuizzes())[0].id).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not start a request for an already closed editor', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(fetchWorkspaceQuizzes(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
