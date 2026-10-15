import type { ComponentProps, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dashboardMonthlyFixture } from '@/test/dashboardMonthlyFixture';
import { MonthlyPlanBoard } from '../MonthlyPlanBoard';

const actions = vi.hoisted(() => ({ booking: vi.fn(), absence: vi.fn(), catchup: vi.fn() }));
vi.mock('@/pages/learner/reviews/MeetingBookingDialog', () => ({ default: (props: { onBooked: () => void }) => {
  actions.booking(props); return <button onClick={props.onBooked}>Save review booking</button>;
} }));
vi.mock('@/pages/learner/attendance/components/AbsenceReportDialog', () => ({ default: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div> }));
vi.mock('@/pages/learner/attendance/components/AbsenceReportForm', () => ({ default: (props: { onSubmitted: () => void }) => {
  actions.absence(props); return <button onClick={props.onSubmitted}>Submit absence</button>;
} }));
vi.mock('@/pages/learner/attendance/components/CatchupBooking', () => ({ default: (props: unknown) => { actions.catchup(props); return <p>Catch-up options</p>; } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const review = { id: 'r1', eventKey: 'progress-review:r1', title: 'Progress review', source: 'progress-review', sequence: 1,
  status: 'not-scheduled', date: '2026-10-20', targetDate: '2026-10-20', scheduledDate: null,
  scheduledTime: null, durationMinutes: 60, coachName: 'Review coach', reviewTemplateId: 'template', reviewInstanceId: null, meetingLink: null };
const lecture = (id: string) => ({ session: { id, start: '2099-10-20T09:00:00Z', end: '2099-10-20T10:00:00Z', minutes: 60,
  joinUrl: 'https://example.test/join', status: 'scheduled' }, title: `Lecture ${id}`, tutor: 'Tutor', attendance: null });
function display(payload = dashboardMonthlyFixture()) {
  const onRefresh = vi.fn(), onMonthChange = vi.fn();
  render(<MemoryRouter><MonthlyPlanBoard payload={payload} kind="commercial" learnerId="265" onRefresh={onRefresh} refreshing={false} onMonthChange={onMonthChange} /></MemoryRouter>);
  return { onRefresh, onMonthChange };
}

describe('compact Monthly board keeps existing presentation and actions', () => {
  it('shows SSOT hours and derived difference, sends navigation only when clicked, and keeps assignment links/caps', () => {
    const payload = dashboardMonthlyFixture();
    payload.assignments = [1, 2, 3].map(id => ({ moduleId: 'current:M1', moduleTitle: 'Module',
      activity: { id: String(id), title: `Assignment ${id}`, componentId: `A${id}`, weekTitle: 'Week 1', expectedHours: 2, completed: id === 2 } }));
    const { onMonthChange } = display(payload);
    expect(screen.getByText('50 hrs')).toBeVisible();
    expect(screen.getByText('12 hrs')).toBeVisible();
    expect(screen.getByText('-38 hrs')).toBeVisible();
    expect(screen.getByText('K1')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Start' })).toHaveAttribute('href', '/learner/component/commercial/265/A1?week=Week%201');
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/learner/component/commercial/265/A2?week=Week%201');
    expect(screen.queryByText('Assignment 3')).not.toBeInTheDocument();
    expect(onMonthChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onMonthChange).toHaveBeenCalledWith('2026-11');
  });

  it('preserves form navigation, booking identity/learner and refresh after review booking', () => {
    const payload = dashboardMonthlyFixture(); payload.reviews = [review];
    const { onRefresh } = display(payload);
    expect(screen.getByRole('link', { name: 'View form' })).toHaveAttribute('href', '/learner/progress-reviews/progress-review%3Ar1?kind=commercial&learner=265');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(actions.booking).toHaveBeenLastCalledWith(expect.objectContaining({
      learner: { kind: 'commercial', id: '265' }, rules: null,
      session: expect.objectContaining({ eventKey: 'progress-review:r1', type: 'review', meetingProvider: 'teams', notes: '' }),
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Save review booking' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps booked/review invitation statuses and safe session Attend links', () => {
    const payload = dashboardMonthlyFixture();
    payload.reviews = [{ ...review, status: 'scheduled', invited: false }];
    payload.lectures = [lecture('1'), lecture('2'), lecture('3'), lecture('4')];
    display(payload);
    expect(screen.getByText('Booking pending')).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Attend' })).toHaveLength(3);
    expect(screen.queryByText('Lecture 4')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all activities for October 2026' })).toHaveAttribute('href', '/learner/modules/commercial/265?subject=current%3AM1');
  });

  it('preserves absence reporting preselection and refresh', () => {
    const payload = dashboardMonthlyFixture();
    const row: ComponentProps<typeof MonthlyPlanBoard>['payload']['lectures'][number] = lecture('1');
    row.attendance = { id: 'teams:1', date: '2099-10-20', title: 'Lecture 1', status: 'upcoming',
      canReportAbsence: true, catchupStatus: null, absenceReport: null };
    payload.lectures = [row];
    const { onRefresh } = display(payload);
    fireEvent.click(screen.getByRole('button', { name: 'Report absence' }));
    expect(actions.absence).toHaveBeenLastCalledWith(expect.objectContaining({ preselectMatch: { id: 'teams:1', dateIso: '2099-10-20', title: 'Lecture 1' }, showGuidance: false, showHistory: true, compact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit absence' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps catch-up recovery priority and hides catch-up for a recovered absence', () => {
    const payload = dashboardMonthlyFixture();
    const row: ComponentProps<typeof MonthlyPlanBoard>['payload']['lectures'][number] = lecture('1');
    row.attendance = { id: 'teams:1', date: '2099-10-20', title: 'Lecture 1', status: 'absent',
      canReportAbsence: false, catchupStatus: 'pending', absenceReport: { id: 7, status: 'pending' },
      recovery: { method: 'catch-up', date: null, calendarKey: 'catch-up:c1', ended: false } };
    payload.lectures = [row];
    display(payload);
    fireEvent.click(screen.getByRole('button', { name: 'Change catch-up' }));
    expect(within(screen.getByRole('dialog')).getByText('Catch-up options')).toBeVisible();
    expect(actions.catchup).toHaveBeenLastCalledWith(expect.objectContaining({ standalone: true,
      lecture: expect.objectContaining({ dateIso: '2099-10-20', title: 'Lecture 1', sessionType: 'live_session', status: 'absent' }) }));
    cleanup();
    row.attendance = { ...row.attendance, status: 'present' as typeof row.attendance.status, rawStatus: 'absent', effectiveAttendance: 1 };
    display(payload);
    expect(screen.queryByRole('button', { name: /catch.?up/i })).not.toBeInTheDocument();
  });

  it('shows unavailable hour values and existing empty states', () => {
    const payload = dashboardMonthlyFixture(); payload.summary = { requiredHours: null, achievedHours: null, ksbs: [] };
    payload.navigation = { previous: null, next: null }; payload.selectedSubjectId = null;
    display(payload);
    expect(screen.getAllByText('Not available')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    expect(screen.getByText('No assignments found for this month.')).toBeVisible();
    expect(screen.getByText('No reviews planned for this month.')).toBeVisible();
    expect(screen.getByText('No lectures scheduled for this month.')).toBeVisible();
  });
});
