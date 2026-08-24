import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as curriculumApi from '@/lib/curriculumApi';
import { CohortFormDrawer } from '../forms';

const HOLIDAYS = [
  { id: 'HOL-1', label: 'Oct 27', startDate: '2027-09-26', endDate: '2027-10-02', type: 'Break', color: '#dc2626' },
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
      name: 'Feb 2026',
      programmeId: 'PROG-1',
      startDate: '2026-02-01',
      durationMonths: 24,
      epaMonths: 5,
      holidayIds: ['HOL-1'],
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

describe('cohort holiday scheduling note', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps selected holidays out of the cohort end-date preview', async () => {
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
    expect(await screen.findByText(/Selected holidays are saved for module scheduling/i)).toBeTruthy();
    expect(screen.queryByText(/Extended by/i)).toBeNull();
    expect(screen.queryByText(/Practical end date moved/i)).toBeNull();
  });

  it('explains that unticked holidays do not affect generated module sessions', async () => {
    mockContractPreview();
    const props = baseProps();
    (props.cohort as { holidayIds: string[] }).holidayIds = [];

    render(<CohortFormDrawer {...props} />);

    expect(await screen.findByText(/Nothing ticked: none of the/i)).toBeTruthy();
  });

  it('can select every holiday in the cohort period at once', async () => {
    mockContractPreview();
    const save = vi.spyOn(curriculumApi, 'updateCurriculumCohort').mockResolvedValue({} as never);
    const props = baseProps();
    (props.cohort as { holidayIds: string[] }).holidayIds = [];
    (props.cohort as { practicalEndDate: string }).practicalEndDate = '2028-01-31';

    render(<CohortFormDrawer {...props} />);

    await userEvent.click(await screen.findByRole('button', { name: /select all holidays/i }));
    await userEvent.click(screen.getByRole('button', { name: /save cohort/i }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1]).toMatchObject({
      holidayIds: ['HOL-1'],
    });
  });
});
