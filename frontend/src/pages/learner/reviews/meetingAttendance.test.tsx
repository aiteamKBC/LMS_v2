/* global RequestInfo, RequestInit */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import { AppIcon } from '@/components/feature/AppIcon';
import { MonthlyCoachingListPage } from '../monthly-coaching/page';
import { ProgressReviewsListPage } from '../progress-reviews/page';

vi.mock('@/hooks/useMyLearner', () => ({ useMyLearner: () => ({ kind: 'apprenticeship', id: '12' }), useLinkedLearner: () => ({ kind: 'apprenticeship', id: '12' }) }));
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({ useLearnerWorkspaceAccess: () => ({ canProgress: true }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/pages/coach/progress-reviews/page', () => ({ buildProgressReviewSlidesDeck: vi.fn() }));
let events: LearnerCalendarEvent[];
let state: MeetingAttendance[];
let posts: { url: string; init?: RequestInit }[];
const types = [{ source: 'mcr', path: 'monthly-coaching', Page: MonthlyCoachingListPage }, { source: 'progress-review', path: 'progress-reviews', Page: ProgressReviewsListPage }] as const;
beforeEach(() => {
  clearAllCachedResources(); events = []; state = []; posts = [];
  vi.stubGlobal('React', React); vi.stubGlobal('AppIcon', AppIcon);
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      posts.push({ url, init });
      if (url.endsWith('/attend/')) {
        expect(JSON.parse(String(init.body))).toEqual({ meetingId: 'today' });
        expect(new Headers(init.headers).get('X-CSRFToken')).toBe('csrf');
        state = state.map(item => item.id === 'today' ? { ...item, attendanceConfirmed: true, canAttend: false, canReportAbsence: false, creditedMinutes: 90 } : item);
        return new Response(JSON.stringify({ creditedMinutes: 90 }));
      }
      if (url.includes('/absence-reports/')) {
        expect((init.body as FormData).get('sessionId')).toBe('meeting:12:today');
        expect((init.body as FormData).get('recoveryMethod')).toBe('');
        return new Response(JSON.stringify({ id: 1, reference: 'AR-0001', sessionTitle: 'Meeting', sessionDate: '2026-09-14', status: 'pending' }));
      }
      throw new Error(`Unexpected write: ${url}`);
    }
    if (url.includes('/learner-detail/')) return new Response(JSON.stringify({ name: 'Learner', programme: 'Assigned programme', lineManager: 'Manager Jane' }));
    if (url.includes('/meeting-attendance/')) return new Response(JSON.stringify({ sessions: state, today: '2026-09-14', timeZone: 'Europe/London', csrfToken: 'csrf' }));
    if (url.includes('/absence-reports/')) {
      expect(url).toContain('scope=meetings');
      return new Response(JSON.stringify({ results: [], missedSessions: state.map(item => ({ id: item.absenceSessionId, sessionId: `meeting:12:${item.id}`, title: item.title, dateIso: item.date, startTime: '10:00', endTime: '11:30', coach: 'Coach', module: '', sessionType: 'mcr' })) }));
    }
    if (url.includes('/calendar/')) return new Response(JSON.stringify({ events }));
    if (url.includes('/curriculum/cache-epoch/')) return new Response(JSON.stringify({ epoch: 0, changes: [] }));
    throw new Error(`Unexpected read: ${url}`);
  }));
});
afterEach(() => { cleanup(); clearAllCachedResources(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function populate(source: string, day = '2026-09-14') {
  events = [{ id: 'today', eventKey: 'today', title: 'Meeting', source, type: 'coaching', sequence: 1, status: 'scheduled', date: day,
    targetDate: day, scheduledDate: day, scheduledTime: '10:00', durationMinutes: 90, coachName: 'Coach Alex', coachEmail: '', meetingLink: 'https://teams.microsoft.com/meet/1', meetingProvider: 'Microsoft Teams', notes: '' }];
  state = [{ id: 'today', title: 'Meeting', date: day, startTime: '10:00', durationMinutes: 90, canAttend: day === '2026-09-14', attendanceConfirmed: false, creditedMinutes: null,
    canReportAbsence: true, absenceReported: false, absenceSessionId: `meeting:12:today-${day}`, missed: false, meetingLink: events[0].meetingLink, meetingProvider: 'Microsoft Teams' }];
}
describe.each(types)('$path meeting attendance', item => {
  function mount() { return render(<MemoryRouter initialEntries={[`/learner/${item.path}`]}><item.Page /></MemoryRouter>); }
  it('shows real details and credits the full meeting once, surviving reload', async () => {
    populate(item.source);
    const page = mount();
    const action = item.source === 'mcr' ? 'Confirm attendance' : 'Attend';
    const attend = await screen.findByRole('button', { name: action });
    await waitFor(() => expect(attend).toBeEnabled());
    if (item.source === 'mcr') {
      expect(screen.getByText('10:00')).toBeInTheDocument();
      expect(screen.getByText(/Europe\/London.*90 minutes/)).toBeInTheDocument();
    } else {
      expect(screen.getByText(/10:00.*Europe\/London/)).toBeInTheDocument();
      expect(screen.getByText(/Microsoft Teams.*90 minutes/)).toBeInTheDocument();
    }
    if (item.source === 'progress-review') expect(screen.getByText('Manager Jane')).toBeInTheDocument();
    fireEvent.click(attend); fireEvent.click(attend);
    await screen.findByRole('status');
    expect(posts).toHaveLength(1);
    expect(events[0].status).toBe('scheduled');
    page.unmount(); mount();
    await waitFor(() => expect(screen.getAllByText(item.source === 'mcr' ? 'Attended' : 'Attended · 90 min').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: action })).not.toBeInTheDocument();
  });
  it('does not allow attendance before the scheduled date', async () => {
    populate(item.source, '2026-10-01'); mount();
    if (item.source === 'mcr') {
      expect(await screen.findByRole('link', { name: 'Prepare for meeting' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Confirm attendance' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Join meeting' })).not.toBeInTheDocument();
    } else {
      expect(await screen.findByRole('link', { name: 'View review' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Attend' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Join meeting' })).not.toBeInTheDocument();
    }
    expect(posts).toHaveLength(0);
  });
  it('opens the same absence form from the current card and meeting list with the exact meeting selected', async () => {
    populate(item.source); mount();
    if (item.source === 'mcr') fireEvent.click(await screen.findByText('More options', { selector: 'summary' }));
    const buttons = await screen.findAllByRole('button', { name: item.source === 'mcr' ? 'Report absence' : 'Report Absence' });
    fireEvent.click(buttons[0]);
    let dialog = await screen.findByRole('dialog', { name: 'Report Absence' });
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Meeting *' })).toHaveValue(state[0].absenceSessionId));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close absence report' }));
    if (item.source === 'mcr') {
      fireEvent.click(screen.getByRole('link', { name: 'View all meetings' }));
      await screen.findByRole('tab', { name: /Upcoming/ });
      const summary = screen.getByText('More options', { selector: 'summary' });
      if (!summary.parentElement?.hasAttribute('open')) fireEvent.click(summary);
      fireEvent.click(screen.getByRole('button', { name: 'Report absence' }));
    } else {
      fireEvent.click(screen.getByRole('link', { name: 'View all reviews (1)' }));
      await screen.findByRole('group', { name: 'Filter reviews' });
      fireEvent.click(screen.getByRole('button', { name: 'Report Absence' }));
    }
    dialog = await screen.findByRole('dialog', { name: 'Report Absence' });
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Meeting *' })).toHaveValue(state[0].absenceSessionId));
    expect(within(dialog).queryByText('Watch the recording')).not.toBeInTheDocument();
    expect(posts).toHaveLength(0);
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Main reason' }), { target: { value: 'illness' } });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit absence report' }));
    await within(dialog).findByText(/has been saved for your coach to review/);
    expect(posts).toHaveLength(1);
  });
});
