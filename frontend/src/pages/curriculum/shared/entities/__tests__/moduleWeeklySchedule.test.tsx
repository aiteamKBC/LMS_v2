import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGroupModule, previewModuleSessionPlan, previewTutorAvailabilityRoster, updateCurriculumModule } from '@/lib/curriculumApi';
import type { CurriculumGroup, CurriculumModule, CurriculumSession } from '@/lib/curriculumApi';
import { buildTeamsCalendarInput, emptyTeamsCalendarForm } from '@/pages/curriculum/teams-meetings/createCalendarForm';
import { ModuleFormDrawer, moduleFormTarget, type ModuleFormTarget } from '../moduleForm';

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(), showCurriculumConfirm: vi.fn(),
}));
vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  createGroupModule: vi.fn(), updateCurriculumModule: vi.fn(),
  previewModuleSessionPlan: vi.fn(), previewTutorAvailabilityRoster: vi.fn(),
}));

const days = ['2026-09-02', '2026-09-03', '2026-09-09', '2026-09-10', '2026-09-16', '2026-09-17', '2026-09-23', '2026-09-24'];
const group = {
  id: 'GROUP-1', name: 'Group A', cohortId: 'COHORT-1', programmeId: 'PROG-1',
  weekDays: 'Wednesday', startTime: '10:00', endTime: '12:00',
} as CurriculumGroup;

function drawer(module?: ModuleFormTarget, extraGroups: CurriculumGroup[] = []) {
  return render(<MemoryRouter><ModuleFormDrawer
    open module={module}
    programmes={[{ id: 'PROG-1', sourceId: 'PROG-1', name: 'Programme', isActive: true } as never]}
    cohorts={[{ id: 'COHORT-1', name: 'September', programmeId: 'PROG-1', startDate: '2026-09-01', endDate: '2027-08-31' } as never]}
    groups={[group, ...extraGroups]} tutorNames={['Tutor One']}
    defaults={{ programmeId: 'PROG-1', cohortId: 'COHORT-1', groupId: 'GROUP-1' }}
    onClose={vi.fn()} onSaved={vi.fn()}
  /></MemoryRouter>);
}

async function choose(field: string, value: string) {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(field, 'i') }));
  await userEvent.click(screen.getByRole('option', { name: new RegExp(`^${value}$`) }));
}

describe('module weekly schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createGroupModule).mockResolvedValue({ created: [{ moduleCatalogueId: 'MOD-NEW' }] } as never);
    vi.mocked(updateCurriculumModule).mockResolvedValue({ updated: true } as never);
    vi.mocked(previewTutorAvailabilityRoster).mockResolvedValue({ sessionDates: [], startTime: '', endTime: '', bookable: false, results: [], availableCount: 0, busyCount: 0 });
    vi.mocked(previewModuleSessionPlan).mockImplementation(async input => ({
      sessions: input.weekDays === 'Wednesday, Thursday' ? days.slice(0, input.numberOfSessions).map((date, index) => ({ sessionNumber: index + 1, date, day: index % 2 ? 'Thursday' : 'Wednesday', skippedHolidays: [] })) : [],
      finalEndDate: input.weekDays === 'Wednesday, Thursday' ? days[input.numberOfSessions - 1] : '',
      warnings: [], skippedHolidays: [],
    }));
  });

  it('previews and saves eight sessions across four weeks with the chosen days and independent times', async () => {
    drawer();
    await userEvent.type(screen.getByPlaceholderText('e.g. Data Modelling'), 'Twice weekly');
    fireEvent.change(screen.getByRole('spinbutton', { name: /^Weeks/ }), { target: { value: '4' } });
    await choose('Sessions per week', '2');
    await userEvent.click(screen.getByRole('button', { name: 'Thu' }));
    fireEvent.change(screen.getByLabelText('Wednesday start time', { exact: false }), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('Wednesday end time', { exact: false }), { target: { value: '11:00' } });
    fireEvent.change(screen.getByLabelText('Thursday start time', { exact: false }), { target: { value: '19:00' } });
    fireEvent.change(screen.getByLabelText('Thursday end time', { exact: false }), { target: { value: '20:00' } });
    await choose('Tutor', 'Tutor One');

    await waitFor(() => expect(previewModuleSessionPlan).toHaveBeenLastCalledWith(expect.objectContaining({ numberOfSessions: 8, weekDays: 'Wednesday, Thursday' })));
    await waitFor(() => expect(previewTutorAvailabilityRoster).toHaveBeenLastCalledWith(expect.objectContaining({ sessionsNumber: 8, weekDays: 'Wednesday, Thursday', startTime: '09:00', endTime: '11:00' })));
    expect(screen.getByText('8 planned sessions, no holiday shifts.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View sessions' }));
    expect(screen.getByRole('dialog', { name: 'Twice weekly' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /close session/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Create module' }));
    expect(createGroupModule).toHaveBeenCalledWith('GROUP-1', expect.objectContaining({ weeks: 4, sessionsNumber: 8, weekDays: 'Wednesday, Thursday', startTime: '09:00', endTime: '11:00', endDate: '2026-09-24', weeklySchedule: [{ day: 'Wednesday', startTime: '09:00', endTime: '11:00' }, { day: 'Thursday', startTime: '19:00', endTime: '20:00' }] }));
  });

  it('blocks a count without enough days and hides the outdated preview', async () => {
    drawer();
    await userEvent.type(screen.getByPlaceholderText('e.g. Data Modelling'), 'Missing day');
    await choose('Tutor', 'Tutor One');
    await choose('Sessions per week', '2');
    expect(screen.getByRole('button', { name: 'View sessions' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Create module' }));
    expect(screen.getByText('Choose 2 delivery days to match the sessions per week.')).toBeInTheDocument();
    expect(createGroupModule).not.toHaveBeenCalled();
  });

  it('reopens the module schedule instead of replacing it with the group defaults', async () => {
    const module = moduleFormTarget({
      id: 'MOD-SAVED', name: 'Saved schedule', programmeId: 'PROG-1', cohortId: 'COHORT-1', groupId: 'GROUP-1',
      weeks: 4, sessionsNumber: 8, weekDays: 'Monday, Thursday', startTime: '09:00', endTime: '11:00',
      weeklySchedule: [{ day: 'Monday', startTime: '09:00', endTime: '11:00' }, { day: 'Thursday', startTime: '19:00', endTime: '20:00' }],
      startDate: '2026-09-07', endDate: '2026-10-01', tutor: 'Tutor One',
    } as CurriculumModule)!;
    drawer(module);
    expect(screen.getByRole('combobox', { name: /Sessions per week/ })).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Wed' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Monday start time', { exact: false })).toHaveValue('09:00');
    expect(screen.getByLabelText('Thursday start time', { exact: false })).toHaveValue('19:00');
    await userEvent.click(screen.getByRole('button', { name: 'Save module' }));
    expect(updateCurriculumModule).toHaveBeenCalledWith('MOD-SAVED', expect.objectContaining({ sessionsNumber: 8, weekDays: 'Monday, Thursday', startTime: '09:00', endTime: '11:00' }));
    expect(vi.mocked(updateCurriculumModule).mock.calls[0][1]).not.toHaveProperty('weeks');
  });

  it('keeps other groups on their own schedules when the primary schedule changes', async () => {
    drawer(undefined, [{ ...group, id: 'GROUP-2', name: 'Group B', weekDays: 'Friday', startTime: '14:00', endTime: '16:00' }]);
    await userEvent.type(screen.getByPlaceholderText('e.g. Data Modelling'), 'Two groups');
    await userEvent.click(screen.getByRole('button', { name: /Group B/ }));
    await choose('Sessions per week', '2');
    await userEvent.click(screen.getByRole('button', { name: 'Thu' }));
    await choose('Tutor', 'Tutor One');
    await userEvent.click(screen.getByRole('button', { name: 'Create module' }));
    expect(createGroupModule).toHaveBeenCalledWith('GROUP-1', expect.objectContaining({ sessionsNumber: 2, weekDays: 'Wednesday, Thursday', startTime: '10:00' }));
    expect(createGroupModule).toHaveBeenCalledWith('GROUP-2', expect.objectContaining({ sessionsNumber: 1, weekDays: 'Friday', startTime: '14:00' }));
  });

  it('reduces the calendar count without resizing authored weeks when switching back to once weekly', async () => {
    drawer({ id: 'MOD-SAVED', name: 'Saved schedule', groupId: 'GROUP-1', weeks: 4, sessionsNumber: 8, weekDays: 'Monday, Thursday', startDate: '2026-09-07', endDate: '2026-10-01', tutor: 'Tutor One' });
    await choose('Sessions per week', '1');
    expect(screen.getByRole('button', { name: 'Thu' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Save module' }));
    expect(updateCurriculumModule).toHaveBeenCalledWith('MOD-SAVED', expect.objectContaining({ sessionsNumber: 4, weekDays: 'Monday', endDate: '2026-09-28' }));
    expect(vi.mocked(updateCurriculumModule).mock.calls[0][1]).not.toHaveProperty('weeks');
  });

  it('rejects an end time before the start time', async () => {
    drawer({ id: 'MOD-SAVED', name: 'Saved schedule', groupId: 'GROUP-1', weeks: 4, weekDays: 'Wednesday', startDate: '2026-09-02', tutor: 'Tutor One' });
    fireEvent.change(screen.getByLabelText('Wednesday end time', { exact: false }), { target: { value: '09:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save module' }));
    expect(screen.getByText("Set each day's start and end time, with the end after the start.")).toBeInTheDocument();
    expect(updateCurriculumModule).not.toHaveBeenCalled();
  });

  it('passes both weekly slots to one Teams calendar series', () => {
    const input = buildTeamsCalendarInput({
      catalogueId: 'MOD-SAVED', name: 'Twice weekly', durationMinutes: 120,
      plannedStarts: [], teamsStarts: [],
      sessions: days.map((date, index) => ({ id: `session-${index}`, date, startTime: '09:00', endTime: '11:00' } as CurriculumSession)),
    }, { ...emptyTeamsCalendarForm(), organizerEmail: 'tutor@example.com', durationMinutes: '120' });
    expect(input).toMatchObject({ seriesMode: 'auto', moduleCatalogueId: 'MOD-SAVED', repeat: 'weekly', repeatOccurrences: 8, transactionId: 'TEAMS-MOD-SAVED' });
    expect(input.scheduledOccurrences.map(session => session.startDateTimeUtc.slice(0, 10))).toEqual(days);
    expect(input.scheduledOccurrences.every(session => session.durationMinutes === 120)).toBe(true);
  });

  it('sends each day’s own start and duration with the chosen Teams series option', () => {
    const input = buildTeamsCalendarInput({
      catalogueId: 'MOD-SAVED', name: 'Independent times', durationMinutes: 120, plannedStarts: [], teamsStarts: [],
      sessions: days.map((date, index) => ({ id: `session-${index}`, date, startTime: index % 2 ? '19:00' : '09:00', endTime: index % 2 ? '20:00' : '11:00' } as CurriculumSession)),
    }, { ...emptyTeamsCalendarForm(), organizerEmail: 'tutor@example.com', seriesMode: 'per_day' });
    expect(input.seriesMode).toBe('per_day');
    expect(input.scheduledOccurrences.map(item => item.durationMinutes)).toEqual([120, 60, 120, 60, 120, 60, 120, 60]);
    expect(input.scheduledOccurrences[0].startDateTimeUtc).toBe('2026-09-02T08:00:00.000Z');
    expect(input.scheduledOccurrences[1].startDateTimeUtc).toBe('2026-09-03T18:00:00.000Z');
  });
});
