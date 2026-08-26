import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  CurriculumCohort,
  CurriculumGroup,
  CurriculumHoliday,
  CurriculumModule,
  CurriculumProgramme,
  CurriculumTeamsMeetingSummary,
} from '@/lib/curriculumApi';

/**
 * The Schedule tab reads the module's saved plan: the dates the backend
 * generates from it, the holiday shifts they caused, and the Teams calendar
 * those dates are sent to. It holds no editor of its own — the dates are typed
 * in the one module form, which the header's Edit module button opens.
 *
 * Neither it nor the Teams meeting tab writes to the Teams calendar: creating
 * the series, sending the dates, invitations and fetching results all belong to
 * the Teams Meetings page, so both tabs here only read and link out.
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
  {
    id: 'COHORT-1', name: 'Sept 2026', programmeId: 'PROG-DATA', programme: 'Data Analyst',
    status: 'active', startDate: '2026-09-01', holidayIds: ['HOL-1'],
  },
] as unknown as CurriculumCohort[];

const groups = [
  {
    id: 'GROUP-1', name: 'Group A', cohortId: 'COHORT-1', cohort: 'Sept 2026',
    programme: 'Data Analyst', coach: 'Coach One', weekDays: 'Wednesday',
    startTime: '09:30', endTime: '11:30', status: 'active',
  },
] as unknown as CurriculumGroup[];

const modules = [
  {
    id: 'MOD-1', moduleCatalogueId: 'MOD-1', name: 'Data Foundations', groupId: 'GROUP-1',
    cohortId: 'COHORT-1', programmeId: 'PROG-DATA', weeks: 2, sessionsNumber: 2,
    startDate: '2026-09-02', status: 'published', tutor: 'Tutor One',
  },
] as unknown as CurriculumModule[];

const holidays = [
  { id: 'HOL-1', label: 'Autumn closure', startDate: '2026-09-09', endDate: '2026-09-09' },
] as unknown as CurriculumHoliday[];

const teamsMeetings: CurriculumTeamsMeetingSummary[] = [
  {
    moduleCatalogueId: 'MOD-1', liveSessionId: 'LIVE-1', status: 'active',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/one', organizerEmail: 'tutor@example.com',
    eventId: 'event-1', presenters: ['tutor@example.com'], attendees: [],
    repeatPattern: 'weekly', startDateTime: '2026-09-02T08:30:00Z', durationMinutes: 120,
    occurrenceCount: 2, upcomingCount: 2, syncedCount: 0, nextOccurrence: '2026-09-02T08:30:00Z',
    updatedAt: '2026-08-20T10:00:00Z',
  },
];

// Session two lands a week late: the weekly slot fell on the closure.
const plan = {
  sessions: [
    { sessionNumber: 1, date: '2026-09-02', day: 'Wednesday', skippedHolidays: [] as string[] },
    { sessionNumber: 2, date: '2026-09-16', day: 'Wednesday', skippedHolidays: ['2026-09-09'] },
  ],
  skippedHolidays: ['2026-09-09'],
  finalEndDate: '2026-09-16',
  warnings: [] as string[],
};

const previewModuleSessionPlan = vi.fn(async () => plan);
const updateCurriculumModule = vi.fn(async () => ({}));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  previewModuleSessionPlan: (...args: unknown[]) => previewModuleSessionPlan(...(args as [])),
  updateCurriculumModule: (...args: unknown[]) => updateCurriculumModule(...(args as [])),
  fetchCurriculumModuleKsbCoverage: vi.fn(async () => null),
}));

const updateTeamsMeetingSchedule = vi.fn(async () => ({ updated: true, meeting: {} as never, warnings: [] }));
const createTeamsMeeting = vi.fn(async () => ({
  created: true,
  meeting: { liveSessionId: 'LIVE-NEW' } as never,
  warnings: [] as string[],
}));

// Teams is still holding the unbroken weekly slot the closure moved session two off.
const artifacts = {
  series: { id: 'LIVE-1', module_title: 'Data Foundations', organizer_email: 'tutor@example.com', join_url: '', online_meeting_id: 'meeting-1' },
  occurrences: [
    {
      id: 'OCC-1', session_number: 1, scheduled_start: '2026-09-02T08:30:00Z', scheduled_end: '2026-09-02T10:30:00Z',
      participant_count: 0, status: 'scheduled', attendance: [], artifacts: [],
    },
    {
      id: 'OCC-2', session_number: 2, scheduled_start: '2026-09-09T08:30:00Z', scheduled_end: '2026-09-09T10:30:00Z',
      participant_count: 0, status: 'scheduled', attendance: [], artifacts: [],
    },
  ],
};

// Only the calls that reach Microsoft are stubbed; the timezone maths that turns
// 09:30 in the calendar's zone into a UTC instant is the real implementation.
vi.mock('../../module-builder/moduleAuthoringData', async importOriginal => ({
  ...(await importOriginal<typeof import('../../module-builder/moduleAuthoringData')>()),
  loadModuleStructure: vi.fn(async () => null),
  loadTeamsMeetingConfiguration: vi.fn(async () => ({
    configured: true, defaultOrganizer: 'tutor@example.com',
    timeZone: 'GMT Standard Time', timeZoneIana: 'Europe/London',
  })),
  loadTeamsMeetingArtifacts: vi.fn(async () => artifacts),
  restoreModuleTeamsMeeting: vi.fn(async () => ({ restored: true, updatedComponents: 1, meeting: {}, module: {} })),
  updateTeamsMeetingSchedule: (...args: unknown[]) => updateTeamsMeetingSchedule(...(args as [])),
  createTeamsMeeting: (...args: unknown[]) => createTeamsMeeting(...(args as [])),
}));

let entityTeamsMeetings = teamsMeetings;

vi.mock('@/hooks/useCurriculumEntities', () => ({
  useCurriculumEntities: () => ({
    programmes, cohorts, groups, modules, holidays,
    tutors: [{ id: 'STAFF-1', name: 'Tutor One', email: 'tutor.one@example.com' }],
    coaches: [], teamsMeetings: entityTeamsMeetings,
    entities: {}, loading: false, loaded: true, error: null,
    reload: vi.fn(async () => null),
  }),
}));

async function renderSchedule() {
  const { default: Page } = await import('../page');
  return render(
    <MemoryRouter initialEntries={['/curriculum/modules/MOD-1?tab=schedule']}>
      <Routes>
        <Route path="/curriculum/modules/:id" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Module workspace — Schedule tab Teams calendar', () => {
  beforeEach(() => {
    entityTeamsMeetings = teamsMeetings;
    updateTeamsMeetingSchedule.mockClear();
    createTeamsMeeting.mockClear();
    updateCurriculumModule.mockClear();
  });

  it('names the holiday every moved session stepped over', async () => {
    await renderSchedule();
    expect(await screen.findByText('Session 1')).toBeInTheDocument();

    // The closed date keeps a card of its own, in red, naming the holiday that
    // shut it and the day the session moved to.
    const blocked = screen.getByText('Shifted to replacement').closest('div')?.parentElement;
    expect(blocked).toHaveTextContent('09 Sept 2026');
    expect(blocked).toHaveTextContent('Blocked by Autumn closure; replacement scheduled on 16 Sept 2026.');
    // A session that runs on its own day stays quiet: "no clash", repeated down
    // the list, is not a fact anyone reads.
    expect(screen.queryByText(/No holiday clash/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Runs on its own day/)).not.toBeInTheDocument();
  });

  it('gives every session a way into the meeting', async () => {
    await renderSchedule();
    expect(await screen.findByText('Session 1')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: 'Open' });
    expect(links).toHaveLength(2);
    links.forEach(link => {
      expect(link).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/one');
      expect(link).toHaveAttribute('target', '_blank');
    });
  });

  it('says the Teams calendar is off the plan, and sends the reader to the page that fixes it', async () => {
    await renderSchedule();
    expect((await screen.findAllByText('Session 2')).length).toBeGreaterThan(0);
    // The date Teams is holding for session two is the pre-shift one.
    await waitFor(() => expect(
      screen.getByText('The Teams calendar is not on these dates yet — send them from the Teams Meetings page.'),
    ).toBeInTheDocument());
    // The Schedule tab reports the calendar; it never sends to it.
    expect(screen.queryByRole('button', { name: 'Send session dates to Teams' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Manage on Teams Meetings' })[0])
      .toHaveAttribute('href', '/curriculum/teams-meetings?module=MOD-1');
  });

  it('keeps the Teams meeting tab read-only: every calendar action lives on the Teams Meetings page', async () => {
    await renderSchedule();
    expect(await screen.findByText('Session 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Teams meeting tab' }));
    // What the calendar holds is still read here...
    expect(await screen.findByText('tutor@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Teams' })).toBeInTheDocument();
    // ...but nothing here writes to it. One link out, no action buttons.
    expect(screen.getByRole('link', { name: 'Manage on Teams Meetings' }))
      .toHaveAttribute('href', '/curriculum/teams-meetings?module=MOD-1');
    expect(screen.queryByRole('button', { name: 'Send session dates to Teams' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Teams calendar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fetch attendance/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Re-attach meeting/ })).not.toBeInTheDocument();
    expect(updateTeamsMeetingSchedule).not.toHaveBeenCalled();
    expect(createTeamsMeeting).not.toHaveBeenCalled();
    expect(updateCurriculumModule).not.toHaveBeenCalled();
  });

  it('has no schedule editor of its own, and opens the one module form instead', async () => {
    await renderSchedule();
    expect(await screen.findByText('Session 1')).toBeInTheDocument();
    // The delivery-plan form the tab used to carry is gone: the same three
    // values are edited in the module form, so there is only one of them.
    expect(screen.queryByRole('spinbutton', { name: /Number of sessions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save schedule' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Edit module' }));

    expect(await screen.findByRole('button', { name: 'Save module' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Data Foundations')).toBeInTheDocument();
  });

  it('points at the Teams Meetings page when the module has no meeting yet', async () => {
    entityTeamsMeetings = [];
    await renderSchedule();
    expect(await screen.findByText('Session 1')).toBeInTheDocument();
    // With no meeting there is no calendar column to fill, and no link to offer.
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument();
    expect(screen.getByText(/No Teams calendar yet\. Create one on the Teams Meetings page/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Teams meeting tab' }));
    expect(await screen.findByText(/Create one on the Teams Meetings page/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Teams calendar' })).not.toBeInTheDocument();
    expect(createTeamsMeeting).not.toHaveBeenCalled();
  });
});
