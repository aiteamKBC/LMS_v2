import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { compareTeamsAttendees, pendingInvitations } from '../attendeeComparison';

const transport = vi.fn();
const body = {
  status: 'different', lmsCount: 2, teamsCount: 2, matchingCount: 1, extraCount: 1, missingCount: 1,
  matching: [{ email: 'ahmed@example.com', name: 'Ahmed' }],
  extraOnTeams: [{ email: 'john@example.com', name: 'John Smith' }],
  missingFromTeams: [{ email: 'sara@example.com', name: 'Sara' }],
  aliasPossible: true, checkedAt: '2026-09-30T16:48:00Z',
};
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', transport); });
afterEach(() => vi.unstubAllGlobals());

it('reads the comparison with the session credentials and asks Microsoft for nothing else', async () => {
  transport.mockResolvedValue({ ok: true, json: async () => body });
  expect(await compareTeamsAttendees('LIVE/ONE')).toEqual(body);
  const [url, options] = transport.mock.calls[0];
  expect(url).toBe('/curriculum_api/curriculum/teams-meetings/LIVE%2FONE/compare-attendees/');
  expect(options.method).toBe('GET');
  expect(options.credentials).toBe('include');
  // A read carries no body, so nothing about the open form can reach the server.
  expect(options.body).toBeUndefined();
});

it('surfaces the server’s own explanation rather than a generic failure', async () => {
  transport.mockResolvedValue({ ok: false, json: async () => ({ error: 'The Microsoft calendar event could not be found.' }) });
  await expect(compareTeamsAttendees('LIVE-1')).rejects.toThrow('The Microsoft calendar event could not be found.');
});

it('explains a failure the server did not describe', async () => {
  transport.mockResolvedValue({ ok: false, json: async () => ({}) });
  await expect(compareTeamsAttendees('LIVE-1')).rejects.toThrow('Unable to read the current attendee list from Microsoft.');
});

it('refuses a malformed comparison instead of showing invented counts', async () => {
  for (const broken of [
    { ...body, matching: [{ name: 'No address' }] },
    { ...body, extraOnTeams: 'john@example.com' },
    { ...body, missingCount: '1' },
    { ...body, status: 'maybe' },
    { ...body, checkedAt: 'whenever' },
  ]) {
    transport.mockResolvedValueOnce({ ok: true, json: async () => broken });
    await expect(compareTeamsAttendees('LIVE-1')).rejects.toThrow('could not be read');
  }
});

it('treats a nameless person as nameless rather than dropping them', async () => {
  transport.mockResolvedValue({
    ok: true,
    json: async () => ({ ...body, extraOnTeams: [{ email: 'john@example.com' }] }),
  });
  expect((await compareTeamsAttendees('LIVE-1')).extraOnTeams).toEqual([{ email: 'john@example.com', name: '' }]);
});

it('counts only the typed addresses no save has published', () => {
  expect(pendingInvitations(
    ['Ahmed@Example.com', ' sara@example.com ', 'mohamed@example.com', 'MOHAMED@example.com', '  '],
    ['ahmed@example.com', 'sara@example.com'],
  )).toEqual(['mohamed@example.com']);
});

it('reports nothing pending when the form matches what was published', () => {
  expect(pendingInvitations(['ahmed@example.com'], ['ahmed@example.com', 'sara@example.com'])).toEqual([]);
});
