import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearnerCalendarEvent, LearnerReviewDefinition } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import CoachingHome, { type CoachingHomeProps } from './CoachingHome';

const today = '2026-09-14';
const learner = { kind: 'apprenticeship', id: '12' };
const session = (id: string, date = today, overrides: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id, eventKey: id, title: 'Monthly coaching', source: 'mcr', type: 'coaching', sequence: 1,
  status: 'scheduled', date, targetDate: date, scheduledDate: date, scheduledTime: '10:00',
  durationMinutes: 60, coachName: 'Current coach', coachEmail: '', meetingLink: 'https://teams.microsoft.com/meet/123',
  meetingProvider: 'Microsoft Teams', notes: '', ...overrides,
});
const attendance = (id: string, overrides: Partial<MeetingAttendance> = {}): MeetingAttendance => ({
  id, title: 'Monthly coaching', date: today, startTime: '10:00', durationMinutes: 60,
  status: 'scheduled', meetingLink: 'https://teams.microsoft.com/meet/123', meetingProvider: 'Microsoft Teams',
  canAttend: true, attendanceConfirmed: false, creditedMinutes: null, canReportAbsence: true,
  absenceReported: false, absenceSessionId: 'absence:12:1', missed: false, ...overrides,
});
const signatureDefinition = (): LearnerReviewDefinition => ({
  manualOverride: null,
  instance: { id: 'instance-1', reviewTemplateId: 'template-1', learnerId: 12, programmeId: 'programme-1',
    occurrenceNumber: 1, targetDate: '2026-09-01', status: 'awaiting-signature', startedAt: null, completedAt: '2026-09-01' },
  template: { id: 'template-1', name: 'Monthly coaching',
    signatures: { participant: true, advisor: true, employer: false, referrer: false },
    visibleTo: { participant: true, advisor: true, employer: false, referrer: false },
    recurrence: { interval: 1, unit: 'month' }, notifications: {}, allowEditingPriorDays: 0 },
  sections: [], signatures: {
    participant: { required: true, signed: false }, advisor: { required: true, signed: true },
    employer: { required: false, signed: false }, referrer: { required: false, signed: false },
  },
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}
function mount(overrides: Partial<CoachingHomeProps> = {}, search = '') {
  const props: CoachingHomeProps = {
    sessions: [], attendance: [], learner, today, timeZone: 'Europe/London', loading: false, error: '',
    canAct: true, busy: false, onSchedule: vi.fn(), onAttend: vi.fn(), onReport: vi.fn(), ...overrides,
  };
  render(<MemoryRouter initialEntries={[`/learner/monthly-coaching?kind=apprenticeship&learner=12${search}`]}>
    <CoachingHome {...props}/><LocationProbe/>
  </MemoryRouter>);
  return props;
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('coaching learner navigation and actions', () => {
  it.each([
    { kind: 'apprenticeship', id: '12', now: '2026-09-14T10:00:00Z', month: '2026-09', canAct: true, search: '' },
    { kind: 'commercial', id: '34', now: '2026-09-30T23:30:00Z', month: '2026-10', canAct: false, search: '&view=all&tab=upcoming' },
    { kind: 'apprenticeship', id: '56', now: '2026-12-31T23:30:00Z', month: '2026-12', canAct: false, search: '&view=all&tab=past' },
  ])('opens $kind learner $id logs for the current UK month $month', ({ kind, id, now, month, canAct, search }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    const props = mount({ learner: { kind, id }, canAct, sessions: [session('future', '2027-02-15')] }, search);

    fireEvent.click(screen.getByRole('link', { name: "This month's logs" }));

    expect(screen.getByTestId('location')).toHaveTextContent(`/learner/monthly-logs/${kind}/${id}/${month}`);
    expect(props.onSchedule).not.toHaveBeenCalled();
    expect(props.onAttend).not.toHaveBeenCalled();
    expect(props.onReport).not.toHaveBeenCalled();
  });

  it('shows the current assignment separately from the existing host and keeps an absence-reported meeting link visible', () => {
    const next = session('mcr:211:2:2026-11-30', '2026-09-15', {
      coachName: 'Rewan Yasser', coachEmail: 'rewan@example.com', scheduledTime: '11:00',
    });
    const props = mount({ sessions: [next], currentCoach: { name: 'Test curriculum', email: 'curriculum@example.com' },
      attendance: [attendance(next.id, { date: '2026-09-15', startTime: '11:00', absenceReported: true, canAttend: false })] });
    const current = within(screen.getByRole('article', { name: 'Current coaching meeting' }));
    expect(current.getByText('Your current coach').nextElementSibling).toHaveTextContent('Test curriculum');
    expect(current.getByText('This meeting is booked with Rewan Yasser.')).toBeInTheDocument();
    expect(current.getByText('Absence reported')).toBeInTheDocument();
    expect(current.getByRole('button', { name: 'Reschedule meeting' })).toBeEnabled();
    const meetingLink = current.getByRole('link', { name: 'Open meeting link' });
    expect(meetingLink).toHaveAttribute('href', 'https://teams.microsoft.com/meet/123');
    expect(meetingLink).toHaveAttribute('target', '_blank');
    expect(meetingLink).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(meetingLink);
    expect(props.onSchedule).not.toHaveBeenCalled();
    expect(props.onAttend).not.toHaveBeenCalled();
    expect(props.onReport).not.toHaveBeenCalled();
    expect(current.queryByRole('button', { name: 'Confirm attendance' })).not.toBeInTheDocument();
    expect(next.coachName).toBe('Rewan Yasser');
  });

  it('keeps future meeting preparation and the real meeting link accessible in read-only preview', () => {
    const props = mount({ sessions: [session('future', '2026-09-15')], canAct: false });
    const current = within(screen.getByRole('article', { name: 'Current coaching meeting' }));
    expect(current.getByRole('link', { name: 'Prepare for meeting' })).toBeInTheDocument();
    const link = current.getByRole('link', { name: 'Open meeting link' });
    expect(link).toHaveAttribute('href', 'https://teams.microsoft.com/meet/123');
    fireEvent.click(link);
    expect(props.onAttend).not.toHaveBeenCalled();
    expect(props.onSchedule).not.toHaveBeenCalled();
    expect(props.onReport).not.toHaveBeenCalled();
  });

  it.each([
    { currentCoach: { name: '', email: '' }, expected: 'Not yet assigned' },
    { currentCoach: null, expected: 'To be confirmed' },
  ])('does not substitute the old meeting host when current assignment is $expected', ({ currentCoach, expected }) => {
    mount({ sessions: [session('future', '2026-09-15', { coachName: 'Rewan Yasser' })], currentCoach });
    const current = within(screen.getByRole('article', { name: 'Current coaching meeting' }));
    expect(current.getByText('Your current coach').nextElementSibling).toHaveTextContent(expected);
    expect(current.getByText('Your current coach').nextElementSibling).not.toHaveTextContent('Rewan Yasser');
    expect(current.getByText('This meeting is booked with Rewan Yasser.')).toBeInTheDocument();
  });

  it('shows when the confirmed booking has no meeting link instead of using a stale calendar URL', () => {
    mount({ sessions: [session('future', '2026-09-15')], attendance: [attendance('future', {
      date: '2026-09-15', meetingLink: '', canAttend: false,
    })] });
    expect(screen.getByText('Meeting link is not available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open meeting link|Join meeting/ })).not.toBeInTheDocument();
  });

  it.each(['cancelled', 'completed', 'failed'])('does not render an online meeting link for a %s booking', status => {
    mount({ sessions: [session('closed', '2026-09-15', { status })] }, `&view=all&tab=${status === 'failed' ? 'needs-action' : 'past'}`);
    expect(screen.getByText('September 2026 coaching')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open meeting link|Join meeting/ })).not.toBeInTheDocument();
  });

  it('keeps a pending learner signature and the next appointment visible together', () => {
    const signedMeeting = session('summary:1', '2026-09-01', { status: 'awaiting-signature', reviewTemplateId: 'template-1', coachName: 'Previous coach' });
    const next = session('next:2', '2026-09-15');
    mount({ sessions: [signedMeeting, next, session('far-future', '2027-01-01')], reviews: { 'summary:1': signatureDefinition() } });
    const attention = within(screen.getByRole('region', { name: 'Needs your attention' }));
    expect(attention.getByRole('heading', { name: 'Your signature is needed' })).toBeInTheDocument();
    expect(attention.getByRole('link', { name: 'Review & sign' })).toHaveAttribute('href', '/learner/monthly-coaching/summary%3A1?kind=apprenticeship&learner=12');
    const current = within(screen.getByRole('article', { name: 'Current coaching meeting' }));
    expect(current.getByText('Tue, 15 Sept 2026')).toBeInTheDocument();
    expect(current.getByRole('link', { name: 'Prepare for meeting' })).toHaveAttribute('href', '/learner/monthly-coaching/next%3A2?kind=apprenticeship&learner=12');
    expect(screen.queryByText('January 2027 coaching')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('confirms attendance using its own durable id when it differs from the calendar id', () => {
    const calendar = session('calendar:22');
    const matched = attendance('imported-review:8', { calendarEventKey: calendar.eventKey });
    const props = mount({ sessions: [calendar], attendance: [matched] });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm attendance' }));
    expect(props.onAttend).toHaveBeenCalledExactlyOnceWith('imported-review:8');
  });

  it('exposes reschedule and absence actions for a non-current meeting in the archive', () => {
    const later = session('later:2', '2026-10-02');
    const laterAttendance = attendance('later:2', { date: '2026-10-02', canAttend: false });
    const props = mount({ sessions: [session('next:1', '2026-09-15'), later], attendance: [laterAttendance] }, '&view=all&tab=upcoming');
    const row = within(screen.getByText('October 2026 coaching').closest('li')!);
    fireEvent.click(row.getByText('More options'));
    fireEvent.click(row.getByRole('button', { name: 'Reschedule' }));
    expect(props.onSchedule).toHaveBeenCalledExactlyOnceWith(later);
    fireEvent.click(row.getByRole('button', { name: 'Report absence' }));
    expect(props.onReport).toHaveBeenCalledExactlyOnceWith(laterAttendance);
  });

  it('disables booking, attendance, rescheduling and absence writes in a staff preview', () => {
    const current = session('current');
    const planned = session('planned', '2026-09-18', { status: 'not-scheduled', scheduledDate: null, scheduledTime: null });
    const props = mount({ sessions: [current, planned], attendance: [attendance('current')], canAct: false });
    const book = screen.getByRole('button', { name: 'Book a time' });
    const confirm = screen.getByRole('button', { name: 'Confirm attendance' });
    fireEvent.click(screen.getByText('More options'));
    const reschedule = screen.getByRole('button', { name: 'Reschedule' });
    const report = screen.getByRole('button', { name: 'Report absence' });
    for (const button of [book, confirm, reschedule, report]) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(props.onSchedule).not.toHaveBeenCalled();
    expect(props.onAttend).not.toHaveBeenCalled();
    expect(props.onReport).not.toHaveBeenCalled();
  });

  it('keeps signature summaries readable in preview without promising a signing action', () => {
    const review = session('sign', '2026-09-01', { status: 'awaiting-signature', reviewTemplateId: 'template-1' });
    mount({ sessions: [review], reviews: { sign: signatureDefinition() }, canAct: false });
    expect(screen.queryByRole('link', { name: 'Review & sign' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View summary' })).toHaveAttribute('href', '/learner/monthly-coaching/sign?kind=apprenticeship&learner=12');
  });

  it('supports keyboard tabs, focuses view headings and preserves the learner when returning', () => {
    mount({ sessions: [session('next', '2026-09-15'), session('past', '2026-09-01', { status: 'completed' })] });
    fireEvent.click(screen.getByRole('link', { name: 'View all meetings' }));
    expect(screen.getByRole('heading', { level: 1, name: 'All coaching meetings' })).toHaveFocus();
    const upcoming = screen.getByRole('tab', { name: /Upcoming/ });
    expect(upcoming).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(upcoming, { key: 'ArrowRight' });
    const past = screen.getByRole('tab', { name: /Past/ });
    expect(past).toHaveAttribute('aria-selected', 'true');
    expect(past).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: /Past/ })).toBeInTheDocument();
    const location = new URL(screen.getByTestId('location').textContent!, 'http://localhost');
    expect(location.searchParams.get('tab')).toBe('past');
    expect(location.searchParams.get('learner')).toBe('12');
    fireEvent.keyDown(past, { key: 'Home' });
    const actions = screen.getByRole('tab', { name: /Needs your action/ });
    expect(actions).toHaveFocus();
    expect(actions).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(actions, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: /Past/ })).toHaveFocus();
    fireEvent.click(screen.getByRole('link', { name: 'Back to current meeting' }));
    expect(screen.getByRole('heading', { level: 1, name: 'My coaching' })).toHaveFocus();
    expect(screen.getByTestId('location')).toHaveTextContent('/learner/monthly-coaching?kind=apprenticeship&learner=12');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('carries archive tab and page context into the exact meeting detail link', () => {
    const sessions = Array.from({ length: 10 }, (_, index) => session(`meeting:${index + 1}`, `2026-10-${String(index + 1).padStart(2, '0')}`));
    mount({ sessions }, '&view=all&tab=upcoming');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
    const firstRow = screen.getAllByRole('listitem')[0];
    const details = within(firstRow).getByRole('link', { name: 'Prepare for meeting' });
    const url = new URL(details.getAttribute('href')!, 'http://localhost');
    expect(url.pathname).toBe('/learner/monthly-coaching/meeting%3A9');
    expect(Object.fromEntries(url.searchParams)).toEqual({ kind: 'apprenticeship', learner: '12', view: 'all', tab: 'upcoming', page: '2' });
  });
});
