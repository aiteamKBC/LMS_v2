import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Two habits of the request layer that only show themselves when something goes
 * wrong or somebody else saves.
 *
 * A read that fails transiently is tried again, because the failure this exists
 * for is a worker being replaced under a deploy -- a second of 502s that used to
 * blank whichever page happened to be reading. A write is never tried again,
 * because a 502 is returned just as readily after the write committed as before.
 *
 * And the preview answers -- "where do these sessions land", "is this tutor
 * free" -- are dropped whenever anything is written. They are the only cached
 * reads not held by the multi-tier cache, and the tutor one exists precisely to
 * stop a save being refused for a clash, so an answer from before somebody took
 * the slot is worse than no answer at all.
 */

const PROGRAMMES_URL = '/curriculum_api/curriculum/programmes/';
const MODULES_URL = '/curriculum_api/curriculum/modules/';
const PREVIEW_URL = '/curriculum_api/curriculum/preview/session-plan/';
const PREVIEW_PATH = '/curriculum/preview/session-plan/';

/** Longer than the two backoffs put together, so a retry has room to run. */
const RETRY_WINDOW_MS = 5_000;

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const serverError = () => json({ error: 'upstream gone' }, 502);
const collection = () => json({ results: [{ id: 'p1' }] });

let fetchMock: ReturnType<typeof vi.fn>;

function callsTo(url: string) {
  return fetchMock.mock.calls.filter(call => String(call[0]) === url).length;
}

async function loadApi() {
  vi.resetModules();
  return import('@/lib/curriculumApi');
}

/** Runs `work` to completion with the retry backoffs fast-forwarded. */
async function settle<T>(work: Promise<T>): Promise<T> {
  const settled = work.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
  await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
  const outcome = await settled as { ok: boolean; value?: T; error?: unknown };
  if (!outcome.ok) throw outcome.error;
  return outcome.value as T;
}

describe('curriculum request resilience', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => collection());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -- retrying the failures worth retrying ---------------------------------

  it('tries a read again after a transient failure', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValueOnce(serverError());

    await expect(settle(api.fetchCurriculumProgrammes())).resolves.toEqual([{ id: 'p1' }]);
    expect(callsTo(PROGRAMMES_URL)).toBe(2);
  });

  it('gives up after two further attempts rather than hammering a dead backend', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(serverError());

    await expect(settle(api.fetchCurriculumProgrammes())).rejects.toThrow(/502/);
    expect(callsTo(PROGRAMMES_URL)).toBe(3);
  });

  it('waits between attempts instead of firing them back to back', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(serverError());

    const pending = api.fetchCurriculumProgrammes().catch(() => null);
    await vi.advanceTimersByTimeAsync(0);
    expect(callsTo(PROGRAMMES_URL)).toBe(1);

    // A quarter of a second later the second attempt has still not gone. The
    // wait is the difference between a retry and a burst: a backend that is
    // restarting needs a moment, and three requests inside a tick give it none.
    await vi.advanceTimersByTimeAsync(250);
    expect(callsTo(PROGRAMMES_URL)).toBe(1);

    // 300ms plus up to 100ms of jitter, so by half a second it has.
    await vi.advanceTimersByTimeAsync(250);
    expect(callsTo(PROGRAMMES_URL)).toBe(2);

    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
    await pending;
    expect(callsTo(PROGRAMMES_URL)).toBe(3);
  });

  it('does not try again when the answer will not change', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(json({ error: 'no such programme' }, 404));

    await expect(settle(api.fetchCurriculumProgrammes())).rejects.toThrow(/404/);
    expect(callsTo(PROGRAMMES_URL)).toBe(1);
  });

  it('retries a read that never reached the server at all', async () => {
    const api = await loadApi();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(settle(api.fetchCurriculumProgrammes())).resolves.toEqual([{ id: 'p1' }]);
    expect(callsTo(PROGRAMMES_URL)).toBe(2);
  });

  it('never sends a write twice', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(serverError());

    await expect(
      settle(api.fetchCurriculumJson(MODULES_URL.replace('/curriculum_api', ''), {
        method: 'POST',
        body: '{}',
      })),
    ).rejects.toThrow(/502/);
    // A 502 can be returned after the row was written, so a second POST would
    // create it twice. One attempt, and the caller is told.
    expect(callsTo(MODULES_URL)).toBe(1);
  });

  it('retries a preview, which is a read wearing a POST', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValueOnce(serverError());

    await settle(api.fetchCurriculumJson(PREVIEW_PATH, { method: 'POST', body: '{"weeks":6}' }));
    expect(callsTo(PREVIEW_URL)).toBe(2);
  });

  // -- the preview cache hears about writes ---------------------------------

  it('answers the same preview question without asking again', async () => {
    const api = await loadApi();

    await api.fetchCurriculumJson(PREVIEW_PATH, { method: 'POST', body: '{"weeks":6}' });
    await api.fetchCurriculumJson(PREVIEW_PATH, { method: 'POST', body: '{"weeks":6}' });

    expect(callsTo(PREVIEW_URL)).toBe(1);
  });

  it('throws the preview answers away when something is written', async () => {
    const api = await loadApi();

    await api.fetchCurriculumJson(PREVIEW_PATH, { method: 'POST', body: '{"weeks":6}' });
    expect(callsTo(PREVIEW_URL)).toBe(1);

    // A module was saved -- which is exactly what changes where sessions land
    // and which tutors are still free.
    await api.fetchCurriculumJson('/curriculum/modules/', { method: 'POST', body: '{}' });

    await api.fetchCurriculumJson(PREVIEW_PATH, { method: 'POST', body: '{"weeks":6}' });
    expect(callsTo(PREVIEW_URL)).toBe(2);
  });

  it('does not keep a preview answer that was already in flight when a write landed', async () => {
    const api = await loadApi();
    let releasePreview: (() => void) | null = null;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => {
      releasePreview = () => resolve(collection());
    }));

    const preview = api.fetchCurriculumJson(PREVIEW_PATH, { method: 'POST', body: '{"weeks":6}' });
    await api.fetchCurriculumJson('/curriculum/modules/', { method: 'POST', body: '{}' });
    releasePreview?.();
    await preview;

    // The answer was computed before the write, so it must not be sitting in
    // the cache afterwards pretending otherwise.
    await api.fetchCurriculumJson(PREVIEW_PATH, { method: 'POST', body: '{"weeks":6}' });
    expect(callsTo(PREVIEW_URL)).toBe(2);
  });
});
