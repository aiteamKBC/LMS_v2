import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as curriculumApi from '@/lib/curriculumApi';
import { CohortFormDrawer } from '../forms';

// England's bank holidays, in the shape `/curriculum/holidays/` serves them:
// one day each, so start and end are the same date.
const HOLIDAYS = [
  { id: 'england-and-wales:2027-08-30', label: 'Summer bank holiday', startDate: '2027-08-30', endDate: '2027-08-30', type: 'Bank holiday', color: '#91d64c' },
  { id: 'england-and-wales:2027-12-27', label: 'Christmas Day', startDate: '2027-12-27', endDate: '2027-12-27', type: 'Bank holiday', color: '#91d64c', notes: 'Substitute day' },
  // After the cohort's practical end date below, so it never applies to it.
  { id: 'england-and-wales:2028-04-14', label: 'Good Friday', startDate: '2028-04-14', endDate: '2028-04-14', type: 'Bank holiday', color: '#91d64c' },
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
      name: 'Feb 2026',
      programmeId: 'PROG-1',
      startDate: '2026-02-01',
      durationMonths: 24,
      epaMonths: 5,
      // A stale selection from the authored holiday table that no longer
      // exists. The dates decide, so this must not change the answer.
      holidayIds: ['1079', '1090'],
      color: '#6d28d9',
    } as never,
  };
}

function mockContractPreview() {
  return vi.spyOn(curriculumApi, 'previewCohortEndDate').mockResolvedValue({
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
}

describe('cohort holidays follow the cohort dates', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps holidays out of the cohort end-date preview', async () => {
    const preview = mockContractPreview();

    render(<CohortFormDrawer {...baseProps()} />);

    await waitFor(() => expect(preview).toHaveBeenCalled());
    for (const [body] of preview.mock.calls) {
      expect((body as { holidays?: unknown[] }).holidays).toBeUndefined();
    }
  });

  it('shows fixed contract dates instead of an amber extension note', async () => {
    mockContractPreview();

    render(<CohortFormDrawer {...baseProps()} />);

    expect(await screen.findByText(/Contract dates/i)).toBeTruthy();
    expect(await screen.findByText(/saved for module scheduling/i)).toBeTruthy();
    expect(screen.queryByText(/Extended by/i)).toBeNull();
    expect(screen.queryByText(/Practical end date moved/i)).toBeNull();
  });

  it('lists every bank holiday inside the period and nothing outside it', async () => {
    mockContractPreview();

    render(<CohortFormDrawer {...baseProps()} />);

    expect(await screen.findByText('Summer bank holiday')).toBeTruthy();
    expect(screen.getByText('Christmas Day')).toBeTruthy();
    // 2028-04-14, past the 2028-01-31 practical end date.
    expect(screen.queryByText('Good Friday')).toBeNull();
    expect(screen.getByText(/2 holidays in this period/i)).toBeTruthy();
  });

  it('offers every holiday in the period a checkbox, all ticked by default', async () => {
    mockContractPreview();

    render(<CohortFormDrawer {...baseProps()} />);

    await screen.findByText('Summer bank holiday');
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    for (const checkbox of checkboxes) expect(checkbox).toBeChecked();
    expect(screen.getByRole('button', { name: /select all/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /clear all/i })).not.toBeDisabled();
  });

  it('saves the holidays the period resolved to, not the stale stored selection', async () => {
    mockContractPreview();
    const save = vi.spyOn(curriculumApi, 'updateCurriculumCohort').mockResolvedValue({} as never);

    render(<CohortFormDrawer {...baseProps()} />);

    await screen.findByText('Summer bank holiday');
    await userEvent.click(screen.getByRole('button', { name: /save cohort/i }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1]).toMatchObject({
      holidayIds: ['england-and-wales:2027-08-30', 'england-and-wales:2027-12-27'],
      excludedHolidayIds: [],
    });
  });

  it('unticking a holiday excludes it from the saved selection', async () => {
    mockContractPreview();
    const save = vi.spyOn(curriculumApi, 'updateCurriculumCohort').mockResolvedValue({} as never);

    render(<CohortFormDrawer {...baseProps()} />);

    await screen.findByText('Summer bank holiday');
    await userEvent.click(screen.getByRole('checkbox', { name: /summer bank holiday/i }));
    await userEvent.click(screen.getByRole('button', { name: /save cohort/i }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1]).toMatchObject({
      holidayIds: ['england-and-wales:2027-12-27'],
      excludedHolidayIds: ['england-and-wales:2027-08-30'],
    });
  });

  it('Clear all unticks every holiday, and Select all restores them', async () => {
    mockContractPreview();

    render(<CohortFormDrawer {...baseProps()} />);

    await screen.findByText('Summer bank holiday');
    await userEvent.click(screen.getByRole('button', { name: /clear all/i }));
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();
    expect(screen.getByText(/0 selected/i)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /select all/i }));
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeChecked();
  });
});
