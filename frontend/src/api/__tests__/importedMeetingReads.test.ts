import { afterEach, expect, it, vi } from 'vitest';
import { fetchEmployerMeetingArtifacts } from '../employerPortal';
import { fetchLearnerMeetingArtifacts, fetchLearnerMeetingRecordings } from '../learnerCalendar';

afterEach(() => vi.unstubAllGlobals());

it.each(['commercial', 'apprenticeship'] as const)('reads newly saved resources through authenticated GET for both %s portals', async kind => {
  const before = { artifacts: [], resourceMode: 'stored' };
  const after = { artifacts: [{ id: 'saved-recording', artifact_type: 'recording', content_available: true }], resourceMode: 'stored' };
  const fetch = vi.fn().mockImplementationOnce(async () => new Response(JSON.stringify(before)))
    .mockImplementationOnce(async () => new Response(JSON.stringify(after)))
    .mockImplementationOnce(async () => new Response(JSON.stringify(before)))
    .mockImplementationOnce(async () => new Response(JSON.stringify(after)));
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  await expect(fetchLearnerMeetingArtifacts(kind, '71', 'imported-review:901', signal)).resolves.toEqual(before);
  await expect(fetchLearnerMeetingArtifacts(kind, '71', 'imported-review:901', signal)).resolves.toEqual(after);
  await expect(fetchEmployerMeetingArtifacts('91', kind, '71', 'imported-review:901', signal)).resolves.toEqual(before);
  await expect(fetchEmployerMeetingArtifacts('91', kind, '71', 'imported-review:901', signal)).resolves.toEqual(after);
  expect(fetch).toHaveBeenCalledTimes(4);
  for (const [url, init] of fetch.mock.calls) {
    expect(url).toMatch(/^\/learner_api\//);
    expect(url).toContain('/imported-review%3A901/artifacts/');
    expect(init.method || 'GET').toBe('GET');
    expect(init.credentials).toBe('include');
    // The learner read client owns its transport signal for deduplicated reads.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBeUndefined();
  }
});

it.each(['commercial', 'apprenticeship'] as const)('requests stored recordings separately from the unchanged artifact read for %s', async kind => {
  const data = { artifacts: [], resourceMode: 'stored' };
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(data)));
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  await fetchLearnerMeetingRecordings(kind, '71', 'mcr:booking/901', signal);
  await fetchLearnerMeetingArtifacts(kind, '71', 'mcr:booking/901', signal);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][0]).toBe(`/learner_api/calendar/${kind}/71/events/mcr%3Abooking%2F901/artifacts/?recordings_only=1`);
  expect(fetch.mock.calls[1][0]).toBe(`/learner_api/calendar/${kind}/71/events/mcr%3Abooking%2F901/artifacts/`);
  for (const [, init] of fetch.mock.calls) {
    expect(init.method || 'GET').toBe('GET');
    expect(init.credentials).toBe('include');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBeUndefined();
  }
});
