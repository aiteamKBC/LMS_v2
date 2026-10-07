import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { finishTeamsUpdate } from '../../teams-meetings/creationResult';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type {
  CurriculumCohort,
  CurriculumGroup,
  CurriculumModule,
  CurriculumProgramme,
  CurriculumSession,
  CurriculumTeamsMeetingSummary,
} from '@/lib/curriculumApi';
import { TeamsMeetingModal } from '../TeamsMeetingModal';
import type { ModuleCatalogueItem } from '../moduleAuthoringData';

/**
 * The Module Builder opens the Teams Meetings page's own dialog, for its one
 * module. The dialog's behaviour is pinned where it lives, in
 * teams-meetings/__tests__/teamsMeetingsPage.test.tsx; what is pinned here is
 * what this door adds: the scope, the refusal to write over unsaved work, the
 * read-back after a write, and closing -- plus the meeting-settings and
 * invitation actions both doors share.
 */

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));
vi.mock('../../teams-meetings/creationResult', () => ({ finishTeamsCreation: vi.fn(), finishTeamsUpdate: vi.fn() }));
vi.mock('../../teams-meetings/calendarState', () => ({
  syncTeamsCalendarState: vi.fn(async () => ({ changed: false, seriesStatus: 'active', cancelledSessions: [], errors: [] })),
}));
vi.mock('../../teams-meetings/calendarActions', () => ({ calendarAction: vi.fn() }));

const programmes = [{ id: 'programme-data', sourceId: 'PROG-DATA', name: 'Data Analyst', level: '4' }] as CurriculumProgramme[];
const cohorts = [{ id: 'COHORT-1', name: 'Sept 2026', programmeId: 'PROG-DATA', programme: 'Data Analyst', status: 'active' }] as unknown as CurriculumCohort[];
const groups = [{
  id: 'GROUP-1', name: 'Group A', cohortId: 'COHORT-1', cohort: 'Sept 2026', programme: 'Data Analyst',
  weekDays: 'Wednesday', startTime: '09:30', endTime: '11:30', status: 'active',
}] as unknown as CurriculumGroup[];
const modules = [
  { id: 'MOD-1', moduleCatalogueId: 'MOD-1', name: 'Data Foundations', groupId: 'GROUP-1', weeks: 2, sessionsNumber: 2, status: 'published' },
  { id: 'MOD-3', moduleCatalogueId: 'MOD-3', name: 'Reporting Basics', groupId: 'GROUP-1', weeks: 1, sessionsNumber: 1, status: 'draft' },
] as unknown as CurriculumModule[];

function session(moduleId: string, date: string) {
  return {
    id: `${moduleId}-${date}`, moduleCatalogueId: moduleId, moduleId, title: 'Live session', type: 'live-session',
    date, day: 'Wednesday', startTime: '09:30', endTime: '11:30', tutor: 'Tutor One', group: 'Group A',
    cohort: 'Sept 2026', programme: 'Data Analyst', venue: 'Online', module: moduleId, week: 1,
  } as unknown as CurriculumSession;
}
const sessions = [session('MOD-1', '2026-09-02'), session('MOD-1', '2026-09-09'), session('MOD-3', '2026-09-04')];

const summaries: CurriculumTeamsMeetingSummary[] = [{
  moduleCatalogueId: 'MOD-1', liveSessionId: 'LIVE-1', status: 'active',
  joinUrl: 'https://teams.microsoft.com/l/meetup-join/one', organizerEmail: 'organizer@example.invalid',
  eventId: 'event-1', presenters: ['tutor@example.invalid'], coOrganizers: ['co@example.invalid'],
  attendees: ['learner@example.invalid'], repeatPattern: 'weekly', startDateTime: '2026-09-02T08:30:00Z', durationMinutes: 120,
  occurrenceCount: 2, upcomingCount: 2, syncedCount: 0, nextOccurrence: '2026-09-02T08:30:00Z', updatedAt: '2026-08-20T10:00:00Z',
  occurrenceDates: ['2026-09-02T08:30:00Z', '2026-09-09T08:30:00Z'],
  syncState: 'in-sync', expectedOccurrenceCount: 2, differingOccurrenceCount: 0, missingFromTeams: [], extraInTeams: [],
} as CurriculumTeamsMeetingSummary];

const artifacts = {
  series: {
    id: 'LIVE-1', module_title: 'Data Foundations', organizer_email: 'organizer@example.invalid', join_url: '', online_meeting_id: 'meeting-1',
    recording: 'record', lobby_bypass: 'organization', spoken_language: 'ar-EG',
    presenters: ['tutor@example.invalid'], co_organizers: ['co@example.invalid'], attendees: ['learner@example.invalid'],
  },
  occurrences: [
    { id: 'OCC-1', session_number: 1, scheduled_start: '2026-09-02T08:30:00Z', scheduled_end: '2026-09-02T10:30:00Z', status: 'scheduled', attendance: [], artifacts: [] },
    { id: 'OCC-2', session_number: 2, scheduled_start: '2026-09-09T08:30:00Z', scheduled_end: '2026-09-09T10:30:00Z', status: 'scheduled', attendance: [], artifacts: [] },
  ],
};

const fetchCurriculumTeamsMeetingSummaries = vi.fn(async () => summaries);
vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumTeamsMeetingSummaries: (...args: unknown[]) => fetchCurriculumTeamsMeetingSummaries(...(args as [])),
  fetchCurriculumSessions: vi.fn(async () => sessions),
  fetchCurriculumScopeLearnerRoster: vi.fn(async () => ({ assignedLearners: [{ email: 'learner@example.invalid' }, { email: 'new@example.invalid' }] })),
}));

// One live-session component per week, each with the name its author typed --
// what the schedule rows are supposed to be called.
const freshModule = {
  catalogueId: 'MOD-1', title: 'Data Foundations',
  weekStructure: [
    { weekNumber: 1, components: [{ id: 'COMP-1', type: 'live-session', title: 'Live Teams Session 1' }] },
    { weekNumber: 2, components: [{ id: 'COMP-2', type: 'live-session', title: 'Kick-off workshop' }] },
  ],
} as unknown as ModuleCatalogueItem;
const updateTeamsMeetingSchedule = vi.fn(async (..._args: unknown[]) => ({ updated: true, meeting: {} as never, warnings: [] }));
const loadModuleStructure = vi.fn(async (..._args: unknown[]) => freshModule);
vi.mock('../moduleAuthoringData', async importOriginal => ({
  ...(await importOriginal<typeof import('../moduleAuthoringData')>()),
  loadTeamsMeetingConfiguration: vi.fn(async () => ({
    configured: true, defaultOrganizer: 'organizer@example.invalid', timeZone: 'GMT Standard Time', timeZoneIana: 'Europe/London',
  })),
  loadTeamsMeetingArtifacts: vi.fn(async () => artifacts),
  fetchModuleSessionPlan: vi.fn(async () => ({
    sessions: [
      { sessionNumber: 1, weekNumber: 1, date: '2026-09-02', day: 'Wednesday', startTime: '09:30', endTime: '11:30', skippedHolidays: [] },
      { sessionNumber: 2, weekNumber: 2, date: '2026-09-09', day: 'Wednesday', startTime: '09:30', endTime: '11:30', skippedHolidays: [] },
    ],
    skippedHolidays: [], finalEndDate: '', warnings: [],
  })),
  fetchModuleMeetingInvitees: vi.fn(async () => ({ attendees: [], presenters: [] })),
  loadModuleStructure: (...args: unknown[]) => loadModuleStructure(...args),
  probeModuleTeamsAttachment: vi.fn(async () => 0),
  updateTeamsMeetingSchedule: (...args: unknown[]) => updateTeamsMeetingSchedule(...args),
  createTeamsMeeting: vi.fn(),
  restoreModuleTeamsMeeting: vi.fn(),
}));

vi.mock('@/hooks/useCurriculumEntities', () => ({
  useCurriculumEntities: () => ({
    programmes, cohorts, groups, modules, holidays: [], tutors: [], coaches: [], teamsMeetings: [],
    entities: {}, loading: false, loaded: true, error: null, reload: vi.fn(async () => null),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('curriculumTeamsAutoSync', 'off');
});

function open(catalogueId: string, props: Partial<Parameters<typeof TeamsMeetingModal>[0]> = {}) {
  const onClose = vi.fn();
  const onRestored = vi.fn();
  render(
    <MemoryRouter>
      <TeamsMeetingModal module={{ catalogueId, title: 'Module' } as never} onClose={onClose} onRestored={onRestored} {...props} />
    </MemoryRouter>,
  );
  return { onClose, onRestored };
}

it('opens the Teams Meetings dialog itself, for this module alone', async () => {
  open('MOD-1');
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getAllByText('Data Foundations').length).toBeGreaterThan(0);
  for (const name of ['Update Teams calendar', 'Edit session dates', 'Cancel series', 'Save without notifying', 'Edit meeting settings', 'Sync calendar status']) {
    expect(dialog.getByRole('button', { name })).toBeInTheDocument();
  }
  expect(fetchCurriculumTeamsMeetingSummaries).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ moduleCatalogueIds: ['MOD-1'] }));
  // Only this module's sessions, read fresh -- never a forced rebuild of every module's.
  const { fetchCurriculumSessions } = await import('@/lib/curriculumApi');
  expect(fetchCurriculumSessions).toHaveBeenCalledWith(expect.anything(), { skipCache: true, moduleCatalogueId: 'MOD-1' });
});

it('waits for the saved session dates instead of calling a scheduled module empty', async () => {
  let release!: (value: CurriculumSession[]) => void;
  const { fetchCurriculumSessions } = await import('@/lib/curriculumApi');
  vi.mocked(fetchCurriculumSessions).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  open('MOD-3');
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByRole('status')).toHaveTextContent(/Loading this module.s session dates and Teams calendar/);
  expect(dialog.queryByText(/no stored session dates/)).not.toBeInTheDocument();
  expect(dialog.queryByText(/No sessions/i)).not.toBeInTheDocument();
  expect(dialog.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  await act(async () => { release(sessions); });
  // The same dialog fills in with the module's own dates.
  expect(await dialog.findByText(/Create puts one Teams meeting on each of the 1 session date below/)).toBeVisible();
  expect(dialog.getByRole('button', { name: 'Create' })).toBeInTheDocument();
});

it('opens the shared create form for a module with no calendar', async () => {
  open('MOD-3');
  const dialog = within(await screen.findByRole('dialog'));
  expect(await dialog.findByRole('combobox', { name: 'Organizer' })).toBeInTheDocument();
  expect(dialog.getByRole('button', { name: 'Create' })).toBeInTheDocument();
});

it('refuses every write while the module has unsaved changes, and still lets it sync', async () => {
  open('MOD-1', { unsavedChanges: true });
  const dialog = within(await screen.findByRole('dialog'));
  expect(await dialog.findByText(/This module has unsaved changes/)).toBeVisible();
  await waitFor(() => expect(dialog.getByRole('button', { name: 'Edit meeting settings' })).toBeDisabled());
  for (const name of ['Update Teams calendar', 'Edit session dates', 'Cancel series', 'Save without notifying']) {
    expect(dialog.getByRole('button', { name })).toBeDisabled();
  }
  expect(dialog.getByRole('button', { name: 'Sync calendar status' })).toBeEnabled();
});

it('reads the module back from the server after a write', async () => {
  const { onRestored } = open('MOD-1');
  const dialog = within(await screen.findByRole('dialog'));
  const update = await dialog.findByRole('button', { name: 'Update Teams calendar' });
  await waitFor(() => expect(update).toBeEnabled());
  await userEvent.click(update);
  await waitFor(() => expect(updateTeamsMeetingSchedule).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(onRestored).toHaveBeenCalledWith(freshModule));
  expect(loadModuleStructure).toHaveBeenCalledWith('MOD-1', { skipCache: true });
});

// A date the reader cannot name is a date they cannot check. "Session 1" is the
// number, not the session: the name belongs to the live-session component.
it('names each schedule row from its own live-session component, not the module', async () => {
  open('MOD-1');
  const dialog = within(await screen.findByRole('dialog'));
  expect(await dialog.findByText('Live Teams Session 1')).toBeInTheDocument();
  expect(dialog.getByText('Kick-off workshop')).toBeInTheDocument();
  // The bare number was what the row said when it had no name to say instead.
  expect(dialog.queryByText('Session 1')).not.toBeInTheDocument();
  expect(dialog.queryByText('Session 2')).not.toBeInTheDocument();
});

it('closes the builder door when the dialog closes', async () => {
  const { onClose } = open('MOD-1');
  const dialog = within(await screen.findByRole('dialog'));
  await userEvent.click(dialog.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it('edits meeting settings on the existing meeting without its dates or attendees', async () => {
  open('MOD-1');
  const dialog = within(await screen.findByRole('dialog'));
  const settings = await dialog.findByRole('button', { name: 'Edit meeting settings' });
  await waitFor(() => expect(settings).toBeEnabled());
  await userEvent.click(settings);
  await userEvent.click(await screen.findByRole('button', { name: 'Save meeting settings' }));
  await waitFor(() => expect(updateTeamsMeetingSchedule).toHaveBeenCalledTimes(1));
  const [liveId, payload] = updateTeamsMeetingSchedule.mock.calls[0] as [string, Record<string, unknown>];
  expect(liveId).toBe('LIVE-1');
  // The saved settings, as Microsoft was last told them, go back as the edit.
  expect(payload).toMatchObject({
    peopleOnly: true, settingsOnly: true, recording: 'record', lobbyBypass: 'organization', spokenLanguage: 'ar-EG',
    presenters: ['tutor@example.invalid'], coOrganizers: ['co@example.invalid'], eventId: 'event-1',
  });
  // Invitations are their own action: the attendee list is not part of this save.
  expect(payload).not.toHaveProperty('attendees');
  // The held dates go back unchanged.
  expect((payload.scheduledOccurrences as Array<{ startDateTimeUtc: string }>).map(item => item.startDateTimeUtc))
    .toEqual(['2026-09-02T08:30:00.000Z', '2026-09-09T08:30:00.000Z']);
  // Scoped to one module, closing the drawer returns to its dialog.
  expect(await screen.findByRole('button', { name: 'Edit meeting settings' })).toBeInTheDocument();
});

it('shows the invitation fields under the dates, every role filled, and saves only what changed', async () => {
  open('MOD-1');
  const dialog = within(await screen.findByRole('dialog'));
  // Every role the create form offers, in the dialog itself, each filled with
  // the people already in it; the organizer is shown, not edited.
  await waitFor(() => expect(dialog.getByRole('button', { name: 'Remove tutor@example.invalid' })).toBeInTheDocument());
  expect(dialog.getByRole('textbox', { name: 'Organizer' })).toHaveAttribute('readonly');
  expect(dialog.getByRole('button', { name: 'Remove co@example.invalid' })).toBeInTheDocument();
  expect(dialog.getByRole('button', { name: 'Remove learner@example.invalid' })).toBeInTheDocument();
  for (const name of ['Presenters', 'Co-organizers', 'Attendees']) expect(dialog.getByRole('combobox', { name })).toBeInTheDocument();
  const save = dialog.getByRole('button', { name: 'Save without notifying' });
  // Nothing to save until something changes.
  expect(save).toBeDisabled();
  const attendees = dialog.getByRole('combobox', { name: 'Attendees' });
  fireEvent.change(attendees, { target: { value: 'new@example.invalid' } });
  fireEvent.keyDown(attendees, { key: 'Enter' });
  await waitFor(() => expect(save).toBeEnabled());
  // Adding someone says, before saving, that this button tells them nothing.
  expect(dialog.getByText(/added people will be saved to the Teams meeting but will not receive an invitation or LMS email/))
    .toBeInTheDocument();
  await act(async () => { await userEvent.click(save); });
  await waitFor(() => expect(updateTeamsMeetingSchedule).toHaveBeenCalledTimes(1));
  const [, payload] = updateTeamsMeetingSchedule.mock.calls[0] as [string, Record<string, unknown>];
  // Save without notifying only saves: it asks the server to send nothing to anybody.
  expect(payload).toMatchObject({ peopleOnly: true, invitationsOnly: true, attendees: ['learner@example.invalid', 'new@example.invalid'] });
  // Untouched roles and options keep what Teams has saved.
  expect(payload).not.toHaveProperty('presenters');
  expect(payload).not.toHaveProperty('coOrganizers');
  expect(payload).not.toHaveProperty('recording');
  // The held dates go back unchanged, and nobody is emailed -- not even the one new person.
  expect((payload.scheduledOccurrences as Array<{ startDateTimeUtc: string }>).map(item => item.startDateTimeUtc))
    .toEqual(['2026-09-02T08:30:00.000Z', '2026-09-09T08:30:00.000Z']);
  await waitFor(() => expect(showCurriculumAlert).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Saved without notifying', text: expect.stringContaining('Nobody was emailed, including the 1 person you added'),
  })));
  expect(finishTeamsUpdate).not.toHaveBeenCalled();
});

it('invites only the people added when asked to, without moving a date', async () => {
  open('MOD-1');
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(dialog.getByRole('button', { name: 'Remove learner@example.invalid' })).toBeInTheDocument());
  // Offered only once somebody is added: with nobody new there is nobody to invite.
  expect(dialog.queryByRole('button', { name: 'Save and invite added people' })).toBeNull();
  const attendees = dialog.getByRole('combobox', { name: 'Attendees' });
  fireEvent.change(attendees, { target: { value: 'new@example.invalid' } });
  fireEvent.keyDown(attendees, { key: 'Enter' });
  const invite = await dialog.findByRole('button', { name: 'Save and invite added people' });
  await waitFor(() => expect(invite).toBeEnabled());
  await act(async () => { await userEvent.click(invite); });
  await waitFor(() => expect(updateTeamsMeetingSchedule).toHaveBeenCalledTimes(1));
  const [, payload] = updateTeamsMeetingSchedule.mock.calls[0] as [string, Record<string, unknown>];
  // The people-only path that forwards the meeting to the added and emails
  // them their schedule: never "send nothing", never a date change.
  expect(payload).toMatchObject({ peopleOnly: true, attendees: ['learner@example.invalid', 'new@example.invalid'] });
  expect(payload).not.toHaveProperty('invitationsOnly');
  expect(payload).not.toHaveProperty('notifyAttendees');
  expect((payload.scheduledOccurrences as Array<{ startDateTimeUtc: string }>).map(item => item.startDateTimeUtc))
    .toEqual(['2026-09-02T08:30:00.000Z', '2026-09-09T08:30:00.000Z']);
  await waitFor(() => expect(finishTeamsUpdate).toHaveBeenCalledTimes(1));
  expect(vi.mocked(finishTeamsUpdate).mock.calls[0][1]).toMatchObject({ addedPeople: ['new@example.invalid'] });
});
