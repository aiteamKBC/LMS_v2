import { finishTeamsCreation } from '../../teams-meetings/creationResult';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchCurriculumHolidays } from '@/lib/curriculumApi';
import { TeamsMeetingModal } from '../TeamsMeetingModal';
import { createTeamsMeeting, updateTeamsMeetingSchedule, loadTeamsMeetingConfiguration, fetchModuleMeetingInvitees, fetchModuleSessionPlan, restoreModuleTeamsMeeting, readModuleTeamsMeeting, CurriculumRequestTimeout, ApiError, type ModuleCatalogueItem, type SavedModuleTeamsMeeting } from '../moduleAuthoringData';

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
  restoreModuleTeamsMeeting: vi.fn(), readModuleTeamsMeeting: vi.fn(), updateTeamsMeetingSchedule: vi.fn(),
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
  vi.resetAllMocks();
  vi.mocked(readModuleTeamsMeeting).mockRejectedValue(new ApiError(404, 'No saved Teams meeting was found for this module.'));
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
  // England remains selectable; the new default requested by the owner is Egypt.
  await userEvent.click(screen.getByRole('combobox', { name: /Schedule time zone/ }));
  await userEvent.click(screen.getByRole('option', { name: 'England (Europe/London)' }));
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

it('previews and creates 09:00 to 11:00 from the delivery plan instead of stale component defaults', async () => {
  const module = structuredClone(MODULE) as unknown as { weekStructure: { components: { settings: Record<string, unknown> }[] }[] };
  module.weekStructure[0].components.forEach(component => {
    component.settings.sessionTime = '12:00';
    component.settings.durationMinutes = 60;
  });
  vi.mocked(fetchModuleSessionPlan).mockResolvedValue({
    sessions: ['2026-09-07', '2026-09-10'].map((date, index) => ({
      sessionNumber: index + 1, weekNumber: 1, date, day: index ? 'Thursday' : 'Monday',
      startTime: '09:00', endTime: '11:00', durationMinutes: 120, skippedHolidays: [],
    })), skippedHolidays: [], finalEndDate: '2026-09-10', warnings: [],
  });
  render(<TeamsMeetingModal module={module as never} onClose={vi.fn()} onCreated={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled());
  expect(screen.getByText('7 Sept 2026, 9:00 AM')).toBeInTheDocument();
  expect(screen.getByText('10 Sept 2026, 9:00 AM')).toBeInTheDocument();
  expect(screen.getByText('120 min each')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() => expect(createTeamsMeeting).toHaveBeenCalledWith(expect.objectContaining({
    scheduleTimeZone: 'Africa/Cairo',
    scheduledOccurrences: [
      { sessionNumber: 1, startDateTimeUtc: '2026-09-07T06:00:00.000Z', durationMinutes: 120 },
      { sessionNumber: 2, startDateTimeUtc: '2026-09-10T06:00:00.000Z', durationMinutes: 120 },
    ],
  })));
});

it('shows each live component title on its own date without duplicate country dates or session labels', async () => {
  const module = structuredClone(MODULE as ModuleCatalogueItem);
  const [monday, thursday] = module.weekStructure[0].components;
  module.weekStructure[0].components = [
    { ...thursday, title: 'P2: Risk analysis workshop' },
    { ...monday, title: 'P1: Foundations workshop' },
  ];
  render(<TeamsMeetingModal module={module} onClose={vi.fn()} onCreated={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled());
  const first = screen.getByText('P1: Foundations workshop').closest('div');
  const second = screen.getByText('P2: Risk analysis workshop').closest('div');
  expect(first).toHaveTextContent(/7 Sept 2026, 9:00 AM\s*\(Monday\)/);
  expect(second).toHaveTextContent(/10 Sept 2026, 7:00 PM\s*\(Thursday\)/);
  expect(screen.queryByText(/^Session \d+$/)).not.toBeInTheDocument();
  const timeBadge = screen.getByRole('note', { name: 'Session start times in Egypt and England' });
  expect(timeBadge).toHaveTextContent('Egypt: 9:00 AM · England: 7:00 AM');
  expect(timeBadge).toHaveTextContent('Egypt: 7:00 PM · England: 5:00 PM');
  expect(screen.queryByText(/Egypt:.*Sept/)).not.toBeInTheDocument();
  expect(screen.queryByText(/England:.*Sept/)).not.toBeInTheDocument();
  // Removing the country dates must remove their empty bordered row too.
  expect(first?.parentElement?.children).toHaveLength(1);
  expect(createTeamsMeeting).not.toHaveBeenCalled();
  expect(updateTeamsMeetingSchedule).not.toHaveBeenCalled();
});

it('retains a session-number fallback when a live component has no title', async () => {
  const module = structuredClone(MODULE as ModuleCatalogueItem);
  module.weekStructure[0].components[0].title = '   ';
  render(<TeamsMeetingModal module={module} onClose={vi.fn()} onCreated={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled());
  expect(screen.getByText('Session 1')).toBeInTheDocument();
  expect(screen.getByText('Thursday session')).toBeInTheDocument();
  expect(screen.queryByText('Session 2')).not.toBeInTheDocument();
});

it('recovers saved component links after a timeout without creating or sending again', async () => {
  const restored = { ...(MODULE as object), structureRevision: 'after-attachment' } as typeof MODULE;
  vi.mocked(createTeamsMeeting).mockRejectedValueOnce(new CurriculumRequestTimeout());
  vi.mocked(readModuleTeamsMeeting).mockRejectedValueOnce(new ApiError(404, 'No calendar')).mockResolvedValue({ ...SAVED, module: restored });
  vi.mocked(restoreModuleTeamsMeeting).mockResolvedValue({ restored: true, module: restored } as never);
  const onRestored = vi.fn();
  render(<TeamsMeetingModal module={MODULE} onClose={vi.fn()} onCreated={vi.fn()} onRestored={onRestored} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() => expect(onRestored).toHaveBeenCalledWith(restored));
  expect(readModuleTeamsMeeting).toHaveBeenCalledWith('MOD-ONE');
  expect(restoreModuleTeamsMeeting).toHaveBeenCalledWith('MOD-ONE');
  expect(createTeamsMeeting).toHaveBeenCalledTimes(1);
  expect(finishTeamsCreation).not.toHaveBeenCalled();
});

it('keeps an incomplete saved calendar visible and retries only its status and attachment', async () => {
  vi.mocked(createTeamsMeeting).mockRejectedValueOnce(new CurriculumRequestTimeout());
  vi.mocked(readModuleTeamsMeeting).mockRejectedValueOnce(new ApiError(404, 'No calendar')).mockResolvedValue({ ...SAVED, verificationPending: true });
  const onRestored = vi.fn();
  render(<TeamsMeetingModal module={MODULE} onClose={vi.fn()} onCreated={vi.fn()} onRestored={onRestored} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(await screen.findByText(/verification is still incomplete/)).toBeInTheDocument();
  expect(restoreModuleTeamsMeeting).not.toHaveBeenCalled();
  expect(onRestored).not.toHaveBeenCalled();
  vi.mocked(readModuleTeamsMeeting).mockResolvedValue(SAVED);
  vi.mocked(restoreModuleTeamsMeeting).mockResolvedValue({ restored: true, module: MODULE } as never);
  await userEvent.click(screen.getByRole('button', { name: 'Check saved calendar & restore links' }));
  await waitFor(() => expect(onRestored).toHaveBeenCalledWith(MODULE));
  expect(createTeamsMeeting).toHaveBeenCalledTimes(1);
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

const SAVED: SavedModuleTeamsMeeting = {
  verificationPending: false, module: MODULE,
  meeting: {
    teamsLiveSessionId: 'LIVE-SAVED', teamsEventId: 'EVENT-SAVED', teamsMeetingUrl: 'https://teams.example/saved',
    teamsOrganizerEmail: 'saved-organizer@example.invalid', teamsAttendees: ['learner@example.invalid'],
    teamsPresenters: ['presenter@example.invalid'], teamsCoOrganizers: ['co-organizer@example.invalid'],
    teamsLobbyBypass: 'organizer', teamsRecording: 'none', teamsSpokenLanguage: 'ar-EG',
    sessionTimeZone: 'Africa/Cairo', teamsRepeat: 'weekly',
  },
  calendar: { title: 'Saved calendar', seriesMode: 'shared', occurrences: [
    { sessionNumber: 1, startDateTimeUtc: '2026-10-23T06:00:00Z', durationMinutes: 120, eventId: 'OCC-1', joinUrl: 'https://teams.example/saved' },
    // Session 2 was cancelled. Session 3 has an individual duration change.
    { sessionNumber: 3, startDateTimeUtc: '2026-10-30T07:00:00Z', durationMinutes: 60, eventId: 'OCC-3', joinUrl: 'https://teams.example/saved' },
  ] },
};

it('loads the existing calendar, updates the same identity and restores its component links', async () => {
  vi.mocked(readModuleTeamsMeeting).mockResolvedValue(SAVED);
  vi.mocked(updateTeamsMeetingSchedule).mockResolvedValue({ updated: true, meeting: {} } as never);
  vi.mocked(restoreModuleTeamsMeeting).mockResolvedValue({ restored: true, module: MODULE } as never);
  const onRestored = vi.fn();
  const onClose = vi.fn();
  render(<TeamsMeetingModal module={MODULE} onClose={onClose} onCreated={vi.fn()} onRestored={onRestored} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Organizer' })).toHaveValue('saved-organizer@example.invalid');
  expect(screen.getByRole('textbox', { name: 'Organizer' })).toHaveAttribute('readonly');
  for (const email of ['learner@example.invalid', 'presenter@example.invalid', 'co-organizer@example.invalid']) expect(screen.getByText(email)).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: /Recording/ })).toHaveTextContent('Do not start automatically');
  expect(screen.getByRole('combobox', { name: /Who can bypass/ })).toHaveTextContent('Only organizers');
  expect(screen.getByRole('combobox', { name: /Spoken language/ })).toHaveTextContent('Arabic (Egypt)');
  expect(screen.getByRole('combobox', { name: /Schedule time zone/ })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: /Teams series and links/ })).toBeDisabled();
  expect(screen.getByText('23 Oct 2026, 9:00 AM')).toBeInTheDocument();
  expect(screen.getByText('30 Oct 2026, 9:00 AM')).toBeInTheDocument();
  const timeBadge = screen.getByRole('note', { name: 'Session start times in Egypt and England' });
  expect(timeBadge).toHaveTextContent('Egypt: 9:00 AM · England: 7:00 AM');
  expect(timeBadge.children).toHaveLength(1);
  expect(screen.queryByText(/Egypt:.*Oct/)).not.toBeInTheDocument();
  expect(screen.queryByText(/England:.*Oct/)).not.toBeInTheDocument();
  expect(screen.getByText('Session 3')).toBeInTheDocument();
  expect(screen.queryByText('Session 2')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: /Recording/ }));
  await userEvent.click(screen.getByRole('option', { name: 'Record automatically' }));
  await userEvent.click(screen.getByRole('button', { name: 'Update' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(updateTeamsMeetingSchedule).toHaveBeenCalledWith('LIVE-SAVED', expect.objectContaining({
    eventId: 'EVENT-SAVED', organizerEmail: 'saved-organizer@example.invalid', peopleOnly: true,
    seriesMode: 'shared', attendees: ['learner@example.invalid'], presenters: ['presenter@example.invalid'], coOrganizers: ['co-organizer@example.invalid'],
    lobbyBypass: 'organizer', recording: 'record', spokenLanguage: 'ar-EG',
    scheduledOccurrences: SAVED.calendar.occurrences.map(({ sessionNumber, startDateTimeUtc, durationMinutes }) => ({ sessionNumber, startDateTimeUtc, durationMinutes })),
  }));
  expect(onRestored).toHaveBeenCalledWith(MODULE);
  expect(createTeamsMeeting).not.toHaveBeenCalled();
  expect(finishTeamsCreation).not.toHaveBeenCalled();
});

it('matches saved titles by calendar identity and session number across cancellations and reordered components', async () => {
  const module = structuredClone(MODULE as ModuleCatalogueItem);
  const [monday, thursday] = module.weekStructure[0].components;
  module.weekStructure[0].components = [
    { ...thursday, title: 'Current risk workshop' },
    { ...monday, title: 'Current foundations workshop' },
  ];
  const savedModule = structuredClone(module);
  savedModule.weekStructure[0].components = [
    { ...thursday, id: 'OTHER-CALENDAR', title: 'Another calendar workshop', settings: { teamsLiveSessionId: 'LIVE-OTHER', teamsSessionNumber: 3 } },
    { ...monday, id: 'READING', type: 'reading', title: 'Reading material', settings: { teamsLiveSessionId: 'LIVE-SAVED', teamsSessionNumber: 1 } },
    { ...thursday, title: 'Saved risk workshop', settings: { teamsLiveSessionId: 'LIVE-SAVED', teamsSessionNumber: 3 } },
    { ...monday, title: 'Saved foundations workshop', settings: { teamsLiveSessionId: 'LIVE-SAVED', teamsSessionNumber: 1 } },
  ];
  vi.mocked(readModuleTeamsMeeting).mockResolvedValue({ ...SAVED, module: savedModule });
  render(<TeamsMeetingModal module={module} onClose={vi.fn()} onCreated={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled());
  expect(screen.getByText('Current foundations workshop').closest('div')).toHaveTextContent(/23 Oct 2026, 9:00 AM\s*\(Friday\)/);
  expect(screen.getByText('Current risk workshop').closest('div')).toHaveTextContent(/30 Oct 2026, 9:00 AM\s*\(Friday\)/);
  expect(screen.queryByText(/^Session \d+$/)).not.toBeInTheDocument();
  expect(screen.queryByText('Another calendar workshop')).not.toBeInTheDocument();
  expect(screen.queryByText('Reading material')).not.toBeInTheDocument();
  expect(screen.queryByText(/^Saved .* workshop$/)).not.toBeInTheDocument();
  expect(createTeamsMeeting).not.toHaveBeenCalled();
  expect(updateTeamsMeetingSchedule).not.toHaveBeenCalled();
  expect(restoreModuleTeamsMeeting).not.toHaveBeenCalled();
});

it('changes duration only when chosen and keeps saved dates and series links', async () => {
  vi.mocked(readModuleTeamsMeeting).mockResolvedValue(SAVED);
  vi.mocked(updateTeamsMeetingSchedule).mockResolvedValue({ updated: true } as never);
  vi.mocked(restoreModuleTeamsMeeting).mockResolvedValue({ restored: true, module: MODULE } as never);
  render(<TeamsMeetingModal module={MODULE} onClose={vi.fn()} onCreated={vi.fn()} />);
  await screen.findByRole('button', { name: 'Update' });
  await userEvent.click(screen.getByRole('combobox', { name: /^Duration/ }));
  await userEvent.click(screen.getByRole('option', { name: '2 hours' }));
  await userEvent.click(screen.getByRole('button', { name: 'Update' }));
  await waitFor(() => expect(updateTeamsMeetingSchedule).toHaveBeenCalledWith('LIVE-SAVED', expect.objectContaining({
    peopleOnly: false, seriesMode: 'shared', scheduledOccurrences: [
      { sessionNumber: 1, startDateTimeUtc: '2026-10-23T06:00:00Z', durationMinutes: 120 },
      { sessionNumber: 3, startDateTimeUtc: '2026-10-30T07:00:00Z', durationMinutes: 120 },
    ],
  })));
});

it('blocks creation when the saved calendar cannot be read and retries the read only', async () => {
  vi.mocked(readModuleTeamsMeeting).mockRejectedValueOnce(new ApiError(503, 'Calendar lookup failed')).mockResolvedValue(SAVED);
  render(<TeamsMeetingModal module={MODULE} onClose={vi.fn()} onCreated={vi.fn()} />);
  expect(await screen.findByText('Calendar lookup failed')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading calendar' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled());
  expect(createTeamsMeeting).not.toHaveBeenCalled();
  expect(updateTeamsMeetingSchedule).not.toHaveBeenCalled();
});

it('never offers Create for a saved calendar whose verification is incomplete', async () => {
  vi.mocked(readModuleTeamsMeeting).mockResolvedValue({ ...SAVED, verificationPending: true });
  render(<MemoryRouter><TeamsMeetingModal module={MODULE} onClose={vi.fn()} onCreated={vi.fn()} /></MemoryRouter>);
  expect(await screen.findByRole('button', { name: 'Update' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Review it in Teams Meetings' })).toHaveAttribute('href', '/curriculum/teams-meetings?module=MOD-ONE');
  expect(createTeamsMeeting).not.toHaveBeenCalled();
});

it('keeps Update and the same calendar after an interrupted update', async () => {
  vi.mocked(readModuleTeamsMeeting).mockResolvedValue(SAVED);
  vi.mocked(updateTeamsMeetingSchedule).mockRejectedValueOnce(new CurriculumRequestTimeout());
  render(<TeamsMeetingModal module={MODULE} onClose={vi.fn()} onCreated={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Update' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  expect(restoreModuleTeamsMeeting).not.toHaveBeenCalled();
  expect(createTeamsMeeting).not.toHaveBeenCalled();
});

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
