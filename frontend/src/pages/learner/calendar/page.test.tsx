import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnerCalendarContent } from './page';
import { bookLearnerCalendarSession, fetchLearnerCalendarEvents, rescheduleLearnerCalendarSession, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { fetchReviewHistory } from '@/api/reviewHistory';

vi.mock('@/hooks/useMyLearner', () => ({ useLinkedLearner: () => ({ kind: 'commercial', id: '125' }) }));
vi.mock('@/pages/coach/shared/CoachMeetingArtifactsPanel', () => ({ CoachMeetingArtifactsPanel: () => <div>Meeting recordings</div> }));
vi.mock('@/api/learnerCalendar', () => ({
  fetchLearnerCalendarEvents: vi.fn(),
  fetchLearnerEventReviewInstance: vi.fn(async () => ({ instance: null })),
  bookLearnerCalendarSession: vi.fn(),
  rescheduleLearnerCalendarSession: vi.fn(),
  fetchLearnerCoach: vi.fn(async () => ({ coachName: 'Assigned coach', coachEmail: 'coach@example.test' })),
  fetchCalendarConnections: vi.fn(async () => ({ connections: [] })),
  fetchPersonalCalendarAvailability: vi.fn(async () => ({ busy: [] })),
  fetchLearnerMeetingArtifacts: vi.fn(), learnerMeetingArtifactContentUrl: vi.fn(),
  startCalendarOAuth: vi.fn(), connectCredentialCalendar: vi.fn(), disconnectPersonalCalendar: vi.fn(),
}));
vi.mock('@/api/reviewHistory', () => ({ fetchReviewHistory: vi.fn(async () => ({ reviews: [] })) }));

const now = new Date();
const isoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const event = (overrides: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id: 'catch-up-1', eventKey: 'catch-up:1', title: 'Catch-up with your coach', source: 'catch-up', type: 'coaching',
  status: 'scheduled', sequence: 0, targetDate: isoDate, date: isoDate, scheduledDate: isoDate, scheduledTime: '10:00', durationMinutes: 60,
  coachName: 'Assigned coach', coachEmail: 'coach@example.test', meetingProvider: 'teams',
  meetingLink: 'https://teams.microsoft.com/meet/example', notes: 'Discuss the next learning milestone.', invited: true,
  ...overrides,
});

function setup(events: LearnerCalendarEvent[] = [event()], search = '') {
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 125 }, events });
  return render(<StrictMode><MemoryRouter initialEntries={['/learner/calendar' + search]}><LearnerCalendarContent /></MemoryRouter></StrictMode>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchReviewHistory).mockResolvedValue({ learnerId: null, category: 'reviews', reviews: [] });
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('calendar event previews', () => {
  it('opens the colour customisation drawer from the learner calendar', async () => {
    setup();
    await screen.findAllByRole('button', { name: /Catch-up with your coach/ });
    fireEvent.click(screen.getByRole('button', { name: 'Customise colours' }));
    expect(screen.getByRole('dialog', { name: 'Calendar Colour Preferences' })).toBeVisible();
  });

  it('shows horizontally scrollable source and status filters with distinct status colours', async () => {
    setup();
    await screen.findAllByRole('button', { name: /Catch-up with your coach/ });

    const sourceFilters = screen.getByRole('group', { name: 'Calendar source filters' });
    const statusFilters = screen.getByRole('group', { name: 'Calendar status filters' });
    expect(within(sourceFilters).getByRole('button', { name: /Catch-up/ })).toBeVisible();
    const scheduled = within(statusFilters).getByTitle(/Scheduled \(1\)/);
    const completed = within(statusFilters).getByTitle(/Completed \(/);
    expect(scheduled).toHaveStyle({ backgroundColor: '#ECFDF5' });
    expect(completed).toHaveStyle({ backgroundColor: '#D1FAE5' });
    expect(scheduled).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders a visible scrollbar when the status filters overflow', async () => {
    setup();
    await screen.findAllByRole('button', { name: /Catch-up with your coach/ });
    const statusFilters = screen.getByRole('group', { name: 'Calendar status filters' });
    Object.defineProperty(statusFilters, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(statusFilters, 'scrollWidth', { configurable: true, value: 900 });
    fireEvent.resize(window);

    expect(screen.getByRole('scrollbar', { name: 'Calendar status filters scrollbar' })).toHaveAttribute('aria-valuemax', '600');
  });

  it('shows a written, colour-coded status on month cards', async () => {
    setup();
    const statusBadges = await screen.findAllByLabelText('Scheduled status');
    expect(statusBadges[0]).toBeVisible();
    expect(statusBadges[0]).toHaveTextContent('Scheduled');
    expect(statusBadges[0]).toHaveClass('bg-primary-100', 'text-primary-800');
  });

  it.each(['book', 'reschedule'] as const)('uses the appointment date timezone offset when a future session is %s', async action => {
    // A browser in London is UTC+1 in September, but UTC in November.
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(function (this: Date) {
      return this.getFullYear() === 2026 && this.getMonth() === 10 ? 0 : -60;
    });
    const scheduled = event({ source: 'mcr', date: '2026-11-02', targetDate: '2026-11-02', scheduledDate: '2026-11-02', scheduledTime: '11:30' });
    const save = action === 'book' ? bookLearnerCalendarSession : rescheduleLearnerCalendarSession;
    vi.mocked(save).mockResolvedValue({ event: scheduled });
    setup([action === 'book' ? { ...scheduled, status: 'not-scheduled', scheduledTime: null, scheduledDate: null } : scheduled], '?event=catch-up%3A1');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: action === 'book' ? /Schedule Monthly Coaching Meeting/ : 'Reschedule' }));
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '2026-11-02' } });
    fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: '11:30' } });
    fireEvent.click(screen.getAllByRole('button', { name: action === 'book' ? 'Book Session' : 'Save New Time' })[0]);
    await waitFor(() => expect(save).toHaveBeenCalledWith('commercial', '125', expect.objectContaining({ scheduledDate: '2026-11-02', timezoneOffsetMinutes: 0 })));
  });

  it.each(['Week', 'Day'])('keeps untimed and early appointments visible in %s view', async view => {
    setup([
      event({ id: 'untimed', eventKey: 'untimed', title: 'Untimed appointment', status: 'not-scheduled', scheduledTime: null, scheduledDate: null, date: '2026-12-15', targetDate: '2026-12-15' }),
      event({ id: 'early', eventKey: 'early', title: 'Early appointment', date: '2026-12-15', scheduledDate: '2026-12-15', scheduledTime: '06:30' }),
    ], '?event=untimed');
    await screen.findByRole('dialog', { name: 'Untimed appointment' });
    fireEvent.click(screen.getByRole('button', { name: 'Close event details' }));
    fireEvent.click(screen.getByRole('button', { name: view }));
    const pending = screen.getByRole('region', { name: 'Sessions awaiting a time' });
    expect(within(pending).getByRole('button', { name: /Untimed appointment/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Early appointment/ })).toBeVisible();
    fireEvent.click(within(pending).getByRole('button', { name: /Untimed appointment/ }));
    expect(screen.getByRole('dialog', { name: 'Untimed appointment' })).toBeVisible();
  });

  it('moves one week when the next-week button is pressed', async () => {
    setup();
    await screen.findAllByRole('button', { name: /Catch-up with your coach/ });
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    const next = new Date(now); next.setDate(next.getDate() + 7);
    const dateLabel = `${next.getDate()} ${next.toLocaleDateString('en-GB', { month: 'long' })} ${next.getFullYear()}`;
    expect(screen.getByText(new RegExp(dateLabel))).toBeVisible();
  });

  it('shows next-year appointments in a week spanning December and January', async () => {
    setup([
      event({ id: 'year-end', eventKey: 'year-end', title: 'End of year session', date: '2026-12-31', scheduledDate: '2026-12-31' }),
      event({ id: 'new-year', eventKey: 'new-year', title: 'New year session', date: '2027-01-01', scheduledDate: '2027-01-01' }),
    ], '?event=year-end');
    await screen.findByRole('dialog', { name: 'End of year session' });
    fireEvent.click(screen.getByRole('button', { name: 'Close event details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('button', { name: /New year session/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Select 1 January 2027' }));
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(screen.getByText(/1 January 2027/)).toBeVisible();
    expect(screen.getByRole('button', { name: /New year session/ })).toBeVisible();
  });

  it('refreshes an open appointment after the coach changes it in another tab', async () => {
    setup();
    fireEvent.click((await screen.findAllByRole('button', { name: /Catch-up with your coach/ }))[0]);
    const updated = event({ scheduledTime: '14:30', coachName: 'Replacement coach' });
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 125 }, events: [updated] });
    fireEvent.focus(window);
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('14:30–15:30')).toBeVisible();
    expect(within(dialog).getByText('Replacement coach')).toBeVisible();
  });

  it('can retry a failed calendar load without reloading the application', async () => {
    vi.mocked(fetchLearnerCalendarEvents).mockRejectedValue(new Error('Calendar unavailable'));
    render(<MemoryRouter><LearnerCalendarContent /></MemoryRouter>);
    expect(await screen.findByText(/Calendar unavailable/)).toBeVisible();
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 125 }, events: [event()] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry calendar' }));
    await screen.findAllByRole('button', { name: /Catch-up with your coach/ });
    expect(screen.queryByText(/Calendar unavailable/)).not.toBeInTheDocument();
  });

  it.each(['Month', 'Week', 'Day'])('opens details directly from %s and hands rescheduling the exact event', async view => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole('button', { name: /Catch-up with your coach/ });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('No event selected')).not.toBeInTheDocument();
    if (view !== 'Month') await user.click(screen.getByRole('button', { name: view }));
    const trigger = screen.getAllByRole('button', { name: /Catch-up with your coach/ })[0];
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Catch-up with your coach' });
    expect(within(dialog).getByText('Assigned coach')).toBeVisible();
    expect(within(dialog).getByText('Discuss the next learning milestone.')).toBeVisible();
    expect(within(dialog).getByRole('link', { name: 'Join Meeting' })).toHaveAttribute('href', event().meetingLink);
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
    await user.click(trigger);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reschedule' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Reschedule/ })).toBeVisible();
    expect(document.querySelector('input[type="date"]')).toHaveValue(isoDate);
    expect(document.querySelector('input[type="time"]')).toHaveValue('10:00');
    expect(rescheduleLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('opens live sessions and pending requests without showing unavailable edit actions', async () => {
    const user = userEvent.setup();
    setup([
      event({ id: 'live', eventKey: 'live:1', title: 'Marketing workshop', source: 'live-session', module: 'Marketing' }),
      event({ id: 'pending', eventKey: 'catch-up:2', title: 'Pending support', source: 'student-support', status: 'not-scheduled', invited: false, meetingLink: '' }),
    ]);
    for (const title of ['Marketing workshop', 'Pending support']) {
      await user.click((await screen.findAllByRole('button', { name: new RegExp(title) }))[0]);
      const dialog = screen.getByRole('dialog', { name: title });
      expect(within(dialog).queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument();
      if (title === 'Pending support') expect(within(dialog).getByText(/after coach approval/)).toBeVisible();
      await user.click(within(dialog).getByRole('button', { name: 'Close event details' }));
    }
  });

  it('opens overflow and upcoming events in the same dialog', async () => {
    const user = userEvent.setup();
    setup(Array.from({ length: 4 }, (_, index) => event({ id: `event-${index}`, title: `Session ${index}`, eventKey: `catch-up:${index}` })));
    await user.click(await screen.findByRole('button', { name: '+1 more' }));
    await user.click(screen.getAllByRole('button', { name: /Session 3/ })[0]);
    expect(screen.getByRole('dialog', { name: 'Session 3' })).toBeVisible();
    await user.keyboard('{Escape}');
    const triggers = screen.getAllByRole('button', { name: /Session 0/ });
    await user.click(triggers[triggers.length - 1]);
    expect(screen.getByRole('dialog', { name: 'Session 0' })).toBeVisible();
  });

  it('keeps dashboard schedule links opening the booking form without a second overlay', async () => {
    setup([event({ status: 'not-scheduled', scheduledTime: null, scheduledDate: null, meetingLink: '', source: 'mcr' })], '?event=catch-up%3A1&action=schedule');
    expect(await screen.findByRole('heading', { name: 'Schedule Monthly Coaching Meeting' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('shows Curriculum reviews instead of imported upcoming schedules', async () => {
    vi.mocked(fetchReviewHistory).mockResolvedValue({
      learnerId: 125, category: 'reviews', reviews: [{
        id: '72', aptemReviewId: '72', name: 'Old Aptem schedule',
        type: 'Progress Review', status: 'not-scheduled', plannedDate: isoDate,
        plannedTime: null, completedDate: null, reviewerName: '', extractionStatus: 'complete',
        detailsAvailable: false, sections: [],
      }],
    });
    setup([event({
      source: 'progress-review', title: 'Configured progress conversation',
      reviewTemplateId: 'REV-72', reviewTypeId: 'REVT-PROGRESS_REVIEW',
      reviewTypeCode: 'progress_review', reviewTypeName: 'Progress Review',
    })]);
    expect((await screen.findAllByRole('button', { name: /Configured progress conversation/ }))[0]).toBeVisible();
    expect(screen.queryByText('Old Aptem schedule')).not.toBeInTheDocument();
    expect(screen.getByTitle('Progress Review (1)')).toBeVisible();
  });

  it('previews the updated appointment after a successful reschedule', async () => {
    const user = userEvent.setup();
    const nextWeekday = new Date(now);
    do { nextWeekday.setDate(nextWeekday.getDate() + 1); } while ([0, 6].includes(nextWeekday.getDay()));
    const nextDate = `${nextWeekday.getFullYear()}-${String(nextWeekday.getMonth() + 1).padStart(2, '0')}-${String(nextWeekday.getDate()).padStart(2, '0')}`;
    vi.mocked(rescheduleLearnerCalendarSession).mockResolvedValue({ event: event({ date: nextDate, scheduledDate: nextDate, scheduledTime: '11:30' }) });
    setup();
    await user.click((await screen.findAllByRole('button', { name: /Catch-up with your coach/ }))[0]);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reschedule' }));
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: nextDate } });
    fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: '11:30' } });
    await user.click(screen.getByRole('button', { name: 'Save New Time' }));
    await waitFor(() => expect(rescheduleLearnerCalendarSession).toHaveBeenCalledWith('commercial', '125', expect.objectContaining({ eventKey: 'catch-up:1', scheduledDate: nextDate, scheduledTime: '11:30' })));
    const dialog = await screen.findByRole('dialog', { name: 'Catch-up with your coach' });
    expect(within(dialog).getByText('11:30–12:30')).toBeVisible();
  });

  it('keeps a saved reschedule when an older background calendar read finishes afterward', async () => {
    setup();
    await screen.findAllByRole('button', { name: /Catch-up with your coach/ });
    let resolveOldRead!: (value: Awaited<ReturnType<typeof fetchLearnerCalendarEvents>>) => void;
    vi.mocked(fetchLearnerCalendarEvents).mockImplementation(() => new Promise(resolve => { resolveOldRead = resolve; }));
    fireEvent.focus(window);
    await waitFor(() => expect(resolveOldRead).toBeTypeOf('function'));
    const nextWeekday = new Date(now);
    do { nextWeekday.setDate(nextWeekday.getDate() + 1); } while ([0, 6].includes(nextWeekday.getDay()));
    const nextDate = `${nextWeekday.getFullYear()}-${String(nextWeekday.getMonth() + 1).padStart(2, '0')}-${String(nextWeekday.getDate()).padStart(2, '0')}`;
    vi.mocked(rescheduleLearnerCalendarSession).mockResolvedValue({ event: event({ date: nextDate, scheduledDate: nextDate, scheduledTime: '11:30' }) });
    fireEvent.click(screen.getAllByRole('button', { name: /Catch-up with your coach/ })[0]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reschedule' }));
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: nextDate } });
    fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: '11:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save New Time' }));
    await within(await screen.findByRole('dialog')).findByText('11:30–12:30');
    await act(async () => { resolveOldRead({ learner: { kind: 'commercial', id: 125 }, events: [event()] }); });
    expect(within(screen.getByRole('dialog')).getByText('11:30–12:30')).toBeVisible();
  });
});
