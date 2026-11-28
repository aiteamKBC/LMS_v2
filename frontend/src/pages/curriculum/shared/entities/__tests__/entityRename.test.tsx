import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  updateCurriculumCohort, updateCurriculumGroup, updateCurriculumProgramme,
  type CurriculumCohort, type CurriculumGroup, type CurriculumProgramme,
} from '@/lib/curriculumApi';
import { CohortFormDrawer, GroupFormDrawer, ProgrammeFormDrawer } from '../forms';

vi.mock('../recordSnapshot', () => ({
  fetchCurriculumRecordSnapshot: vi.fn(async () => ({ revision: 'revision-1', record: null })),
}));
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
}));
vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  updateCurriculumProgramme: vi.fn(async () => ({ updated: true })),
  updateCurriculumCohort: vi.fn(async () => ({ updated: true })),
  updateCurriculumGroup: vi.fn(async () => ({ updated: true, teamsCalendarsToUpdate: [] })),
  previewCohortEndDate: vi.fn(async () => ({
    endDate: '2027-09-01', practicalEndDate: '2027-09-01',
    calculatedEndDate: '2027-09-01', apprenticeshipEndDate: '2027-12-01', warnings: [],
  })),
}));

const programme = {
  id: 'programme-display-id', sourceId: 'PROG-1', name: 'Synthetic programme',
  level: 'LVL-4', color: '#6941c6',
} as CurriculumProgramme;
const cohort = {
  id: 'COH-1', name: 'Synthetic cohort', programmeId: 'PROG-1', programme: programme.name,
  startDate: '2026-09-01', durationMonths: 12, epaMonths: 3,
  endDate: '2027-08-31', practicalEndDate: '2027-08-31', color: '#6941c6',
} as CurriculumCohort;
const group = {
  id: 'GRP-1', name: 'Synthetic group', cohortId: 'COH-1', programmeId: 'PROG-1',
  weekDays: 'Tuesday', startTime: '11:00', endTime: '13:00', color: '#6941c6',
} as CurriculumGroup;
const callbacks = () => ({ onClose: vi.fn(), onSaved: vi.fn(async () => undefined) });

describe('curriculum name-only edits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renames a programme by canonical ID with its revision and no unrelated fields', async () => {
    render(<ProgrammeFormDrawer open programme={programme} {...callbacks()} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. Data Analyst'), { target: { value: 'Renamed programme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save programme' }));
    await waitFor(() => expect(updateCurriculumProgramme).toHaveBeenCalledWith(
      'PROG-1', { name: 'Renamed programme', expectedRevision: 'revision-1' },
    ));
  });

  it('does not submit computed dates, holidays or placement when renaming a cohort', async () => {
    const props = callbacks();
    render(<CohortFormDrawer open cohort={cohort} programmes={[programme]} holidays={[]} {...props} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. September 2026'), { target: { value: 'Renamed cohort' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save cohort' }));
    await waitFor(() => expect(updateCurriculumCohort).toHaveBeenCalledWith(
      'COH-1', { name: 'Renamed cohort', expectedRevision: 'revision-1' },
    ));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith({ cohort: { ...cohort, name: 'Renamed cohort' } }));
  });

  it('does not submit delivery days, clock or parent IDs when renaming a group', async () => {
    const props = callbacks();
    render(<MemoryRouter><GroupFormDrawer open group={group} programmes={[programme]} cohorts={[cohort]} coachNames={[]} {...props} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('e.g. Group A'), { target: { value: 'Renamed group' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save group' }));
    await waitFor(() => expect(updateCurriculumGroup).toHaveBeenCalledWith(
      'GRP-1', { name: 'Renamed group', expectedRevision: 'revision-1' },
    ));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith({ group: { ...group, name: 'Renamed group' } }));
  });
});
