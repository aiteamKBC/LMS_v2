import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as curriculumApi from '@/lib/curriculumApi';
import { CohortFormDrawer } from '../forms';

/**
 * Holidays applied to a cohort push its end dates out, and the picker that
 * chooses them is filtered by those same dates. That is a loop unless the
 * picker is pinned to the *base* period, so these tests hold the two halves
 * apart: the extension has to reach the dates, and it must not feed itself.
 */

const HOLIDAYS = [
  { id: 'HOL-1', label: 'Oct 27', startDate: '2027-09-26', endDate: '2027-10-02', type: 'Break', color: '#dc2626' },
  // Starts the day after the *base* end date (31 Jan 2028) but before the
  // extended one, so it must never appear in the picker or be counted.
  { id: 'HOL-2', label: 'Feb 28', startDate: '2028-02-01', endDate: '2028-02-07', type: 'Break', color: '#dc2626' },
] as never[];

const PROGRAMMES = [{ id: 'PROG-1', name: 'MBA' }] as never[];

function baseProps() {
  return {
    open: true,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    programmes: PROGRAMMES,
    cohorts: [] as never[],
    holidays: HOLIDAYS,
    cohort: {
      id: 'COHORT-1',
      name: 'Feb -2026',
      programmeId: 'PROG-1',
      startDate: '2026-02-01',
      durationMonths: 24,
      epaMonths: 5,
      holidayIds: ['HOL-1'],
      color: '#6d28d9',
    } as never,
  };
}

describe('cohort holiday extension', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the ticked holidays to the preview so the end dates can extend', async () => {
    const preview = vi.spyOn(curriculumApi, 'previewCohortEndDate').mockResolvedValue({
      endDate: '2028-02-07',
      practicalEndDate: '2028-02-07',
      calculatedEndDate: '2028-02-07',
      baseEndDate: '2028-01-31',
      holidayExtensionDays: 7,
      apprenticeshipEndDate: '2028-07-07',
      autoCalculated: true,
      rule: 'test',
      warnings: [],
    } as never);

    render(<CohortFormDrawer {...(baseProps() as never)} />);

    await waitFor(() => expect(preview).toHaveBeenCalled());
    await waitFor(() => {
      const withHolidays = preview.mock.calls.find(
        ([body]) => ((body as { holidays?: unknown[] }).holidays || []).length > 0,
      );
      expect(withHolidays).toBeTruthy();
      expect((withHolidays![0] as { holidays: { startDate: string }[] }).holidays).toEqual([
        { label: 'Oct 27', startDate: '2027-09-26', endDate: '2027-10-02' },
      ]);
    });
  });

  it('never counts a holiday that starts after the base end date', async () => {
    const preview = vi.spyOn(curriculumApi, 'previewCohortEndDate').mockResolvedValue({
      endDate: '2028-02-07',
      practicalEndDate: '2028-02-07',
      calculatedEndDate: '2028-02-07',
      baseEndDate: '2028-01-31',
      holidayExtensionDays: 7,
      apprenticeshipEndDate: '2028-07-07',
      autoCalculated: true,
      rule: 'test',
      warnings: [],
    } as never);

    // Both holidays ticked, but HOL-2 sits past the base end date.
    const props = baseProps();
    (props.cohort as { holidayIds: string[] }).holidayIds = ['HOL-1', 'HOL-2'];
    render(<CohortFormDrawer {...(props as never)} />);

    await waitFor(() => expect(preview).toHaveBeenCalled());
    await waitFor(() => {
      const withHolidays = preview.mock.calls.find(
        ([body]) => ((body as { holidays?: unknown[] }).holidays || []).length > 0,
      );
      expect(withHolidays).toBeTruthy();
      const sent = (withHolidays![0] as { holidays: { startDate: string }[] }).holidays;
      // Only the in-base-period holiday, even though the extended date covers both.
      expect(sent).toEqual([{ label: 'Oct 27', startDate: '2027-09-26', endDate: '2027-10-02' }]);
    });
  });

  it('settles instead of extending itself again and again', async () => {
    // The extension feeding back into the picker window would show up here as an
    // ever-growing holiday list and a preview call count that never stops.
    const preview = vi.spyOn(curriculumApi, 'previewCohortEndDate').mockImplementation((async (body: {
      holidays?: { startDate: string; endDate: string }[];
    }) => {
      const days = (body.holidays || []).length * 7;
      return {
        endDate: '2028-02-07',
        practicalEndDate: days ? '2028-02-07' : '2028-01-31',
        calculatedEndDate: days ? '2028-02-07' : '2028-01-31',
        // The base window is the same on every call, whatever the extension is.
        baseEndDate: '2028-01-31',
        holidayExtensionDays: days,
        apprenticeshipEndDate: days ? '2028-07-07' : '2028-06-30',
        autoCalculated: true,
        rule: 'test',
        warnings: [],
      };
    }) as never);

    render(<CohortFormDrawer {...(baseProps() as never)} />);

    await waitFor(() => expect(preview).toHaveBeenCalled());
    await waitFor(() => {
      const last = preview.mock.calls.at(-1)![0] as { holidays?: unknown[] };
      expect((last.holidays || []).length).toBe(1);
    });

    const settled = preview.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 600));
    // No further round trips once the base window stopped moving.
    expect(preview.mock.calls.length).toBe(settled);
    const finalCall = preview.mock.calls.at(-1)![0] as { holidays?: unknown[] };
    expect((finalCall.holidays || []).length).toBe(1);
  });

  it('shows the extended practical and apprenticeship dates to the user', async () => {
    vi.spyOn(curriculumApi, 'previewCohortEndDate').mockResolvedValue({
      endDate: '2028-02-07',
      practicalEndDate: '2028-02-07',
      calculatedEndDate: '2028-02-07',
      baseEndDate: '2028-01-31',
      holidayExtensionDays: 7,
      apprenticeshipEndDate: '2028-07-07',
      autoCalculated: true,
      rule: 'test',
      warnings: [],
    } as never);

    render(<CohortFormDrawer {...(baseProps() as never)} />);

    // The Learner dates panel is what the delivery team reads off the screen.
    await waitFor(() => {
      expect(screen.getByText(/07 Feb 2028/i)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText(/07 Jul 2028/i)).toBeTruthy();
    });
  });

  it('names each holiday and states the duration change in the hint', async () => {
    // The whole point of the hint: a reader must be able to see *which* holiday
    // moved the date and by how much, not just a total.
    vi.spyOn(curriculumApi, 'previewCohortEndDate').mockResolvedValue({
      endDate: '2028-02-07',
      practicalEndDate: '2028-02-07',
      calculatedEndDate: '2028-02-07',
      baseEndDate: '2028-01-31',
      holidayExtensionDays: 21,
      holidayExtensions: [
        { label: 'Summer 27', startDate: '2027-07-25', endDate: '2027-08-07', days: 14 },
        { label: 'Oct 27', startDate: '2027-09-26', endDate: '2027-10-02', days: 7 },
      ],
      durationMonths: 24,
      effectiveDurationMonths: 25,
      apprenticeshipEndDate: '2028-07-07',
      autoCalculated: true,
      rule: 'test',
      warnings: [],
    } as never);

    render(<CohortFormDrawer {...(baseProps() as never)} />);

    // Scoped to the hint: the holiday names also appear in the picker below,
    // so a document-wide query would pass without the hint existing at all.
    const heading = await screen.findByText(/Extended by 21 days of holiday/i);
    const hint = heading.closest('div')!;

    // The duration is stated as unchanged, with what the cohort now runs for.
    expect(hint.textContent).toMatch(/duration stays 24 months/i);
    expect(hint.textContent).toMatch(/now runs 25 months/i);
    // Each holiday named with its own dates and day count.
    expect(hint.textContent).toContain('Summer 27');
    expect(hint.textContent).toContain('Oct 27');
    expect(hint.textContent).toMatch(/25 Jul 2027 – 07 Aug 2027 \(\+14 days\)/i);
    expect(hint.textContent).toMatch(/26 Sept 2027 – 02 Oct 2027 \(\+7 days\)/i);
    // And where the date moved from and to.
    expect(hint.textContent).toMatch(/moved from 31 Jan 2028 to 07 Feb 2028/i);
  });

  it('shows no extension hint when a hand-set date overrides the holidays', async () => {
    // The authored date wins, so a hint claiming the holidays moved it would lie.
    vi.spyOn(curriculumApi, 'previewCohortEndDate').mockResolvedValue({
      endDate: '2028-04-01',
      practicalEndDate: '2028-04-01',
      calculatedEndDate: '2028-02-07',
      baseEndDate: '2028-01-31',
      holidayExtensionDays: 7,
      holidayExtensions: [
        { label: 'Oct 27', startDate: '2027-09-26', endDate: '2027-10-02', days: 7 },
      ],
      durationMonths: 24,
      effectiveDurationMonths: 27,
      apprenticeshipEndDate: '2028-09-01',
      autoCalculated: true,
      rule: 'test',
      warnings: [],
    } as never);

    const props = baseProps();
    // A stored cohort's practical end date is treated as hand-set on open.
    (props.cohort as { practicalEndDate: string }).practicalEndDate = '2028-04-01';
    render(<CohortFormDrawer {...(props as never)} />);

    await waitFor(() => expect(screen.getByText(/Learner dates/i)).toBeTruthy());
    expect(screen.queryByText(/Extended by/i)).toBeNull();
  });

  it('shows no extension hint when no holiday moved the date', async () => {
    vi.spyOn(curriculumApi, 'previewCohortEndDate').mockResolvedValue({
      endDate: '2028-01-31',
      practicalEndDate: '2028-01-31',
      calculatedEndDate: '2028-01-31',
      baseEndDate: '2028-01-31',
      holidayExtensionDays: 0,
      holidayExtensions: [],
      durationMonths: 24,
      effectiveDurationMonths: 24,
      apprenticeshipEndDate: '2028-06-30',
      autoCalculated: true,
      rule: 'test',
      warnings: [],
    } as never);

    render(<CohortFormDrawer {...(baseProps() as never)} />);

    await waitFor(() => expect(screen.getByText(/Learner dates/i)).toBeTruthy());
    expect(screen.queryByText(/Extended by/i)).toBeNull();
  });

  it('pins the holiday picker heading to the base period, not the extended one', async () => {
    vi.spyOn(curriculumApi, 'previewCohortEndDate').mockResolvedValue({
      endDate: '2028-02-07',
      practicalEndDate: '2028-02-07',
      calculatedEndDate: '2028-02-07',
      baseEndDate: '2028-01-31',
      holidayExtensionDays: 7,
      apprenticeshipEndDate: '2028-07-07',
      autoCalculated: true,
      rule: 'test',
      warnings: [],
    } as never);

    render(<CohortFormDrawer {...(baseProps() as never)} />);

    // The window the picker advertises has to be the base one: 31 Jan 2028.
    await waitFor(() => {
      expect(screen.getByText(/Holidays in this cohort's period \(01 Feb 2026 – 31 Jan 2028\)/i)).toBeTruthy();
    });
    // The out-of-period holiday must not be offered.
    expect(screen.queryByText('Feb 28')).toBeNull();
  });
});
