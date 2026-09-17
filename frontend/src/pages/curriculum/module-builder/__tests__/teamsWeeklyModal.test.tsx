import { finishTeamsCreation } from '../../teams-meetings/creationResult';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchCurriculumHolidays } from '@/lib/curriculumApi';
import { TeamsMeetingModal } from '../TeamsMeetingModal';
import { createTeamsMeeting, loadTeamsMeetingConfiguration, fetchModuleMeetingInvitees, fetchModuleSessionPlan, restoreModuleTeamsMeeting } from '../moduleAuthoringData';

vi.mock('../../teams-meetings/creationResult', () => ({ finishTeamsCreation: vi.fn() }));
vi.mock('@/lib/curriculumApi', async original => ({
  ...(await original<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumHolidays: vi.fn(),
}));
// `moduleTeamsPlannedSessions` is deliberately left real: it is the walk that
// turns this module's authored weeks into the dates the calendar is created on,
// so mocking it would leave the thing under test untested.
vi.mock('../moduleAuthoringData', async original => ({
  ...(await original<typeof import('../moduleAuthoringData')>()),
  createTeamsMeeting: vi.fn(), loadTeamsMeetingConfiguration: vi.fn(),
  fetchModuleMeetingInvitees: vi.fn(), fetchModuleSessionPlan: vi.fn(),
  restoreModuleTeamsMeeting: vi.fn(),
}));

// One Mon-Sun week delivering two live sessions at different times. The dates,
// clocks and lengths sit on the components themselves, which is where the
// backend stamps them when it serves the module's structure.
const MODULE = {
  catalogueId: 'MOD-ONE',
  title: 'Two weekly sessions',
  weeks: 1,
  weekStructure: [{
    id: 'WEEK-1', moduleId: 'MOD-ONE', weekNumber: 1, title: 'Week 1', summary: '',
    learningOutcomes: [], ksbMappings: [],
    sessionDate: '2026-09-07', sessionStartTime: '09:00', sessionDurationMinutes: 120,
    components: [
      { id: 'COMP-MON', title: 'Monday session', type: 'live-session', settings: { sessionDate: '2026-09-07', sessionTime: '09:00', durationMinutes: 120 } },
      { id: 'COMP-THU', title: 'Thursday session', type: 'live-session', settings: { sessionDate: '2026-09-10', sessionTime: '19:00', durationMinutes: 60 } },
    ],
  }],
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTeamsMeetingConfiguration).mockResolvedValue({ configured: true, defaultOrganizer: 'tutor@example.com', organizerLocked: false, timeZone: 'GMT Standard Time', timeZoneIana: 'Europe/London' });
  vi.mocked(fetchCurriculumHolidays).mockResolvedValue([]);
  vi.mocked(fetchModuleMeetingInvitees).mockResolvedValue({ attendees: [], presenters: [] } as never);
  vi.mocked(fetchModuleSessionPlan).mockResolvedValue({
    sessions: [
      { sessionNumber: 1, weekNumber: 1, date: '2026-09-07', day: 'Monday', skippedHolidays: [] },
      { sessionNumber: 2, weekNumber: 1, date: '2026-09-10', day: 'Thursday', skippedHolidays: [] },
    ],
    skippedHolidays: [], finalEndDate: '2026-09-10', warnings: [],
  } as never);
  vi.mocked(restoreModuleTeamsMeeting).mockResolvedValue({ updated: true } as never);
  vi.mocked(createTeamsMeeting).mockResolvedValue({
    created: true, warnings: [], meeting: {
      liveSessionId: 'LIVE-ONE', eventId: 'MON', joinUrl: 'https://teams.example/monday', onlineMeetingId: 'meeting-mon',
      organizerEmail: 'tutor@example.com', settingsApplied: true, durationMinutes: 120, startDateTimeUtc: '2026-09-07T08:00:00Z',
      calendarSeries: [
        { day: 'Monday', eventId: 'MON', joinUrl: 'https://teams.example/monday', onlineMeetingId: 'meeting-mon', sessionNumbers: [1] },
        { day: 'Thursday', eventId: 'THU', joinUrl: 'https://teams.example/thursday', onlineMeetingId: 'meeting-thu', sessionNumbers: [2] },
      ],
    },
  } as never);
});

it('creates from the module times and gives a Thursday component its own series link', async () => {
  const onCreated = vi.fn();
  render(<TeamsMeetingModal module={MODULE}
    component={{ id: 'COMP-THU', title: 'Thursday session', type: 'live-session', settings: { sessionDate: '2026-09-10' } } as never}
    onClose={vi.fn()} onCreated={onCreated} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled());
  expect(screen.getByRole('combobox', { name: /Teams series and links/ })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Co-organizers' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Presenters' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Attendees' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(createTeamsMeeting).toHaveBeenCalledWith(expect.objectContaining({ seriesMode: 'auto', scheduledOccurrences: [
    { sessionNumber: 1, startDateTimeUtc: '2026-09-07T08:00:00.000Z', durationMinutes: 120 },
    { sessionNumber: 2, startDateTimeUtc: '2026-09-10T18:00:00.000Z', durationMinutes: 60 },
  ] }));
  expect(restoreModuleTeamsMeeting).toHaveBeenCalledWith('MOD-ONE');
  await waitFor(() => expect(finishTeamsCreation).toHaveBeenCalledTimes(1));
  expect(onCreated.mock.calls[0][0].meeting).toMatchObject({ joinUrl: 'https://teams.example/thursday', eventId: 'THU', onlineMeetingId: 'meeting-thu', durationMinutes: 60, startDateTimeUtc: '2026-09-10T18:00:00.000Z' });
});

// A live session the author has just added to a week, before any save. It has
// no stored date of its own — the backend stamps one when it serves the
// structure — so it takes its week's date, the same one the rail shows.
const MODULE_WITH_UNSAVED_SESSION = {
  ...(MODULE as Record<string, unknown>),
  weekStructure: [{
    ...((MODULE as { weekStructure: Record<string, unknown>[] }).weekStructure[0]),
    components: [
      ...((MODULE as { weekStructure: { components: unknown[] }[] }).weekStructure[0].components),
      { id: 'COMP-NEW', title: 'Just added', type: 'live-session', settings: {} },
    ],
  }],
} as never;

it('lists an unsaved live session but refuses to create the calendar on it', async () => {
  render(<TeamsMeetingModal module={MODULE_WITH_UNSAVED_SESSION} unsavedChanges
    onClose={vi.fn()} onCreated={vi.fn()} />);

  // Shown, not hidden: the dialog must not claim a shorter module than the one
  // the reader is looking at. Three sessions, the new one among them.
  expect(await screen.findByText('3 sessions')).toBeInTheDocument();
  expect(screen.getByText(/This module has unsaved changes/)).toBeInTheDocument();

  // But nothing reaches Microsoft: these dates are not stored, so the backend
  // could not link the join link back to a saved session.
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  expect(createTeamsMeeting).not.toHaveBeenCalled();
});
