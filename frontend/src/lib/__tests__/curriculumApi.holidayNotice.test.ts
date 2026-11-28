import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCurriculumGetCache, fetchCurriculumTeamsMeetingSummaries } from '@/lib/curriculumApi';

const staff = { moduleCatalogueId: 'MOD-SYNTHETIC', holidayInvitationNotice: {
  code: 'existing_holiday_invitations', invitationCount: 1, invitations: [] } };
const learner = { moduleCatalogueId: 'MOD-SYNTHETIC' };
const response = (value: unknown) => new Response(JSON.stringify({ results: [value] }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});

describe('Role-specific calendar guidance', () => {
  const network = vi.fn();
  beforeEach(() => { clearCurriculumGetCache(); network.mockReset(); vi.stubGlobal('fetch', network); });
  afterEach(() => { clearCurriculumGetCache(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('does not reuse a staff payload for a later learner request', async () => {
    network.mockResolvedValueOnce(response(staff)).mockResolvedValueOnce(response(learner));
    const first = await fetchCurriculumTeamsMeetingSummaries(undefined, { occurrenceDates: true });
    const next = await fetchCurriculumTeamsMeetingSummaries(undefined, { occurrenceDates: true });
    expect(first[0].holidayInvitationNotice).toBeDefined();
    expect(next[0].holidayInvitationNotice).toBeUndefined();
    expect(network).toHaveBeenCalledTimes(2);
    expect(network.mock.calls[1][1].cache).toBe('no-store');
  });

  it('does not join an in-flight role-specific request', async () => {
    network.mockResolvedValueOnce(response(staff)).mockResolvedValueOnce(response(learner));
    const [first, next] = await Promise.all([
      fetchCurriculumTeamsMeetingSummaries(undefined, { occurrenceDates: true }),
      fetchCurriculumTeamsMeetingSummaries(undefined, { occurrenceDates: true }),
    ]);
    expect(network).toHaveBeenCalledTimes(2);
    expect(first[0].holidayInvitationNotice).toBeDefined();
    expect(next[0].holidayInvitationNotice).toBeUndefined();
  });

  it('preserves caching for the existing lightweight counts response', async () => {
    network.mockResolvedValue(response(learner));
    await fetchCurriculumTeamsMeetingSummaries();
    await fetchCurriculumTeamsMeetingSummaries();
    expect(network).toHaveBeenCalledTimes(1);
  });
});
