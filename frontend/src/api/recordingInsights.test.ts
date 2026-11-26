import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadRecordingInsights } from './recordingInsights';

const file = { id: 'R', type: 'recording' as const, state: 'ready' as const };
const learner = { kind: 'commercial' as const, id: '7' };
const signal = () => new AbortController().signal;
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());
const respond = (value: unknown, status = 200) => vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(value), { status }));

it('uses the existing learner artifact endpoint and returns only highlight fields', async () => {
  respond({ audience: 'learner', highlights: { watched: 12, finished: 5 }, private: 'ignored' });
  expect(await loadRecordingInsights('S', file, learner, signal())).toEqual({ audience: 'learner', highlights: { watched: 12, finished: 5 } });
  expect(fetch).toHaveBeenCalledWith('/learner_api/session-results/commercial/7/S/artifacts/R/?format=engagement', expect.objectContaining({ credentials: 'include' }));
});

it('keeps the engagement query inside the authorised personal-learning request path', async () => {
  respond({ audience: 'learner', highlights: { watched: null, finished: null } });
  await loadRecordingInsights('S', file, { kind: 'commercial', id: 'pl.7.study.M' }, signal());
  const called = new URL(vi.mocked(fetch).mock.calls[0][0] as string, window.location.origin);
  expect(called.pathname).toBe('/learner_api/personal-learning/pl.7.study.M/request/');
  expect(called.searchParams.get('path')).toBe('/learner_api/session-results/commercial/pl.7.study.M/S/artifacts/R/?format=engagement');
});

it('rejects staff detail for a learner and malformed counts without displaying invented values', async () => {
  for (const value of [{ audience: 'staff', learners: 12 }, { audience: 'learner', highlights: { watched: -1, finished: 5 } }]) {
    respond(value);
    await expect(loadRecordingInsights('S', file, learner, signal())).rejects.toThrow('verified');
  }
  respond({}, 503);
  await expect(loadRecordingInsights('S', file, learner, signal())).rejects.toThrow('loaded');
});
