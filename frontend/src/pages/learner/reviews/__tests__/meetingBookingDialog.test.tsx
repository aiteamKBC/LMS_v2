import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingCalendarRules, LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import {
  bookLearnerCalendarSession, fetchCalendarConnections, fetchLearnerCalendarEvents, fetchPersonalCalendarAvailability, rescheduleLearnerCalendarSession,
} from '@/api/learnerCalendar';
import MeetingBookingDialog, { type MeetingBookingSession } from '../MeetingBookingDialog';

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

function mount(session: MeetingBookingSession, onClose = vi.fn(), attendance?: MeetingAttendance) {
  render(<MemoryRouter><main aria-label="Coaching page">Coaching page</main>
    <MeetingBookingDialog session={session} title="your coaching meeting" learner={{ kind: 'apprenticeship', id: '125' }}
      rules={rules} attendance={attendance} onClose={onClose} onBooked={vi.fn()} /></MemoryRouter>);
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
  const aptem = (source = 'progress-review', overrides: Partial<LearnerCalendarEvent> = {}) => meeting({
    id: 'imported-review:11', eventKey: 'imported-review:11', calendarEventKey: 'booking:11', reviewId: '11', reviewSource: 'aptem',
    source, type: source === 'mcr' ? 'coaching' : 'review', status: 'scheduled',
    scheduledDate: '2026-10-20', scheduledTime: '10:00', durationMinutes: 90,
    importedReview: {
      id: '11', aptemReviewId: 'A-11', name: 'Imported review', type: source === 'mcr' ? 'Monthly Coaching Meeting' : 'Progress Review',
      reviewerName: 'Coach', plannedDate: '2026-10-15', plannedTime: '10:00', completedDate: null,
      status: 'scheduled', extractionStatus: 'complete', detailsAvailable: true, sections: [],
    }, ...overrides,
  });

  it.each(['progress-review', 'mcr'])('moves the exact Aptem %s booking using the refreshed duration, ignoring its own personal-calendar slot', async source => {
    const event = aptem(source);
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [event], bookingCalendar: rules } as never);
    vi.mocked(fetchPersonalCalendarAvailability).mockResolvedValue({ busy: [{
      provider: 'google', start: new Date('2026-10-20T10:00:00').toISOString(), end: new Date('2026-10-20T11:30:00').toISOString(),
    }], errors: [], connectedProviders: ['google'] });
    vi.mocked(rescheduleLearnerCalendarSession).mockResolvedValue({ event });
    mount(aptem(source, { durationMinutes: 60 }), undefined, { calendarEventKey: 'booking:11', durationMinutes: 60 } as MeetingAttendance);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Duration')).toHaveValue('90'));
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '10:30' } });
    if (source === 'progress-review') fireEvent.change(within(dialog).getByLabelText('Duration'), { target: { value: '120' } });
    const submit = within(dialog).getByRole('button', { name: 'Save new time' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(rescheduleLearnerCalendarSession).toHaveBeenCalledExactlyOnceWith('apprenticeship', '125', expect.objectContaining({
      eventKey: 'booking:11', reviewId: '11', scheduledDate: '2026-10-20', scheduledTime: '10:30', durationMinutes: source === 'mcr' ? 90 : 120,
    })));
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('prefers the exact linked booking over an older row with the same Aptem review id', async () => {
    const event = aptem();
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [aptem('progress-review', {
      id: 'old-booking', eventKey: 'old-booking', calendarEventKey: 'old-booking', status: 'cancelled',
    }), event], bookingCalendar: rules } as never);
    vi.mocked(rescheduleLearnerCalendarSession).mockResolvedValue({ event });
    mount(event);
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Save new time' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(rescheduleLearnerCalendarSession).toHaveBeenCalledWith('apprenticeship', '125', expect.objectContaining({ eventKey: 'booking:11' })));
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('reschedules an imported-prefixed durable key supplied only by attendance instead of creating a second booking', async () => {
    const event = aptem('progress-review', { calendarEventKey: undefined });
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [event], bookingCalendar: rules } as never);
    vi.mocked(rescheduleLearnerCalendarSession).mockResolvedValue({ event });
    mount(event, undefined, { calendarEventKey: 'imported-review:A-11', durationMinutes: 90 } as MeetingAttendance);
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Save new time' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(rescheduleLearnerCalendarSession).toHaveBeenCalledWith('apprenticeship', '125', expect.objectContaining({ eventKey: 'imported-review:A-11' })));
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('treats an Aptem source date without a local booking as a first booking', async () => {
    const event = aptem('mcr', { calendarEventKey: undefined, durationMinutes: 60 });
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [event], bookingCalendar: rules } as never);
    vi.mocked(bookLearnerCalendarSession).mockResolvedValue({ event });
    mount(event);
    const dialog = await screen.findByRole('dialog', { name: 'Book monthly coaching' });
    const submit = within(dialog).getByRole('button', { name: 'Book session' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('apprenticeship', '125', expect.objectContaining({ reviewId: '11', durationMinutes: 60 })));
    expect(rescheduleLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it.each(['personal', 'lms'])('still blocks a conflict with a different %s appointment', async calendar => {
    const event = aptem();
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [event, ...(calendar === 'lms' ? [meeting({
      id: 'another', eventKey: 'another', scheduledDate: '2026-10-20', scheduledTime: '11:00', status: 'scheduled',
    })] : [])], bookingCalendar: rules } as never);
    vi.mocked(fetchPersonalCalendarAvailability).mockResolvedValue({ busy: [{
      provider: 'google', start: new Date('2026-10-20T10:00:00').toISOString(), end: new Date('2026-10-20T11:30:00').toISOString(),
    }, ...(calendar === 'personal' ? [{ provider: 'google' as const, start: new Date('2026-10-20T11:00:00').toISOString(), end: new Date('2026-10-20T12:00:00').toISOString() }] : [])], errors: [], connectedProviders: ['google'] });
    mount(event);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Duration')).toHaveValue('90'));
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '10:30' } });
    expect(await within(dialog).findByText(/This time conflicts with/)).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: 'Save new time' });
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest('form')!);
    expect(rescheduleLearnerCalendarSession).not.toHaveBeenCalled();
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it.each(['completed', 'awaiting-signature', 'in-progress', 'cancelled'])('rejects a stale Aptem booking card when the refreshed status is %s', async status => {
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [aptem('progress-review', { status })], bookingCalendar: rules } as never);
    mount(aptem());
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This meeting can no longer be scheduled');
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Save new time' }).closest('form')!);
    expect(rescheduleLearnerCalendarSession).not.toHaveBeenCalled();
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it.each(['2026-10-06', '2026-10-19'])('blocks an MCM on %s before any booking request', async day => {
    mount(meeting());
    const dialog = await screen.findByRole('dialog', { name: 'Book monthly coaching' });
    const submit = within(dialog).getByRole('button', { name: 'Book session' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: day } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('20th');
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest('form')!);
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('resolves a minimal Monthly V2 booking input against the authorized calendar', async () => {
    const event = meeting();
    mount({ id: event.id, eventKey: event.eventKey, source: event.source, title: event.title,
      date: event.date, durationMinutes: event.durationMinutes, status: event.status });
    const dialog = await screen.findByRole('dialog', { name: 'Book monthly coaching' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Book session' })).toBeEnabled());
    expect(fetchLearnerCalendarEvents).toHaveBeenCalledWith('apprenticeship', '125', { revalidate: true });
    expect(within(dialog).getByLabelText('Day')).toHaveValue('2026-10-20');
  });

  it('refuses booking when a minimal card identity is absent from the authorized calendar', async () => {
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [], bookingCalendar: rules } as never);
    mount({ id: 'unknown', eventKey: 'unknown', source: 'mcr', date: '2026-10-15' });
    const dialog = await screen.findByRole('dialog', { name: 'Book monthly coaching' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This meeting is no longer available');
    expect(within(dialog).getByRole('button', { name: 'Book session' })).toBeDisabled();
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

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

    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '2026-10-20' } });
    await waitFor(() => expect(submit).toBeEnabled());
    const [, , start, end] = vi.mocked(fetchPersonalCalendarAvailability).mock.calls.at(-1)!;
    expect(start).toBe(new Date(2026, 9, 20, 0, 0, 0).toISOString());
    expect(end).toBe(new Date(2026, 9, 20, 23, 59, 59).toISOString());
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
