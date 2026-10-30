import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingCalendarRules, LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import {
  bookLearnerCalendarSession, fetchCalendarConnections, fetchLearnerCalendarEvents, fetchPersonalCalendarAvailability, fetchReviewSlots, rescheduleLearnerCalendarSession,
} from '@/api/learnerCalendar';
import MeetingBookingDialog, { type MeetingBookingSession } from '../MeetingBookingDialog';

vi.mock('@/api/learnerCalendar', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/learnerCalendar')>(),
  bookLearnerCalendarSession: vi.fn(),
  rescheduleLearnerCalendarSession: vi.fn(),
  fetchLearnerCalendarEvents: vi.fn(),
  fetchCalendarConnections: vi.fn(),
  fetchPersonalCalendarAvailability: vi.fn(),
  fetchReviewSlots: vi.fn(),
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

async function chooseReviewTime(value: string, dialog: HTMLElement = document.body) {
  await within(dialog).findByRole('option', { name: value });
  fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value } });
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
  vi.mocked(fetchReviewSlots).mockImplementation(async (_kind, _id, _date, duration) =>
    Array.from({ length: 32 }, (_, index) => 9 * 60 + index * 15)
      .filter(minutes => minutes + duration <= 17 * 60)
      .map(minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`));
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

  it.each(['progress-review', 'mcr'])('edits only raw Aptem %s notes and submits an explicit clear with the original booking', async source => {
    const event = aptem(source, { bookingNotes: 'Original agenda', notes: 'Generated description. Original agenda' });
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [event], bookingCalendar: rules } as never);
    vi.mocked(rescheduleLearnerCalendarSession).mockResolvedValue({ event });
    mount(event);
    const notes = await screen.findByRole('textbox');
    await waitFor(() => expect(notes).toHaveValue('Original agenda'));
    fireEvent.change(notes, { target: { value: '' } });
    await chooseReviewTime('10:00');
    fireEvent.click(screen.getByRole('button', { name: 'Save new time' }));
    await waitFor(() => expect(rescheduleLearnerCalendarSession).toHaveBeenCalledWith('apprenticeship', '125', expect.objectContaining({
      notes: '',
      expectedBooking: { scheduledDate: '2026-10-20', scheduledTime: '10:00', durationMinutes: 90, notes: 'Original agenda' },
    })));
  });

  it('retries a reserved Aptem meeting with failed sync through reschedule, not a new booking', async () => {
    const event = aptem('progress-review', { status: 'not-scheduled', bookingStatus: 'scheduled', syncState: 'failed' });
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [event], bookingCalendar: rules } as never);
    vi.mocked(rescheduleLearnerCalendarSession).mockResolvedValue({ event });
    mount(event);
    const button = await screen.findByRole('button', { name: 'Save new time' });
    await waitFor(() => expect(button).toBeEnabled());
    await chooseReviewTime('10:00');
    fireEvent.click(button);
    await waitFor(() => expect(rescheduleLearnerCalendarSession).toHaveBeenCalledWith('apprenticeship', '125', expect.objectContaining({
      eventKey: 'booking:11', expectedBooking: expect.objectContaining({ scheduledTime: '10:00' }),
    })));
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('refreshes the original Aptem booking after a conflict while retaining the learner draft', async () => {
    vi.mocked(fetchLearnerCalendarEvents)
      .mockResolvedValueOnce({ events: [aptem()], bookingCalendar: rules } as never)
      .mockResolvedValueOnce({ events: [aptem('progress-review', { scheduledTime: '14:00', bookingNotes: 'Updated agenda' })], bookingCalendar: rules } as never);
    vi.mocked(rescheduleLearnerCalendarSession)
      .mockRejectedValueOnce(new Error('This booking was changed by another request. Refresh before rescheduling.'))
      .mockResolvedValueOnce({ event: aptem() });
    mount(aptem());
    const button = await screen.findByRole('button', { name: 'Save new time' });
    await waitFor(() => expect(button).toBeEnabled());
    await chooseReviewTime('12:00');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My draft agenda' } });
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh booking' }));
    await waitFor(() => expect(fetchLearnerCalendarEvents).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByLabelText('Time')).toHaveValue('12:00');
    expect(screen.getByRole('textbox')).toHaveValue('My draft agenda');
    fireEvent.click(button);
    await waitFor(() => expect(rescheduleLearnerCalendarSession).toHaveBeenLastCalledWith('apprenticeship', '125', expect.objectContaining({
      notes: 'My draft agenda', scheduledTime: '12:00',
      expectedBooking: expect.objectContaining({ scheduledTime: '14:00', notes: 'Updated agenda' }),
    })));
  });

  it('does not claim an Aptem slot is available when personal calendar availability failed', async () => {
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [aptem()], bookingCalendar: rules } as never);
    vi.mocked(fetchPersonalCalendarAvailability).mockResolvedValue({ busy: [], errors: [{ provider: 'google', message: 'Unavailable' }], connectedProviders: ['google'] });
    mount(aptem());
    expect(await screen.findByText('Personal calendar availability could not be confirmed.')).toBeVisible();
    expect(screen.queryByText('This time is available in your calendar.')).not.toBeInTheDocument();
  });

  it('ignores a late slot response after the learner changes the booking date', async () => {
    let resolveOldSlots!: (slots: string[]) => void;
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [aptem()], bookingCalendar: rules } as never);
    vi.mocked(fetchReviewSlots)
      .mockImplementationOnce(() => new Promise(resolve => { resolveOldSlots = resolve; }))
      .mockResolvedValueOnce(['14:00']);
    mount(aptem());
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Date')).toBeEnabled());
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-10-21' } });
    expect(await within(dialog).findByRole('option', { name: '14:00' })).toBeInTheDocument();
    resolveOldSlots(['09:00']);
    await waitFor(() => expect(within(dialog).queryByRole('option', { name: '09:00' })).not.toBeInTheDocument());
    expect(within(dialog).getByRole('option', { name: '14:00' })).toBeInTheDocument();
  });

  it.each(['progress-review', 'mcr'])('moves the exact Aptem %s booking using the refreshed duration, ignoring its own personal-calendar slot', async source => {
    const event = aptem(source);
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [event], bookingCalendar: rules } as never);
    vi.mocked(fetchPersonalCalendarAvailability).mockResolvedValue({ busy: [{
      provider: 'google', start: '2026-10-20T09:00:00.000Z', end: '2026-10-20T10:30:00.000Z',
    }], errors: [], connectedProviders: ['google'] });
    vi.mocked(rescheduleLearnerCalendarSession).mockResolvedValue({ event });
    mount(aptem(source, { durationMinutes: 60 }), undefined, { calendarEventKey: 'booking:11', durationMinutes: 60 } as MeetingAttendance);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Duration')).toHaveValue('90'));
    expect(within(dialog).getByLabelText('Duration')).toBeEnabled();
    fireEvent.change(within(dialog).getByLabelText('Duration'), { target: { value: '120' } });
    await chooseReviewTime('10:30', dialog);
    const submit = within(dialog).getByRole('button', { name: 'Save new time' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(rescheduleLearnerCalendarSession).toHaveBeenCalledExactlyOnceWith('apprenticeship', '125', expect.objectContaining({
      eventKey: 'booking:11', reviewId: '11', scheduledDate: '2026-10-20', scheduledTime: '10:30', durationMinutes: 120,
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
    await chooseReviewTime('10:00', dialog);
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
    await chooseReviewTime('09:00', dialog);
    fireEvent.click(submit);
    await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('apprenticeship', '125', expect.objectContaining({ reviewId: '11', durationMinutes: 60 })));
    expect(rescheduleLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it.each(['personal', 'lms'])('does not offer a time conflicting with another %s appointment', async calendar => {
    const event = aptem();
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [event, ...(calendar === 'lms' ? [meeting({
      id: 'another', eventKey: 'another', scheduledDate: '2026-10-20', scheduledTime: '11:00', status: 'scheduled',
    })] : [])], bookingCalendar: rules } as never);
    vi.mocked(fetchPersonalCalendarAvailability).mockResolvedValue({ busy: [{
      provider: 'google', start: '2026-10-20T09:00:00.000Z', end: '2026-10-20T10:30:00.000Z',
    }, ...(calendar === 'personal' ? [{ provider: 'google' as const, start: '2026-10-20T10:00:00.000Z', end: '2026-10-20T11:00:00.000Z' }] : [])], errors: [], connectedProviders: ['google'] });
    mount(event);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Duration')).toHaveValue('90'));
    await waitFor(() => expect(within(dialog).getByLabelText('Time')).toBeEnabled());
    expect(within(dialog).queryByRole('option', { name: '10:30' })).not.toBeInTheDocument();
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
    await chooseReviewTime('09:00', dialog);
    await waitFor(() => expect(submit).toBeEnabled());
    const [, , start, end] = vi.mocked(fetchPersonalCalendarAvailability).mock.calls.at(-1)!;
    expect(start).toBe('2026-10-19T23:00:00.000Z');
    expect(end).toBe('2026-10-20T23:00:00.000Z');
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('treats a malformed availability response as unchecked instead of crashing', async () => {
    vi.mocked(fetchPersonalCalendarAvailability).mockResolvedValue({} as never);
    mount(meeting());
    const dialog = await screen.findByRole('dialog', { name: 'Book monthly coaching' });
    expect((await within(dialog).findAllByRole('alert'))[0]).toHaveTextContent('Some connected calendars could not be checked');
    expect(within(dialog).getByRole('button', { name: 'Book session' })).toBeDisabled();
    expect(within(dialog).getByLabelText('Time')).toBeDisabled();
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


describe('planned dates versus reserved appointments', () => {
  it.each([
    ['mcr', true], ['progress-review', true], ['review', false], ['mcr', false],
  ] as const)('defaults a new %s booking to one hour and submits the selected duration (imported=%s)', async (source, imported) => {
    const event = meeting({ source, scheduledDate: '2027-03-01', scheduledTime: null, durationMinutes: 90,
      ...(imported ? { id: 'imported-review:11', eventKey: 'imported-review:11', reviewId: '11', reviewSource: 'aptem',
        importedReview: { id: '11', type: source === 'mcr' ? 'Monthly Coaching Meeting' : 'Progress Review' } as never } : {}),
    });
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [event], bookingCalendar: rules } as never);
    vi.mocked(bookLearnerCalendarSession).mockResolvedValue({ event });
    mount(event);
    await chooseReviewTime('16:00');
    const duration = screen.getByLabelText('Duration');
    expect(duration).toBeEnabled();
    expect(duration).toHaveValue('60');
    fireEvent.change(duration, { target: { value: '90' } });
    await waitFor(() => expect(fetchReviewSlots).toHaveBeenLastCalledWith('apprenticeship', '125', '2027-03-01', 90, expect.anything()));
    expect(screen.getByLabelText('Time')).toHaveValue('');
    expect(screen.queryByRole('option', { name: '16:00' })).not.toBeInTheDocument();
    await chooseReviewTime('15:30');
    fireEvent.click(screen.getByRole('button', { name: 'Book session' }));
    await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('apprenticeship', '125', expect.objectContaining({ durationMinutes: 90, scheduledTime: '15:30' })));
    expect(event.durationMinutes).toBe(90);
    expect(rescheduleLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it.each(['mcr', 'progress-review', 'review'])('normalizes an unreserved Sunday for %s without changing source data', async source => {
    const event = meeting({ source, scheduledDate: '2027-02-28', scheduledTime: null, bookingReserved: false });
    const original = JSON.stringify(event);
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [event], bookingCalendar: rules } as never);
    mount(event);
    await waitFor(() => expect(screen.getByLabelText('Day')).toHaveValue('2027-03-01'));
    await chooseReviewTime('16:00');
    expect(fetchReviewSlots).toHaveBeenLastCalledWith('apprenticeship', '125', '2027-03-01', 60, expect.anything());
    expect(screen.getByLabelText('Day')).toBeEnabled();
    expect(JSON.stringify(event)).toBe(original);
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it.each([
    ['unreserved', { status: 'not-scheduled', bookingReserved: false }, true],
    ['stale overlay with actual booking', { status: 'not-scheduled', bookingStatus: 'scheduled', bookingReserved: true }, false],
    ['active lease', { status: 'not-scheduled', syncState: 'syncing', bookingReserved: true }, false],
    ['cancelled', { status: 'cancelled', bookingReserved: false }, true],
  ] as const)('handles %s in learner overlap checks', async (_name, state, available) => {
    const event = meeting({ scheduledDate: '2027-03-01', bookingReserved: false });
    const other = meeting({ id: 'other', eventKey: 'other', scheduledDate: '2027-03-01', scheduledTime: '11:00', ...state });
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [event, other], bookingCalendar: rules } as never);
    mount(event);
    await waitFor(() => expect(screen.getByLabelText('Time')).toBeEnabled());
    expect(screen.queryByRole('option', { name: '10:30' }) !== null).toBe(available);
    expect(screen.getByRole('option', { name: '10:00' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '12:00' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2027-03-02' } });
    await waitFor(() => expect(screen.getByLabelText('Time')).toBeEnabled());
    expect(screen.getByLabelText('Day')).toHaveValue('2027-03-02');
  });

  it('ignores an old availability response after the learner changes the day', async () => {
    let finish!: (value: string[]) => void;
    vi.mocked(fetchReviewSlots).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(['15:00']);
    mount(meeting());
    await waitFor(() => expect(fetchReviewSlots).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-10-21' } });
    await chooseReviewTime('15:00');
    finish(['09:00']);
    await waitFor(() => expect(screen.getByLabelText('Time')).toHaveValue('15:00'));
    expect(screen.queryByRole('option', { name: '09:00' })).not.toBeInTheDocument();
  });
});


it('keeps an out-of-hours existing booking visible without making it a replacement slot', async () => {
  const event = meeting({ status: 'scheduled', bookingReserved: true, scheduledDate: '2027-03-01', scheduledTime: '18:00', durationMinutes: 60 });
  const original = JSON.stringify(event);
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ events: [event], bookingCalendar: rules } as never);
  mount(event);
  await screen.findByRole('option', { name: '16:00' });
  expect(screen.getByRole('note')).toHaveTextContent('2027-03-01 at 18:00 UK time');
  expect(screen.queryByRole('option', { name: '18:00' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Day')).toHaveValue('2027-03-01');
  expect(screen.getByRole('button', { name: 'Save new time' })).toBeDisabled();
  expect(JSON.stringify(event)).toBe(original);
});
