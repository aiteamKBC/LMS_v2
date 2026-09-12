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
  vi.stubGlobal('React', React); vi.stubGlobal('AppIcon', AppIcon);
  payload = {
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
      if (url.endsWith('/mode/')) {
        payload = { ...payload, mode: { ...payload.mode, requestedMode: 'lazy', status: 'pending', emailSent: true, remindersEnabled: false } };
        return new Response(JSON.stringify(payload.mode));
      }
      return new Response(JSON.stringify({ id: 1, sessionTitle: 'Future lecture', sessionDate: '2026-10-01', reference: 'AR-0001', status: 'pending' }), { status: 201 });
    }
    if (url.includes('/absence-reports/')) return new Response(JSON.stringify({ results: [], missedSessions: [
      { id: 'future', sessionId: 'teams:future', reportId: '8000000000000000013', title: 'Future lecture', dateIso: '2026-10-01',
        startTime: '10:00', endTime: '11:00', module: 'New module', sessionType: 'live_session', coach: '', status: 'upcoming' },
    ] }));
    return new Response(JSON.stringify(payload));
  }));
});
afterEach(() => { cleanup(); clearAllCachedResources(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function CurrentLocation() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}{location.search}</span>;
}
const mount = () => render(<MemoryRouter><AttendancePage /><CurrentLocation /></MemoryRouter>);

describe('Attendance lecture workspace', () => {
  it('filters by module and keeps future/catch-up separate from attendance rate', async () => {
    expect(lectureCounts(payload.lectures)).toEqual({ all: 3, attended: 1, absent: 1, covered: 1, upcoming: 1, rate: 50 });
    mount();
    expect(await screen.findByText('50% attendance · includes late attendance')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Module'), { target: { value: 'native:new' } });
    expect(screen.queryByText('First lecture')).not.toBeInTheDocument();
    expect(screen.getByText('Future lecture')).toBeInTheDocument();
    expect(screen.getByText('No completed attendance records yet')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Submit absence report/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    const body = posts[0].body as FormData;
    expect(body.get('sessionId')).toBe('teams:future');
    expect(body.get('explanation')).toBe('');
    expect(await screen.findByText(/has been saved for your coach to review/)).toBeInTheDocument();
  });
});
