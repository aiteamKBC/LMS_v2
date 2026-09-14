import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearnerCalendarEvent, LearnerReviewDefinition } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import ReviewsHome, { type ReviewsHomeProps } from './ReviewsHome';

const today = '2026-09-14';
const learner = { kind: 'apprenticeship', id: '12' };
const session = (id: string, overrides: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id, eventKey: id, title: `Progress Review ${id}`, source: 'progress-review', type: 'review', sequence: 1,
  status: 'scheduled', date: today, targetDate: today, scheduledDate: today, scheduledTime: '10:00',
  durationMinutes: 60, coachName: 'Coach', coachEmail: '', meetingLink: 'https://teams.microsoft.com/meet/123',
  meetingProvider: 'Microsoft Teams', notes: '', ...overrides,
});
const attendance = (id: string, overrides: Partial<MeetingAttendance> = {}): MeetingAttendance => ({
  id, title: 'Progress Review', date: today, startTime: '10:00', durationMinutes: 60, status: 'scheduled',
  meetingLink: 'https://teams.microsoft.com/meet/123', meetingProvider: 'Microsoft Teams',
  canAttend: true, attendanceConfirmed: false, creditedMinutes: null, canReportAbsence: false,
  absenceReported: false, absenceSessionId: 'absence:12:1', missed: false, ...overrides,
});
const signatureDefinition = (): LearnerReviewDefinition => ({
  instance: { id: 'instance-1', reviewTemplateId: 'template-1', learnerId: 12, programmeId: 'programme-1',
    occurrenceNumber: 1, targetDate: today, status: 'awaiting-signature', startedAt: null, completedAt: today },
  template: { id: 'template-1', name: 'Progress Review',
    signatures: { participant: true, advisor: true, employer: false, referrer: false },
    visibleTo: { participant: true, advisor: true, employer: false, referrer: false },
    recurrence: { interval: 3, unit: 'month' }, notifications: {}, allowEditingPriorDays: 0 },
  sections: [], signatures: {
    participant: { required: true, signed: false }, advisor: { required: true, signed: true },
    employer: { required: false, signed: false }, referrer: { required: false, signed: false },
  },
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}
function mount(overrides: Partial<ReviewsHomeProps> = {}, search = '?kind=apprenticeship&learner=12') {
  const props: ReviewsHomeProps = {
    sessions: [], attendance: [], learner, today, timeZone: 'Europe/London', loading: false, error: '', busy: false,
    canAct: true, titleOf: row => row.title, onSchedule: vi.fn(), onAttend: vi.fn(), onReport: vi.fn(), ...overrides,
  };
  render(<MemoryRouter initialEntries={[`/learner/progress-reviews${search}`]}><ReviewsHome {...props}/><LocationProbe/></MemoryRouter>);
  return props;
}

afterEach(cleanup);

describe('review learner navigation and safe actions', () => {
  it('keeps the next booked review and older required signature visible without listing every future review', () => {
    const sign = session('sign:1', { status: 'awaiting-signature', scheduledDate: '2026-09-01', reviewTemplateId: 'template-1' });
    mount({ sessions: [sign, session('next:2', { scheduledDate: '2026-09-15' }), session('far-future', { scheduledDate: '2027-01-01' })],
      definitions: { 'sign:1': signatureDefinition() } });
    const current = within(screen.getByRole('article', { name: 'Current review' }));
    expect(current.getByRole('heading', { name: 'Progress Review next:2' })).toBeInTheDocument();
    const attention = within(screen.getByRole('region', { name: 'Reviews needing attention' }));
    expect(attention.getByRole('heading', { name: 'Progress Review sign:1' })).toBeInTheDocument();
    expect(attention.getByRole('link', { name: 'Read & sign' })).toHaveAttribute('href', '/learner/progress-reviews/sign%3A1?kind=apprenticeship&learner=12');
    expect(screen.queryByText('Progress Review far-future')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all reviews (3)' })).toBeInTheDocument();
  });

  it('passes the exact original calendar event to the existing booking callback', () => {
    const planned = session('review:12:3', { eventKey: 'programme:8:review:3', status: 'not-scheduled', scheduledDate: null, scheduledTime: null });
    const original = structuredClone(planned);
    Object.freeze(planned);
    const props = mount({ sessions: [planned] });
    fireEvent.click(screen.getByRole('button', { name: 'Book a time' }));
    expect(props.onSchedule).toHaveBeenCalledExactlyOnceWith(planned);
    expect(vi.mocked(props.onSchedule).mock.calls[0][0]).toBe(planned);
    expect(planned).toEqual(original);
    expect(props.onAttend).not.toHaveBeenCalled();
  });

  it('keeps future joining in More options and does not mark attendance when a meeting link is opened', () => {
    const props = mount({ sessions: [session('future', { scheduledDate: '2026-09-15' })], canAct: false });
    expect(screen.queryByRole('link', { name: 'Join meeting' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('More options'));
    const link = screen.getByRole('link', { name: 'Open meeting link' });
    expect(link).toHaveAttribute('href', 'https://teams.microsoft.com/meet/123');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(link);
    expect(props.onAttend).not.toHaveBeenCalled();
    expect(props.onReport).not.toHaveBeenCalled();
    expect(props.onSchedule).not.toHaveBeenCalled();
  });

  it('records attendance only on explicit Attend and uses the attendance record durable id', () => {
    const calendar = session('calendar:22', { eventKey: 'event:22' });
    const matched = attendance('imported-review:8', { calendarEventKey: 'event:22' });
    const props = mount({ sessions: [calendar], attendance: [matched] });
    fireEvent.click(screen.getByRole('link', { name: 'Join meeting' }));
    expect(props.onAttend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Attend' }));
    expect(props.onAttend).toHaveBeenCalledExactlyOnceWith('imported-review:8');
    expect(props.onReport).not.toHaveBeenCalled();
    expect(props.onSchedule).not.toHaveBeenCalled();
  });

  it('preserves rescheduling and absence actions for a non-current review in the full list', () => {
    const later = session('later', { scheduledDate: '2026-10-01' });
    const matched = attendance('later', { date: '2026-10-01', canAttend: false, canReportAbsence: true });
    const props = mount({ sessions: [session('next'), later], attendance: [matched] }, '?view=all&filter=upcoming');
    const row = within(screen.getByRole('heading', { name: 'Progress Review later' }).closest('li')!);
    fireEvent.click(row.getByText('More options'));
    fireEvent.click(row.getByRole('button', { name: 'Reschedule meeting' }));
    expect(vi.mocked(props.onSchedule).mock.calls[0][0]).toBe(later);
    fireEvent.click(row.getByRole('button', { name: 'Report Absence' }));
    expect(vi.mocked(props.onReport).mock.calls[0][0]).toBe(matched);
  });

  it.each([{ canAct: false, busy: false }, { canAct: true, busy: true }])('disables booking and attendance writes with action permissions $canAct and busy $busy', flags => {
    const planned = session('planned', { status: 'not-scheduled', scheduledDate: null });
    const props = mount({ sessions: [session('today'), planned], attendance: [attendance('today', { canReportAbsence: true })], ...flags }, '?view=all');
    fireEvent.click(within(screen.getByRole('heading', { name: 'Progress Review today' }).closest('li')!).getByText('More options'));
    const buttons = screen.getAllByRole('button').filter(button => /Book a time|Reschedule meeting|Attend|Saving|Report Absence/.test(button.textContent || ''));
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    buttons.forEach(button => { expect(button).toBeDisabled(); fireEvent.click(button); });
    expect(props.onSchedule).not.toHaveBeenCalled();
    expect(props.onAttend).not.toHaveBeenCalled();
    expect(props.onReport).not.toHaveBeenCalled();
  });

  it('keeps a required signature readable in preview without promising a signing action', () => {
    const sign = session('sign', { status: 'awaiting-signature', reviewTemplateId: 'template-1' });
    mount({ sessions: [sign], definitions: { sign: signatureDefinition() }, canAct: false });
    expect(screen.queryByRole('link', { name: 'Read & sign' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View review' })).toHaveAttribute('href', '/learner/progress-reviews/sign?kind=apprenticeship&learner=12');
  });

  it('navigates current/all views, focuses their headings, and retains resolved learner identity', () => {
    mount({ sessions: [session('next'), session('done', { status: 'completed', learnerSigned: true })] }, '?kind=bootcamp&learner=999');
    fireEvent.click(screen.getByRole('link', { name: 'View all reviews (2)' }));
    expect(screen.getByRole('heading', { level: 1, name: 'All reviews' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Past (1)' }));
    expect(screen.getByRole('button', { name: 'Past (1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Progress Review done' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Progress Review next' })).not.toBeInTheDocument();
    const location = new URL(screen.getByTestId('location').textContent!, 'http://localhost');
    expect(Object.fromEntries(location.searchParams)).toEqual({ kind: 'apprenticeship', learner: '12', view: 'all', filter: 'past' });
    fireEvent.click(screen.getByRole('link', { name: 'Back to current review' }));
    expect(screen.getByRole('heading', { level: 1, name: 'My reviews' })).toHaveFocus();
    expect(screen.getByTestId('location')).toHaveTextContent('/learner/progress-reviews?kind=apprenticeship&learner=12');
  });

  it('carries full-list filter and page context into details with the resolved learner', () => {
    const sessions = Array.from({ length: 10 }, (_, index) => session(`review:${index + 1}`, { scheduledDate: `2026-10-${String(index + 1).padStart(2, '0')}` }));
    mount({ sessions }, '?kind=bootcamp&learner=999&view=all&filter=upcoming');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    const href = within(screen.getAllByRole('listitem')[0]).getByRole('link', { name: 'View review' }).getAttribute('href')!;
    const url = new URL(href, 'http://localhost');
    expect(url.pathname).toBe('/learner/progress-reviews/review%3A9');
    expect(Object.fromEntries(url.searchParams)).toEqual({ kind: 'apprenticeship', learner: '12', view: 'all', filter: 'upcoming', page: '2' });
  });

  it('keeps the saved-booking sync warning visible beside the review', () => {
    mount({ sessions: [session('pending', { syncWarning: 'Saved locally; invitation is pending.' })] });
    expect(within(screen.getByRole('article', { name: 'Current review' })).getByRole('status')).toHaveTextContent('Saved locally; invitation is pending.');
  });

  it.each(['completed', 'cancelled', 'awaiting-signature'])('does not expose attendance or booking writes for a %s review with stale attendance flags', status => {
    const props = mount({ sessions: [session('closed', { status, learnerSigned: true })],
      attendance: [attendance('closed', { canAttend: true, canReportAbsence: true, missed: true })] }, '?view=all');
    fireEvent.click(screen.getByText('More options'));
    expect(screen.queryByRole('button', { name: /Attend|Report Absence|Reschedule meeting|Book a time/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View in calendar' })).toBeInTheDocument();
    expect(props.onAttend).not.toHaveBeenCalled();
    expect(props.onSchedule).not.toHaveBeenCalled();
    expect(props.onReport).not.toHaveBeenCalled();
  });

  it('keeps imported history read-only even when an old attendance record offers actions', () => {
    const importedReview: NonNullable<LearnerCalendarEvent['importedReview']> = {
      id: 'archive-1', aptemReviewId: 'A-1', name: 'Imported review', type: 'Progress Review', reviewerName: 'Coach',
      plannedDate: today, plannedTime: '10:00', completedDate: today, status: 'completed',
      extractionStatus: 'complete', detailsAvailable: true, sections: [],
    };
    const props = mount({ sessions: [session('imported', { importedReview })],
      attendance: [attendance('imported', { canAttend: true, canReportAbsence: true, missed: true, calendarEventKey: 'imported' })] }, '?view=all');
    fireEvent.click(screen.getByText('More options'));
    expect(screen.queryByRole('button', { name: /Attend|Report Absence|Reschedule meeting|Book a time/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Read & sign|Join meeting|Open meeting link/ })).not.toBeInTheDocument();
    expect(props.onAttend).not.toHaveBeenCalled();
  });

  it('shows one absence action when the attendance step and meeting options are both open', () => {
    mount({ sessions: [session('today')], attendance: [attendance('today', { canReportAbsence: true })] });
    fireEvent.click(screen.getByText('More options'));
    expect(screen.getAllByRole('button', { name: 'Report Absence' })).toHaveLength(1);
  });
});
