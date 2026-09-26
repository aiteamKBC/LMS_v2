import * as React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AttendancePage, { lectureCounts } from './page';
import AbsenceReportForm from './components/AbsenceReportForm';
import { AppIcon } from '@/components/feature/AppIcon';
import type { AttendanceLecture, AttendanceWorkspace } from '@/api/attendanceLectures';
import { clearAllCachedResources } from '@/api/cachedRequest';

vi.mock('@/hooks/useMyLearner', () => ({ useMyLearner: () => ({ kind: 'apprenticeship', id: '12' }) }));
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({ useLearnerWorkspaceAccess: () => ({ canProgress: true }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));

const lecture = (overrides: Partial<AttendanceLecture> = {}): AttendanceLecture => ({
  id: 'legacy-one', sessionId: 'legacy-one', reportId: '8000000000000000012', date: '2026-09-01', title: 'First lecture',
  moduleId: 'legacy:business', module: 'Business', source: 'kbc-attendance', startTime: '10:00', endTime: '11:00',
  durationMinutes: 60, contentSummary: 'Business strategy', ksbs: ['K1', 'S2'], activities: [], status: 'completed',
  catchupStatus: null, updatedAt: null, canReportAbsence: false, absenceReport: null, ...overrides,
});
let payload: AttendanceWorkspace;
let posts: { url: string; body: unknown }[];
beforeEach(() => {
  clearAllCachedResources(); posts = [];
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
  vi.stubGlobal('React', React); vi.stubGlobal('AppIcon', AppIcon);
  payload = {
    csrfToken: 'test-csrf', timeZone: 'Europe/London',
    lectures: [lecture(), lecture({ id: 'missed', title: 'Missed lecture', status: 'absent', catchupStatus: 'completed',
      activities: [{ id: 'a', title: 'Recording', type: 'video', completed: true, groupId: 20, activityId: 4 }], canReportAbsence: true }),
      lecture({ id: 'future', title: 'Future lecture', status: 'upcoming', moduleId: 'native:new', module: 'New module', canReportAbsence: true })],
    totals: { total: 3, attended: 1, absent: 1, covered: 1, upcoming: 1, attendanceRate: 50 },
    modules: [{ id: 'legacy:business', title: 'Business' }, { id: 'native:new', title: 'New module' }],
    summary: null, recentActivity: [],
    mode: { available: true, mode: 'live', requestedMode: null, status: 'active', emailSent: false, managerAvailable: true, remindersEnabled: true, updatedAt: null },
  };
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (init?.method === 'POST') {
      posts.push({ url, body: init.body });
      if (url.endsWith('/attend/')) {
        const { lectureId } = JSON.parse(String(init.body));
        expect(new Headers(init.headers).get('X-CSRFToken')).toBe('test-csrf');
        return new Response(JSON.stringify({ lectureId, status: 'completed', creditedMinutes: 120, creditedHours: 2, alreadyRecorded: false }));
      }
      if (url.endsWith('/mode/')) {
        payload = { ...payload, mode: { ...payload.mode, requestedMode: 'lazy', status: 'pending', emailSent: true, remindersEnabled: false } };
        return new Response(JSON.stringify(payload.mode));
      }
      return new Response(JSON.stringify({ id: 1, sessionTitle: 'Future lecture', sessionDate: '2026-10-01', reference: 'AR-0001', status: 'pending' }), { status: 201 });
    }
    if (url.includes('/calendar/')) return new Response(JSON.stringify({ events: [] }));
    if (url.includes('/absence-reports/')) return new Response(JSON.stringify({ results: [], missedSessions: [
      { id: 'future', sessionId: 'teams:future', reportId: '8000000000000000013', title: 'Future lecture', dateIso: '2026-10-01',
        startTime: '10:00', endTime: '11:00', module: 'New module', sessionType: 'live_session', coach: '', status: 'upcoming' },
    ] }));
    return new Response(JSON.stringify(payload));
  }));
});
afterEach(() => {
  cleanup(); clearAllCachedResources(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
function CurrentLocation() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}{location.search}</span>;
}
const mount = () => render(<MemoryRouter><AttendancePage /><CurrentLocation /></MemoryRouter>);

describe('Attendance lecture workspace', () => {
  it('features today ahead of future lectures and credits its full hours once', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-14T08:00:00Z'));
    payload.lectures = [lecture({ id: 'later', date: '2026-10-01', status: 'upcoming' }),
      lecture({ id: 'today', title: 'Today lecture', date: '2026-09-14', status: 'upcoming', durationMinutes: 120,
        tutor: 'Tutor Alex', coach: 'Coach Sam', canReportAbsence: true })];
    mount();
    const card = await screen.findByRole('region', { name: 'Today lecture' });
    expect(within(card).getByText('Tutor Alex')).toBeInTheDocument();
    expect(within(card).getByText('Coach Sam')).toBeInTheDocument();
    const attend = within(card).getByRole('button', { name: 'Attend' });
    expect(attend).toBeEnabled();
    fireEvent.click(attend);
    fireEvent.click(attend);
    expect(await within(card).findByRole('button', { name: 'Attended' })).toBeDisabled();
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0].body))).toEqual({ lectureId: 'today' });
    expect(within(card).getByRole('status')).toHaveTextContent('2 hours credited');
    expect(within(screen.getByRole('article', { name: 'Today lecture' })).getByText('Attended')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Report Absence' })).toBeDisabled();
  });

  it('opens the same preselected absence popup from the future card and the table', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-14T08:00:00Z'));
    payload.lectures = [lecture({ id: 'future', title: 'Future lecture', date: '2026-10-01', status: 'upcoming', canReportAbsence: true }),
      lecture({ id: 'distant', title: 'Distant lecture', date: '2026-12-01', status: 'upcoming', canReportAbsence: true })];
    mount();
    const card = await screen.findByRole('region', { name: 'Future lecture' });
    expect(within(card).getByRole('button', { name: 'Attend' })).toBeDisabled();
    fireEvent.click(within(card).getByRole('button', { name: 'Report Absence' }));
    expect(await screen.findByRole('dialog', { name: 'Report Absence' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Lecture *')).toHaveValue('future'));
    fireEvent.click(screen.getByRole('button', { name: 'Close absence report' }));
    fireEvent.click(within(screen.getByRole('article', { name: 'Future lecture' })).getByRole('button', { name: 'Report Absence' }));
    await waitFor(() => expect(screen.getByLabelText('Lecture *')).toHaveValue('future'));
  });

  it('shows the approved alternative session link in the attendance popup', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (!init?.method && String(input).includes('/absence-reports/')) return new Response(JSON.stringify({
        results: [{
          id: 29, reference: 'AR-0029', sessionTitle: 'MM21 copy — Session 8', sessionDate: '2026-09-23',
          sessionTime: '07:00', reasonCategory: 'emergency', reason: 'Family or personal emergency',
          status: 'approved', evidenceProvided: false, evidenceKind: '', evidenceUrl: '', evidenceText: '',
          coachNote: '', recoveryMethod: 'alternative', catchupEventKey: 'alternative:target-occurrence',
          alternativeSession: { id: 'target-occurrence', title: 'MM21 — Session 8', dateIso: '2026-09-25',
            startTime: '06:00', endTime: '08:00', groupId: 'group-2', group: 'Aya Group', cohortId: 'cohort-1',
            cohort: 'Final Cohort', status: 'scheduled', joinUrl: 'https://teams.microsoft.com/l/meetup-join/approved' },
          attendanceRate: 0, previousAbsences: 4, createdAt: '2026-09-21T10:00:00Z', updatedAt: '2026-09-21T11:00:00Z',
        }],
        missedSessions: [],
      }));
      return originalFetch(input, init);
    });

    mount();
    await screen.findByText('Attendance');
    fireEvent.click(screen.getByRole('button', { name: 'Report absence' }));
    const join = await screen.findByRole('link', { name: 'Join approved session' });
    expect(join).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/approved');
    expect(screen.getByText('Alternative: Aya Group')).toBeInTheDocument();
  });

  it('shows the learner selected recovery plans with calendar and join actions', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (!init?.method && url.includes('/absence-reports/')) return new Response(JSON.stringify({
        results: [{
          id: 31, reference: 'AR-0031', sessionTitle: 'MM21 — Session 8', sessionDate: '2026-09-23',
          sessionTime: '07:00', reasonCategory: 'emergency', reason: 'Family or personal emergency',
          status: 'approved', evidenceProvided: false, evidenceKind: '', evidenceUrl: '', evidenceText: '',
          coachNote: '', recoveryMethod: 'catch-up', catchupEventKey: 'catch-up:12:1', alternativeSession: null,
          attendanceRate: 0, previousAbsences: 4, createdAt: '2026-09-21T10:00:00Z', updatedAt: '2026-09-21T11:00:00Z',
        }], missedSessions: [],
      }));
      if (!init?.method && url.includes('/calendar/')) return new Response(JSON.stringify({ learner: { kind: 'apprenticeship', id: 12 }, events: [{
        id: 'catch-up:12:1', eventKey: 'catch-up:12:1', title: 'Catch-up Session', source: 'catch-up', type: 'coaching',
        sequence: 1, status: 'scheduled', date: '2026-09-25', targetDate: '2026-09-25', scheduledDate: '2026-09-25',
        scheduledTime: '11:00', durationMinutes: 30, coachName: 'Coach', coachEmail: 'coach@example.test',
        meetingProvider: 'teams', meetingLink: 'https://teams.microsoft.com/l/meetup-join/catch-up', notes: '',
      }] }));
      return originalFetch(input, init);
    });

    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'My recovery plans' }));
    const dialog = await screen.findByRole('dialog', { name: 'My recovery plans' });
    expect(within(dialog).getByText('Coach catch-up')).toBeInTheDocument();
    expect(within(dialog).getByText('MM21 — Session 8')).toBeInTheDocument();
    expect(within(dialog).getByText('25 Sept 2026 at 11:00')).toBeInTheDocument();
    expect(within(dialog).getByText('Confirmed')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'View in calendar' })).toHaveAttribute(
      'href', '/learner/calendar?kind=apprenticeship&learner=12&event=catch-up%3A12%3A1');
    expect(within(dialog).getByRole('link', { name: 'Join session' })).toHaveAttribute(
      'href', 'https://teams.microsoft.com/l/meetup-join/catch-up');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close my recovery plans' }));
    expect(screen.queryByRole('dialog', { name: 'My recovery plans' })).not.toBeInTheDocument();
  });

  it('opens catch-up booking for a missed lecture even after absence was reported', async () => {
    payload.lectures = [lecture({ id: 'missed', title: 'Missed lecture', status: 'absent',
      canReportAbsence: false, absenceReport: { id: 1, status: 'pending' } })];
    mount();
    const row = await screen.findByRole('article', { name: 'Missed lecture' });
    expect(within(row).getByText('Missed', { exact: true })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Book Catchup Session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Book Catchup Session' });
    expect(within(dialog).getByText(/Missed lecture/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Catch-up date')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Main reason')).not.toBeInTheDocument();
  });

  it('shows a missed catch-up and still lets the learner book another one', async () => {
    payload.lectures = [lecture({ id: 'missed', title: 'Missed lecture', status: 'absent', catchupStatus: 'missed',
      canReportAbsence: false, absenceReport: { id: 1, status: 'approved' } })];
    mount();
    const row = await screen.findByRole('article', { name: 'Missed lecture' });
    expect(within(row).getByText('Catch-up missed')).toBeInTheDocument();
    expect(within(row).queryByText('Catch-up pending')).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Book Catchup Session' })).toBeEnabled();
  });

  it('starts a linked absence report when booking recovery for an unreported missed lecture', async () => {
    payload.lectures = [lecture({ id: 'missed', sessionId: 'teams:missed', title: 'Missed lecture',
      date: '2026-09-01', status: 'absent', catchupStatus: null, canReportAbsence: true, absenceReport: null })];
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (!init?.method && String(input).includes('/absence-reports/')) return new Response(JSON.stringify({
        results: [], missedSessions: [{ id: 'missed', sessionId: 'teams:missed', reportId: '8000000000000000012',
          title: 'Missed lecture', dateIso: '2026-09-01', startTime: '10:00', endTime: '11:00',
          module: 'Business', sessionType: 'live_session', coach: 'Coach', status: 'absent' }],
      }));
      return originalFetch(input, init);
    });

    mount();
    const row = await screen.findByRole('article', { name: 'Missed lecture' });
    fireEvent.click(within(row).getByRole('button', { name: 'Book Catchup Session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Book Catchup Session' });
    await waitFor(() => expect(within(dialog).getByLabelText('Lecture *')).toHaveValue('missed'));
    expect(within(dialog).getByLabelText('Main reason')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Coach catch-up/ })).toBeChecked();
  });

  it('keeps Attend retryable when saving fails and does not display credited hours', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-14T08:00:00Z'));
    payload.lectures = [lecture({ title: 'Today lecture', date: '2026-09-14', status: 'upcoming' })];
    mount();
    const card = await screen.findByRole('region', { name: 'Today lecture' });
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => init?.method === 'POST'
      ? new Response(JSON.stringify({ error: 'Attendance could not be saved.' }), { status: 503 }) : originalFetch(input, init));
    fireEvent.click(within(card).getByRole('button', { name: 'Attend' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Attendance could not be saved.');
    expect(within(card).getByRole('button', { name: 'Attend' })).toBeEnabled();
    expect(within(card).queryByText(/hours credited/)).not.toBeInTheDocument();
  });

  it('filters by module and keeps future/catch-up separate from attendance rate', async () => {
    expect(lectureCounts(payload.lectures)).toEqual({ all: 3, attended: 1, absent: 1, covered: 1, upcoming: 1, rate: 50 });
    mount();
    expect(await screen.findByText('50% attendance')).toHaveTextContent('50% attendance · includes late attendance');
    fireEvent.change(screen.getByLabelText('Module'), { target: { value: 'native:new' } });
    expect(screen.queryByText('First lecture')).not.toBeInTheDocument();
    expect(screen.getByText('Future lecture')).toBeInTheDocument();
    expect(screen.getByText('No completed attendance records yet')).toBeInTheDocument();
  });

  it('shows 67 percent when two of three finalised lectures were attended', () => {
    const lectures = [lecture({ id: 'first' }), lecture({ id: 'second' }),
      lecture({ id: 'missed', status: 'absent' })];
    expect(lectureCounts(lectures)).toEqual({ all: 3, attended: 2, absent: 1, covered: 0, upcoming: 0, rate: 67 });
  });

  it('counts a lecture made up by catch-up or alternative session as attended', () => {
    const lectures = [lecture({ id: 'first' }), lecture({ id: 'missed', status: 'absent' }),
      lecture({ id: 'made-up', status: 'absent', catchupStatus: 'completed', effectiveAttendance: 1 })];
    expect(lectureCounts(lectures)).toEqual({ all: 3, attended: 2, absent: 1, covered: 1, upcoming: 0, rate: 67 });
  });

  it('opens the same attendance source in Monthly Logs and searches KSBs', async () => {
    mount();
    const row = await screen.findByRole('article', { name: 'Missed lecture' });
    fireEvent.click(within(row).getByRole('button', { name: 'Open Activities' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/learner/monthly-logs/apprenticeship/12/2026-09?source=att%3Alegacy-one');
    expect(screen.queryByText('Activity content 4')).not.toBeInTheDocument();
    expect(posts).toEqual([]);
    fireEvent.change(screen.getByLabelText('Search lectures'), { target: { value: 'K99' } });
    expect(screen.getByText('No lectures match this filter')).toBeInTheDocument();
  });

  it.each([
    { source: 'microsoft-teams' as const, sessionId: 'teams:occ-8', expected: 'attendance:occ-8', month: '2026-09' },
    { source: 'kbc-attendance' as const, sessionId: '92_A&B', expected: 'att:92_A&B', month: '2026-08',
      monthlyLog: { month: '2026-08', sourceRef: 'att:92_A&B' } },
  ])('preserves the exact source and report month for $source', async ({ expected, month, ...overrides }) => {
    payload.lectures = [lecture(overrides)];
    mount();
    const row = await screen.findByRole('article', { name: 'First lecture' });
    fireEvent.click(within(row).getByRole('button', { name: 'Open Activities' }));
    const destination = new URL(screen.getByTestId('location').textContent!, 'http://localhost');
    expect(destination.pathname).toBe(`/learner/monthly-logs/apprenticeship/12/${month}`);
    expect(destination.searchParams.get('source')).toBe(expected);
  });

  it('opens an upcoming lecture in its exact My Learning component', async () => {
    payload.lectures = [lecture({ status: 'upcoming', date: '2027-01-10', source: 'microsoft-teams',
      sessionId: 'teams:occ-8', componentHref: '/learner/component/apprenticeship/12/live-session-9' })];
    mount();
    const row = await screen.findByRole('article', { name: 'First lecture' });
    fireEvent.click(within(row).getByRole('button', { name: 'Open Activities' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/learner/component/apprenticeship/12/live-session-9');
    expect(screen.getByTestId('location')).not.toHaveTextContent('/monthly-logs/');
  });

  it('keeps an unmapped upcoming lecture in its My Learning module instead of Monthly Logs', async () => {
    payload.lectures = [lecture({ status: 'upcoming', date: '2027-01-10', source: 'microsoft-teams',
      sessionId: 'teams:unmapped', moduleId: 'native:test-teams' })];
    mount();
    const row = await screen.findByRole('article', { name: 'First lecture' });
    fireEvent.click(within(row).getByRole('button', { name: 'Open Activities' }));
    const destination = new URL(screen.getByTestId('location').textContent!, 'http://localhost');
    expect(destination.pathname).toBe('/learner/my-learning/apprenticeship/12');
    expect(destination.searchParams.get('subject')).toBe('current:test-teams');
    expect(destination.pathname).not.toContain('/monthly-logs/');
  });

  it('requests manager approval and keeps Live Sessions effective while pending', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Lazy Mode' }));
    expect(await screen.findByText('Your request has been emailed to your manager for approval.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Awaiting manager approval/)).toBeInTheDocument());
    expect(payload.mode.mode).toBe('live');
    expect(JSON.parse(String(posts[0].body))).toEqual({ mode: 'lazy' });
    expect(screen.getByText('Absence reminders: paused')).toBeInTheDocument();
  });

  it('refreshes live source edits when the window regains focus', async () => {
    mount(); await screen.findByText('First lecture');
    payload = { ...payload, lectures: [lecture({ title: 'Updated lecture', ksbs: ['K9'] })] };
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByText('Updated lecture')).toBeInTheDocument();
    expect(screen.queryByText('First lecture')).not.toBeInTheDocument();
    expect(screen.getByText('K9')).toBeInTheDocument();
  });

  it('keeps saved lectures visible during one refresh when the connection and tab return together', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    mount(); await screen.findByText('First lecture');
    const initialRequests = vi.mocked(fetch).mock.calls.length;
    let finishRefresh!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finishRefresh = resolve; }));
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetch).toHaveBeenCalledTimes(initialRequests + 1);
    expect(screen.getByText('First lecture')).toBeInTheDocument();
    await act(async () => {
      finishRefresh(new Response(JSON.stringify({ ...payload, lectures: [lecture({ title: 'Updated lecture' })] })));
    });
    expect(await screen.findByText('Updated lecture')).toBeInTheDocument();
    expect(screen.queryByText('First lecture')).not.toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it('waits until the tab is visible before automatically refreshing saved lectures', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    mount(); await screen.findByText('First lecture');
    const initialRequests = vi.mocked(fetch).mock.calls.length;
    payload = { ...payload, lectures: [lecture({ title: 'Updated lecture' })] };
    visibility.mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
    });
    expect(fetch).toHaveBeenCalledTimes(initialRequests);
    expect(screen.getByText('First lecture')).toBeInTheDocument();
    visibility.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(await screen.findByText('Updated lecture')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(initialRequests + 1);
    expect(posts).toEqual([]);
  });

  it('offers working support and module destinations', async () => {
    mount(); await screen.findByText('First lecture');
    expect(screen.getByRole('link', { name: /Book a Support Session/ })).toHaveAttribute('href', '/learner/calendar?book=student-support');
    expect(screen.getByRole('link', { name: 'Contact Support' })).toHaveAttribute('href', '/learner/support');
    expect(screen.getByRole('link', { name: /View all modules/ })).toHaveAttribute('href', '/learner/my-learning');
  });

  it('keeps complete months together, toggles them and sorts without refetching', async () => {
    payload.lectures = Array.from({ length: 20 }, (_, index) => lecture({
      id: `session-${index}`, title: `Session ${index}`, date: index < 15 ? `2026-09-${String(index + 1).padStart(2, '0')}` : `2026-08-${index + 1}`,
    }));
    mount(); await screen.findByRole('article', { name: 'Session 14' });
    expect(screen.getAllByRole('article')).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'Group by month' }));
    const calls = vi.mocked(fetch).mock.calls.length;
    expect(screen.getAllByRole('article')).toHaveLength(15);
    expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('Session 14');
    expect(screen.getByText('20 lectures · 2 months')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'August 2026' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'September 2026' }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'August 2026' }));
    expect(screen.getAllByRole('article')).toHaveLength(5);
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'oldest' } });
    expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('Session 15');
    fireEvent.click(screen.getByRole('button', { name: 'Expand all months' }));
    expect(screen.getAllByRole('article')).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all months' }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-08' } });
    expect(screen.getAllByRole('article')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'September 2026' })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(calls);
    // Sorting must leave the shared cached response intact.
    expect(payload.lectures[0].id).toBe('session-0');
  });

  it('reveals long KSB mappings and searches all codes even when collapsed', async () => {
    payload.lectures = [lecture({ ksbs: ['K1', 'K2', 'S1', 'B1', 'K99'], ksbScope: 'module' })];
    mount(); await screen.findByRole('article', { name: 'First lecture' });
    expect(screen.getByText('Module KSBs')).toBeInTheDocument();
    expect(screen.queryByText('K99')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5 KSBs for First lecture' }));
    expect(screen.getByText('K99')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer KSBs for First lecture' }));
    fireEvent.change(screen.getByLabelText('Search lectures'), { target: { value: 'K99' } });
    expect(screen.getByRole('article', { name: 'First lecture' })).toBeInTheDocument();
  });

  it('reveals matches in collapsed months and recovers from empty filters and refreshed data', async () => {
    payload.lectures = Array.from({ length: 15 }, (_, index) => lecture({ id: `session-${index}`, title: `Session ${index}`, date: index < 10 ? '2026-09-01' : '2026-08-01' }));
    mount(); await screen.findByRole('article', { name: 'Session 0' });
    fireEvent.click(screen.getByRole('button', { name: 'Group by month' }));
    expect(screen.queryByRole('article', { name: 'Session 14' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search lectures'), { target: { value: 'Session 14' } });
    expect(screen.getByRole('article', { name: 'Session 14' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search lectures'), { target: { value: 'missing' } });
    expect(screen.getByText('No lectures match this filter')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all lectures' }));
    expect(screen.getByText('15 lectures · 2 months')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'September 2026' }));
    payload = { ...payload, lectures: [lecture({ title: 'Updated lecture', date: '2026-07-01' })] };
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByRole('article', { name: 'Updated lecture' })).toBeInTheDocument();
    expect(screen.getByText('1 lecture · 1 month')).toBeInTheDocument();
  });

  it('submits an upcoming absence with only a reason and no optional explanation', async () => {
    render(<MemoryRouter><AbsenceReportForm preselectMatch={{ id: 'future', dateIso: '2026-10-01', title: 'Future lecture' }} showHistory={false} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Lecture *')).toHaveValue('future'));
    fireEvent.click(screen.getByText('Illness or medical appointment'));
    fireEvent.click(screen.getByRole('radio', { name: /Watch the recording/ }));
    fireEvent.change(screen.getByLabelText('Recording viewing date'), { target: { value: '2026-10-02' } });
    fireEvent.change(screen.getByLabelText('Recording viewing time'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Submit absence report/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    const body = posts[0].body as FormData;
    expect(body.get('sessionId')).toBe('teams:future');
    expect(body.get('explanation')).toBe('');
    expect(body.get('recoveryMethod')).toBe('recorded');
    expect(body.get('recordingDate')).toBe('2026-10-02');
    expect(body.get('recordingTime')).toBe('18:00');
    expect(body.has('catchupEventKey')).toBe(false);
    expect(await screen.findByText(/has been saved for your coach to review/)).toBeInTheDocument();
  });
});
