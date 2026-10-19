import type { ComponentProps, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dashboardMonthlyFixture } from '@/test/dashboardMonthlyFixture';
import { MonthlyPlanBoard } from '../MonthlyPlanBoard';
import { coachFetch } from '@/lib/coachFetch';

const actions = vi.hoisted(() => ({ booking: vi.fn(), absence: vi.fn(), catchup: vi.fn() }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/pages/learner/reviews/MeetingBookingDialog', () => ({ default: (props: { onBooked: () => void }) => {
  actions.booking(props); return <button onClick={props.onBooked}>Save review booking</button>;
} }));
vi.mock('@/pages/learner/attendance/components/AbsenceReportDialog', () => ({ default: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div> }));
vi.mock('@/pages/learner/attendance/components/AbsenceReportForm', () => ({ default: (props: { onSubmitted: () => void }) => {
  actions.absence(props); return <button onClick={props.onSubmitted}>Submit absence</button>;
} }));
vi.mock('@/pages/learner/attendance/components/CatchupBooking', () => ({ default: (props: { onSelect: (event: { eventKey: string }) => void }) => {
  actions.catchup(props); return <><p>Catch-up options</p><button onClick={() => props.onSelect({ eventKey: 'catch-up:selected' })}>Select catch-up</button></>;
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

const review = { id: 'progress-review:r1', title: 'Progress review', date: '20 Oct', time: '60 min', status: 'Not booked',
  tooltip: 'Review coach', formHref: '/learner/progress-reviews/progress-review%3Ar1?kind=commercial&learner=265', attendHref: null,
  booking: { id: 'r1', eventKey: 'progress-review:r1', title: 'Progress review', source: 'progress-review',
    status: 'not-scheduled', date: '2026-10-20', durationMinutes: 60 } };
const lecture = (id: string): ComponentProps<typeof MonthlyPlanBoard>['payload']['lectures'][number] => ({
  id, date: '20 Oct 2099', time: '10:00', duration: '60 min', attendHref: 'https://example.test/join',
  title: `Lecture ${id}`, tutor: 'Tutor', status: '', absence: null, absenceAction: null, absenceLabel: null });
function display(payload = dashboardMonthlyFixture()) {
  const onRefresh = vi.fn(), onMonthChange = vi.fn();
  render(<MemoryRouter><MonthlyPlanBoard payload={payload} kind="commercial" learnerId="265" onRefresh={onRefresh} refreshing={false} onMonthChange={onMonthChange} /></MemoryRouter>);
  return { onRefresh, onMonthChange };
}

describe('compact Monthly board keeps existing presentation and actions', () => {
  it('does not launch another expired-deadline refresh during an ongoing read', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T09:00:20Z'));
    const payload = dashboardMonthlyFixture(); payload.refreshAt = '2026-10-20T09:00:10Z';
    const onRefresh = vi.fn();
    render(<MemoryRouter><MonthlyPlanBoard payload={payload} kind="commercial" learnerId="265"
      onRefresh={onRefresh} refreshing onMonthChange={vi.fn()} /></MemoryRouter>);
    act(() => vi.advanceTimersByTime(100));
    expect(onRefresh).not.toHaveBeenCalled();
  });
  it('pauses the deadline while hidden and refreshes on activation without losing a dialog', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T09:00:00Z'));
    const payload = dashboardMonthlyFixture(); payload.refreshAt = '2026-10-20T09:00:10Z'; payload.reviews = [review];
    const onRefresh = vi.fn();
    const boardProps = { payload, kind: 'commercial' as const, learnerId: '265', onRefresh,
      refreshing: false, onMonthChange: vi.fn() };
    const view = render(<MemoryRouter><MonthlyPlanBoard {...boardProps} active /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    view.rerender(<MemoryRouter><MonthlyPlanBoard {...boardProps} active={false} /></MemoryRouter>);
    act(() => vi.advanceTimersByTime(20_000));
    expect(onRefresh).not.toHaveBeenCalled();
    view.rerender(<MemoryRouter><MonthlyPlanBoard {...boardProps} active /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Save review booking' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
  it('renders server hours and difference, sends navigation only when clicked, and keeps assignment links', () => {
    const payload = dashboardMonthlyFixture();
    payload.assignments = [1, 2].map(id => ({ id: String(id), title: `Assignment ${id}`, subtitle: 'Week 1',
      requiredHours: '2 hrs', achievedHours: id === 2 ? '2 hrs' : '0 hrs', progress: id === 2 ? '100%' : '0%',
      progressLabel: id === 2 ? '100% complete' : '0% complete', href: `/learner/component/commercial/265/A${id}?week=Week%201`, actionLabel: id === 2 ? 'View' : 'Start' }));
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
      session: expect.objectContaining({ eventKey: 'progress-review:r1', source: 'progress-review', date: '2026-10-20' }),
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Save review booking' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps booked/review invitation statuses and safe session Attend links', () => {
    const payload = dashboardMonthlyFixture();
    payload.reviews = [{ ...review, status: 'Booking pending', booking: null }];
    // The server owns the three-row cap (covered in MonthlyV2ProjectionTests).
    payload.lectures = [lecture('1'), lecture('2'), lecture('3')];
    display(payload);
    expect(screen.getByText('Booking pending')).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Attend' })).toHaveLength(3);
    expect(screen.queryByText('Lecture 4')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all activities for October 2026' })).toHaveAttribute('href', '/learner/modules/commercial/265?subject=current%3AM1');
  });

  it('preserves absence reporting preselection and refresh', () => {
    const payload = dashboardMonthlyFixture();
    const row: ComponentProps<typeof MonthlyPlanBoard>['payload']['lectures'][number] = lecture('1');
    row.absence = { id: 'teams:1', date: '2099-10-20', title: 'Lecture 1', reportId: null };
    row.absenceAction = 'absence'; row.absenceLabel = 'Report absence';
    payload.lectures = [row];
    const { onRefresh } = display(payload);
    fireEvent.click(screen.getByRole('button', { name: 'Report absence' }));
    expect(actions.absence).toHaveBeenLastCalledWith(expect.objectContaining({ preselectMatch: { id: 'teams:1', dateIso: '2099-10-20', title: 'Lecture 1' }, showGuidance: false, showHistory: true, compact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit absence' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('renders server catch-up actions and hides them when the server removes eligibility', () => {
    const payload = dashboardMonthlyFixture();
    const row: ComponentProps<typeof MonthlyPlanBoard>['payload']['lectures'][number] = lecture('1');
    row.absence = { id: 'teams:1', date: '2099-10-20', title: 'Lecture 1', reportId: 7 };
    row.absenceAction = 'catchup'; row.absenceLabel = 'Change catch-up';
    payload.lectures = [row];
    display(payload);
    fireEvent.click(screen.getByRole('button', { name: 'Change catch-up' }));
    expect(within(screen.getByRole('dialog')).getByText('Catch-up options')).toBeVisible();
    expect(actions.catchup).toHaveBeenLastCalledWith(expect.objectContaining({ standalone: true,
      lecture: expect.objectContaining({ dateIso: '2099-10-20', title: 'Lecture 1', sessionType: 'live_session', status: 'absent' }) }));
    cleanup();
    row.absence = null; row.absenceAction = null; row.absenceLabel = null;
    display(payload);
    expect(screen.queryByRole('button', { name: /catch.?up/i })).not.toBeInTheDocument();
  });

  it('shows unavailable hour values and existing empty states', () => {
    const payload = dashboardMonthlyFixture(); payload.summary = { requiredHours: 'Not available', achievedHours: 'Not available',
      difference: 'Not available', differenceDirection: 'equal', differenceTone: null, ksbs: [] };
    payload.navigation = { previous: null, next: null }; payload.activitiesHref = null;
    display(payload);
    expect(screen.getAllByText('Not available')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    expect(screen.getByText('No assignments found for this month.')).toBeVisible();
    expect(screen.getByText('No reviews planned for this month.')).toBeVisible();
    expect(screen.getByText('No lectures scheduled for this month.')).toBeVisible();
  });

  it('links catch-up using only the server report identity and selected event, and preserves a failed dialog', async () => {
    const payload = dashboardMonthlyFixture();
    payload.lectures = [{ ...lecture('1'), absenceAction: 'catchup', absenceLabel: 'Change catch-up',
      absence: { id: 'teams:1', date: '2026-10-20', title: 'Lecture 1', reportId: 7 } }];
    vi.mocked(coachFetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403 }));
    const { onRefresh } = display(payload);
    fireEvent.click(screen.getByRole('button', { name: 'Change catch-up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select catch-up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link catch-up to this absence' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not authorized');
    expect(onRefresh).not.toHaveBeenCalled();
    expect(coachFetch).toHaveBeenCalledWith('/learner_api/session-catchup/commercial/265/', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ reportId: 7, eventKey: 'catch-up:selected' }),
    }));
    vi.mocked(coachFetch).mockResolvedValueOnce(new Response(JSON.stringify({ success: true })));
    fireEvent.click(screen.getByRole('button', { name: 'Link catch-up to this absence' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders prepared strings without deriving dates, differences, or meeting status', () => {
    const payload = dashboardMonthlyFixture(); payload.title = 'Prepared month heading';
    payload.summary.difference = 'Prepared difference';
    payload.reviews = [{ ...review, booking: null, date: 'Prepared date', time: 'Prepared time', status: 'Prepared status' }];
    display(payload);
    for (const label of ['Prepared month heading', 'Prepared difference', 'Prepared date', 'Prepared time', 'Prepared status']) {
      expect(screen.getByText(label)).toBeVisible();
    }
  });

  it('refreshes at the server deadline without calculating availability locally', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T09:00:00Z'));
    const payload = dashboardMonthlyFixture(); payload.refreshAt = '2026-10-20T09:00:10Z';
    const { onRefresh } = display(payload);
    act(() => vi.advanceTimersByTime(9_999)); expect(onRefresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1)); expect(onRefresh).toHaveBeenCalledOnce();
  });
});
