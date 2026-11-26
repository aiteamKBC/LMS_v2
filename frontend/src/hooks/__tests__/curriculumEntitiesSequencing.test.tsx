import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The entity pages' five reads are independent, so they go out together.
 *
 * The regression this guards: `load` used to `await` the compact overview and
 * only then start tutors, coaches, holidays and Teams summaries. The overview
 * is the slowest request on the page -- it is the one that rebuilds the whole
 * curriculum payload -- so the other four waited behind it for nothing. Nothing
 * in them is derived from it: staff come from the enrolment directory, holidays
 * from the calendar, Teams state from its own summary endpoint.
 */
const api = vi.hoisted(() => ({
  fetchCurriculumOverview: vi.fn(),
  fetchCurriculumTutors: vi.fn(),
  fetchCurriculumCoaches: vi.fn(),
  fetchCurriculumHolidays: vi.fn(),
  fetchCurriculumTeamsMeetingSummaries: vi.fn(),
}));

vi.mock('@/lib/curriculumApi', () => api);
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: vi.fn() }));

import { useCurriculumEntities } from '../useCurriculumEntities';

const EMPTY_OVERVIEW = { programmes: [], cohorts: [], groups: [], modules: [] };

describe('curriculum entity reads', () => {
  let releaseOverview: (value: typeof EMPTY_OVERVIEW) => void;

  beforeEach(() => {
    Object.values(api).forEach(mock => mock.mockReset());
    api.fetchCurriculumOverview.mockImplementation(
      () => new Promise(resolve => { releaseOverview = resolve; }),
    );
    api.fetchCurriculumTutors.mockResolvedValue([]);
    api.fetchCurriculumCoaches.mockResolvedValue([]);
    api.fetchCurriculumHolidays.mockResolvedValue([]);
    api.fetchCurriculumTeamsMeetingSummaries.mockResolvedValue([]);
  });

  it('starts staff, holidays and Teams reads without waiting for the overview', async () => {
    renderHook(() => useCurriculumEntities({
      includeStaff: true, includeHolidays: true, includeTeams: true,
    }));

    // The overview has not resolved. Everything else must already be in flight.
    await waitFor(() => expect(api.fetchCurriculumOverview).toHaveBeenCalled());
    expect(api.fetchCurriculumTutors).toHaveBeenCalled();
    expect(api.fetchCurriculumCoaches).toHaveBeenCalled();
    expect(api.fetchCurriculumHolidays).toHaveBeenCalled();
    expect(api.fetchCurriculumTeamsMeetingSummaries).toHaveBeenCalled();

    releaseOverview(EMPTY_OVERVIEW);
  });

  it('asks for nothing it was not told to include', async () => {
    renderHook(() => useCurriculumEntities());

    await waitFor(() => expect(api.fetchCurriculumOverview).toHaveBeenCalled());
    expect(api.fetchCurriculumTutors).not.toHaveBeenCalled();
    expect(api.fetchCurriculumCoaches).not.toHaveBeenCalled();
    expect(api.fetchCurriculumHolidays).not.toHaveBeenCalled();
    expect(api.fetchCurriculumTeamsMeetingSummaries).not.toHaveBeenCalled();

    releaseOverview(EMPTY_OVERVIEW);
  });

  it('does not bypass either cache on the first load', async () => {
    renderHook(() => useCurriculumEntities({ includeStaff: true, includeHolidays: true }));

    await waitFor(() => expect(api.fetchCurriculumOverview).toHaveBeenCalled());
    for (const call of [
      api.fetchCurriculumOverview, api.fetchCurriculumTutors,
      api.fetchCurriculumCoaches, api.fetchCurriculumHolidays,
    ]) {
      const options = call.mock.calls[0][1];
      expect(options.skipCache).toBeFalsy();
      expect(options.revalidate).toBeFalsy();
    }

    releaseOverview(EMPTY_OVERVIEW);
  });

  it('still paints the structure as soon as the overview lands', async () => {
    const { result } = renderHook(() => useCurriculumEntities({ includeStaff: true }));

    await waitFor(() => expect(api.fetchCurriculumOverview).toHaveBeenCalled());
    releaseOverview({ ...EMPTY_OVERVIEW, programmes: [{ id: 'P1' }] } as never);

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.programmes).toHaveLength(1);
  });

  it('keeps the optional collections when one of them fails', async () => {
    api.fetchCurriculumTutors.mockRejectedValue(new Error('directory down'));
    const { result } = renderHook(() => useCurriculumEntities({ includeStaff: true }));

    await waitFor(() => expect(api.fetchCurriculumOverview).toHaveBeenCalled());
    releaseOverview({ ...EMPTY_OVERVIEW, groups: [{ id: 'G1' }] } as never);

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.tutors).toEqual([]);
  });
});
