import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  CurriculumCohort,
  CurriculumGroup,
  CurriculumModule,
  CurriculumProgramme,
  CurriculumSession,
  CurriculumTeamsMeetingSummary,
} from '@/lib/curriculumApi';

/**
 * The point of this page is that the module's own session dates are the
 * authority: it has to say when the Teams calendar disagrees with them, and
 * pressing the button has to send those exact dates — holiday shifts included —
 * rather than a plain weekly recurrence Graph invented for itself.
 */

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

const programmes = [
  { id: 'programme-data', sourceId: 'PROG-DATA', name: 'Data Analyst', level: '4' },
] as CurriculumProgramme[];

const cohorts = [
  { id: 'COHORT-1', name: 'Sept 2026', programmeId: 'PROG-DATA', programme: 'Data Analyst', status: 'active' },
] as unknown as CurriculumCohort[];

const groups = [
  {
    id: 'GROUP-1', name: 'Group A', cohortId: 'COHORT-1', cohort: 'Sept 2026',
    programme: 'Data Analyst', coach: 'Coach One', weekDays: 'Wednesday',
    startTime: '09:30', endTime: '11:30', status: 'active',
  },
] as unknown as CurriculumGroup[];

const modules = [
  { id: 'MOD-1', moduleCatalogueId: 'MOD-1', name: 'Data Foundations', groupId: 'GROUP-1', weeks: 2, sessionsNumber: 2, status: 'published' },
  { id: 'MOD-2', moduleCatalogueId: 'MOD-2', name: 'Risk Management', groupId: 'GROUP-1', weeks: 2, sessionsNumber: 2, status: 'published' },
  { id: 'MOD-4', moduleCatalogueId: 'MOD-4', name: 'Ops Clinic', groupId: 'GROUP-1', weeks: 1, sessionsNumber: 1, status: 'published' },
  {
    id: 'MOD-3', moduleCatalogueId: 'MOD-3', name: 'Reporting Basics', groupId: 'GROUP-1',
    weeks: 1, sessionsNumber: 1, status: 'draft',
    // The API appends these hidden lines to every module's notes.
    notes: [
      'Bring the reporting template to the first session.',
      '__program_id:PROG-DATA',
      '__cohort_id:COHORT-1',
      '__group_id:GROUP-1',
      '__group_name:Group A',
      '__module_catalogue_id:MOD-3',
    ].join('\n'),
  },
] as unknown as CurriculumModule[];

function session(moduleId: string, date: string, extra: Partial<CurriculumSession> = {}) {
  return {
    id: `${moduleId}-${date}`, moduleCatalogueId: moduleId, moduleId,
    title: 'Live session', type: 'live-session', date, day: 'Wednesday',
    startTime: '09:30', endTime: '11:30', tutor: 'Tutor One',
    group: 'Group A', cohort: 'Sept 2026', programme: 'Data Analyst',
    venue: 'Online', module: moduleId, week: 1, ...extra,
  } as unknown as CurriculumSession;
}

// 09:30 in Europe/London during BST is 08:30 UTC — the instant Teams holds.
const sessions: CurriculumSession[] = [
  session('MOD-1', '2026-09-02'),
  session('MOD-1', '2026-09-09'),
  session('MOD-2', '2026-09-03'),
  // Moved a week past a closure, exactly as the backend generator leaves it:
  // the field carries the dates that were skipped, and the page names them.
  session('MOD-2', '2026-09-17', { skippedHolidays: ['2026-09-10'] }),
  session('MOD-3', '2026-09-04'),
  // Right day, wrong hour: the calendar entry sits an hour off the module.
  session('MOD-4', '2026-09-08'),
];

const summaries: CurriculumTeamsMeetingSummary[] = [
  {
    moduleCatalogueId: 'MOD-1', liveSessionId: 'LIVE-1', status: 'active',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/one', organizerEmail: 'tutor@example.com',
    eventId: 'event-1', presenters: ['tutor@example.com'],
    // Two, so the head count in the dialog has names to open onto.
    attendees: ['learner@example.com', 'apprentice@example.com'],
    repeatPattern: 'weekly', startDateTime: '2026-09-02T08:30:00Z', durationMinutes: 120,
    occurrenceCount: 2, upcomingCount: 2, syncedCount: 0, nextOccurrence: '2026-09-02T08:30:00Z',
    updatedAt: '2026-08-20T10:00:00Z',
    occurrenceDates: ['2026-09-02T08:30:00Z', '2026-09-09T08:30:00Z'],
  },
  {
    moduleCatalogueId: 'MOD-2', liveSessionId: 'LIVE-2', status: 'active',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/two', organizerEmail: 'tutor@example.com',
    eventId: 'event-2', presenters: [], attendees: ['learner@example.com'],
    repeatPattern: 'weekly', startDateTime: '2026-09-03T08:30:00Z', durationMinutes: 120,
    occurrenceCount: 2, upcomingCount: 2, syncedCount: 0, nextOccurrence: '2026-09-03T08:30:00Z',
    updatedAt: '2026-08-20T10:00:00Z',
    // Teams still holds the unbroken weekly slot the closure moved the module off.
    occurrenceDates: ['2026-09-03T08:30:00Z', '2026-09-10T08:30:00Z'],
  },
  {
    moduleCatalogueId: 'MOD-4', liveSessionId: 'LIVE-4', status: 'active',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/four', organizerEmail: 'tutor@example.com',
    eventId: 'event-4', presenters: [], attendees: [],
    repeatPattern: 'none', startDateTime: '2026-09-08T07:30:00Z', durationMinutes: 120,
    occurrenceCount: 1, upcomingCount: 1, syncedCount: 0, nextOccurrence: '2026-09-08T07:30:00Z',
    updatedAt: '2026-08-20T10:00:00Z',
    occurrenceDates: ['2026-09-08T07:30:00Z'],
  },
];

import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';

const confirmMock = vi.mocked(showCurriculumConfirm);
const alertMock = vi.mocked(showCurriculumAlert);

// Every week already has its live session unless a test says otherwise.
const probeModuleTeamsAttachment = vi.fn(async () => 0);
const fetchCurriculumTeamsMeetingSummaries = vi.fn(async () => summaries);
const fetchCurriculumSessions = vi.fn(async () => sessions);

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumTeamsMeetingSummaries: (...args: unknown[]) => fetchCurriculumTeamsMeetingSummaries(...(args as [])),
  fetchCurriculumSessions: (...args: unknown[]) => fetchCurriculumSessions(...(args as [])),
}));

const updateTeamsMeetingSchedule = vi.fn(async () => ({
  updated: true,
  meeting: {} as never,
  warnings: [],
}));
const createTeamsMeeting = vi.fn(async () => ({ created: true, meeting: {} as never, warnings: [] }));
const saveTeamsRecordingEvents = vi.fn(async () => ({ saved: 1, previewSessionId: 'preview-1' }));
const syncTeamsMeetingArtifacts = vi.fn(async () => ({
  synced: { attendanceReports: 1, attendanceRecords: 3, transcripts: 1, recordings: 1 },
  errors: [], partial: false,
}));

// One meeting that has already run, so its recording is there to be watched.
const artifacts = {
  series: { id: 'LIVE-1', module_title: 'Data Foundations', organizer_email: 'tutor@example.com', join_url: '', online_meeting_id: 'meeting-1' },
  occurrences: [
    {
      id: 'OCC-1', session_number: 1, scheduled_start: '2026-09-02T08:30:00Z', scheduled_end: '2026-09-02T10:30:00Z',
      participant_count: 3, status: 'held', attendance: [],
      artifacts: [{ id: 'ART-REC-1', artifact_type: 'recording' }, { id: 'ART-VTT-1', artifact_type: 'transcript' }],
    },
  ],
};

// Only the calls that reach Microsoft are stubbed; the timezone maths this page
// relies on is the real implementation.
vi.mock('../../module-builder/moduleAuthoringData', async importOriginal => ({
  ...(await importOriginal<typeof import('../../module-builder/moduleAuthoringData')>()),
  loadTeamsMeetingConfiguration: vi.fn(async () => ({
    configured: true, defaultOrganizer: 'tutor@example.com',
    timeZone: 'GMT Standard Time', timeZoneIana: 'Europe/London',
  })),
  loadTeamsMeetingArtifacts: vi.fn(async () => artifacts),
  syncTeamsMeetingArtifacts: (...args: unknown[]) => syncTeamsMeetingArtifacts(...(args as [])),
  restoreModuleTeamsMeeting: vi.fn(async () => ({ restored: true, updatedComponents: 1, meeting: {}, module: {} })),
  probeModuleTeamsAttachment: (...args: unknown[]) => probeModuleTeamsAttachment(...(args as [])),
  updateTeamsMeetingSchedule: (...args: unknown[]) => updateTeamsMeetingSchedule(...(args as [])),
  createTeamsMeeting: (...args: unknown[]) => createTeamsMeeting(...(args as [])),
  saveTeamsRecordingEvents: (...args: unknown[]) => saveTeamsRecordingEvents(...(args as [])),
}));

const holidays = [
  { id: 'HOL-1', label: 'Autumn closure', startDate: '2026-09-10', endDate: '2026-09-10' },
];

vi.mock('@/hooks/useCurriculumEntities', () => ({
  useCurriculumEntities: () => ({
    programmes, cohorts, groups, modules, holidays,
    tutors: [], coaches: [], teamsMeetings: [],
    entities: {}, loading: false, loaded: true, error: null,
    reload: vi.fn(async () => null),
  }),
}));

async function renderPage() {
  const { default: Page } = await import('../page');
  return render(
    <MemoryRouter initialEntries={['/curriculum/teams-meetings']}>
      <Routes>
        <Route path="/curriculum/teams-meetings" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  );
}

function rowFor(name: string) {
  return screen.getByText(name).closest('div[class*="grid-cols"]') as HTMLElement;
}

describe('Teams Meetings page', () => {
  beforeEach(() => {
    updateTeamsMeetingSchedule.mockClear();
    createTeamsMeeting.mockClear();
    saveTeamsRecordingEvents.mockClear();
    syncTeamsMeetingArtifacts.mockClear();
    fetchCurriculumTeamsMeetingSummaries.mockClear();
    fetchCurriculumTeamsMeetingSummaries.mockImplementation(async () => summaries);
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(false);
    probeModuleTeamsAttachment.mockClear();
    probeModuleTeamsAttachment.mockResolvedValue(0);
    // Cleared like the rest: without this the call count is cumulative across
    // the file, so any test asserting on what a click confirmed counts every
    // earlier test's alerts too.
    alertMock.mockClear();
    window.localStorage.removeItem('curriculumTeamsAutoSync');
  });

  it('reports a calendar that matches the module session plan as in sync', async () => {
    await renderPage();
    expect(await screen.findByText('Data Foundations')).toBeInTheDocument();
    expect(within(rowFor('Data Foundations')).getByText('In sync')).toBeInTheDocument();
    // The dates themselves are what the comparison needs, so they are asked for.
    expect(fetchCurriculumTeamsMeetingSummaries).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ occurrenceDates: true }),
    );
  });

  it('names the sessions whose Teams date no longer matches the module', async () => {
    await renderPage();
    expect(await screen.findByText('Risk Management')).toBeInTheDocument();
    const row = within(rowFor('Risk Management'));
    expect(row.getByText('Dates differ')).toBeInTheDocument();
    expect(row.getByText('1 session differs')).toBeInTheDocument();
  });

  it('names the holiday that moved a session, in the dialog and in the create form', async () => {
    await renderPage();
    expect(await screen.findByText('Risk Management')).toBeInTheDocument();
    await userEvent.click(within(rowFor('Risk Management')).getByRole('button', { name: 'Detail' }));

    const dialog = await screen.findByRole('dialog');
    // The closed date keeps a row of its own, in red, saying which holiday shut
    // it and where the session went — the same pair of cards the module form
    // shows, rather than a column of prose beside every unmoved session.
    const blocked = within(dialog).getByText('Shifted to replacement').closest('div')?.parentElement;
    expect(blocked).toHaveTextContent('10 Sept 2026');
    expect(blocked).toHaveTextContent('Blocked by Autumn closure; replacement scheduled on 17 Sept 2026.');
    // …and the day it moved onto is marked as the replacement, not as a
    // second, unexplained session.
    expect(within(dialog).getByText('17 Sept 2026, 09:30').closest('div'))
      .toHaveTextContent('Replacement delivered');
    // The session numbers the holiday note talks about are findable in the list.
    expect(within(dialog).getByText('Session 1')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Session 2').length).toBeGreaterThan(0);
  });

  it('spells out that a closure rolls the rest of the plan, end date included', async () => {
    await renderPage();
    expect(await screen.findByText('Risk Management')).toBeInTheDocument();
    await userEvent.click(within(rowFor('Risk Management')).getByRole('button', { name: 'Detail' }));

    const dialog = await screen.findByRole('dialog');
    // Moved dates alone read as "one session slipped", so the rule and its
    // cost to the module's end date are stated in words above them.
    expect(within(dialog).getByText(/closes/)).toHaveTextContent('Autumn closure closes 10 Sept 2026');
    expect(within(dialog).getByText(/moves to the next delivery day/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Session 2 runs later/))
      .toHaveTextContent('the module now ends 17 Sept 2026 instead of 10 Sept 2026');
  });

  it('separates a calendar entry on the wrong day from one on the wrong hour', async () => {
    await renderPage();
    expect(await screen.findByText('Ops Clinic')).toBeInTheDocument();
    await userEvent.click(within(rowFor('Ops Clinic')).getByRole('button', { name: 'Detail' }));

    // “Will be moved” beside an unchanged date reads as a mistake, so a
    // calendar entry that is only an hour out says exactly that.
    const clinic = await screen.findByRole('dialog');
    expect(within(clinic).getByText(/Right day, wrong time/))
      .toHaveTextContent('Teams still holds 08:30; sending moves it here.');
    // …and the note is only worth reading next to what makes it happen.
    expect(within(clinic).getByText(/Nothing on the Teams calendar changes/))
      .toHaveTextContent('until you press Update Teams calendar');
    await userEvent.click(within(clinic).getByRole('button', { name: 'Close' }));

    await userEvent.click(within(rowFor('Risk Management')).getByRole('button', { name: 'Detail' }));
    const risk = await screen.findByRole('dialog');
    // Only the difference is written down. The module's date is already on the
    // row, so a calendar entry that agrees with it says nothing at all — the
    // "same as the module" line used to repeat that fact once per session and
    // buried the one row that had actually moved.
    expect(within(risk).queryByText(/nothing to change/)).not.toBeInTheDocument();
    expect(within(risk).getByText('Teams still holds 10 Sept 2026, 09:30; sending moves it here.'))
      .toBeInTheDocument();
  });

  it('offers the way into each meeting, and says so when the session is over', async () => {
    await renderPage();
    expect(await screen.findByText('Risk Management')).toBeInTheDocument();
    await userEvent.click(within(rowFor('Risk Management')).getByRole('button', { name: 'Detail' }));

    const dialog = await screen.findByRole('dialog');
    const join = within(dialog).getAllByRole('link', { name: /Join/ });
    expect(join.length).toBeGreaterThan(0);
    join.forEach(link => expect(link).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/two'));
    expect(within(dialog).queryByText('Session ended')).not.toBeInTheDocument();
  });

  it('closes the join door once a session\u2019s end time has passed', async () => {
    // The dialog reads the clock, so the clock is what the test moves: both of
    // this module's meetings are over by the time the page renders.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T09:00:00Z'));
    try {
      await renderPage();
      expect(await screen.findByText('Risk Management')).toBeInTheDocument();
      await userEvent.click(within(rowFor('Risk Management')).getByRole('button', { name: 'Detail' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getAllByText('Session ended')).toHaveLength(2);
      expect(within(dialog).queryByRole('link', { name: 'Join Teams' })).not.toBeInTheDocument();
    } finally {
      clock.mockRestore();
    }
  });

  /**
   * A filled-in Detail button marks a row that is waiting on somebody. Colour
   * cannot be looked up, so the row and the toolbar both say what it means.
   */
  it('says what a highlighted Detail button means, on the button and above the table', async () => {
    await renderPage();
    expect(await screen.findByText('Risk Management')).toBeInTheDocument();

    // Risk Management's calendar disagrees with its module dates.
    expect(within(rowFor('Risk Management')).getByText('Dates differ')).toBeInTheDocument();
    expect(within(rowFor('Risk Management')).getByRole('button', { name: 'Detail' }))
      .toHaveAttribute('title', expect.stringContaining('Needs attention'));

    // A row that agrees says so rather than saying nothing.
    expect(within(rowFor('Data Foundations')).getByRole('button', { name: 'Detail' }))
      .toHaveAttribute('title', expect.stringContaining('Up to date'));

    // And the convention is decoded once, where the highlight is.
    expect(screen.getByText(/highlighted Detail button/)).toBeInTheDocument();
  });

  /**
   * The footer used to offer all three actions in every state, so a module with
   * every session attached and none of them run yet showed two buttons that
   * would have changed nothing. What is left appears only where it can act.
   */
  describe('the footer only offers what the module can actually do', () => {
    it('shows the update action alone when nothing is missing and nothing has run', async () => {
      await renderPage();
      expect(await screen.findByText('Risk Management')).toBeInTheDocument();
      await userEvent.click(within(rowFor('Risk Management')).getByRole('button', { name: 'Detail' }));

      const dialog = within(await screen.findByRole('dialog'));
      expect(dialog.getByRole('button', { name: 'Update Teams calendar' })).toBeInTheDocument();
      await waitFor(() => expect(probeModuleTeamsAttachment).toHaveBeenCalled());
      expect(dialog.queryByRole('button', { name: /missing live session/ })).not.toBeInTheDocument();
      expect(dialog.getByRole('button', { name: 'Sync attendance & files' })).toBeInTheDocument();
      expect(dialog.getByRole('switch', { name: 'Auto-sync on' })).toHaveAttribute('aria-checked', 'true');
    });

    it('offers the missing live sessions, counted, when weeks are still without one', async () => {
      probeModuleTeamsAttachment.mockResolvedValue(3);
      await renderPage();
      expect(await screen.findByText('Risk Management')).toBeInTheDocument();
      await userEvent.click(within(rowFor('Risk Management')).getByRole('button', { name: 'Detail' }));

      const dialog = within(await screen.findByRole('dialog'));
      // The count is on the button, so the action says what it will do.
      expect(await dialog.findByRole('button', { name: 'Add 3 missing live sessions' })).toBeInTheDocument();
    });

    it('keeps the manual artifact sync available once sessions have ended', async () => {
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T09:00:00Z'));
      try {
        await renderPage();
        expect(await screen.findByText('Risk Management')).toBeInTheDocument();
        await userEvent.click(within(rowFor('Risk Management')).getByRole('button', { name: 'Detail' }));

        const dialog = within(await screen.findByRole('dialog'));
        expect(dialog.getAllByText('Session ended').length).toBeGreaterThan(0);
        expect(dialog.getByRole('button', { name: 'Sync attendance & files' })).toBeInTheDocument();
      } finally {
        clock.mockRestore();
      }
    });
  });

  it('syncs attendance, transcripts and recordings when the manual button is pressed', async () => {
    await renderPage();
    expect(await screen.findByText('Data Foundations')).toBeInTheDocument();
    await userEvent.click(within(rowFor('Data Foundations')).getByRole('button', { name: 'Detail' }));

    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Sync attendance & files' }));

    await waitFor(() => expect(syncTeamsMeetingArtifacts).toHaveBeenCalledWith('LIVE-1'));
    expect(await screen.findByText('Teams sync complete: 3 attendance records, 1 transcript, 1 recording.'))
      .toBeInTheDocument();
  });

  it('automatically syncs a tracked meeting after its end time', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-02T11:00:00Z'));
    try {
      await renderPage();
      expect(await screen.findByText('Data Foundations')).toBeInTheDocument();
      await waitFor(() => expect(syncTeamsMeetingArtifacts).toHaveBeenCalledWith('LIVE-1'));
    } finally {
      clock.mockRestore();
    }
  });

  it('sends the module’s own holiday-shifted session dates to Teams', async () => {
    await renderPage();
    expect(await screen.findByText('Risk Management')).toBeInTheDocument();
    // Every Teams action for a module lives in its dialog, which the row's one
    // button opens — the row itself carries no bank of half-disabled buttons.
    await userEvent.click(within(rowFor('Risk Management')).getByRole('button', { name: 'Detail' }));

    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Update Teams calendar' });
    await waitFor(() => expect(send).not.toBeDisabled());
    await userEvent.click(send);

    await waitFor(() => expect(updateTeamsMeetingSchedule).toHaveBeenCalledTimes(1));
    const [liveSessionId, input] = updateTeamsMeetingSchedule.mock.calls[0] as unknown as [
      string,
      { scheduledOccurrences: Array<{ sessionNumber: number; startDateTimeUtc: string; durationMinutes: number }>; repeatOccurrences: number; startDateTimeUtc: string; localStartDateTime: string },
    ];
    expect(liveSessionId).toBe('LIVE-2');
    expect(input.localStartDateTime).toBe('2026-09-03T09:30');
    expect(input.repeatOccurrences).toBe(2);
    expect(input.scheduledOccurrences.map(item => item.startDateTimeUtc)).toEqual([
      '2026-09-03T08:30:00.000Z',
      // The shifted session, not the weekly slot Teams is still holding.
      '2026-09-17T08:30:00.000Z',
    ]);
    expect(input.scheduledOccurrences.map(item => item.durationMinutes)).toEqual([120, 120]);
  });

  // The detail used to unfold underneath the table, which pushed every row below
  // it off screen and left the reader scrolling to find what they had opened.
  it('opens the module detail in a dialog rather than unfolding it under the table', async () => {
    await renderPage();
    expect(await screen.findByText('Data Foundations')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const row = within(rowFor('Data Foundations'));
    await userEvent.click(row.getByRole('button', { name: 'Detail' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /Data Foundations/ })).toBeInTheDocument();
    expect(within(dialog).getByText('Module dates sent to Teams')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  // "2 invited" answers how many, not who, and the only place that used to name
  // them was the invitations editor -- an edit form opened for a read.
  it('opens the invited head count onto the names behind it', async () => {
    await renderPage();
    expect(await screen.findByText('Data Foundations')).toBeInTheDocument();
    await userEvent.click(within(rowFor('Data Foundations')).getByRole('button', { name: 'Detail' }));

    const dialog = await screen.findByRole('dialog');
    const count = within(dialog).getByRole('button', { name: /2 invited/ });
    expect(within(dialog).queryByText('learner@example.com')).not.toBeInTheDocument();

    await userEvent.click(count);
    expect(within(dialog).getByText('learner@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('apprentice@example.com')).toBeInTheDocument();

    // It folds back up: the names are an aside, not a permanent block in the
    // middle of the meeting facts.
    await userEvent.click(count);
    expect(within(dialog).queryByText('learner@example.com')).not.toBeInTheDocument();
  });

  it('offers to build the calendar for a module that has session dates but no meeting', async () => {
    await renderPage();
    expect(await screen.findByText('Reporting Basics')).toBeInTheDocument();
    const row = within(rowFor('Reporting Basics'));
    expect(row.getByText('Not created')).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Create Teams meetings calendar' })).toBeInTheDocument();
  });

  it('plays a recording in place and records how it was watched', async () => {
    await renderPage();
    expect(await screen.findByText('Data Foundations')).toBeInTheDocument();
    await userEvent.click(within(rowFor('Data Foundations')).getByRole('button', { name: 'Detail' }));

    const watch = await screen.findByRole('button', { name: /Watch recording/ });
    await userEvent.click(watch);

    // Played here rather than downloaded, so the watch can be recorded at all.
    const player = await screen.findByLabelText(/Recording — Data Foundations/);
    const video = player.querySelector('video') as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.getAttribute('src')).toContain('ART-REC-1');

    fireEvent.play(video);
    fireEvent.seeked(video);
    await userEvent.click(within(player).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(saveTeamsRecordingEvents).toHaveBeenCalled());
    const [liveSessionId, artifactId, payload] = saveTeamsRecordingEvents.mock.calls
      .at(-1) as unknown as [string, string, { events: Array<{ type: string }>; viewer?: unknown }];
    expect(liveSessionId).toBe('LIVE-1');
    expect(artifactId).toBe('ART-REC-1');
    expect(payload.events.map(event => event.type)).toEqual(
      expect.arrayContaining(['open', 'play', 'seeked', 'close']),
    );
    // Who watched comes from the signed-in session on the server, never from here.
    expect(payload.viewer).toBeUndefined();
  });

  // The description used to be seeded from the module's notes, which carry the
  // API's hidden `__key:value` lines — programme, cohort, group and catalogue
  // ids went straight into the calendar invitation.
  it('names the meeting after the module and leaves the details empty', async () => {
    await renderPage();
    expect(await screen.findByText('Reporting Basics')).toBeInTheDocument();
    await userEvent.click(within(rowFor('Reporting Basics')).getByRole('button', { name: 'Create Teams meetings calendar' }));

    // The dialog the row opens *is* the create form: the dates it will be built
    // on, the settings, and one Create at the end.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /Reporting Basics/ })).toBeInTheDocument();
    expect(within(dialog).getByText('Dates the calendar will be created on')).toBeInTheDocument();
    expect(within(dialog).getByText('4 Sept 2026, 09:30')).toBeInTheDocument();
    const details = within(dialog).getByLabelText(/Details/i) as HTMLTextAreaElement;
    expect(details.value).toBe('');
    expect(within(dialog).queryByText(/__program_id/)).not.toBeInTheDocument();
    expect(within(dialog).queryByDisplayValue(/__/)).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createTeamsMeeting).toHaveBeenCalledTimes(1));
    const [input] = createTeamsMeeting.mock.calls[0] as unknown as [{
      title: string;
      moduleTitle: string;
      scheduledOccurrences: Array<{ startDateTimeUtc: string }>;
    }];
    expect(input.title).toBe('Reporting Basics');
    expect(input.moduleTitle).toBe('Reporting Basics');
    expect(input.scheduledOccurrences.map(item => item.startDateTimeUtc)).toEqual([
      '2026-09-04T08:30:00.000Z',
    ]);
  });

  /**
   * Create is the end of this dialog's job. Leaving it open re-rendered the
   * module in its summary view, which reads as "nothing happened" on top of a
   * form that has just sent real invitations.
   */
  it('confirms the dates reached Teams and closes the dialog', async () => {
    // Graph accepted the meeting options, so this is the clean-success path --
    // the one whose confirmation names the dates rather than warning about them.
    createTeamsMeeting.mockResolvedValueOnce({
      created: true,
      meeting: { settingsApplied: true } as never,
      warnings: [],
    });
    await renderPage();
    expect(await screen.findByText('Reporting Basics')).toBeInTheDocument();
    await userEvent.click(within(rowFor('Reporting Basics')).getByRole('button', { name: 'Create Teams meetings calendar' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(alertMock).toHaveBeenCalledTimes(1));
    expect(alertMock.mock.calls[0][0]).toMatchObject({ title: 'Session dates sent to Teams' });

    // The dialog is gone, not swapped for the summary view of the same module.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  /**
   * The create form lives in the dialog itself, so the dialog's own X, backdrop
   * and Escape are the only ways out of it. Nothing has reached Teams until
   * Create runs, which is exactly why a filled-in form must not vanish on a
   * mis-click.
   */
  describe('leaving the create form without creating', () => {
    async function openCreateForm() {
      await renderPage();
      expect(await screen.findByText('Reporting Basics')).toBeInTheDocument();
      await userEvent.click(within(rowFor('Reporting Basics')).getByRole('button', { name: 'Create Teams meetings calendar' }));
      return within(await screen.findByRole('dialog'));
    }

    it('closes an untouched form without asking', async () => {
      const dialog = await openCreateForm();
      await userEvent.click(dialog.getByRole('button', { name: 'Close' }));

      expect(confirmMock).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('asks before throwing away what was filled in, and stays open until the user says so', async () => {
      const dialog = await openCreateForm();
      await userEvent.type(dialog.getByLabelText(/Details/i), 'Bring the reporting template.');
      await userEvent.click(dialog.getByRole('button', { name: 'Close' }));

      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(confirmMock.mock.calls[0][0].confirmButtonText).toBe('Discard changes');
      // Cancelling the alert is the default, so the form survives.
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(createTeamsMeeting).not.toHaveBeenCalled();
    });

    it('closes once the discard is confirmed', async () => {
      // The real alert runs onConfirm when the user picks "Discard changes".
      confirmMock.mockImplementation(async options => {
        await options.onConfirm();
        return true;
      });
      const dialog = await openCreateForm();
      await userEvent.type(dialog.getByLabelText(/Details/i), 'Bring the reporting template.');
      await userEvent.click(dialog.getByRole('button', { name: 'Close' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(createTeamsMeeting).not.toHaveBeenCalled();
    });

    it('guards the backdrop and Escape too, not just the cross', async () => {
      const dialog = await openCreateForm();
      await userEvent.type(dialog.getByLabelText(/Details/i), 'Bring the reporting template.');

      const backdrop = screen.getByRole('dialog').parentElement?.querySelector('div.absolute.inset-0');
      fireEvent.click(backdrop as HTMLElement);
      expect(confirmMock).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(document, { key: 'Escape' });
      // The second way out asks again rather than closing silently; a raised
      // alert is not re-raised on top of itself.
      expect(confirmMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
  /**
   * A meeting is one absolute instant, and each person's Teams renders it in that
   * person's own timezone. The occurrence table is `timestamp without time zone`
   * holding UTC, so its values can reach the browser without an offset -- and
   * `new Date()` reads those as the reader's own local time. Read that way, a
   * calendar that matches perfectly reads as two hours out for a reader in Cairo
   * and as in sync for one in London, off the same data.
   */
  it('reads a Teams date that names no offset as UTC, so the reader’s own zone cannot invent drift', async () => {
    fetchCurriculumTeamsMeetingSummaries.mockImplementation(async () => summaries.map(summary => ({
      ...summary,
      startDateTime: String(summary.startDateTime).replace('Z', ''),
      nextOccurrence: String(summary.nextOccurrence).replace('Z', ''),
      occurrenceDates: (summary.occurrenceDates || []).map(value => String(value).replace('Z', '')),
    })));

    await renderPage();
    expect(await screen.findByText('Data Foundations')).toBeInTheDocument();
    // Same dates as the stamped fixture, so the same verdict: the offset being
    // absent is not a difference.
    expect(within(rowFor('Data Foundations')).getByText('In sync')).toBeInTheDocument();
    expect(within(rowFor('Risk Management')).getByText('Dates differ')).toBeInTheDocument();
  });

  it('says whose clock the times on this page are', async () => {
    await renderPage();
    expect(await screen.findByText('Data Foundations')).toBeInTheDocument();
    // The calendar's zone is what the column shows; a reader elsewhere is told
    // how far their own Teams will differ rather than left to wonder.
    expect(screen.getByText(/Microsoft calendar's timezone \(GMT Standard Time\)/)).toBeInTheDocument();
  });
});
