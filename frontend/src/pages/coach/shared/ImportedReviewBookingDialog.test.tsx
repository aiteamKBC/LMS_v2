import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachCalendarEvent } from './calendarEvents';
import ImportedReviewBookingDialog from './ImportedReviewBookingDialog';
import { importedBookingDefinition, installDialogTestSupport, scheduledImportedBooking } from './__tests__/importedBookingFixtures';

const { fetchForm, initializeForm, book, reschedule } = vi.hoisted(() => ({
  fetchForm: vi.fn(), initializeForm: vi.fn(), book: vi.fn(), reschedule: vi.fn(),
}));
vi.mock('@/api/reviewInstances', () => ({
  fetchReviewInstanceForm: fetchForm, initializeMigratedReview: initializeForm,
  bookMigratedReview: book, rescheduleMigratedReview: reschedule,
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
beforeEach(() => {
  vi.resetAllMocks();
  installDialogTestSupport();
  fetchForm.mockResolvedValue(importedBookingDefinition());
  book.mockResolvedValue(scheduledImportedBooking());
  reschedule.mockResolvedValue(scheduledImportedBooking());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Aptem booking from a coach list', () => {
  it('initializes an eligible summary then books its own review without changing its row identity', async () => {
    fetchForm.mockResolvedValueOnce(importedBookingDefinition({ migratedForm: false, formAvailable: false, canInitialize: true }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(initializeForm).toHaveBeenCalledExactlyOnceWith('imported-review:31');
    expect(book).toHaveBeenCalledExactlyOnceWith('imported-review:31', {
      scheduledDate: '2026-09-22', scheduledTime: '09:00', durationMinutes: 60,
      timezoneOffsetMinutes: new Date('2026-09-22T09:00').getTimezoneOffset(),
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
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '14:30' } });
    fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '90' } });
    fireEvent.click(save);
    await waitFor(() => expect(reschedule).toHaveBeenCalled());
    expect(fetchForm).toHaveBeenCalledWith('imported-review:31', expect.any(AbortSignal));
    expect(reschedule).toHaveBeenCalledExactlyOnceWith('imported-review:31', {
      scheduledDate: '2026-12-03', scheduledTime: '14:30', durationMinutes: 90,
      timezoneOffsetMinutes: new Date('2026-12-03T14:30').getTimezoneOffset(),
    }, current.booking);
    expect(book).not.toHaveBeenCalled();
  });

  it('attaches an existing meeting without changing its slot or creating a new booking', async () => {
    const current = scheduledImportedBooking();
    fetchForm.mockResolvedValue({ ...current, localStatus: 'not-scheduled', booking: { ...current.booking, canReschedule: false, canAttach: true } });
    mount();
    const attach = await screen.findByRole('button', { name: 'Use existing meeting' });
    expect(screen.getByLabelText('Date')).toBeDisabled();
    fireEvent.click(attach);
    await waitFor(() => expect(book).toHaveBeenCalledWith('imported-review:31', expect.objectContaining({ scheduledDate: '2026-09-22', scheduledTime: '10:00', durationMinutes: 75 })));
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
    expect(await screen.findByRole('button', { name: 'Confirm booking' })).toBeEnabled();
  });

  it('keeps inputs after an API error and prevents double submission or dismissal while saving', async () => {
    let reject!: (error: Error) => void;
    book.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    mount();
    const submit = await screen.findByRole('button', { name: 'Confirm booking' });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '15:00' } });
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
