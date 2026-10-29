import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachCalendarEvent } from './calendarEvents';
import ImportedReviewBookingDialog from './ImportedReviewBookingDialog';
import { importedBookingDefinition, installDialogTestSupport, personalSupportBooking, scheduledImportedBooking } from './__tests__/importedBookingFixtures';

const { fetchForm, initializeForm, book, reschedule, adopt, fetchSlots } = vi.hoisted(() => ({
  fetchForm: vi.fn(), initializeForm: vi.fn(), book: vi.fn(), reschedule: vi.fn(), adopt: vi.fn(), fetchSlots: vi.fn(),
}));
vi.mock('@/api/reviewInstances', () => ({
  fetchReviewInstanceForm: fetchForm, initializeMigratedReview: initializeForm,
  bookMigratedReview: book, rescheduleMigratedReview: reschedule,
  adoptMigratedReviewBooking: adopt, fetchCoachReviewSlots: fetchSlots,
}));
const event: CoachCalendarEvent = {
  id: 'row-31', eventKey: 'imported-review:31', reviewSource: 'aptem', aptemReviewId: '31',
  title: 'Progress review', source: 'progress-review', type: 'review', status: 'not-scheduled',
  learner: 'Synthetic learner', learnerId: '31', targetDate: '2026-09-20',
};
const onSaved = vi.fn();
const onClose = vi.fn();
const mount = (overrides: Partial<Parameters<typeof ImportedReviewBookingDialog>[0]> = {}) => render(
  <ImportedReviewBookingDialog event={event} viewingAsCoach={false} onSaved={onSaved} onClose={onClose} {...overrides} />,
);
async function selectTime(value = '09:00') {
  await screen.findByRole('option', { name: value });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-01T09:00:00Z'));
  installDialogTestSupport();
  fetchForm.mockResolvedValue(importedBookingDefinition());
  fetchSlots.mockResolvedValue(['09:00', '10:00', '14:30', '15:00']);
  book.mockResolvedValue(scheduledImportedBooking());
  reschedule.mockResolvedValue(scheduledImportedBooking());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Aptem booking from a coach list', () => {
  it.each(['Monthly Coaching Meeting', 'Progress Review', 'Progress Review (+ Skills Radar)', 'Personal Support Plan'])('defaults a new %s to an editable hour and sends the chosen duration', async type => {
    const current = type === 'Personal Support Plan' ? personalSupportBooking() : importedBookingDefinition();
    current.booking = { ...current.booking!, durationMinutes: 90 };
    fetchForm.mockResolvedValue(current);
    mount({ event: { ...event, importedReviewType: type, source: type === 'Monthly Coaching Meeting' ? 'mcr' : 'progress-review' } });
    await selectTime();
    const duration = screen.getByLabelText('Duration (minutes)');
    expect(duration).toBeEnabled();
    expect(duration).toHaveValue(60);
    fireEvent.change(duration, { target: { value: '90' } });
    await waitFor(() => expect(fetchSlots).toHaveBeenLastCalledWith(31, expect.any(String), 90, expect.anything()));
    await selectTime();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(book).toHaveBeenCalledWith('imported-review:31', expect.objectContaining({ durationMinutes: 90 })));
  });
  it.each([false, true])('books a PSP summary independently of its read-only form (scheduled=%s)', async scheduled => {
    const current = personalSupportBooking(scheduled);
    fetchForm.mockResolvedValue(current);
    book.mockResolvedValue(personalSupportBooking(true));
    reschedule.mockResolvedValue(personalSupportBooking(true));
    mount({ event: { ...event, importedReviewType: 'Personal Support Plan', hasReviewForm: false } });
    expect(await screen.findByRole('heading', { name: `${scheduled ? 'Reschedule' : 'Schedule'} Personal Support Plan` })).toBeVisible();
    await selectTime();
    fireEvent.click(await screen.findByRole('button', { name: scheduled ? 'Save new time' : 'Confirm booking' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: event.eventKey, calendarEventKey: 'imported-review:31', status: 'scheduled',
    }), scheduled ? 'Review rescheduled.' : 'Review scheduled.'));
    expect(initializeForm).not.toHaveBeenCalled();
    expect(scheduled ? reschedule : book).toHaveBeenCalledOnce();
  });

  it.each(['completed', 'in-progress', 'awaiting-signature', 'cancelled'])('does not bypass PSP lifecycle permissions for %s', async status => {
    const current = personalSupportBooking();
    fetchForm.mockResolvedValue({ ...current, booking: { ...current.booking!, status, canBook: false } });
    mount({ event: { ...event, importedReviewType: 'Personal Support Plan' } });
    await screen.findByText(/Booking is not available/);
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).not.toBeInTheDocument();
  });

  it('keeps PSP booking disabled in coach preview', async () => {
    fetchForm.mockResolvedValue(personalSupportBooking());
    mount({ viewingAsCoach: true });
    await screen.findByText(/coach preview is read-only/);
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).not.toBeInTheDocument();
  });
  it('initializes an eligible summary then books its own review without changing its row identity', async () => {
    fetchForm.mockResolvedValueOnce(importedBookingDefinition({ migratedForm: false, formAvailable: false, canInitialize: true }));
    mount();
    await selectTime();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(initializeForm).toHaveBeenCalledExactlyOnceWith('imported-review:31');
    expect(book).toHaveBeenCalledExactlyOnceWith('imported-review:31', {
      scheduledDate: '2026-09-22', scheduledTime: '09:00', durationMinutes: 60,
      timezoneOffsetMinutes: -60,
    });
    expect(reschedule).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      id: 'row-31', eventKey: 'imported-review:31', learnerId: '31', targetDate: '2026-09-20',
      calendarEventKey: 'native-booking:31', scheduledTime: '10:00', durationMinutes: 75, status: 'scheduled',
    }), 'Review scheduled.');
  });

  it('reschedules using the latest linked booking and its original concurrency values', async () => {
    const current = scheduledImportedBooking();
    fetchForm.mockResolvedValue(current);
    mount({ event: { ...event, eventKey: 'calendar-row:31', formEventKey: 'imported-review:31' } });
    const save = await screen.findByRole('button', { name: 'Save new time' });
    expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(75);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-12-03' } });
    fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '90' } });
    await selectTime('14:30');
    fireEvent.click(save);
    await waitFor(() => expect(reschedule).toHaveBeenCalled());
    expect(fetchForm).toHaveBeenCalledWith('imported-review:31', expect.any(AbortSignal));
    expect(reschedule).toHaveBeenCalledExactlyOnceWith('imported-review:31', {
      scheduledDate: '2026-12-03', scheduledTime: '14:30', durationMinutes: 90,
      timezoneOffsetMinutes: 0,
    }, current.booking);
    expect(book).not.toHaveBeenCalled();
  });

  it('automatically adopts an existing meeting and updates the list with the same slot and identity', async () => {
    const current = scheduledImportedBooking();
    current.template.reviewTypeCode = 'aptem_progress_review';
    fetchForm.mockResolvedValue({ ...current, localStatus: 'not-scheduled', booking: { ...current.booking, canReschedule: false, canAttach: true } });
    adopt.mockResolvedValue(current);
    mount();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      id: 'row-31', eventKey: event.eventKey, calendarEventKey: current.booking!.eventKey,
      status: 'scheduled', scheduledDate: '2026-09-22', scheduledTime: '10:00', durationMinutes: 75,
    }), 'Existing meeting linked automatically.', { keepOpen: true }));
    expect(adopt).toHaveBeenCalledExactlyOnceWith('imported-review:31', expect.any(AbortSignal));
    expect(screen.getByLabelText('Date')).toHaveValue('2026-09-22');
    expect(screen.queryByRole('button', { name: 'Use existing meeting' })).not.toBeInTheDocument();
    expect(book).not.toHaveBeenCalled();
    expect(reschedule).not.toHaveBeenCalled();
    await selectTime('14:30');
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '14:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new time' }));
    await waitFor(() => expect(reschedule).toHaveBeenCalledWith('imported-review:31',
      expect.objectContaining({ scheduledTime: '14:30' }), current.booking));
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith(expect.anything(), 'Review rescheduled.'));
  });

  it('keeps the reschedule form open after a failed adoption is retried', async () => {
    const current = scheduledImportedBooking();
    current.template.reviewTypeCode = 'aptem_progress_review';
    fetchForm.mockResolvedValue({ ...current, localStatus: 'not-scheduled', booking: { ...current.booking!, canReschedule: false, canAttach: true } });
    adopt.mockRejectedValueOnce(new Error('Temporary adoption failure')).mockResolvedValueOnce(current);
    mount();
    await screen.findByText('Temporary adoption failure');
    fireEvent.click(screen.getByRole('button', { name: 'Retry linking meeting' }));
    await selectTime('10:00');
    expect(await screen.findByRole('button', { name: 'Save new time' })).toBeEnabled();
    expect(screen.getByLabelText('Time')).toBeEnabled();
    expect(onSaved).toHaveBeenCalledWith(expect.anything(), 'Existing meeting linked.', { keepOpen: true });
    expect(book).not.toHaveBeenCalled();
    expect(reschedule).not.toHaveBeenCalled();
  });

  it.each(['completed', 'in-progress', 'awaiting-signature', 'cancelled'])('blocks a stale list action when the server now reports %s', async status => {
    fetchForm.mockResolvedValue(importedBookingDefinition({ localStatus: status }));
    mount();
    await screen.findByText(/Booking is not available/);
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).toBeNull();
    expect(book).not.toHaveBeenCalled();
  });

  it.each(['preview', 'readOnly', 'conflict', 'templateConflict', 'ineligible'])('prevents mutation for %s', async kind => {
    const data = importedBookingDefinition();
    fetchForm.mockResolvedValue({ ...data,
      readOnly: kind === 'readOnly',
      booking: { ...data.booking, conflict: kind === 'conflict', canBook: kind !== 'ineligible' },
      ...(kind === 'templateConflict' ? { templateSync: { status: 'conflict' } } : {}),
    });
    mount({ viewingAsCoach: kind === 'preview' });
    await waitFor(() => expect(screen.queryByText('Loading review booking…')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).toBeNull();
    expect(initializeForm).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  it('never initializes a summary while viewing as another coach', async () => {
    fetchForm.mockResolvedValue(importedBookingDefinition({ migratedForm: false, formAvailable: false, canInitialize: true }));
    mount({ viewingAsCoach: true });
    await screen.findByText(/coach preview is read-only/);
    expect(initializeForm).not.toHaveBeenCalled();
  });

  it('shows initialization failure as unavailable and allows a fresh eligibility check', async () => {
    fetchForm.mockResolvedValue(importedBookingDefinition({ migratedForm: false, formAvailable: false, canInitialize: true }));
    initializeForm.mockRejectedValue(new Error('No approved template'));
    mount();
    await screen.findByText(/Booking is not available/);
    expect(book).not.toHaveBeenCalled();
    fetchForm.mockResolvedValue(importedBookingDefinition());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh booking' }));
    await selectTime();
    expect(await screen.findByRole('button', { name: 'Confirm booking' })).toBeEnabled();
  });

  it('keeps inputs after an API error and prevents double submission or dismissal while saving', async () => {
    let reject!: (error: Error) => void;
    book.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    mount();
    const submit = await screen.findByRole('button', { name: 'Confirm booking' });
    await selectTime('15:00');
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(book).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close booking' })).toBeDisabled();
    reject(new Error('The booking changed. Refresh and try again.'));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Time')).toHaveValue('15:00');
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeEnabled();
  });

  it.each(['pending', 'failed'])('reports local save with %s sync instead of claiming a confirmed meeting', async syncState => {
    const saved = scheduledImportedBooking();
    book.mockResolvedValue({ ...saved, booking: { ...saved.booking, booked: false, syncState, meetingLink: null } });
    mount({ event: { ...event, meetingLink: 'https://example.invalid/old-meeting', graphWebLink: 'https://example.invalid/old-event' } });
    await selectTime();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ syncState, meetingLink: undefined, graphWebLink: undefined }), expect.stringContaining('Booking saved in LMS. Microsoft calendar sync')));
  });

  it('shows a load error, retries safely and closes without booking', async () => {
    fetchForm.mockRejectedValueOnce(new Error('Booking could not be loaded'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Booking could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh booking' }));
    await screen.findByRole('button', { name: 'Confirm booking' });
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(book).not.toHaveBeenCalled();
  });
});


it('normalizes an unreserved MCM Sunday without changing source data', async () => {
  const definition = importedBookingDefinition();
  definition.instance.targetDate = '2027-02-28';
  definition.booking = { ...definition.booking!, scheduledDate: '2027-02-28', scheduledTime: null, reserved: false };
  definition.bookingCalendar = { division: 'england-and-wales', today: '2026-09-01', coveredYears: [2026, 2027], bankHolidays: [] };
  const original = JSON.stringify(definition);
  fetchForm.mockResolvedValue(definition);
  render(<ImportedReviewBookingDialog event={{ ...event, source: 'mcr', importedReviewType: 'Monthly Coaching Meeting' }} viewingAsCoach={false} onClose={onClose} onSaved={onSaved} />);
  await screen.findByRole('option', { name: '09:00' });
  expect(screen.getByLabelText('Date')).toHaveValue('2027-03-01');
  expect(fetchSlots).toHaveBeenLastCalledWith(31, '2027-03-01', 60, expect.anything());
  expect(JSON.stringify(definition)).toBe(original);
  expect(book).not.toHaveBeenCalled();
});

it('retries availability without discarding the selected date or duration', async () => {
  fetchSlots.mockRejectedValue(new Error('Synthetic provider failure'));
  render(<ImportedReviewBookingDialog event={event} viewingAsCoach={false} onClose={onClose} onSaved={onSaved} />);
  await screen.findByText(/Synthetic provider failure/);
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2027-03-01' } });
  fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '30' } });
  await screen.findByText(/Synthetic provider failure/);
  fetchSlots.mockResolvedValue(['16:30']);
  fireEvent.click(screen.getByRole('button', { name: 'Retry availability' }));
  await selectTime('16:30');
  expect(screen.getByLabelText('Date')).toHaveValue('2027-03-01');
  expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(30);
  expect(book).not.toHaveBeenCalled();
});
