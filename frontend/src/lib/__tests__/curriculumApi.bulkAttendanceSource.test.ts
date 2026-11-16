import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('isolates learner-backed overview requests from the ordinary overview cache', async () => {
  vi.resetModules();
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ modules: [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetch);
  const { fetchCurriculumOverview } = await import('../curriculumApi');
  await fetchCurriculumOverview(undefined, { compact: true, visibility: 'all' });
  await fetchCurriculumOverview(undefined, { compact: true, visibility: 'all', learnerSource: 'profiles' });
  await fetchCurriculumOverview(undefined, { visibility: 'all', learnerSource: 'profiles' });
  const urls = fetch.mock.calls.map(([url]) => new URL(String(url), 'https://example.test'));
  expect(urls).toHaveLength(3);
  expect(urls.map(url => url.searchParams.get('learner_source'))).toEqual([null, 'profiles', 'profiles']);
  expect(urls.map(url => url.searchParams.get('compact'))).toEqual(['true', 'true', null]);
  expect(urls.every(url => url.searchParams.get('visibility') === 'all')).toBe(true);
});
