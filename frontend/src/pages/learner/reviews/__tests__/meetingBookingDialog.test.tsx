import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingCalendarRules, LearnerCalendarEvent } from '@/api/learnerCalendar';
import {
  bookLearnerCalendarSession, fetchCalendarConnections, fetchLearnerCalendarEvents, fetchPersonalCalendarAvailability,
} from '@/api/learnerCalendar';
import MeetingBookingDialog from '../MeetingBookingDialog';

vi.mock('@/api/learnerCalendar', () => ({
  bookLearnerCalendarSession: vi.fn(),
  rescheduleLearnerCalendarSession: vi.fn(),
  fetchLearnerCalendarEvents: vi.fn(),
  fetchCalendarConnections: vi.fn(),
  fetchPersonalCalendarAvailability: vi.fn(),
}));

const rules: BookingCalendarRules = {
  division: 'england-and-wales', today: '2026-10-01', coveredYears: [2026, 2027], bankHolidays: [],
} as BookingCalendarRules;

function meeting(overrides: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent {
  return {
    id: 'mcr:211:1:2026-10-15', eventKey: 'mcr:211:1:2026-10-15', source: 'mcr', type: 'coaching',
    title: 'Monthly Coaching Meeting', sequence: 1, status: 'not-scheduled', date: '2026-10-15', targetDate: '2026-10-15',
    scheduledDate: null, scheduledTime: null, durationMinutes: 60, coachName: 'Coach', coachEmail: '',
    meetingProvider: '', meetingLink: '', notes: '', ...overrides,
  } as LearnerCalendarEvent;
}

function mount(session: LearnerCalendarEvent, onClose = vi.fn()) {
  render(<MemoryRouter><main aria-label="Coaching page">Coaching page</main>
    <MeetingBookingDialog session={session} title="your coaching meeting" learner={{ kind: 'apprenticeship', id: '125' }}
      rules={rules} onClose={onClose} onBooked={vi.fn()} /></MemoryRouter>);
  return onClose;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T09:00:00'));
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [meeting()], bookingCalendar: rules } as never);
  vi.mocked(fetchCalendarConnections).mockResolvedValue({ connections: [
    { provider: 'google', accountEmail: 'learner@example.invalid', status: 'connected', connectedAt: null, lastSyncAt: null },
  ] });
  vi.mocked(fetchPersonalCalendarAvailability).mockResolvedValue({ busy: [], errors: [], connectedProviders: ['google'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('MeetingBookingDialog', () => {
  it('keeps the page and form when the day field reports an unparseable date with a connected calendar', async () => {
    mount(meeting());
    const dialog = await screen.findByRole('dialog', { name: 'Book monthly coaching' });
    const submit = within(dialog).getByRole('button', { name: 'Book session' });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(fetchPersonalCalendarAvailability).toHaveBeenCalled();
    vi.mocked(fetchPersonalCalendarAvailability).mockClear();

    // Chrome reports a five-digit year typed into the year segment verbatim.
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '20261-10-05' } });

    expect(screen.getByRole('main', { name: 'Coaching page' })).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose a valid booking date.');
    expect(submit).toBeDisabled();
    expect(fetchPersonalCalendarAvailability).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '2026-10-06' } });
    await waitFor(() => expect(submit).toBeEnabled());
    const [, , start, end] = vi.mocked(fetchPersonalCalendarAvailability).mock.calls.at(-1)!;
    expect(start).toBe(new Date(2026, 9, 6, 0, 0, 0).toISOString());
    expect(end).toBe(new Date(2026, 9, 6, 23, 59, 59).toISOString());
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('treats a malformed availability response as unchecked instead of crashing', async () => {
    vi.mocked(fetchPersonalCalendarAvailability).mockResolvedValue({} as never);
    mount(meeting());
    const dialog = await screen.findByRole('dialog', { name: 'Book monthly coaching' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Some connected calendars could not be checked');
    expect(within(dialog).getByRole('button', { name: 'Book session' })).toBeEnabled();
  });

  it('shows an inline error the learner can close when the form itself fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = meeting();
    Object.defineProperty(broken, 'notes', { get() { throw new Error('unexpected booking payload'); } });
    const onClose = mount(broken);

    const dialog = await screen.findByRole('dialog', { name: 'Booking form unavailable' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Something went wrong in the booking form.');
    expect(screen.getByRole('main', { name: 'Coaching page' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });
});
