import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CurriculumApiError, convertFreeCourseToModule, fetchCurriculumDeliveryScope, fetchCurriculumTutors, previewTutorAvailabilityRoster, type CurriculumProgramme } from '@/lib/curriculumApi';
import { FreeCourseMoveDrawer } from '../FreeCourseMoveDrawer';

vi.mock('@/lib/curriculumApi', async original => ({
  ...(await original<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumDeliveryScope: vi.fn(), fetchCurriculumTutors: vi.fn(), convertFreeCourseToModule: vi.fn(),
  previewTutorAvailabilityRoster: vi.fn(),
}));

const programmes: CurriculumProgramme[] = [{ id: 'P1', name: 'Programme one' }, { id: 'P2', name: 'Programme two' }].map(item => ({
  ...item, sourceId: item.id, standard: '', level: '', modules: 0, weeks: 0, ksbMapped: 0,
  ksbTotal: 0, learners: 0, cohorts: 1, lastUpdated: '', owner: '', color: '', description: '',
}));
const scope: Awaited<ReturnType<typeof fetchCurriculumDeliveryScope>> = {
  cohorts: [{ id: 'C1', name: 'Cohort one', programmeId: 'P1' }, { id: 'C2', name: 'Cohort two', programmeId: 'P2' }].map(item => ({
    ...item, programme: programmes.find(programme => programme.id === item.programmeId)!.name,
    startDate: '', endDate: '', status: 'active', learners: 0, groups: [], modules: [], sessions: 0, color: '', progress: 0, attendance: 0,
  })),
  groups: [{ id: 'G1', name: 'Group one', programmeId: 'P1', cohortId: 'C1' }, { id: 'G2', name: 'Group two', programmeId: 'P2', cohortId: 'C2' }].map(item => ({
    ...item, programme: programmes.find(programme => programme.id === item.programmeId)!.name,
    cohort: item.cohortId === 'C1' ? 'Cohort one' : 'Cohort two', learners: 0, coach: '', tutor: '',
    startDate: '', endDate: '', status: 'active', schedule: '', mode: '', modules: [], sessions: 0,
  })),
};
const result = { converted: true, moduleCatalogueId: 'FREE-1', programmeId: 'P1', programmeName: 'Programme one',
  cohortId: 'C1', cohortName: 'Cohort one', groupId: 'G1', groupName: 'Group one', tutor: 'Tutor one' };
const moved = vi.fn();
const close = vi.fn();
const renderDrawer = () => render(<MemoryRouter><FreeCourseMoveDrawer module={{ catalogueId: 'FREE-1', title: 'Independent study' }}
  programmes={programmes} onClose={close} onMoved={moved} /></MemoryRouter>);
async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string | RegExp) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}
async function destination(user: ReturnType<typeof userEvent.setup>, withTutor = true) {
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Destination programme' })).toBeEnabled());
  await choose(user, 'Destination programme', 'Programme one');
  await choose(user, 'Destination cohort', 'Cohort one');
  await choose(user, 'Destination group', 'Group one');
  if (withTutor) await choose(user, 'Destination tutor', /Tutor one/);
}

describe('Move a free course into a module', () => {
  beforeEach(() => {
    vi.mocked(previewTutorAvailabilityRoster).mockReset().mockResolvedValue({
      results: [], sessionDates: [], bookable: false, startTime: '', endTime: '', availableCount: 0, busyCount: 0,
    });
    vi.mocked(fetchCurriculumDeliveryScope).mockReset().mockResolvedValue(scope);
    vi.mocked(fetchCurriculumTutors).mockReset().mockResolvedValue([
      { id: 'T1', name: 'Tutor one', email: 'tutor-one@example.invalid', status: 'active' },
      { id: 'T2', name: 'Archived tutor', status: 'archived' },
    ]);
    vi.mocked(convertFreeCourseToModule).mockReset().mockResolvedValue(result);
    moved.mockReset().mockResolvedValue(undefined);
    close.mockReset();
  });
  it('requires a destination and tutor and submits the original course identity', async () => {
    const user = userEvent.setup(); renderDrawer();
    expect(screen.getByRole('button', { name: 'Move to module' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Destination cohort' })).toBeDisabled();
    await destination(user, false);
    expect(screen.getByRole('button', { name: 'Move to module' })).toBeDisabled();
    await choose(user, 'Destination tutor', /Tutor one/);
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    await waitFor(() => expect(moved).toHaveBeenCalledWith(result));
    expect(convertFreeCourseToModule).toHaveBeenCalledExactlyOnceWith('FREE-1', { programmeId: 'P1', cohortId: 'C1', groupId: 'G1', tutor: 'T1' });
  });
  it('clears dependent selections when the programme changes', async () => {
    const user = userEvent.setup(); renderDrawer(); await destination(user);
    await choose(user, 'Destination programme', 'Programme two');
    expect(screen.getByRole('button', { name: 'Move to module' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Destination group' })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Destination cohort' }));
    expect(screen.queryByRole('option', { name: 'Cohort one' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cohort two' })).toBeInTheDocument();
    expect(convertFreeCourseToModule).not.toHaveBeenCalled();
  });
  it('keeps selections and allows retry when conversion fails', async () => {
    vi.mocked(convertFreeCourseToModule).mockRejectedValueOnce(new Error('Destination no longer available'));
    const user = userEvent.setup(); renderDrawer(); await destination(user);
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    expect(await screen.findByText('Destination no longer available')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Destination group' })).toHaveTextContent('Group one');
    expect(screen.getByRole('combobox', { name: 'Destination tutor' })).toHaveTextContent('Tutor one');
    expect(close).not.toHaveBeenCalled(); expect(moved).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    await waitFor(() => expect(moved).toHaveBeenCalledWith(result));
  });
  it('reports destination loading failures and retries the read without a write', async () => {
    vi.mocked(fetchCurriculumDeliveryScope).mockRejectedValueOnce(new Error('Scope unavailable'));
    const user = userEvent.setup(); renderDrawer();
    expect(await screen.findByText('Scope unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Move to module' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry destinations' }));
    await destination(user);
    expect(screen.getByRole('button', { name: 'Move to module' })).toBeEnabled();
    expect(convertFreeCourseToModule).not.toHaveBeenCalled();
  });
  it('distinguishes a successful move from a failed refresh and does not repeat the write', async () => {
    moved.mockRejectedValueOnce(new Error('Refresh failed'));
    const user = userEvent.setup(); renderDrawer(); await destination(user);
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    expect(await screen.findByText(/course was moved, but the catalogue/)).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Destination programme' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Destination tutor' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh catalogue' }));
    await waitFor(() => expect(moved).toHaveBeenCalledTimes(2));
    expect(convertFreeCourseToModule).toHaveBeenCalledTimes(1);
  });
  it('can cancel without changing the course', async () => {
    const user = userEvent.setup(); renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
    expect(convertFreeCourseToModule).not.toHaveBeenCalled();
  });
  const busyTutor = { tutor: 'Tutor one', available: false, message: 'Tutor one is already teaching.', conflicts: [{
    moduleCatalogueId: 'MOD-OTHER', moduleName: 'Other subject', programme: 'Other programme', cohort: 'Other cohort',
    group: 'Other group', startTime: '10:00', endTime: '12:00', dates: ['2026-09-02'],
  }] };
  it('warns while choosing a busy tutor and still permits the move', async () => {
    vi.mocked(previewTutorAvailabilityRoster).mockResolvedValue({
      results: [busyTutor], sessionDates: ['2026-09-02'], bookable: true, startTime: '10:00', endTime: '12:00',
      availableCount: 0, busyCount: 1,
    });
    const user = userEvent.setup(); renderDrawer(); await destination(user);
    expect(await screen.findByText(/You can keep this tutor and save anyway/)).toBeVisible();
    expect(previewTutorAvailabilityRoster).toHaveBeenCalledWith({ moduleCatalogueId: 'FREE-1', groupId: 'G1', cohortId: 'C1' });
    expect(screen.getByText('Other subject')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    await waitFor(() => expect(convertFreeCourseToModule).toHaveBeenCalledWith('FREE-1', {
      programmeId: 'P1', cohortId: 'C1', groupId: 'G1', tutor: 'T1', allowTutorConflict: true,
    }));
  });
  it('offers continuing after a new conflict is returned without repeating a successful move', async () => {
    vi.mocked(convertFreeCourseToModule).mockRejectedValueOnce(new CurriculumApiError('Conflict', 409, '/convert/', {
      error: busyTutor.message, tutor: busyTutor.tutor, tutorConflicts: busyTutor.conflicts,
    }));
    const user = userEvent.setup(); renderDrawer(); await destination(user);
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    expect(await screen.findByText(/Select Move to module again/)).toBeVisible();
    expect(moved).not.toHaveBeenCalled();
    expect(convertFreeCourseToModule).toHaveBeenCalledExactlyOnceWith('FREE-1', {
      programmeId: 'P1', cohortId: 'C1', groupId: 'G1', tutor: 'T1',
    });
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    await waitFor(() => expect(moved).toHaveBeenCalledOnce());
    expect(convertFreeCourseToModule).toHaveBeenLastCalledWith('FREE-1', {
      programmeId: 'P1', cohortId: 'C1', groupId: 'G1', tutor: 'T1', allowTutorConflict: true,
    });
  });
  it('does not carry a conflict override to another destination', async () => {
    vi.mocked(convertFreeCourseToModule).mockRejectedValueOnce(new CurriculumApiError('Conflict', 409, '/convert/', {
      error: busyTutor.message, tutor: busyTutor.tutor, tutorConflicts: busyTutor.conflicts,
    }));
    const user = userEvent.setup(); renderDrawer(); await destination(user);
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    expect(await screen.findByText(/Select Move to module again/)).toBeVisible();
    await choose(user, 'Destination programme', 'Programme two');
    await choose(user, 'Destination cohort', 'Cohort two');
    await choose(user, 'Destination group', 'Group two');
    expect(screen.queryByText(/Select Move to module again/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    await waitFor(() => expect(convertFreeCourseToModule).toHaveBeenLastCalledWith('FREE-1', {
      programmeId: 'P2', cohortId: 'C2', groupId: 'G2', tutor: 'T1',
    }));
  });
  it('loads only active tutor choices and supports keyboard selection', async () => {
    const user = userEvent.setup(); renderDrawer(); await destination(user, false);
    await user.click(screen.getByRole('combobox', { name: 'Destination tutor' }));
    expect(screen.queryByRole('option', { name: /Archived tutor/ })).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Search tutors...'), 'Tutor one');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByRole('combobox', { name: 'Destination tutor' })).toHaveTextContent('Tutor one');
    expect(screen.getByRole('button', { name: 'Move to module' })).toBeEnabled();
  });
  it('cannot move without active tutors and exposes tutor loading failures for retry', async () => {
    vi.mocked(fetchCurriculumTutors).mockRejectedValueOnce(new Error('Tutors unavailable')).mockResolvedValueOnce([]);
    const user = userEvent.setup(); renderDrawer();
    expect(await screen.findByText('Tutors unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Move to module' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry destinations' }));
    await destination(user, false);
    expect(screen.getByRole('combobox', { name: 'Destination tutor' })).toHaveTextContent('No active tutors available');
    expect(screen.getByRole('button', { name: 'Move to module' })).toBeDisabled();
    expect(convertFreeCourseToModule).not.toHaveBeenCalled();
  });
});
