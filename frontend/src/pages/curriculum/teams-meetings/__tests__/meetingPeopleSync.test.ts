import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { refreshTeamsPeople, readTeamsPeopleState } from '../meetingPeopleSync';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
const form = { organizerEmail: 'owner@example.invalid', attendees: ['learner@example.invalid'],
  presenters: ['tutor@example.invalid'], coOrganizers: ['co@example.invalid'] };

describe('refreshTeamsPeople', () => {
  beforeEach(() => vi.mocked(coachFetch).mockReset());

  it('reads one explicit series and returns only the people/roles form', async () => {
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ form, changed: true })));
    expect(await refreshTeamsPeople('LIVE/ONE')).toEqual({ ...form, attendees: 'learner@example.invalid',
      presenters: 'tutor@example.invalid', coOrganizers: 'co@example.invalid' });
    expect(coachFetch).toHaveBeenCalledWith(expect.stringContaining('/LIVE%2FONE/refresh-people/'), expect.objectContaining({
      method: 'POST', body: '{}', signal: expect.any(AbortSignal),
    }));
  });

  it.each([null, {}, { ...form, coOrganizers: null }, { ...form, attendees: [null] }, { ...form, organizerEmail: null }])(
    'refuses incomplete snapshots instead of returning empty roles: %j', async snapshot => {
      vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ form: snapshot })));
      await expect(refreshTeamsPeople('LIVE')).rejects.toThrow('displayed form was preserved');
    },
  );

  it('reports Microsoft refusal and HTML responses as errors', async () => {
    vi.mocked(coachFetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Roles are not verified.' }), { status: 409 }));
    await expect(refreshTeamsPeople('LIVE')).rejects.toThrow('Roles are not verified.');
    vi.mocked(coachFetch).mockResolvedValueOnce(new Response('<html>unavailable</html>', { status: 502 }));
    await expect(refreshTeamsPeople('LIVE')).rejects.toThrow('could not be refreshed');
  });

  it('polls the local saved status with GET and no write body', async () => {
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ form,
      syncInfo: { status: 'synced', checkedAt: '2026-11-12T10:00:00Z' } })));
    expect((await readTeamsPeopleState('LIVE')).syncInfo.status).toBe('synced');
    expect(coachFetch).toHaveBeenCalledWith(expect.stringContaining('/LIVE/refresh-people/'), expect.objectContaining({ method: 'GET' }));
    expect(vi.mocked(coachFetch).mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('does not present an unreadable worker status as synced', async () => {
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ form, syncInfo: { status: 'synced', checkedAt: 'bad' } })));
    await expect(readTeamsPeopleState('LIVE')).rejects.toThrow('saved Teams people sync status');
  });
});
