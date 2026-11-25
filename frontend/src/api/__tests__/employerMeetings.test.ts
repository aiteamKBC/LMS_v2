import { afterEach, expect, it, vi } from 'vitest';
import { fetchEmployerTeamsMeetings } from '../employerMeetings';

afterEach(() => vi.unstubAllGlobals());
it('uses the employer-owned route with credentials and cancellation', async () => {
  const body = { meetings: [], status: 'ready' };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  expect(await fetchEmployerTeamsMeetings('271', signal)).toEqual(body);
  expect(fetch).toHaveBeenCalledWith('/learner_api/employer-portal/271/meetings/', { credentials: 'include', signal });
});
it('does not fabricate empty success for unauthorized or invalid responses', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 403 })).mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  await expect(fetchEmployerTeamsMeetings('271', signal)).rejects.toThrow('Teams invitations could not be loaded');
  await expect(fetchEmployerTeamsMeetings('271', signal)).rejects.toThrow('Teams invitations could not be loaded');
});
